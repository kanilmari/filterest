// dataset_appearance_protection_test.go
// Proves generic HTTP writes and consistency repairs refuse the internal table.
// Connects the private appearance registry with existing mutation boundaries.
// Runs without any installation database or credentials.
package system_table_tools

import (
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	deleteRows "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
)

func TestDatasetAppearanceGenericWritesRefused(t *testing.T) {
	if !row_mutation_policy.RequiresDedicatedMutationAPI(" SYSTEM_DATASET_APPEARANCE ") || !row_mutation_policy.IsInternalRegistryTable("system_dataset_appearance") {
		t.Fatal("appearance storage escaped internal/dedicated policy")
	}
	for name, handler := range map[string]func(http.ResponseWriter, *http.Request, string){
		"create": create.AddRowMultipartHandler, "update": update.UpdateRowHandler, "delete": deleteRows.DeleteRowsHandler,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler(recorder, httptest.NewRequest(http.MethodPost, "/api/"+name, nil), "system_dataset_appearance")
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("generic %s status %d", name, recorder.Code)
			}
		})
	}
}

func TestDatasetAppearanceConsistencyRepairRefused(t *testing.T) {
	for _, action := range []string{"register", "drop", ""} {
		t.Run(action, func(t *testing.T) {
			resetOrphanQueues()
			defer resetOrphanQueues()
			db := newSystemTableToolsTestDB(t)
			defer db.Close()
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"nspname"}, rows: [][]driver.Value{{"public"}}})
			id := "cat2_system_dataset_appearance"
			if err := fixIssue(db, id, map[string]string{id: action}); err == nil || !strings.Contains(err.Error(), "dedicated API") {
				t.Fatal("internal storage repair accepted", err)
			}
			if len(snapshotOrphanCalls()) != 1 {
				t.Fatal("repair changed metadata or storage")
			}
		})
	}
}
