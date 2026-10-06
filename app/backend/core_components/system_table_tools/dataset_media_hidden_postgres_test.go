// dataset_media_hidden_postgres_test.go
// Exercises media hiding through the real migration, header API and tree query.
// Connects disposable PostgreSQL fixtures, uploads and transaction-bound saves.
// Proves that hiding preserves links and files and only visible media affects tabs.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtimepaths"
	esessions "easelect/backend/core_components/sessions"
	"easelect/backend/reusable_components/vanilla_tree"
	"github.com/gorilla/sessions"
)

const datasetMediaHiddenFixture = `
CREATE TABLE system_db_tables (
    id serial PRIMARY KEY, table_uid integer UNIQUE, table_name text, schema_name text DEFAULT 'public',
    folder_id integer, display_name text, search_slogan text, search_placeholder text, icon_key text,
    default_view_id bigint, filterbar_visible_by_default boolean DEFAULT false,
    is_default boolean DEFAULT false, is_main_table boolean DEFAULT false, is_about_table boolean DEFAULT false,
    ui_hidden boolean DEFAULT false
);
CREATE TABLE system_dataset_media (
    id serial PRIMARY KEY, table_uid integer REFERENCES system_db_tables(table_uid), media_role text,
    storage_key text, original_name text, mime_type text, updated timestamptz DEFAULT now(),
    UNIQUE(table_uid, media_role)
);
CREATE TABLE system_column_details (
    table_uid integer, column_name text, data_type text, co_number integer,
    editable_in_ui boolean, created timestamptz, updated timestamptz
);
CREATE TABLE system_lang_keys (
    id serial PRIMARY KEY, lang_key text UNIQUE, fi text, en text, ch text, yue text,
    creation_spec text, created timestamptz DEFAULT now(), updated timestamptz DEFAULT now()
);
CREATE TABLE system_lang_key_sources (
    id serial PRIMARY KEY, lang_key_id integer, source_type text, source_high text, source_low text,
    last_seen date, usage_explanation text, UNIQUE(lang_key_id, source_type, source_high)
);
CREATE TABLE system_languages (language_code text PRIMARY KEY);
CREATE TABLE system_lang_key_translations (
    lang_key_id integer, language_code text, translation text, source_kind text, review_status text,
    updated timestamptz DEFAULT now(), PRIMARY KEY(lang_key_id, language_code)
);
CREATE TABLE system_data_repair_records (migration text, action text, detail jsonb);
CREATE TABLE system_table_folders (id integer, folder_name text, parent_id integer, is_current_project boolean);
CREATE TABLE system_table_views (id bigint, name text);
CREATE TABLE system_user_group_memberships (user_id integer, group_id integer);
INSERT INTO system_user_group_memberships VALUES (41, 1);
INSERT INTO system_languages VALUES ('fi'), ('en');
INSERT INTO system_db_tables (table_uid, table_name) VALUES (104, 'orders'), (105, 'empty'), (106, 'system_dataset_media');
INSERT INTO system_dataset_media (table_uid, media_role, storage_key, original_name, mime_type) VALUES
    (104, 'cover', '104/dataset_media/cover/original/cover.svg', 'cover.svg', 'image/svg+xml'),
    (104, 'background', '104/dataset_media/background/original/background.svg', 'background.svg', 'image/svg+xml');
INSERT INTO system_lang_keys (lang_key, fi, en) VALUES ('dataset_header_config_hide_cover_image', 'Oma kansikuva', 'My cover');
INSERT INTO system_lang_key_translations VALUES (1, 'fi', 'Reviewed cover', 'manual', 'approved', now());
`

func datasetMediaHiddenPostgres(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	if _, err := db.Exec(datasetMediaHiddenFixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../server_tools/migrations/20261005000080_add_dataset_media_hidden.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Replaying the actual upgrade must preserve existing media and reviewed copy.
	for range 2 {
		if _, err := db.Exec(string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	return db
}

func saveHiddenMediaRequest(t *testing.T, db *sql.DB, dataset string, fields map[string]string, uploadRole string, commit bool) datasetHeaderConfigResponse {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("dataset_name", dataset); err != nil {
		t.Fatal(err)
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if uploadRole != "" {
		file, err := writer.CreateFormFile(uploadRole+"_image", "new.svg")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/dataset-header-config/save", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	tx := dbutils.NewLazyTx(db)
	defer tx.Rollback()
	request = request.WithContext(dbutils.SetLazyTx(request.Context(), tx))
	response := httptest.NewRecorder()
	SaveDatasetHeaderConfigHandler(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("save status %d: %s", response.Code, response.Body)
	}
	var payload struct {
		Config datasetHeaderConfigResponse `json:"config"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if commit {
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	return payload.Config
}

func TestDatasetMediaHiddenMigrationAndReadPostgres(t *testing.T) {
	db := datasetMediaHiddenPostgres(t)
	var metadataCount, markerCount int
	var editable bool
	if err := db.QueryRow(`SELECT count(*), bool_or(editable_in_ui) FROM system_column_details
        WHERE table_uid = 106 AND column_name = 'hidden' AND data_type = 'boolean'`).Scan(&metadataCount, &editable); err != nil {
		t.Fatal(err)
	}
	if metadataCount != 1 || editable {
		t.Fatalf("hidden metadata count=%d editable=%v", metadataCount, editable)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_data_repair_records WHERE migration = 'dataset_media_hidden' AND action = 'completed'`).Scan(&markerCount); err != nil {
		t.Fatal(err)
	}
	if markerCount != 1 {
		t.Fatalf("markers=%d", markerCount)
	}
	var fi, normalizedFi, en string
	if err := db.QueryRow(`SELECT k.fi, tr.translation, k.en FROM system_lang_keys k
        JOIN system_lang_key_translations tr ON tr.lang_key_id=k.id AND tr.language_code='fi'
        WHERE k.lang_key='dataset_header_config_hide_cover_image'`).Scan(&fi, &normalizedFi, &en); err != nil {
		t.Fatal(err)
	}
	if fi != "Oma kansikuva" || normalizedFi != "Reviewed cover" || en != "My cover" {
		t.Fatalf("reviewed copy overwritten: %s/%s/%s", fi, normalizedFi, en)
	}
	for _, name := range []string{"orders", "empty"} {
		config, err := readDatasetHeaderConfigWithQueryer(db, name)
		if err != nil {
			t.Fatal(err)
		}
		if config.CoverImageHidden || config.BackgroundImageHidden {
			t.Fatalf("existing media hidden by default: %+v", config)
		}
	}
	if _, err := db.Exec(`UPDATE system_dataset_media SET hidden=true WHERE media_role='cover'`); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	GetDatasetHeaderConfigHandler(response, httptest.NewRequest("GET", "/api/dataset-header-config/orders", nil))
	var config datasetHeaderConfigResponse
	if err := json.Unmarshal(response.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || !config.CoverImageHidden || config.BackgroundImageHidden || config.CoverImagePath == "" || config.BackgroundImagePath == "" {
		t.Fatalf("read status=%d config=%+v", response.Code, config)
	}
}

func TestDatasetHeaderSavesHiddenWithoutDeletingAndRestoresPostgres(t *testing.T) {
	db := datasetMediaHiddenPostgres(t)
	pathsBefore := runtimepaths.Current()
	paths, err := runtimepaths.Resolve(filepath.Join(t.TempDir(), "app"), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtimepaths.Configure(pathsBefore) })
	for _, role := range []string{"cover", "background"} {
		path := filepath.Join(paths.StorageRoot, "104", "dataset_media", role, "original", role+".svg")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("stored image"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	before, err := readDatasetHeaderConfigWithQueryer(db, "orders")
	if err != nil {
		t.Fatal(err)
	}
	hidden := saveHiddenMediaRequest(t, db, "orders", map[string]string{"hide_cover_image": "true", "hide_background_image": "true"}, "", true)
	if !hidden.CoverImageHidden || !hidden.BackgroundImageHidden || hidden.CoverImagePath != before.CoverImagePath || hidden.BackgroundImagePath != before.BackgroundImagePath {
		t.Fatalf("hidden config=%+v", hidden)
	}
	for _, role := range []string{"cover", "background"} {
		if _, err := os.Stat(filepath.Join(paths.StorageRoot, "104", "dataset_media", role, "original", role+".svg")); err != nil {
			t.Fatal("hiding removed file", err)
		}
	}
	// A rolled-back show operation reports its in-transaction state, but leaves stored flags intact.
	show := saveHiddenMediaRequest(t, db, "orders", map[string]string{"hide_cover_image": "false", "hide_background_image": "false"}, "", false)
	persisted, err := readDatasetHeaderConfigWithQueryer(db, "orders")
	if err != nil {
		t.Fatal(err)
	}
	if show.CoverImageHidden || show.BackgroundImageHidden || !persisted.CoverImageHidden || !persisted.BackgroundImageHidden {
		t.Fatal("visibility escaped the transaction")
	}
	shown := saveHiddenMediaRequest(t, db, "orders", map[string]string{"hide_cover_image": "false", "hide_background_image": "false"}, "", true)
	if shown.CoverImageHidden || shown.BackgroundImageHidden || shown.CoverImagePath != before.CoverImagePath {
		t.Fatalf("restored config=%+v", shown)
	}
	for _, role := range []string{"cover", "background"} {
		saved := saveHiddenMediaRequest(t, db, "orders", map[string]string{"hide_" + role + "_image": "true"}, role, true)
		path, hidden := saved.CoverImagePath, saved.CoverImageHidden
		if role == "background" {
			path, hidden = saved.BackgroundImagePath, saved.BackgroundImageHidden
		}
		if !hidden || path == "" {
			t.Fatalf("hidden upload=%+v", saved)
		}
		if _, err := os.Stat(filepath.Join(paths.StorageRoot, path[len("/storage/"):])); err != nil {
			t.Fatal(err)
		}
	}
	empty := saveHiddenMediaRequest(t, db, "empty", map[string]string{"hide_cover_image": "true", "hide_background_image": "true"}, "", true)
	if empty.CoverImageHidden || empty.BackgroundImageHidden || empty.CoverImagePath != "" || empty.BackgroundImagePath != "" {
		t.Fatalf("hide created empty media: %+v", empty)
	}
	removed := saveHiddenMediaRequest(t, db, "orders", map[string]string{"remove_cover_image": "true", "remove_background_image": "true", "hide_cover_image": "true", "hide_background_image": "true"}, "", true)
	if removed.CoverImagePath != "" || removed.BackgroundImagePath != "" || removed.CoverImageHidden || removed.BackgroundImageHidden {
		t.Fatalf("removal lost precedence: %+v", removed)
	}
}

func TestGroupedTablesIgnoresHiddenMediaPostgres(t *testing.T) {
	db := datasetMediaHiddenPostgres(t)
	for _, tc := range []struct{ cover, background, want bool }{{false, false, true}, {true, false, true}, {false, true, true}, {true, true, false}} {
		if _, err := db.Exec(`UPDATE system_dataset_media SET hidden=CASE WHEN media_role='cover' THEN $1::boolean ELSE $2::boolean END`, tc.cover, tc.background); err != nil {
			t.Fatal(err)
		}
		rows, err := db.Query(buildGroupedTablesQuery("NULL::varchar AS icon_key"))
		if err != nil {
			t.Fatal(err)
		}
		seen := false
		for rows.Next() {
			var id, uid int
			var name string
			var isDefault, filterbar, main, about, current, top, hasMedia bool
			var folder sql.NullInt64
			var icon sql.NullString
			if err := rows.Scan(&id, &uid, &name, &isDefault, &filterbar, &main, &about, &folder, &current, &top, &icon, &hasMedia); err != nil {
				t.Fatal(err)
			}
			if name == "orders" {
				seen = true
				if hasMedia != tc.want {
					t.Fatalf("flags=%+v media=%v", tc, hasMedia)
				}
			}
			if name == "empty" && hasMedia {
				t.Fatal("empty slot counts as presentation media")
			}
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		if !seen {
			t.Fatal("missing orders")
		}
	}
}

func TestTreeCarriesDatasetHiddenFlagsPostgres(t *testing.T) {
	db := datasetMediaHiddenPostgres(t)
	if _, err := db.Exec(`UPDATE system_dataset_media SET hidden=true WHERE media_role='cover'`); err != nil {
		t.Fatal(err)
	}
	previousStore, previousName := esessions.Store, esessions.SessionName
	esessions.Store = sessions.NewCookieStore([]byte("dataset-media-test-cookie-key-32"))
	esessions.SessionName = "session"
	t.Cleanup(func() { esessions.Store, esessions.SessionName = previousStore, previousName })
	request := httptest.NewRequest("GET", "/api/tree-data", nil)
	session, err := esessions.Store.Get(request, esessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 41
	cookies := httptest.NewRecorder()
	if err := session.Save(request, cookies); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookies.Result().Cookies() {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	vanilla_tree.GetTreeDataHandler(response, request)
	if response.Code != 200 {
		t.Fatalf("tree status %d: %s", response.Code, response.Body)
	}
	var payload struct {
		Nodes []vanilla_tree.TreeNode `json:"nodes"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, node := range payload.Nodes {
		if node.Name != "orders" {
			continue
		}
		seen = true
		if node.DatasetCoverImageHidden == nil || !*node.DatasetCoverImageHidden || node.DatasetBackgroundImageHidden == nil || *node.DatasetBackgroundImageHidden || node.DatasetCoverImagePath == nil || node.DatasetBackgroundImagePath == nil {
			t.Fatalf("tree media=%+v", node)
		}
	}
	if !seen {
		t.Fatal("missing orders tree node")
	}
}
