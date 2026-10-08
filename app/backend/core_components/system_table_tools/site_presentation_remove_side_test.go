// site_presentation_remove_side_test.go
// Verifies logical selected-chip remove sides and legacy client omissions.
// Connects typed presentation decoding with the transactional configuration save.
// Protects the default and a saved side when older clients omit the new field.
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

func TestActiveFilterRemoveSidePresenceAndValidation(t *testing.T) {
	fixture, err := os.ReadFile("../../../testing/shared_contracts/active_filter_remove_side.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Default string            `json:"default"`
		Valid   []string          `json:"valid"`
		Invalid []json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(fixture, &contract); err != nil {
		t.Fatal(err)
	}
	if defaultSitePresentationSettings().DatasetCoverTheme.Shared.ActiveFilterRemoveSide != contract.Default {
		t.Fatal("default differs from the shared contract")
	}
	values := []string{"omitted"}
	for _, value := range contract.Valid {
		encoded, _ := json.Marshal(value)
		values = append(values, string(encoded))
	}
	for _, value := range contract.Invalid {
		values = append(values, string(value))
	}
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			input := strings.Replace(string(body), `"active_filter_remove_side":"start"`, `"active_filter_remove_side":`+value, 1)
			if value == "omitted" {
				input = strings.Replace(string(body), `"active_filter_remove_side":"start",`, "", 1)
			}
			settings, err := decodeSitePresentationSettings(strings.NewReader(input))
			valid := value == `"start"` || value == `"end"` || value == "omitted"
			if (err == nil) != valid {
				t.Fatalf("value %s: err=%v", value, err)
			}
			if !valid {
				return
			}
			want := "start"
			if value == `"end"` {
				want = "end"
			}
			if settings.DatasetCoverTheme.Shared.ActiveFilterRemoveSide != want || settings.preserveStoredActiveFilterRemoveSide != (value == "omitted") {
				t.Fatalf("wrong side or omission flag: %+v", settings)
			}
		})
	}
}

func TestActiveFilterRemoveSideSurvivesLegacySavePostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })
	save := func(side string, omitted bool) {
		t.Helper()
		input := defaultSitePresentationSettings()
		input.DatasetCoverTheme.Shared.ActiveFilterRemoveSide = side
		input.preserveStoredActiveFilterRemoveSide = omitted
		tx := dbutils.NewLazyTx(db)
		defer tx.Rollback()
		request := httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", nil)
		result, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), tx)), input)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		want := side
		if omitted {
			want = "end"
		}
		stored, err := readSitePresentationSettingsFromDB()
		if err != nil || stored.DatasetCoverTheme.Shared.ActiveFilterRemoveSide != want || result.DatasetCoverTheme.Shared.ActiveFilterRemoveSide != want {
			t.Fatalf("save returned %+v, stored %+v, want %s, err=%v", result, stored, want, err)
		}
	}
	defaults, err := readSitePresentationSettingsFromDB()
	if err != nil || defaults.DatasetCoverTheme.Shared.ActiveFilterRemoveSide != "start" {
		t.Fatalf("empty config default: %+v, %v", defaults, err)
	}
	save("end", false)
	save("start", true)
	save("start", false)
}
