// kind_evidence_rebuild_test.go
// Proves adding the search-vector column clears warm evidence only after commit.
// Connects the actual rebuild handler to lazy transactions and the cache probe.
// Protects rolled-back rebuilds from evicting the previously committed evidence.
package dtt_search_vectors

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dataset_kinds/kindtest"
	"easelect/backend/core_components/dbutils"
)

func TestKindEvidenceSearchVectorRebuildCommitAndRollback(t *testing.T) {
	for _, commit := range []bool{true, false} {
		label := "rollback"
		if commit {
			label = "commit"
		}
		t.Run(label, func(t *testing.T) {
			read := kindtest.WarmProbe(t)
			read(1)
			state := &scriptedDriver{columns: []string{"title"}}
			db, err := sql.Open(registerDriver(state), "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			lt := dbutils.NewLazyTx(db)
			r := kindtest.AuthenticatedRequest(t, "POST", "/api/rebuild-search-vector", strings.NewReader(`{"dataset":"kind_probe"}`))
			r = r.WithContext(dbutils.SetLazyTx(context.Background(), lt))
			w := httptest.NewRecorder()
			RebuildSearchVectorHandler(w, r)
			if w.Code != 200 || len(state.execQueries) != 3 {
				t.Fatal(w.Code, w.Body.String(), state.execQueries)
			}
			read(1)
			want := int64(1)
			if commit {
				err = lt.Commit()
				want = 2
			} else {
				err = lt.Rollback()
			}
			if err != nil {
				t.Fatal(err)
			}
			read(want)
		})
	}
}
