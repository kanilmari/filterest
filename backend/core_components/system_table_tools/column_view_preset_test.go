// column_view_preset_test.go
// Verifies compatibility behavior for generated databases created before the
// optional shared column-preset table was included in the public bootstrap.
package system_table_tools

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"github.com/lib/pq"
)

func TestListColumnViewPresetsTreatsMissingOptionalTableAsEmpty(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)

	db := newSystemTableToolsTestDB(t)
	defer db.Close()

	originalDB := backend.Db
	backend.Db = db
	defer func() { backend.Db = originalDB }()

	pushOrphanQuery(orphanQueuedQuery{err: &pq.Error{Code: "42P01"}})

	req := httptest.NewRequest(http.MethodGet, "/api/column-view-presets/dokumentaatio", nil)
	response := httptest.NewRecorder()
	ListColumnViewPresetsHandler(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if body := strings.TrimSpace(response.Body.String()); body != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}

func TestMissingColumnViewPresetsTableErrorRejectsOtherDatabaseErrors(t *testing.T) {
	if isMissingColumnViewPresetsTableError(&pq.Error{Code: "42501"}) {
		t.Fatal("permission errors must not be treated as a missing optional table")
	}
	if !isMissingColumnViewPresetsTableError(&pq.Error{Code: "42P01"}) {
		t.Fatal("undefined-table errors must be recognized")
	}
}
