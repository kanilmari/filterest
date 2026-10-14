// custom_root_settings_test.go
// Verifies the administrator switch's strict request form and transactional persistence.
// Reuses Home's decoder and disposable PostgreSQL fixture rather than another settings API.
// Keeps older clients compatible and proves no setting seed or migration is needed.
package system_table_tools

import (
	"context"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestCustomRootAdminSwitchStrictBooleanAndOlderClients(t *testing.T) {
	base := `{"settings":{"separate_front_page":false,"front_page_button_shows_site_name":false`
	for _, value := range []string{"true", "false"} {
		request, err := decodeFrontPageAdminRequest(strings.NewReader(base + `,"display_index_html_at_startup":` + value + `}}`))
		if err != nil || request.Settings.DisplayIndexHTMLAtStartup == nil || *request.Settings.DisplayIndexHTMLAtStartup != (value == "true") {
			t.Fatal(request, err)
		}
	}
	request, err := decodeFrontPageAdminRequest(strings.NewReader(base + `}}`))
	if err != nil || request.Settings.DisplayIndexHTMLAtStartup != nil {
		t.Fatal(request, err)
	}
	for _, value := range []string{`"true"`, "1", "{}", "[]"} {
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(base + `,"display_index_html_at_startup":` + value + `}}`)); err == nil {
			t.Fatal("invalid switch accepted", value)
		}
	}
}

func TestCustomRootSettingsPostgresSavePreserveAndDisable(t *testing.T) {
	db := frontPageDisposableDB(t)
	settings, err := backend.ReadFrontPageSettings(context.Background(), db)
	if err != nil || settings.DisplayIndexHTMLAtStartup {
		t.Fatal(settings, err)
	}
	for _, body := range []string{
		`{"settings":{"separate_front_page":false,"front_page_button_shows_site_name":false,"display_index_html_at_startup":true}}`,
		`{"settings":{"separate_front_page":true,"front_page_button_shows_site_name":false}}`,
		`{"settings":{"separate_front_page":false,"front_page_button_shows_site_name":false,"display_index_html_at_startup":false}}`,
	} {
		request, err := decodeFrontPageAdminRequest(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := frontPageTestSave(db, request); err != nil {
			t.Fatal(err)
		}
		settings, err = backend.ReadFrontPageSettings(context.Background(), db)
		want := request.Settings.DisplayIndexHTMLAtStartup == nil || *request.Settings.DisplayIndexHTMLAtStartup
		if err != nil || settings.DisplayIndexHTMLAtStartup != want {
			t.Fatal(settings, err)
		}
		if frontPageCount(t, db, `SELECT count(*) FROM public.system_config WHERE key='display_index_html_at_startup' AND value_type=2 AND text_value=boolean_value::text AND json_value=jsonb_build_object('value',boolean_value)`) != 1 {
			t.Fatal("inconsistent saved setting")
		}
	}
}
