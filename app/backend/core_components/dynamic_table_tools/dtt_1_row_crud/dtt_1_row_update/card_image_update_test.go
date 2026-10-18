// card_image_update_test.go
// Exercises image-use request, authorization and field-policy refusals.
// Uses the real row handler and existing permission driver, without PostgreSQL.
// Injection and conflicting identities must fail before a transaction writes.
package dtt_1_row_update

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pictures "easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/httpresponse"
)

func cardImageTestPayload(presentation, focal string) string {
	return `{"id":4,"card_image":{"use":{"dataset":"example","row_id":4,"column":"hero_image","relation_id":9,"link_row_id":2,"version":"` + strings.Repeat("a", 64) + `"},"presentation":` + presentation + `,"focal":` + focal + `}}`
}

func TestCardImageRowUpdateRejectsInvalidValuesAndIdentity(t *testing.T) {
	for _, body := range []string{
		cardImageTestPayload(`"cover"`, `{"x":"50%;background:url(…) ","y":0.5}`),
		cardImageTestPayload(`"cover"`, `{"x":1.1,"y":0.5}`),
		cardImageTestPayload(`"cover"`, `{"x":0.3}`),
		cardImageTestPayload(`"cover"`, `{"x":null,"y":0.2}`),
		cardImageTestPayload(`"cover"`, `{"x":1e999,"y":0.2}`),
		cardImageTestPayload(`"contain;display:none"`, `null`),
		strings.Replace(cardImageTestPayload(`null`, `null`), `"dataset":"example"`, `"dataset":"other"`, 1),
		strings.Replace(cardImageTestPayload(`null`, `null`), `"id":4`, `"id":4,"dataset":"other"`, 1),
		strings.Replace(cardImageTestPayload(`null`, `null`), `"presentation":null,`, "", 1),
		strings.Replace(cardImageTestPayload(`null`, `null`), `"focal":null`, `"focal":null,"locked":true`, 1),
	} {
		request := buildUpdateRowSessionRequest(t, http.MethodPost, "/api/update-row?dataset=example", body)
		response := httptest.NewRecorder()
		UpdateRowHandler(response, request, "example")
		if response.Code != 400 {
			t.Fatalf("status=%d body=%s for %s", response.Code, response.Body.String(), body)
		}
	}
}

func TestCardImageOperationRequiresExplicitNullableSettingsAndAdoption(t *testing.T) {
	for _, mode := range []string{`null`, `"cover"`, `"contain"`, `"contain_blur"`} {
		var request updateRowRequest
		if err := json.Unmarshal([]byte(cardImageTestPayload(mode, `{"x":0,"y":1}`)), &request); err != nil {
			t.Fatal(err)
		}
		if updates, err := normalizeUpdateOperations(request); err != nil || len(updates) != 0 {
			t.Fatal(updates, err)
		}
	}
	var request updateRowRequest
	adopt := strings.Replace(cardImageTestPayload(`null`, `null`), `"link_row_id":2`, `"link_row_id":0`, 1)
	if json.Unmarshal([]byte(adopt), &request) == nil {
		t.Fatal("implicit adoption accepted")
	}
	adopt = strings.Replace(adopt, `"focal":null`, `"focal":null,"adopt":true`, 1)
	if err := json.Unmarshal([]byte(adopt), &request); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeUpdateOperations(updateRowRequest{ID: 4, CardImage: request.CardImage, Column: "title"}); err == nil {
		t.Fatal("mixed operation accepted")
	}
	for _, column := range []string{"card_image_presentation", "card_image_focal_x", "card_image_focal_y"} {
		if _, err := normalizeUpdateOperations(updateRowRequest{ID: 4, Column: column, Value: nil}); err == nil {
			t.Fatal("unversioned write accepted", column)
		}
	}
}

func TestCardImageWriteRequiresRowUpdateRight(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{{cols: []string{"uid"}, rows: [][]driver.Value{{int64(9)}}}, {cols: []string{"allowed"}}})
	defer tx.Rollback()
	use := pictures.CardImageUse{Dataset: "example", RowID: 4}
	_, err := saveCardImageUpdate(tx, httptest.NewRequest("POST", "/api/update-row?dataset=example", nil), "example", 4, &cardImageUpdate{Use: use}, 4, "basic")
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != 403 {
		t.Fatalf("missing update right: %v", err)
	}
}

func TestCardImageWritePreservesEditabilityAndActorMarks(t *testing.T) {
	for _, test := range []struct {
		editable bool
		actors   [][]driver.Value
	}{
		{false, nil}, {true, [][]driver.Value{{"card_image_presentation", "creator"}}},
	} {
		tx := openUpdRowTx(t, []queuedQuery{
			{cols: []string{"uid"}, rows: [][]driver.Value{{int64(9)}}},
			{cols: []string{"editable"}, rows: [][]driver.Value{{test.editable}}},
		}, test.actors)
		err := requireCardImageColumns(tx, "example", 4, []string{"card_image_presentation"})
		if err == nil {
			t.Fatal("protected image setting accepted")
		}
		tx.Rollback()
	}
}
