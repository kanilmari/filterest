// add_row_media_library_test.go
// Verifies rejection of malformed existing-image selections before ordinary insertion.
// Between the multipart add-row handler and the dedicated media reuse contract.
// Exists so a reserved selection can never be mistaken for an arbitrary SQL column.
package dtt_1_row_create

import (
	"bytes"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddRowRejectsMalformedMediaSelectionBeforeParentInsert(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, e := db.Begin()
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	pushQuery(queuedQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{"101"}}})
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	form.WriteField("jsonPayload", `{"_existingImages":[{"relation_id":17,"source_row_id":0}]}`)
	form.Close()
	r := httptest.NewRequest("POST", "/api/add-row-multipart?dataset=specimen_parent", &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	r = r.WithContext(dbutils.SetTx(r.Context(), tx))
	w := httptest.NewRecorder()
	AddRowMultipartHandler(w, r, "specimen_parent")
	if w.Code != 400 || !strings.Contains(w.Body.String(), "media_reuse_not_allowed") {
		t.Fatalf("unexpected response %d %s", w.Code, w.Body.String())
	}
}
