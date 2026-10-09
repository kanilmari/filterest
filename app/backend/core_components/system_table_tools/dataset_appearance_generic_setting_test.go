// dataset_appearance_generic_setting_test.go
// Proves generic shared-setting writers cannot bypass the dedicated save boundary.
// Connects candidate/locked settings and deletion handlers with translated refusals.
// Keeps key renames and matching cache writes from creating an unversioned path.
package system_table_tools

import (
	"database/sql/driver"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	deleteRows "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	"easelect/backend/core_components/httpresponse"
	checks "easelect/backend/core_components/system_config_checks"
)

func TestDatasetAppearanceGenericSharedSettingRefused(t *testing.T) {
	row := map[string]any{"key": "dataset_cover_theme_config", "value_type": 5, "json_value": map[string]any{}}
	err := checks.ValidateRow("system_config", row)
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.LangKey != "dataset_appearance_invalid" {
		t.Fatal(err)
	}
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"row"}, rows: [][]driver.Value{{[]byte(`{"key":"dataset_cover_theme_config"}`)}}})
	if err := checks.ValidateUpdate(db, "system_config", 1, map[string]any{"key": "unprotected"}); err == nil {
		t.Fatal("rename bypassed shared revision")
	}
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"row"}, rows: [][]driver.Value{{[]byte(`{"key":"dataset_cover_theme_config"}`)}}})
	if err := checks.ValidateMatchingUpdate(db, "system_config", "key", "dataset_cover_theme_config", map[string]any{"key": "unprotected"}); err == nil {
		t.Fatal("matching rename bypassed shared revision")
	}
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"protected"}, rows: [][]driver.Value{{true}}})
	r := httptest.NewRequest("POST", "/api/delete-rows?dataset=system_config", strings.NewReader(`{"ids":[1]}`))
	r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
	w := httptest.NewRecorder()
	deleteRows.DeleteRowsHandler(w, r, "system_config")
	if w.Code != 400 || !strings.Contains(w.Body.String(), "dataset_appearance_invalid") {
		t.Fatal(w.Code, w.Body.String())
	}
}
