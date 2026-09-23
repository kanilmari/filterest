// site_presentation_top_space_test.go
// Locks the empty space above the dataset hero's header icon: its 40px default,
// its accepted range, and the stored choice a request without the key must keep.
// Connects the appearance palette's newest presentation key with system_config.
// Exists because the key ships after database 9.8.1, without a migration of its own.
package system_table_tools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	_ "github.com/lib/pq"
)

// The hero header top space arrived after database 9.8.1, so it must behave like
// the other post-release presentation keys: a request that omits it keeps the
// stored choice instead of writing the input default over it.
func TestFilterbarContentTopSpacePresenceAndValidation(t *testing.T) {
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"filterbar_content_top_space":40`) {
		t.Fatalf("default request body must carry the 40px spacing: %s", body)
	}
	accepted := map[string]float64{
		"omitted": defaultFilterbarContentTopSpace, "0": 0, "12": 12, "40": 40, "200": 200,
	}
	for _, value := range []string{"omitted", "0", "12", "40", "200", "-1", "201", "null", "true", `"40"`} {
		t.Run(value, func(t *testing.T) {
			input := strings.Replace(string(body), `"filterbar_content_top_space":40`,
				`"filterbar_content_top_space":`+value, 1)
			if value == "omitted" {
				input = strings.Replace(string(body), `"filterbar_content_top_space":40,`, "", 1)
			}
			settings, err := decodeSitePresentationSettings(strings.NewReader(input))
			want, valid := accepted[value]
			if (err == nil) != valid {
				t.Fatalf("value %s: err=%v", value, err)
			}
			if !valid {
				return
			}
			if settings.DatasetCoverTheme.Shared.FilterbarContentTopSpace != want {
				t.Fatalf("decoded spacing = %v, want %v", settings.DatasetCoverTheme.Shared.FilterbarContentTopSpace, want)
			}
			if settings.preserveStoredFilterbarContentTopSpace != (value == "omitted") {
				t.Fatalf("wrong presence flag for %s: %+v", value, settings)
			}
		})
	}
}

// The upsert repeats the default as an SQL literal, the way its neighbours do.
// This keeps that literal and the Go constant from drifting apart unnoticed.
func TestFilterbarContentTopSpaceUpsertFallbackMatchesTheConstant(t *testing.T) {
	fallback := fmt.Sprintf("ELSE '%d'::jsonb", defaultFilterbarContentTopSpace)
	section := upsertDatasetCoverThemeSQL[strings.Index(
		upsertDatasetCoverThemeSQL, "'{shared,filterbar_content_top_space}'"):]
	if !strings.Contains(section, fallback) {
		t.Fatalf("upsert fallback does not use %s", fallback)
	}
}

func TestFilterbarContentTopSpaceSurvivesLegacySavePostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previousDB })

	save := func(input SitePresentationSettingsResponse) SitePresentationSettingsResponse {
		t.Helper()
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
		return result
	}
	decode := func(raw string) SitePresentationSettingsResponse {
		t.Helper()
		settings, err := decodeSitePresentationSettings(strings.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		return settings
	}
	body, err := json.Marshal(defaultSitePresentationSettings())
	if err != nil {
		t.Fatal(err)
	}
	readStored := func() float64 {
		t.Helper()
		settings, readErr := readSitePresentationSettingsFromDB()
		if readErr != nil {
			t.Fatal(readErr)
		}
		return settings.DatasetCoverTheme.Shared.FilterbarContentTopSpace
	}

	// No stored row at all: the reader still reports the 40px default.
	if stored := readStored(); stored != defaultFilterbarContentTopSpace {
		t.Fatalf("empty configuration spacing = %v", stored)
	}
	chosen := strings.Replace(string(body), `"filterbar_content_top_space":40`, `"filterbar_content_top_space":96`, 1)
	if saved := save(decode(chosen)).DatasetCoverTheme.Shared.FilterbarContentTopSpace; saved != 96 {
		t.Fatalf("administrator choice returned %v", saved)
	}
	if stored := readStored(); stored != 96 {
		t.Fatalf("stored spacing = %v, want 96", stored)
	}
	legacy := strings.Replace(string(body), `"filterbar_content_top_space":40,`, "", 1)
	if saved := save(decode(legacy)).DatasetCoverTheme.Shared.FilterbarContentTopSpace; saved != 96 {
		t.Fatalf("a request without the key reported %v instead of the stored 96", saved)
	}
	if stored := readStored(); stored != 96 {
		t.Fatalf("a request without the key overwrote the stored spacing: %v", stored)
	}
}
