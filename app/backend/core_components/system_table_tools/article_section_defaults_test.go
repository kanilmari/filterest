// article_section_defaults_test.go
// Verifies typed article-default patches, authorization and presentation isolation.
// Connects actual migration06 and handler requests to a disposable PostgreSQL fixture.
// Prevents stale concurrent saves and reset from overwriting unrelated settings.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

func TestArticleSectionPatchRejectsAmbiguousOrInvalidInput(t *testing.T) {
	prefix := `{"dataset":"fixture","presentation_key":"classic",`
	for _, body := range []string{
		"", "null", "[]", "{}",
		prefix + `"initial_open":{}}`, prefix + `"initial_open":null}`,
		prefix + `"initial_open":{"details":null}}`, prefix + `"initial_open":{"details":"false"}}`,
		prefix + `"initial_open":{"details":0}}`, prefix + `"initial_open":{"unknown":true}}`,
		prefix + `"initial_open":{"images":[]}}`, prefix + `"reset_to_defaults":false}`,
		prefix + `"reset_to_defaults":null}`, prefix + `"reset_to_defaults":"true"}`,
		prefix + `"reset_to_defaults":true,"initial_open":{"details":false}}`,
		prefix + `"reset_to_defaults":true,"target_scope":"groups"}`,
		`{"dataset":"fixture","presentation_key":"image_first","initial_open":{"images":false}}`,
		`{"dataset":"fixture","presentation_key":"unknown","initial_open":{"details":false}}`,
		`{"dataset":"fixture;drop","presentation_key":"classic","reset_to_defaults":true}`,
		prefix + `"reset_to_defaults":true} {}`,
	} {
		if _, err := decodeArticleSectionPatch(strings.NewReader(body)); err == nil {
			t.Errorf("accepted %s", body)
		}
		rec := httptest.NewRecorder()
		SaveArticleSectionDefaultsHandler(rec, httptest.NewRequest(http.MethodPost, "/api/admin/view-field-settings/article-section-defaults", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d for %s", rec.Code, body)
		}
	}
}

func TestArticleSectionDefaultsMissingKeysOpenAndViewsStayIndependent(t *testing.T) {
	stored, err := decodeStoredArticleSectionDefaults([]byte(`{"classic":{"details":false,"images":true},"image_first":{"details":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	classic := articleSectionDefaultsResponse("fixture", "classic", stored, true)
	if classic.InitialOpen["details"] || !classic.InitialOpen["attachments"] || !classic.InitialOpen["task_progress"] || len(classic.Overrides) != 2 {
		t.Fatalf("classic %#v", classic)
	}
	image := articleSectionDefaultsResponse("fixture", "image_first", stored, false)
	if !image.InitialOpen["details"] || len(image.InitialOpen) != 1 || image.CanEdit {
		t.Fatalf("image_first %#v", image)
	}
	missing := articleSectionDefaultsResponse("other", "classic", map[string]map[string]bool{}, false)
	if len(missing.Overrides) != 0 || len(missing.InitialOpen) != 5 {
		t.Fatalf("missing %#v", missing)
	}
	for _, value := range missing.InitialOpen {
		if !value {
			t.Fatal("missing key must open")
		}
	}
	for _, raw := range []string{"null", "[]", `{"classic":null}`, `{"classic":{"details":null}}`, `{"image_first":{"images":true}}`, `{"other":{}}`} {
		if _, err := decodeStoredArticleSectionDefaults([]byte(raw)); err == nil {
			t.Errorf("accepted invalid storage %s", raw)
		}
	}
	for _, body := range []string{
		`{"dataset":"fixture","presentation_key":"classic","initial_open":{"details":false,"images":true}}`,
		`{"dataset":"fixture","presentation_key":"image_first","initial_open":{"details":false}}`,
		`{"dataset":"fixture","presentation_key":"classic","reset_to_defaults":true}`,
	} {
		if _, err := decodeArticleSectionPatch(strings.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
}

func articleSectionFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	_, err := db.Exec(`
 CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text,schema_name text DEFAULT 'public',metadata jsonb);
 CREATE TABLE system_user_groups(id integer PRIMARY KEY,name text);
 CREATE TABLE system_user_group_memberships(user_id integer,group_id integer);
 -- disabled mirrors the real column: the permission check reads it, so a
 -- fixture without it would pass for a reason production does not share.
 CREATE TABLE system_functions(id integer PRIMARY KEY,url_route_endpoint text,disabled boolean DEFAULT false);
 CREATE TABLE system_group_table_func_rights(function_id integer,user_group_id integer,target_table_uid integer);
 CREATE TABLE system_column_details(column_uid integer,metadata jsonb);
 INSERT INTO system_db_tables VALUES(1,'fixture','public','{"card_style_variant":"modern","layout":"stacked"}'),(2,'other','public','{}'),(3,'private_dataset','public','{}');
 INSERT INTO system_column_details VALUES(1,'{"show_key_on_card":false,"card_element":"details"}');
 INSERT INTO system_user_groups VALUES(1,'guests'),(2,'users'),(3,'admins');
 INSERT INTO system_user_group_memberships VALUES(1,1),(2,2),(42,3);
 INSERT INTO system_functions VALUES(1,'/api/get-results');
 INSERT INTO system_group_table_func_rights VALUES(1,1,1),(1,2,1),(1,3,1),(1,3,2);
 `)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20260914000006_add_article_section_initial_open.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(migration)); err != nil {
		t.Fatalf("actual migration06: %v", err)
	}
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	return db
}

func articleSectionRequest(t *testing.T, db *sql.DB, method, dataset, presentation, patch string, userID int, commit bool) (int, ArticleSectionDefaultsResponse) {
	t.Helper()
	path := "/api/view-field-settings/article-section-defaults?dataset=" + dataset + "&presentation_key=" + presentation
	body := ""
	handler := GetArticleSectionDefaultsHandler
	if method == http.MethodPost {
		path = "/api/admin/view-field-settings/article-section-defaults"
		body = `{"dataset":"` + dataset + `","presentation_key":"` + presentation + `",` + patch + "}"
		handler = SaveArticleSectionDefaultsHandler
	}
	request := datasetSortRequestWithUser(t, method, path, body, userID)
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
	rec := httptest.NewRecorder()
	handler(rec, request)
	var result ArticleSectionDefaultsResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if commit {
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
		}
	}
	return rec.Code, result
}

func TestArticleSectionDefaultsAuthorizationAndPersistencePostgres(t *testing.T) {
	db := articleSectionFixture(t)
	get := func(dataset, presentation string, userID, wantStatus int) ArticleSectionDefaultsResponse {
		t.Helper()
		status, result := articleSectionRequest(t, db, http.MethodGet, dataset, presentation, "", userID, false)
		if status != wantStatus {
			t.Fatalf("GET %s/%s user %d status=%d want=%d", dataset, presentation, userID, status, wantStatus)
		}
		return result
	}
	save := func(presentation, patch string, commit bool) ArticleSectionDefaultsResponse {
		t.Helper()
		status, result := articleSectionRequest(t, db, http.MethodPost, "fixture", presentation, patch, 42, commit)
		if status != http.StatusOK {
			t.Fatalf("save status=%d", status)
		}
		return result
	}
	for _, user := range []int{1, 2, 42} {
		initial := get("fixture", "classic", user, http.StatusOK)
		if initial.CanEdit != (user == 42) || len(initial.Overrides) != 0 || !initial.InitialOpen["details"] {
			t.Fatalf("initial user=%d %#v", user, initial)
		}
	}
	get("private_dataset", "classic", 1, http.StatusForbidden)
	get("private_dataset", "classic", 42, http.StatusForbidden)
	get("missing", "classic", 42, http.StatusNotFound)
	get("fixture", "classic", 0, http.StatusUnauthorized)
	for _, user := range []int{1, 2} {
		status, _ := articleSectionRequest(t, db, http.MethodPost, "fixture", "classic", `"initial_open":{"details":false}`, user, true)
		want := http.StatusForbidden
		if user == 1 {
			want = http.StatusUnauthorized
		}
		if status != want {
			t.Fatalf("nonadmin write user%d status=%d", user, status)
		}
	}
	save("classic", `"initial_open":{"details":false,"images":false}`, true)
	save("image_first", `"initial_open":{"details":false}`, true)
	save("classic", `"initial_open":{"attachments":false}`, true)
	current := get("fixture", "classic", 1, http.StatusOK)
	if current.InitialOpen["details"] || current.InitialOpen["images"] || current.InitialOpen["attachments"] || !current.InitialOpen["related_rows"] {
		t.Fatalf("patch lost keys %#v", current)
	}
	save("classic", `"reset_to_defaults":true`, false)
	if get("fixture", "classic", 42, http.StatusOK).InitialOpen["details"] {
		t.Fatal("rollback reset persisted")
	}
	reset := save("classic", `"reset_to_defaults":true`, true)
	if len(reset.Overrides) != 0 || !reset.InitialOpen["details"] {
		t.Fatalf("reset %#v", reset)
	}
	if get("fixture", "image_first", 1, http.StatusOK).InitialOpen["details"] {
		t.Fatal("reset crossed presentation")
	}
	other := get("other", "classic", 42, http.StatusOK)
	if len(other.Overrides) != 0 {
		t.Fatal("patch crossed dataset")
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT metadata='{"card_style_variant":"modern","layout":"stacked"}'::jsonb FROM system_db_tables WHERE table_uid=1`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("dataset metadata changed: %v", err)
	}
	if err := db.QueryRow(`SELECT metadata='{"show_key_on_card":false,"card_element":"details"}'::jsonb FROM system_column_details WHERE column_uid=1`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("column metadata changed: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE system_db_tables DROP COLUMN article_section_initial_open`); err != nil {
		t.Fatal(err)
	}
	get("fixture", "classic", 42, http.StatusConflict)
}

func TestArticleSectionDefaultsConcurrentPatchesPostgres(t *testing.T) {
	db := articleSectionFixture(t)
	first, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback()
	_, err = persistArticleSectionDefaults(first, 1, articleSectionDefaultsPatch{Dataset: "fixture", PresentationKey: "classic", InitialOpen: map[string]bool{"details": false}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	second, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Rollback()
	if _, err = second.Exec("SET LOCAL application_name='article-section-concurrent-test'"); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := persistArticleSectionDefaults(second, 1, articleSectionDefaultsPatch{Dataset: "fixture", PresentationKey: "classic", InitialOpen: map[string]bool{"images": false}})
		finished <- err
	}()
	waiting := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='article-section-concurrent-test' AND wait_event_type='Lock')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("second patch did not wait for dataset row lock")
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := second.Commit(); err != nil {
		t.Fatal(err)
	}
	stored, err := readArticleSectionDefaults(db, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stored["classic"], map[string]bool{"details": false, "images": false}) {
		t.Fatalf("lost concurrent patch: %#v", stored)
	}
}
