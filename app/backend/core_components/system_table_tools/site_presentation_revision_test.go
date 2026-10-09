// site_presentation_revision_test.go
// Supplies loaded revisions and checks revisionless legacy save refusals.
// Connects the existing shared-settings regressions to the revision-protected writer.
// Compares persisted values and update stamps so refused saves cannot change storage.
package system_table_tools

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func sitePresentationTestInputWithLoadedRevision(t *testing.T, input SitePresentationSettingsResponse) SitePresentationSettingsResponse {
	t.Helper()
	stored, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	input.Version = stored.Version
	return input
}

func assertRevisionlessSitePresentationSaveRefused(t *testing.T, db *sql.DB, input SitePresentationSettingsResponse) {
	t.Helper()
	readStorage := func() string {
		t.Helper()
		var stored string
		if err := db.QueryRow(`SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.key),'[]'::jsonb)::text
 FROM public.system_config c`).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		return stored
	}
	before := readStorage()
	input.Version = ""
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	r := httptest.NewRequest(http.MethodPost, "/api/admin/site-presentation-settings", nil)
	_, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), input)
	assertDatasetAppearanceRefusal(t, err, http.StatusConflict)
	// Even committing the refused writer's transaction must leave every row unchanged.
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	if after := readStorage(); after != before {
		t.Fatalf("revisionless save changed stored configuration: before=%s after=%s", before, after)
	}
}
