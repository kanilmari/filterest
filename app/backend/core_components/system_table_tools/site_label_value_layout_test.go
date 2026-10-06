// site_label_value_layout_test.go
// Verifies the site's wrapping choice, development boundary and omission-safe save.
// Connects the browser's shared contract fixture with the settings reader and writer.
// Uses only a disposable PostgreSQL cluster for saves alongside other shared keys.
package system_table_tools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

func TestSiteLabelValueLayoutContract(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/site_label_value_layout.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Environment, Value, Expected string }
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Environment+"/"+tc.Value, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", tc.Environment)
			if got := normalizeSiteLabelValueLayout(tc.Value); got != tc.Expected {
				t.Fatalf("normalized layout = %q, want %q", got, tc.Expected)
			}
			settings := defaultSitePresentationSettings()
			settings.DatasetCoverTheme.Shared.LabelValueLayout = tc.Value
			body, err := json.Marshal(settings)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := decodeSitePresentationSettings(strings.NewReader(string(body)))
			if tc.Value == "auto" && tc.Environment != "dev" {
				if err == nil {
					t.Fatal("Automatic save accepted outside development")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := decoded.DatasetCoverTheme.Shared.LabelValueLayout; got != tc.Expected {
				t.Fatalf("decoded layout = %q, want %q", got, tc.Expected)
			}
		})
	}
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	omitted := strings.Replace(string(body), `"label_value_layout":"stacked",`, "", 1)
	settings, err := decodeSitePresentationSettings(strings.NewReader(omitted))
	if err != nil {
		t.Fatal(err)
	}
	if !settings.preserveStoredLabelValueLayout || settings.DatasetCoverTheme.Shared.LabelValueLayout != "stacked" {
		t.Fatalf("missing layout must default and preserve: %#v", settings)
	}
}

func TestSiteWrappingSurvivesOtherSharedSettingsSavePostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })
	save := func(settings SitePresentationSettingsResponse) SitePresentationSettingsResponse {
		t.Helper()
		tx := dbutils.NewLazyTx(db)
		defer tx.Rollback()
		request := httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", nil)
		saved, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), tx)), settings)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return saved
	}
	read := func(want string) {
		t.Helper()
		settings, err := readSitePresentationSettingsFromDB()
		if err != nil {
			t.Fatal(err)
		}
		if got := settings.DatasetCoverTheme.Shared.LabelValueLayout; got != want {
			t.Fatalf("stored/read layout = %q, want %q", got, want)
		}
	}
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	read("stacked")
	settings := defaultSitePresentationSettings()
	settings.DatasetCoverTheme.Shared.LabelValueLayout = "auto"
	save(settings)
	read("auto")
	settings.preserveStoredLabelValueLayout = true
	settings.DatasetCoverTheme.Shared.LabelValueLayout = "stacked"
	settings.DatasetCoverTheme.Shared.CardImageWidth = 411
	if got := save(settings).DatasetCoverTheme.Shared.LabelValueLayout; got != "auto" {
		t.Fatalf("legacy save returned %q", got)
	}
	read("auto")
	stored, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	if stored.DatasetCoverTheme.Shared.CardImageWidth != 411 {
		t.Fatal("other shared key was not saved")
	}
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	read("stacked")
	if got := save(settings).DatasetCoverTheme.Shared.LabelValueLayout; got != "stacked" {
		t.Fatalf("production preserved disallowed Automatic: %q", got)
	}
	settings.preserveStoredLabelValueLayout = false
	settings.DatasetCoverTheme.Shared.LabelValueLayout = "inline"
	save(settings)
	settings.preserveStoredLabelValueLayout = true
	settings.DatasetCoverTheme.Shared.LabelValueLayout = "stacked"
	save(settings)
	read("inline")
}
