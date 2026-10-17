// translation_source_writer_test.go
// Proves request context cannot mint evidence through the real source writer.
// Exercises the real request-provenance writer without an AI provider or database.
// Frontend-supplied scanner markers never survive even an administrator request.
package lang

import (
	"database/sql/driver"
	"testing"

	backend "easelect/backend/core_components"
)

func TestFrontendTranslationProvenanceCannotMintLiteralMarker(t *testing.T) {
	for _, detail := range []string{"ui_literal_v1:123", "ui_literal_v1:", "ui_literal_v1:complete_generation", "normal_context"} {
		t.Run(detail, func(t *testing.T) {
			queries := []queuedCleanupQuery{
				{cols: []string{"column", "table"}},
				{cols: []string{"table"}},
				{cols: []string{"id"}, rows: [][]driver.Value{{int64(7)}}},
			}
			db, state := openCleanupDB(t, queries, []queuedCleanupExec{{rowsAffected: 1}})
			old := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = old })
			saveLangKeySources([]string{"private_label"}, map[string]string{"private_label": "app/frontend/view.js::" + detail})
			if len(state.execCalls) != 1 || len(state.queries) != 0 || len(state.execs) != 0 {
				t.Fatal("administrator provenance not saved", state)
			}
			want := ""
			if detail == "normal_context" {
				want = detail
			}
			args := state.execArgs[0]
			if args[1].Value != "code" || args[3].Value != want {
				t.Fatal("frontend minted scanner authority or lost ordinary context", args)
			}
		})
	}
}
