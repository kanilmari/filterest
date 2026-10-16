// foreign_reference_updates_test.go
// Proves update-row rejects denied, hidden and missing FK targets before writes.
// Drives the shared add/update reference check with transaction-scoped replies.
// Also covers nullable clearing and relations that store a non-ID unique key.
package dtt_1_row_update

import (
	"database/sql/driver"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

func TestUpdateForeignReferenceReadBoundary(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		allowed, exists, visible bool
		status                   int
	}{
		{"unreadable_dataset", false, true, true, 403},
		{"hidden_row", true, true, false, 403},
		{"nonexistent_id", true, false, false, 400},
		{"readable_non_id_key", true, true, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := []queuedQuery{{cols: []string{"schema", "table", "column"}, rows: [][]driver.Value{{"public", "targets", "code"}}}}
			permission := queuedQuery{cols: []string{"allowed"}}
			if tc.allowed {
				permission.rows = [][]driver.Value{{int64(1)}}
			}
			queries = append(queries, permission)
			if tc.allowed {
				exists := queuedQuery{cols: []string{"id"}}
				if tc.exists {
					exists.rows = [][]driver.Value{{int64(12)}}
				}
				queries = append(queries, exists)
				if tc.exists {
					visible := queuedQuery{cols: []string{"id"}}
					if tc.visible {
						visible.rows = [][]driver.Value{{int64(12)}}
					}
					queries = append(queries, queuedQuery{cols: []string{"column_name"}}, visible)
				}
			}
			tx := openUpdRowTx(t, queries)
			refs, err := validateUpdatedForeignReferences(tx, "sources", "target_code", "CODE", 7, "user")
			if tc.status == 0 {
				if err != nil || len(refs) != 1 || refs[0].id != 12 {
					t.Fatal(refs, err)
				}
			} else {
				var refusal *httpresponse.Refusal
				if !errors.As(err, &refusal) || refusal.Status != tc.status {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestUpdateForeignReferenceNullNeedsNoTargetRead(t *testing.T) {
	refs, err := validateUpdatedForeignReferences(nil, "sources", "target_id", nil, 7, "user")
	if err != nil || len(refs) != 0 {
		t.Fatal(refs, err)
	}
}

func TestUpdateRowHandlerRejectsUnreadableForeignReference(t *testing.T) {
	for _, tc := range []struct {
		name            string
		allowed, exists bool
		status          int
	}{
		{"unreadable_dataset", false, true, 403}, {"hidden_row", true, true, 403}, {"nonexistent_id", true, false, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := []queuedQuery{
				{cols: []string{"column_name"}},
				{cols: []string{"id"}, rows: [][]driver.Value{{int64(41)}}},
				{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}},
				{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{true}}},
				{cols: []string{"data_type"}, rows: [][]driver.Value{{"integer"}}},
				{cols: []string{"schema", "table", "column"}, rows: [][]driver.Value{{"public", "targets", "id"}}},
			}
			permission := queuedQuery{cols: []string{"allowed"}}
			if tc.allowed {
				permission.rows = [][]driver.Value{{int64(1)}}
			}
			queries = append(queries, permission)
			if tc.allowed {
				exists := queuedQuery{cols: []string{"id"}}
				if tc.exists {
					exists.rows = [][]driver.Value{{int64(12)}}
				}
				queries = append(queries, exists)
				if tc.exists {
					queries = append(queries, queuedQuery{cols: []string{"column_name"}}, queuedQuery{cols: []string{"id"}})
				}
			}
			tx := openUpdRowTx(t, queries)
			req := buildUpdateRowSessionRequestForActor(t, "POST", "/api/update-row?dataset=sources", `{"id":41,"column":"target_id","value":12}`, 7, "basic")
			req = req.WithContext(dbutils.SetTx(req.Context(), tx))
			rec := httptest.NewRecorder()
			UpdateRowHandler(rec, req, "sources")
			if rec.Code != tc.status {
				t.Fatalf("%d: %s", rec.Code, rec.Body)
			}
			if !strings.Contains(rec.Body.String(), "foreign row") {
				t.Fatal("refused before reaching the reference boundary", rec.Body)
			}
		})
	}
}
