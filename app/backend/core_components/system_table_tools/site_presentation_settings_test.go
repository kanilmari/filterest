// site_presentation_settings_test.go
// Locks the public allowlist, administrator write contract, and visual defaults.
// Connects public/admin request validation with the typed configuration writer.
// Exists so presentation settings cannot widen into arbitrary system_config access.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	_ "github.com/lib/pq"
)

func TestDefaultSitePresentationSettingsMatchApprovedThemeContract(t *testing.T) {
	settings := defaultSitePresentationSettings()
	light := settings.DatasetCoverTheme.Light
	dark := settings.DatasetCoverTheme.Dark
	shared := settings.DatasetCoverTheme.Shared

	if !light.OvalEnabled || light.OvalWidth != 32 || light.OvalHeight != 67 || light.OvalPositionY != 56 {
		t.Fatalf("light oval defaults = %#v", light)
	}
	if light.CenterOpacity != 0.4 || light.MidOpacity != 0.7 || light.EdgeOpacity != 1 {
		t.Fatalf("light opacity defaults = %#v", light)
	}
	if light.CenterStop != 39 || light.MidStop != 55 || light.EdgeStop != 80 {
		t.Fatalf("light stop defaults = %#v", light)
	}
	if light.ImageOpacity != 1 || light.OverlayOpacity != 0 {
		t.Fatalf("light image defaults = %#v", light)
	}
	if light.ImageBlur != 1 {
		t.Fatalf("light blur default = %#v", light)
	}
	if dark.OvalEnabled || dark.ImageOpacity != 0.3 || dark.OverlayOpacity != 0 || dark.ImageBlur != 1 {
		t.Fatalf("dark defaults = %#v", dark)
	}
	if shared.HeroExtraHeight != 40 || shared.HeroBottomFade != 48 || shared.ImageBlur != 1 {
		t.Fatalf("shared hero defaults = %#v", shared)
	}
	if shared.CardImageWidth != 300 || shared.ActiveTabFade != 25 || shared.ActiveTabMaxOpacity != 1 || shared.BrandColor != "#1a8fe6" {
		t.Fatalf("shared defaults = %#v", shared)
	}
	if shared.CardStyleVariant != "modern" {
		t.Fatalf("site card style default = %q", shared.CardStyleVariant)
	}
	if !shared.CardShowAllFields {
		t.Fatal("card_show_all_fields must default to true")
	}
	if shared.CardDescriptionLines != 2 {
		t.Fatalf("card description line default = %d", shared.CardDescriptionLines)
	}
	if shared.ActiveTabGlowIntensity != 0.5 || shared.ActiveTabGlowWidth != 2 || shared.ActiveTabGlowBlur != 4 {
		t.Fatalf("shared glow defaults = %#v", shared)
	}
	// The stylesheet's own --filterbar-content-top-space default is the same 40px.
	if shared.FilterbarContentTopSpace != defaultFilterbarContentTopSpace {
		t.Fatalf("hero header top space default = %v", shared.FilterbarContentTopSpace)
	}
	if settings.RowArticleTimestampDisplayMode != rowArticleTimestampDateTime {
		t.Fatalf("timestamp mode = %q", settings.RowArticleTimestampDisplayMode)
	}
}

func TestSitePresentationGlowDefaultsPreserveStoredChoices(t *testing.T) {
	config := defaultSitePresentationSettings().DatasetCoverTheme
	// Database reads merge persisted JSON onto defaults, preserving deliberate older choices.
	raw := `{"shared":{"active_tab_glow_intensity":0.3,"active_tab_glow_width":1.5,"active_tab_glow_blur":2,"brand_color":"#00aa77","card_detail_columns":4}}`
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatal(err)
	}
	settings := defaultSitePresentationSettings()
	settings.DatasetCoverTheme = config
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeSitePresentationSettings(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if decoded != settings {
		t.Fatal("validated save must preserve the full settings, including existing glow choices")
	}
	shared := decoded.DatasetCoverTheme.Shared
	if shared.ActiveTabGlowIntensity != 0.3 || shared.ActiveTabGlowWidth != 1.5 || shared.ActiveTabGlowBlur != 2 {
		t.Fatalf("stored glow choices replaced by new defaults: %#v", shared)
	}
}

func TestLegacySharedImageBlurFeedsMissingThemeValues(t *testing.T) {
	config := defaultSitePresentationSettings().DatasetCoverTheme
	config.Shared.ImageBlur = 4
	raw := `{"light":{"image_opacity":1},"dark":{"image_opacity":0.3},"shared":{"image_blur":4}}`
	inheritLegacyImageBlur(raw, &config)

	if config.Light.ImageBlur != 4 || config.Dark.ImageBlur != 4 {
		t.Fatalf("legacy blur inheritance = light %v, dark %v", config.Light.ImageBlur, config.Dark.ImageBlur)
	}

	raw = `{"light":{"image_blur":0},"dark":{"image_blur":2},"shared":{"image_blur":4}}`
	config.Light.ImageBlur = 1
	config.Dark.ImageBlur = 1
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatal(err)
	}
	inheritLegacyImageBlur(raw, &config)
	if config.Light.ImageBlur != 0 || config.Dark.ImageBlur != 2 {
		t.Fatalf("explicit theme blur values must win = light %v, dark %v", config.Light.ImageBlur, config.Dark.ImageBlur)
	}
}

func TestSitePresentationUpsertsDoNotRequireOptionalValueTypeCatalog(t *testing.T) {
	for name, statement := range map[string]string{
		"cover JSON":     upsertDatasetCoverThemeSQL,
		"timestamp text": upsertRowArticleTimestampDisplaySQL,
	} {
		t.Run(name, func(t *testing.T) {
			if strings.Contains(statement, "system_config_value_data_types") {
				t.Fatal("portable upsert must not require the optional value-type catalog")
			}
			if strings.Contains(statement, "value_type") {
				t.Fatal("portable upsert must preserve optional value_type metadata")
			}
		})
	}
}

func TestGetSitePresentationSettingsHandlerReturnsOnlyTypedAllowlist(t *testing.T) {
	originalRead := readSitePresentationSettings
	t.Cleanup(func() { readSitePresentationSettings = originalRead })
	readSitePresentationSettings = func() (SitePresentationSettingsResponse, error) {
		return defaultSitePresentationSettings(), nil
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/site-presentation-settings", nil)
	GetSitePresentationSettingsHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload) != 3 || payload["dataset_cover_theme"] == nil || payload["row_article_timestamp_display_mode"] == nil {
		t.Fatalf("public payload keys = %#v", payload)
	}
}

func TestAdminSitePresentationSettingsHandlerPersistsValidatedWholeObject(t *testing.T) {
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = originalPersist })

	settings := defaultSitePresentationSettings()
	settings.Version = "none"
	settings.DatasetCoverTheme.Dark.OverlayOpacity = 0.25
	settings.RowArticleTimestampDisplayMode = rowArticleTimestampDateOnly
	var persisted SitePresentationSettingsResponse
	persistSitePresentationSettings = func(_ *http.Request, input SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		persisted = input
		return input, nil
	}
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/site-presentation-settings",
		bytes.NewReader(body),
	)
	AdminSitePresentationSettingsHandler(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if persisted.DatasetCoverTheme.Dark.OverlayOpacity != 0.25 {
		t.Fatalf("persisted dark theme = %#v", persisted.DatasetCoverTheme.Dark)
	}
	if persisted.RowArticleTimestampDisplayMode != rowArticleTimestampDateOnly {
		t.Fatalf("persisted timestamp mode = %q", persisted.RowArticleTimestampDisplayMode)
	}
}

func TestAdminSitePresentationSettingsHandlerRejectsIncompleteUnknownAndInvalidValues(t *testing.T) {
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = originalPersist })
	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		t.Fatal("invalid settings reached persistence")
		return SitePresentationSettingsResponse{}, nil
	}

	validBody, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	unknown := strings.Replace(
		string(validBody),
		`"row_article_timestamp_display_mode":"date_time"`,
		`"row_article_timestamp_display_mode":"date_time","secret_key":"leak"`,
		1,
	)
	invalidStop := strings.Replace(string(validBody), `"center_stop":39`, `"center_stop":90`, 1)
	invalidMode := strings.Replace(string(validBody), `"date_time"`, `"relative"`, 1)
	invalidCardWidth := strings.Replace(string(validBody), `"card_image_width":300`, `"card_image_width":601`, 1)
	invalidCardDescriptionLines := strings.Replace(
		string(validBody),
		`"card_description_lines":2`,
		`"card_description_lines":0`,
		1,
	)
	invalidThemeBlur := strings.Replace(string(validBody), `"image_blur":1`, `"image_blur":25`, 1)
	invalidGlowIntensity := strings.Replace(
		string(validBody),
		`"active_tab_glow_intensity":0.5`,
		`"active_tab_glow_intensity":1.1`,
		1,
	)
	invalidTabMaxOpacity := strings.Replace(
		string(validBody),
		`"active_tab_max_opacity":1`,
		`"active_tab_max_opacity":1.1`,
		1,
	)
	invalidBrandColor := strings.Replace(string(validBody), `"brand_color":"#1a8fe6"`, `"brand_color":"red"`, 1)

	for name, body := range map[string]string{
		"incomplete":                `{"dataset_cover_theme":{}}`,
		"unknown":                   unknown,
		"invalid stops":             invalidStop,
		"invalid mode":              invalidMode,
		"invalid card width":        invalidCardWidth,
		"invalid description lines": invalidCardDescriptionLines,
		"invalid theme blur":        invalidThemeBlur,
		"invalid glow":              invalidGlowIntensity,
		"invalid tab opacity":       invalidTabMaxOpacity,
		"invalid brand colour":      invalidBrandColor,
		"trailing":                  string(validBody) + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/admin/site-presentation-settings",
				strings.NewReader(body),
			)
			AdminSitePresentationSettingsHandler(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminSitePresentationSettingsHandlerReportsReadAndWriteFailures(t *testing.T) {
	originalRead := readSitePresentationSettings
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() {
		readSitePresentationSettings = originalRead
		persistSitePresentationSettings = originalPersist
	})
	readSitePresentationSettings = func() (SitePresentationSettingsResponse, error) {
		return SitePresentationSettingsResponse{}, errors.New("read failed")
	}
	getResponse := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(
		getResponse,
		httptest.NewRequest(http.MethodGet, "/api/admin/site-presentation-settings", nil),
	)
	if getResponse.Code != http.StatusInternalServerError {
		t.Fatalf("GET status = %d", getResponse.Code)
	}

	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		return SitePresentationSettingsResponse{}, errors.New("write failed")
	}
	settings := defaultSitePresentationSettings()
	settings.Version = "none"
	body, _ := json.Marshal(settings)
	postResponse := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(
		postResponse,
		httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", bytes.NewReader(body)),
	)
	if postResponse.Code != http.StatusInternalServerError {
		t.Fatalf("POST status = %d", postResponse.Code)
	}
}

// Legacy payloads remain complete except for the one newly optional boolean.
func sitePresentationCardFieldsBody(t *testing.T, value string) string {
	t.Helper()
	settings := defaultSitePresentationSettings()
	settings.Version = "none"
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	if value == "omitted" {
		return strings.Replace(string(body), `"card_show_all_fields":true,`, "", 1)
	}
	return strings.Replace(string(body), `"card_show_all_fields":true`, `"card_show_all_fields":`+value, 1)
}

func TestCardShowAllFieldsRequestPresenceAndBooleanContract(t *testing.T) {
	for _, value := range []string{"omitted", "true", "false"} {
		t.Run(value, func(t *testing.T) {
			settings, err := decodeSitePresentationSettings(strings.NewReader(sitePresentationCardFieldsBody(t, value)))
			if err != nil {
				t.Fatal(err)
			}
			if settings.DatasetCoverTheme.Shared.CardShowAllFields != (value != "false") {
				t.Fatalf("decoded card_show_all_fields = %v", settings.DatasetCoverTheme.Shared.CardShowAllFields)
			}
			if settings.preserveStoredCardShowAllFields != (value == "omitted") {
				t.Fatalf("omission metadata = %v", settings.preserveStoredCardShowAllFields)
			}
		})
	}
}

func TestAdminSitePresentationSettingsRejectsNonBooleanCardFieldValues(t *testing.T) {
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = originalPersist })
	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		t.Fatal("non-boolean card setting reached persistence")
		return SitePresentationSettingsResponse{}, nil
	}
	for _, value := range []string{"null", `"true"`, "0", "1", "{}", "[]"} {
		t.Run(value, func(t *testing.T) {
			response := httptest.NewRecorder()
			AdminSitePresentationSettingsHandler(response, httptest.NewRequest(http.MethodPost,
				"/api/admin/site-presentation-settings", strings.NewReader(sitePresentationCardFieldsBody(t, value))))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d", response.Code)
			}
		})
	}
}

func TestAdminSitePresentationSettingsReturnsPreservedFalseForLegacyClient(t *testing.T) {
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = originalPersist })
	persistSitePresentationSettings = func(_ *http.Request, settings SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		if !settings.preserveStoredCardShowAllFields || !settings.DatasetCoverTheme.Shared.CardShowAllFields {
			t.Fatalf("legacy request must preserve existing value while defaulting a new config: %#v", settings)
		}
		settings.DatasetCoverTheme.Shared.CardShowAllFields = false
		return settings, nil
	}
	response := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(response, httptest.NewRequest(http.MethodPost,
		"/api/admin/site-presentation-settings", strings.NewReader(sitePresentationCardFieldsBody(t, "omitted"))))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var payload SitePresentationSettingsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.DatasetCoverTheme.Shared.CardShowAllFields {
		t.Fatal("response reported input default instead of preserved false")
	}
}

// The existing opt-in test convention starts a private socket-only PostgreSQL
// cluster. Its schema and writes are fixtures, never the native application DB.
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

func TestSitePresentationPersistencePreservesCardFieldsAtomicallyPostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	save := func(input SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		lazy := dbutils.NewLazyTx(db)
		defer lazy.Rollback()
		r := httptest.NewRequest("POST", "/api/admin/site-presentation-settings", nil)
		result, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), input)
		if err == nil {
			err = lazy.Commit()
		}
		return result, err
	}
	initial, err := readSitePresentationSettingsFromDB()
	if err != nil || initial.Version != "none" {
		t.Fatal(initial, err)
	}
	first, err := save(initial)
	if err != nil || first.Version == initial.Version {
		t.Fatal(first, err)
	}
	if _, err = save(initial); err == nil {
		t.Fatal("stale absent-row shared editor accepted")
	}
	legacy := first
	legacy.preserveStoredCardStyleVariant = true
	legacy.preserveStoredCardDetailColumns = true
	legacy.DatasetCoverTheme.Shared.CardStyleVariant = "standard"
	legacy.DatasetCoverTheme.Shared.CardDetailColumns = 4
	second, err := save(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if second.DatasetCoverTheme.Shared.CardStyleVariant != "modern" || second.DatasetCoverTheme.Shared.CardDetailColumns != 2 {
		t.Fatal("omitted choices not preserved", second)
	}
}

func sitePresentationStyleBody(t *testing.T, value string) string {
	t.Helper()
	settings := defaultSitePresentationSettings()
	settings.Version = "none"
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	if value == "omitted" {
		return strings.Replace(string(body), `"card_style_variant":"modern",`, "", 1)
	}
	return strings.Replace(string(body), `"card_style_variant":"modern"`, `"card_style_variant":`+value, 1)
}

func TestSiteCardStyleRequestPresenceAndValidation(t *testing.T) {
	for _, value := range []string{"omitted", `"modern"`, `"standard"`} {
		t.Run(value, func(t *testing.T) {
			settings, err := decodeSitePresentationSettings(strings.NewReader(sitePresentationStyleBody(t, value)))
			if err != nil {
				t.Fatal(err)
			}
			want := "modern"
			if value == `"standard"` {
				want = "standard"
			}
			if settings.DatasetCoverTheme.Shared.CardStyleVariant != want || settings.preserveStoredCardStyleVariant != (value == "omitted") {
				t.Fatalf("decoded style/presence = %#v", settings)
			}
		})
	}
	previous := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = previous })
	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		t.Fatal("invalid style reached persistence")
		return SitePresentationSettingsResponse{}, nil
	}
	for _, value := range []string{"null", "false", "1", "{}", "[]", `""`, `"floating"`, `"Modern"`} {
		t.Run(value, func(t *testing.T) {
			response := httptest.NewRecorder()
			AdminSitePresentationSettingsHandler(response, httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", strings.NewReader(sitePresentationStyleBody(t, value))))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d", response.Code)
			}
		})
	}
}

func TestSiteCardStyleLegacyResponseReturnsPersistedValue(t *testing.T) {
	previous := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = previous })
	persistSitePresentationSettings = func(_ *http.Request, settings SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
		if !settings.preserveStoredCardStyleVariant {
			t.Fatal("legacy style not preserved")
		}
		settings.DatasetCoverTheme.Shared.CardStyleVariant = "standard"
		return settings, nil
	}
	response := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(response, httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", strings.NewReader(sitePresentationStyleBody(t, "omitted"))))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var saved SitePresentationSettingsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.DatasetCoverTheme.Shared.CardStyleVariant != "standard" {
		t.Fatal("response returned input default instead of committed style")
	}
}

func TestCardDetailColumnPresenceAndValidation(t *testing.T) {
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"omitted", "1", "2", "3", "4", "null", "0", "5", "1.5", "true", "\"2\""} {
		t.Run(value, func(t *testing.T) {
			input := strings.Replace(string(body), `"card_detail_columns":2`, `"card_detail_columns":`+value, 1)
			if value == "omitted" {
				input = strings.Replace(string(body), `"card_detail_columns":2,`, "", 1)
			}
			settings, err := decodeSitePresentationSettings(strings.NewReader(input))
			valid := value == "omitted" || value == "1" || value == "2" || value == "3" || value == "4"
			if (err == nil) != valid {
				t.Fatalf("value %s: err=%v", value, err)
			}
			if !valid {
				return
			}
			want := 2
			if value != "omitted" {
				want = int(value[0] - '0')
			}
			if settings.DatasetCoverTheme.Shared.CardDetailColumns != want || settings.preserveStoredCardDetailColumns != (value == "omitted") {
				t.Fatalf("wrong decoded columns or presence: %+v", settings)
			}
		})
	}
}
