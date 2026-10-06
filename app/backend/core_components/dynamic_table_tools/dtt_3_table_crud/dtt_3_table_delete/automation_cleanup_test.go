// automation_cleanup_test.go
// Checks automation cleanup failures stop the shared dataset deletion workflow.
// Uses the existing deletion queues and optional legacy-table fixture.
// The caller can roll back the physical drop without losing registry metadata.
package dtt_3_table_delete

import (
	"errors"
	"strings"
	"testing"
)

func TestCleanupTableMetadataStopsOnAutomationFailure(t *testing.T) {
	failure := errors.New("automation cleanup failed")
	db, state := openDeleteTableDB(t, nil, []queuedDeleteExec{
		{rowsAffected: 1}, {rowsAffected: 1}, {err: failure},
	})
	state.automationTableExists = true
	if err := CleanupTableMetadata(db, 42, "public"); !errors.Is(err, failure) {
		t.Fatal("automation cleanup error was lost", err)
	}
	if len(state.execCalls) != 3 || !strings.HasPrefix(state.execCalls[2], "DELETE FROM public.system_triggers") {
		t.Fatal("registry cleanup continued after automation failure", state.execCalls)
	}
}
