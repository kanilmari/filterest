// site_presentation_settings_test.go
// Locks the public allowlist, administrator write contract, and visual defaults.
// Exists so presentation settings cannot widen into arbitrary system_config access.
package system_table_tools

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	if dark.OvalEnabled || dark.ImageOpacity != 0.3 || dark.OverlayOpacity != 0 {
		t.Fatalf("dark defaults = %#v", dark)
	}
	if shared.HeroExtraHeight != 40 || shared.ImageBlur != 1 {
		t.Fatalf("shared defaults = %#v", shared)
	}
	if settings.RowArticleTimestampDisplayMode != rowArticleTimestampDateTime {
		t.Fatalf("timestamp mode = %q", settings.RowArticleTimestampDisplayMode)
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
	if len(payload) != 2 || payload["dataset_cover_theme"] == nil || payload["row_article_timestamp_display_mode"] == nil {
		t.Fatalf("public payload keys = %#v", payload)
	}
}

func TestSitePresentationHandlersEnforceMethodContract(t *testing.T) {
	publicResponse := httptest.NewRecorder()
	GetSitePresentationSettingsHandler(
		publicResponse,
		httptest.NewRequest(http.MethodPost, "/api/site-presentation-settings", nil),
	)
	if publicResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("public POST status = %d", publicResponse.Code)
	}

	adminResponse := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(
		adminResponse,
		httptest.NewRequest(http.MethodDelete, "/api/admin/site-presentation-settings", nil),
	)
	if adminResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("admin DELETE status = %d", adminResponse.Code)
	}
}

func TestAdminSitePresentationSettingsHandlerPersistsValidatedWholeObject(t *testing.T) {
	originalPersist := persistSitePresentationSettings
	t.Cleanup(func() { persistSitePresentationSettings = originalPersist })

	settings := defaultSitePresentationSettings()
	settings.DatasetCoverTheme.Dark.OverlayOpacity = 0.25
	settings.RowArticleTimestampDisplayMode = rowArticleTimestampDateOnly
	var persisted SitePresentationSettingsResponse
	persistSitePresentationSettings = func(_ *http.Request, input SitePresentationSettingsResponse) error {
		persisted = input
		return nil
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
	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) error {
		t.Fatal("invalid settings reached persistence")
		return nil
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

	for name, body := range map[string]string{
		"incomplete":    `{"dataset_cover_theme":{}}`,
		"unknown":       unknown,
		"invalid stops": invalidStop,
		"invalid mode":  invalidMode,
		"trailing":      string(validBody) + `{}`,
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

	persistSitePresentationSettings = func(_ *http.Request, _ SitePresentationSettingsResponse) error {
		return errors.New("write failed")
	}
	body, _ := json.Marshal(defaultSitePresentationSettings())
	postResponse := httptest.NewRecorder()
	AdminSitePresentationSettingsHandler(
		postResponse,
		httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", bytes.NewReader(body)),
	)
	if postResponse.Code != http.StatusInternalServerError {
		t.Fatalf("POST status = %d", postResponse.Code)
	}
}
