// kind_evidence_unique_index_test.go
// Proves unique index creation invalidates schema evidence after pool commit.
// Connects the actual index handler to warm classification and failed writes.
// Makes contract-sensitive uniqueness changes visible on the next read.
package dtt_crud_workflows

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds/kindtest"
)

func TestKindEvidenceUniqueIndexCreationCommittedWrites(t *testing.T) {
	for _, fail := range []bool{false, true} {
		label := "commit"
		if fail {
			label = "failure"
		}
		t.Run(label, func(t *testing.T) {
			read := kindtest.WarmProbe(t)
			read(1)
			db := newWorkflowQueueTestDB(t)
			defer db.Close()
			old := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = old })
			item := queuedWorkflowExec{rowsAffected: 1}
			if fail {
				item.err = errors.New("index refused")
			}
			pushWorkflowExec(item)
			w := httptest.NewRecorder()
			CreateIndexesHandler(w, httptest.NewRequest("POST", "/api/create-indexes", strings.NewReader(`{"dataset_name":"kind_probe","indexes":[{"columns":["id"],"unique":true}]}`)))
			wantCode, wantQueries := 200, int64(2)
			if fail {
				wantCode, wantQueries = 500, 1
			}
			if w.Code != wantCode {
				t.Fatal(w.Code, w.Body.String())
			}
			read(wantQueries)
		})
	}
}
