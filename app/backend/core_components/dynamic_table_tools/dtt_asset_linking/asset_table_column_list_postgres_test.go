// asset_table_column_list_postgres_test.go
// Proves on a disposable PostgreSQL cluster carrying Filterest's own public
// bootstrap that turning pictures on for a dataset made from a column list
// creates the same image table as before, its columns now in a fixed order.
// Exists because the image table's columns were a map and so came out in a
// random order; their set, types, defaults, link and trigger must not change.
package dtt_asset_linking

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
)

// loadAssetTestBootstrap gives the disposable cluster the schema and seed a
// fresh installation starts from.
func loadAssetTestBootstrap(t *testing.T, db *sql.DB) {
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

// postInLazyTransaction runs one route the way the request middleware does:
// in a lazy transaction that only a success commits.
func postInLazyTransaction(t *testing.T, db *sql.DB, handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	lt := dbutils.NewLazyTx(db)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handler(rec, req.WithContext(dbutils.SetLazyTx(req.Context(), lt)))
	if rec.Code >= http.StatusOK && rec.Code < http.StatusBadRequest {
		if err := lt.Commit(); err != nil {
			t.Fatalf("commit: %v", err)
		}
	} else {
		_ = lt.Rollback()
	}
	return rec
}

// physicalColumns lists a table's columns by attnum as "name type default".
func physicalColumns(t *testing.T, db *sql.DB, table string) []string {
	t.Helper()
	rows, err := db.Query(`
		SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
		       || COALESCE(' ' || pg_get_expr(d.adbin, d.adrelid), '')
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = to_regclass('public.' || $1) AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, table)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatal(err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return columns
}

func TestImageTableKeepsItsColumnSetInListOrderPostgres(t *testing.T) {
	db := previewTestDB(t)
	loadAssetTestBootstrap(t, db)

	if rec := postInLazyTransaction(t, db, dtt_crud_workflows.CreateTableHandler, `{
		"dataset_name": "wl135_places", "folder_id": 4,
		"column_list": [
			{"name": "id", "data_type": "SERIAL"},
			{"name": "created", "data_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"},
			{"name": "updated", "data_type": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"},
			{"name": "name", "data_type": "TEXT", "card_role": "header"},
			{"name": "address", "data_type": "TEXT"}
		]}`); rec.Code != http.StatusCreated {
		t.Fatalf("create dataset: status=%d body=%s", rec.Code, rec.Body)
	}
	if rec := postInLazyTransaction(t, db, EnableImageAssetLinkingHandler, `{"parent_table":"wl135_places"}`); rec.Code != http.StatusCreated {
		t.Fatalf("enable pictures: status=%d body=%s", rec.Code, rec.Body)
	}

	// The same fourteen columns, types and defaults the map used to create,
	// now in one order: identity, parent link, file details, timestamps.
	wantChild := []string{
		"id integer nextval('wl135_places_assets_id_seq'::regclass)",
		"wl135_places_id integer",
		"asset_kind text",
		"filename text",
		"original_name text",
		"mime_type text",
		"size_bytes bigint",
		"title text",
		"description text",
		"sort_order integer 0",
		"is_primary boolean false",
		"metadata_json jsonb",
		"created timestamp with time zone now()",
		"updated timestamp with time zone now()",
	}
	if got := physicalColumns(t, db, "wl135_places_assets"); !reflect.DeepEqual(got, wantChild) {
		t.Fatalf("image table columns =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(wantChild, "\n"))
	}
	// The parent keeps its list order, then the creator and owner columns every new
	// dataset gets last (WL58); the picture cache comes after them.
	wantParent := []string{
		"id integer nextval('wl135_places_id_seq'::regclass)",
		"created timestamp with time zone now()",
		"updated timestamp with time zone now()",
		"name text",
		"address text",
		"created_by bigint app_request_actor_id()",
		"owner_id bigint app_request_actor_id()",
		"cached_image text",
	}
	if got := physicalColumns(t, db, "wl135_places"); !reflect.DeepEqual(got, wantParent) {
		t.Fatalf("parent columns =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(wantParent, "\n"))
	}

	var referenced, onDelete string
	if err := db.QueryRow(`SELECT confrelid::regclass::text, confdeltype::text FROM pg_constraint
		WHERE conname = 'fk_wl135_places_assets_wl135_places_id' AND contype = 'f'`).Scan(&referenced, &onDelete); err != nil {
		t.Fatal(err)
	}
	if referenced != "wl135_places" || onDelete != "c" {
		t.Fatalf("image link refers to %s with delete action %q, want wl135_places and cascade", referenced, onDelete)
	}
	var triggers, relations int
	if err := db.QueryRow(`SELECT count(*) FROM pg_trigger
		WHERE tgrelid = 'public.wl135_places_assets'::regclass AND tgname = 'update_wl135_places_assets_timestamp' AND NOT tgisinternal`).Scan(&triggers); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_foreign_key_relations_1_m r
		JOIN system_db_tables child ON child.table_uid = r.source_table_uid
		JOIN system_db_tables parent ON parent.table_uid = r.target_table_uid
		WHERE child.table_name = 'wl135_places_assets' AND parent.table_name = 'wl135_places'
		  AND r.source_column_name = 'wl135_places_id'`).Scan(&relations); err != nil {
		t.Fatal(err)
	}
	if triggers != 1 || relations != 1 {
		t.Fatalf("updated triggers=%d relation rows=%d, want one of each", triggers, relations)
	}
}
