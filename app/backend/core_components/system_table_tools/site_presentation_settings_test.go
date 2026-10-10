// site_presentation_settings_test.go
// Proves the public 7/9 allowlist and revision-protected site patch protocol.
// Connects handlers, strict ownership and persisted omission behavior.
// Uses only synthetic disposable storage for transaction proofs.
package system_table_tools

import (
	"database/sql"
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"errors"
	_ "github.com/lib/pq"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDefaultSitePresentationSettingsMatchApprovedThemeContract(t *testing.T) {
	settings := defaultSitePresentationSettings()
	if settings.SchemaVersion != 2 || len(settings.SiteValues) != 7 || len(settings.Defaults) != 9 || validateSitePresentationSettings(settings) != nil {
		t.Fatal(settings)
	}
	data, _ := json.Marshal(settings)
	if strings.Contains(string(data), "dataset_cover_theme") || strings.Contains(string(data), "tab_values") || strings.Contains(string(data), "image_blur") {
		t.Fatal("public cover leak", string(data))
	}
}

func TestGetSitePresentationSettingsHandlerReturnsOnlyTypedAllowlist(t *testing.T) {
	previous := readSitePresentationSettings
	defer func() { readSitePresentationSettings = previous }()
	readSitePresentationSettings = func() (SitePresentationSettingsResponse, error) { return defaultSitePresentationSettings(), nil }
	w := httptest.NewRecorder()
	GetSitePresentationSettingsHandler(w, httptest.NewRequest("GET", "/api/site-presentation-settings", nil))
	var payload map[string]any
	if json.Unmarshal(w.Body.Bytes(), &payload) != nil || w.Code != 200 || len(payload) != 5 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, key := range []string{"schema_version", "version", "site_values", "defaults", "row_article_timestamp_display_mode"} {
		if _, ok := payload[key]; !ok {
			t.Fatal(key)
		}
	}
}

func TestAdminSitePresentationSettingsHandlerPersistsValidatedPatch(t *testing.T) {
	previous := persistSitePresentationSettings
	defer func() { persistSitePresentationSettings = previous }()
	persistSitePresentationSettings = func(r *http.Request, p SitePresentationSettingsPatch) (SitePresentationSettingsResponse, error) {
		if p.Set["shared.card_show_all_fields"] != false || p.Version != "loaded" {
			t.Fatal(p)
		}
		result := defaultSitePresentationSettings()
		result.Defaults["shared.card_show_all_fields"] = false
		result.Version = "saved"
		return result, nil
	}
	w := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(w, httptest.NewRequest("POST", "/api/admin/site-presentation-settings", strings.NewReader(`{"schema_version":2,"version":"loaded","set":{"shared.card_show_all_fields":false}}`)))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"shared.card_show_all_fields":false`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestSitePresentationPatchOwnershipAndValues(t *testing.T) {
	rules := appearance.Rules()
	for _, path := range rules.CanonicalPaths() {
		field, _ := rules.Field(path)
		raw, _ := json.Marshal(map[string]any{"schema_version": 2, "set": map[string]any{path: field.Default}})
		_, err := decodeSitePresentationSettings(strings.NewReader(string(raw)))
		if (err == nil) != (field.Place != appearance.TabOnly) {
			t.Fatal(path, err)
		}
	}
	for _, body := range []string{`null`, `{}`, `[]`, `{"schema_version":2,"set":null}`, `{"schema_version":2,"set":{"shared.brand_color":null}}`, `{"schema_version":2,"set":{},"unknown":1}`, `{"schema_version":2,"set":{}} {}`, `{"schema_version":2,"set":{},"version":42}`, `{"schema_version":2,"set":{},"row_article_timestamp_display_mode":false}`} {
		if _, err := decodeSitePresentationSettings(strings.NewReader(body)); err == nil {
			t.Fatal(body)
		}
	}
	for _, v := range []any{float64(0), float64(12.5), float64(200)} {
		assertSitePatchValue(t, "shared.filterbar_content_top_space", v, true)
	}
	for _, v := range []any{nil, -1, 201, true, "40"} {
		assertSitePatchValue(t, "shared.filterbar_content_top_space", v, false)
	}
}

func assertSitePatchValue(t *testing.T, path string, value any, valid bool) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"schema_version": 2, "set": map[string]any{path: value}})
	patch, err := decodeSitePresentationSettings(strings.NewReader(string(raw)))
	if (err == nil) != valid {
		t.Fatal(path, value, err)
	}
	if valid {
		want, _ := json.Marshal(value)
		got, _ := json.Marshal(patch.Set[path])
		if string(want) != string(got) {
			t.Fatal("value changed")
		}
	}
}

func TestAdminSitePresentationSettingsHandlerReportsReadAndWriteFailures(t *testing.T) {
	read, persist := readSitePresentationSettings, persistSitePresentationSettings
	defer func() { readSitePresentationSettings = read; persistSitePresentationSettings = persist }()
	readSitePresentationSettings = func() (SitePresentationSettingsResponse, error) {
		return SitePresentationSettingsResponse{}, errors.New("fixture")
	}
	w := httptest.NewRecorder()
	GetSitePresentationSettingsHandler(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 500 {
		t.Fatal(w.Code)
	}
	persistSitePresentationSettings = func(*http.Request, SitePresentationSettingsPatch) (SitePresentationSettingsResponse, error) {
		return SitePresentationSettingsResponse{}, errors.New("fixture")
	}
	w = httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"schema_version":2,"version":"loaded","set":{}}`)))
	if w.Code != 500 {
		t.Fatal(w.Code)
	}
}

func TestSitePresentationPersistencePreservesOmissionsAndTimestampPostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	save := func(p SitePresentationSettingsPatch) (SitePresentationSettingsResponse, error) {
		lazy := dbutils.NewLazyTx(db)
		defer lazy.Rollback()
		r := httptest.NewRequest("POST", "/", nil)
		result, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), p)
		if err == nil {
			err = lazy.Commit()
		}
		return result, err
	}
	initial, err := readSitePresentationSettingsWith(db)
	if err != nil {
		t.Fatal(err)
	}
	timestamp := "date_only"
	saved, err := save(SitePresentationSettingsPatch{SchemaVersion: 2, Version: initial.Version, Set: map[string]any{"shared.card_show_all_fields": false, "shared.filterbar_content_top_space": 0}, RowArticleTimestampDisplayMode: &timestamp})
	if err != nil {
		t.Fatal(err)
	}
	stale := SitePresentationSettingsPatch{SchemaVersion: 2, Version: initial.Version, Set: map[string]any{}}
	_, err = save(stale)
	assertDatasetAppearanceRefusal(t, err, 409)
	next, err := save(SitePresentationSettingsPatch{SchemaVersion: 2, Version: saved.Version, Set: map[string]any{"shared.brand_color": "#abcdef"}})
	if err != nil || next.Version == saved.Version || next.Defaults["shared.card_show_all_fields"] != false || next.Defaults["shared.filterbar_content_top_space"] != float64(0) || next.RowArticleTimestampDisplayMode != timestamp {
		t.Fatal(next, err)
	}
	before, err := readSitePresentationSettingsWith(db)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	// The store's site revision uses the same durable raw/stamp token as public reads.
	_, version, err := store.ReadShared(tx, false)
	if err != nil || version != before.Version {
		t.Fatal(version, err)
	}
	tx.Rollback()
	after, err := readSitePresentationSettingsWith(db)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal(after, err)
	}
}

func sitePresentationDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	root, err := os.MkdirTemp("", "filterest-presentation-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Errorf("remove test cluster: %v", err)
		}
	})
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15462", "-w", "start")
	t.Cleanup(func() {
		if output, err := exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil {
			t.Errorf("stop test PostgreSQL: %v: %s", err, output)
		}
	})
	db, err := sql.Open("postgres", "host="+socket+" port=15462 user=test_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE public.system_config (
		key text PRIMARY KEY, json_value jsonb, text_value text, creation_spec text, updated timestamptz
	)`); err != nil {
		t.Fatal(err)
	}
	return db
}
