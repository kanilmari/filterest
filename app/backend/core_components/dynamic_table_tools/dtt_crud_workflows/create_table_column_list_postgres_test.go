// create_table_column_list_postgres_test.go
// Proves on a disposable PostgreSQL cluster carrying Filterest's own public
// bootstrap that a new dataset keeps the order of its column list.
// Runs CreateTableHandler end to end as the request middleware does: attnum
// and co_number follow the request, the column settings reach the metadata,
// the foreign key and the updated trigger stay, both creation wrappers keep
// their behaviour, and the retired columns map is refused with nothing made.
package dtt_crud_workflows

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_3_table_create "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"github.com/lib/pq"
)

// loadPublicBootstrap gives a disposable cluster the schema and seed a fresh
// installation starts from, so creation runs against the real metadata tables.
func loadPublicBootstrap(t *testing.T, db *sql.DB) {
	t.Helper()
	root := filepath.Join("..", "..", "..", "..", "server_tools", "public_bootstrap")
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		script, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(script)); err != nil {
			t.Fatalf("load %s: %v", name, err)
		}
	}
}

// postCreateDataset sends one creation request the way the request
// middleware runs it: in a lazy transaction that only a success commits.
func postCreateDataset(t *testing.T, db *sql.DB, body string) *httptest.ResponseRecorder {
	t.Helper()
	lt := dbutils.NewLazyTx(db)
	req := httptest.NewRequest(http.MethodPost, "/api/create_dataset", strings.NewReader(body))
	rec := httptest.NewRecorder()
	CreateTableHandler(rec, req.WithContext(dbutils.SetLazyTx(req.Context(), lt)))
	if rec.Code >= http.StatusOK && rec.Code < http.StatusBadRequest {
		if err := lt.Commit(); err != nil {
			t.Fatalf("commit: %v", err)
		}
	} else {
		_ = lt.Rollback()
	}
	return rec
}

type createdColumnState struct {
	Role              string
	Multilingual      bool
	VisibilityGate    bool
	SortNumber        sql.NullInt64
	HideInFilterPanel bool
}

func TestCreatedDatasetKeepsItsColumnListOrderPostgres(t *testing.T) {
	db, _ := registrationDisposableDB(t)
	loadPublicBootstrap(t, db)

	if rec := postCreateDataset(t, db, `{"dataset_name":"wl135_categories","folder_id":4,
		"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`); rec.Code != http.StatusCreated {
		t.Fatalf("referenced dataset: status=%d body=%s", rec.Code, rec.Body)
	}

	// Neither alphabetical nor any order a map could fall into reliably.
	order := []string{"id", "created", "updated", "name", "description", "website", "keywords", "category_id", "published", "created_by", "owner_id"}
	rec := postCreateDataset(t, db, `{
		"dataset_name": "wl135_services", "folder_id": 4, "new_columns_multilingual": false,
		"column_list": [
			{"name": "id", "data_type": "SERIAL", "card_role": "hidden"},
			{"name": "created", "data_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "card_role": "hidden"},
			{"name": "updated", "data_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()", "card_role": "hidden"},
			{"name": "name", "data_type": "TEXT NOT NULL", "card_role": "header", "is_multilingual": true, "sortable": true},
			{"name": "description", "data_type": "TEXT", "card_role": "description", "is_multilingual": true},
			{"name": "website", "data_type": "TEXT", "card_role": "details_link10"},
			{"name": "keywords", "data_type": "TEXT", "card_role": "keywords", "hide_in_filter_panel": true},
			{"name": "category_id", "data_type": "INTEGER", "sortable": true},
			{"name": "published", "data_type": "BOOLEAN NOT NULL DEFAULT FALSE", "card_role": "hidden", "visibility_gate": true}
		],
		"foreign_keys": [{"referencing_column": "category_id", "referenced_dataset": "wl135_categories", "referenced_column": "id"}]
	}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}

	// PostgreSQL numbers the columns in creation order (attnum), and the
	// metadata sync copies that number to co_number.
	rows, err := db.Query(`
		SELECT a.attname, a.attnum, cd.co_number, COALESCE(cd.card_element, ''), cd.is_multilingual,
		       COALESCE(cd.must_be_true_unless_own, false), cd.sco_number, COALESCE(cd.hide_in_filter_panel, false)
		FROM pg_attribute a
		JOIN system_db_tables dt ON dt.table_name = 'wl135_services' AND dt.schema_name = 'public'
		JOIN system_column_details cd ON cd.table_uid = dt.table_uid AND cd.column_name = a.attname
		WHERE a.attrelid = 'public.wl135_services'::regclass AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	got := map[string]createdColumnState{}
	for rows.Next() {
		var name string
		var attnum, coNumber int
		var state createdColumnState
		if err := rows.Scan(&name, &attnum, &coNumber, &state.Role, &state.Multilingual,
			&state.VisibilityGate, &state.SortNumber, &state.HideInFilterPanel); err != nil {
			t.Fatal(err)
		}
		if coNumber != attnum || attnum != len(names)+1 {
			t.Fatalf("%s: attnum=%d co_number=%d, want both %d", name, attnum, coNumber, len(names)+1)
		}
		names = append(names, name)
		got[name] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(names, order) {
		t.Fatalf("columns by attnum = %v, want the request order %v", names, order)
	}
	first, second := sql.NullInt64{Int64: 1, Valid: true}, sql.NullInt64{Int64: 2, Valid: true}
	want := map[string]createdColumnState{
		"id":          {Role: "hidden"},
		"created":     {Role: "hidden"},
		"updated":     {Role: "hidden"},
		"name":        {Role: "header", Multilingual: true, SortNumber: first},
		"description": {Role: "description", Multilingual: true},
		"website":     {Role: "details_link10"},
		"keywords":    {Role: "keywords", HideInFilterPanel: true},
		"category_id": {Role: "details", SortNumber: second},
		"published":   {Role: "hidden", VisibilityGate: true},
		"created_by":  {Role: "hidden", HideInFilterPanel: true},
		"owner_id":    {Role: "hidden", HideInFilterPanel: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("column metadata =\n%+v\nwant\n%+v", got, want)
	}

	var folderID int
	var multilingualDefault sql.NullBool
	if err := db.QueryRow(`SELECT folder_id, new_columns_multilingual FROM system_db_tables
		WHERE table_name = 'wl135_services' AND schema_name = 'public'`).Scan(&folderID, &multilingualDefault); err != nil {
		t.Fatal(err)
	}
	if folderID != 4 || multilingualDefault != (sql.NullBool{Bool: false, Valid: true}) {
		t.Fatalf("folder=%d language default=%+v, want folder 4 and an explicit false", folderID, multilingualDefault)
	}

	// The foreign key and the updated trigger are made exactly as before.
	var referenced, onDelete string
	if err := db.QueryRow(`SELECT confrelid::regclass::text, confdeltype::text FROM pg_constraint
		WHERE conname = 'fk_wl135_services_category_id' AND contype = 'f'`).Scan(&referenced, &onDelete); err != nil {
		t.Fatal(err)
	}
	if referenced != "wl135_categories" || onDelete != "a" {
		t.Fatalf("foreign key refers to %s with delete action %q, want wl135_categories and no action", referenced, onDelete)
	}
	mustExec := func(query string) {
		t.Helper()
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO wl135_categories(title) VALUES ('Health')`)
	mustExec(`INSERT INTO wl135_services(name, category_id, updated) VALUES ('Clinic', 1, '2000-01-01')`)
	mustExec(`UPDATE wl135_services SET website = 'https://example.com'`)
	var published, touched bool
	if err := db.QueryRow(`SELECT published, updated > '2001-01-01' FROM wl135_services`).Scan(&published, &touched); err != nil {
		t.Fatal(err)
	}
	if published || !touched {
		t.Fatalf("published=%v trigger touched updated=%v, want the default false and a moved timestamp", published, touched)
	}
	var pqErr *pq.Error
	if _, err := db.Exec(`INSERT INTO wl135_services(name, category_id) VALUES ('Orphan', 999)`); !errors.As(err, &pqErr) || pqErr.Code != "23503" {
		t.Fatalf("an unknown category must be refused by the foreign key, got %v", err)
	}

	// The retired maps are refused, and nothing of the refused dataset exists.
	for _, body := range []string{
		`{"dataset_name":"wl135_legacy","folder_id":4,"columns":{"id":"SERIAL","title":"TEXT"}}`,
		`{"dataset_name":"wl135_legacy","folder_id":4,"column_list":[{"name":"id","data_type":"SERIAL"}],"column_card_roles":{"id":"details"}}`,
	} {
		if rec := postCreateDataset(t, db, body); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unknown field") {
			t.Fatalf("%s: status=%d body=%s, want 400 naming the unknown field", body, rec.Code, rec.Body)
		}
	}
	var leftovers bool
	if err := db.QueryRow(`SELECT to_regclass('public.wl135_legacy') IS NOT NULL
		OR EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = 'wl135_legacy')`).Scan(&leftovers); err != nil {
		t.Fatal(err)
	}
	if leftovers {
		t.Fatal("a refused request left a table or its registration behind")
	}

	// The managed-child wrapper still creates only what is missing, and the
	// new-dataset wrapper still refuses a table that exists.
	child := []dtt_3_table_create.ColumnDefinition{{Name: "id", DataType: "SERIAL"}, {Name: "note", DataType: "TEXT"}}
	for attempt := 0; attempt < 2; attempt++ {
		if err := dtt_3_table_create.CreateTableInDatabase(db, "wl135_child", child, nil); err != nil {
			t.Fatalf("idempotent creation, attempt %d: %v", attempt+1, err)
		}
	}
	if err := dtt_3_table_create.CreateNewTableInDatabase(db, "wl135_child", child, nil); !errors.As(err, &pqErr) || pqErr.Code != "42P07" {
		t.Fatalf("strict creation of an existing table = %v, want 42P07", err)
	}
}
