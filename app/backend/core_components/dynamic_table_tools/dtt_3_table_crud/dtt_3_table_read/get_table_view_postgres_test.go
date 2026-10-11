// get_table_view_postgres_test.go
// Exercises the metadata handler against the complete public bootstrap schema.
// Connects the published columns/data API to PostgreSQL's real registry columns.
// Uses only an opt-in disposable Unix-socket cluster, never installation data.
package dtt_3_table_read

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	backend "easelect/backend/core_components"
	_ "github.com/lib/pq"
)

// tableViewBootstrapDB follows the public-bootstrap fixture in
// system_table_tools/front_page_postgres_test.go, with no TCP listener or
// installation credentials. An enabled run must fail if setup is unavailable.
func tableViewBootstrapDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root, err := os.MkdirTemp("", "filterest-t904-postgres-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("disposable %s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", "-h '' -k '"+socket+"' -p 15904", "-w", "start")
	t.Cleanup(func() { run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop") })
	db, err := sql.Open("postgres", "host="+socket+" port=15904 user=fixture_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	bootstrap := filepath.Join("..", "..", "..", "..", "..", "server_tools", "public_bootstrap")
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		content, err := os.ReadFile(filepath.Join(bootstrap, name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(content)); err != nil {
			t.Fatalf("load public bootstrap %s: %v", name, err)
		}
	}
	return db
}

func TestTableViewMetadataUsesBootstrapSchemaPostgres(t *testing.T) {
	db := tableViewBootstrapDB(t)
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })

	// Fixture rows exist only in this disposable bootstrap database. Different
	// view names and ids prove both the dataset filter and the default-view join.
	if _, err := db.Exec(`
		INSERT INTO public.system_table_views (id, name, view_key) VALUES
			(904001, 'Grid view', 't904_grid'), (904002, 'Card view', 't904_card');
		INSERT INTO public.system_db_tables (table_uid, table_name, schema_name, default_view_id) VALUES
			(904001, 't904_with_view', 'public', 904001),
			(904002, 't904_without_view', 'public', NULL),
			(904003, 't904_other_view', 'public', 904002);
	`); err != nil {
		t.Fatalf("seed metadata fixture: %v", err)
	}

	// Obtain the complete column list from PostgreSQL rather than reproducing
	// the registry schema in a mock or a smaller handwritten CREATE TABLE.
	rows, err := db.Query(`SELECT * FROM public.system_db_tables LIMIT 0`)
	if err != nil {
		t.Fatal(err)
	}
	registryColumns, err := rows.Columns()
	_ = rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	wantColumns := append(registryColumns, "default_view_name")
	for _, test := range []struct {
		name, dataset string
		uid           float64
		viewID, view  any
		rowCount      int
	}{
		{"default view", "t904_with_view", 904001, float64(904001), "Grid view", 1},
		{"no default view", "t904_without_view", 904002, nil, nil, 1},
		{"another default view", "t904_other_view", 904003, float64(904002), "Card view", 1},
		{"unknown dataset", "t904_missing", 0, nil, nil, 0},
		{"dataset is a bound value", "t904_with_view' OR true --", 0, nil, nil, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/get-metadata?"+url.Values{"dataset": {test.dataset}}.Encode(), nil)
			response := httptest.NewRecorder()
			GetTableViewHandlerWrapper(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("metadata status=%d body=%s, want 200", response.Code, response.Body.String())
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Fatalf("Content-Type=%q, want application/json", got)
			}
			var envelope map[string]json.RawMessage
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if len(envelope) != 2 || envelope["columns"] == nil || envelope["data"] == nil {
				t.Fatalf("metadata envelope changed: %s", response.Body.String())
			}
			var columns []string
			var data []map[string]any
			if err := json.Unmarshal(envelope["columns"], &columns); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(envelope["data"], &data); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(columns, wantColumns) || data == nil || len(data) != test.rowCount {
				t.Fatalf("metadata columns/data changed: %s", response.Body.String())
			}
			if test.rowCount == 0 {
				return
			}
			row := data[0]
			if len(row) != len(columns) || row["table_uid"] != test.uid || row["table_name"] != test.dataset ||
				row["default_view_id"] != test.viewID || row["default_view_name"] != test.view {
				t.Fatalf("unexpected dataset or default view: %+v", row)
			}
			for _, column := range columns {
				if _, ok := row[column]; !ok {
					t.Fatalf("registry column %q missing from row", column)
				}
			}
		})
	}
}
