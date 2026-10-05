// refusal_test.go
// Proves refusals use the standard API error envelope and a translation key.
// Bridges service errors to HTTP, including errors wrapped by callers.
// Preserves the shape of ordinary errors when no language key applies.
package httpresponse

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestRefusalResponseAndOrdinaryErrorCompatibility(t *testing.T) {
	original := &Refusal{Status: 400, LangKey: "error_owner_column_protected", Message: "actor column is protected"}
	var refusal *Refusal
	if !errors.As(fmt.Errorf("remove column: %w", original), &refusal) {
		t.Fatal("wrapped refusal lost")
	}
	rec := httptest.NewRecorder()
	RespondWithRefusal(rec, refusal)
	var body ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 400 || body.Code != 400 || body.ErrorLangKey != original.LangKey || body.Error != original.Message {
		t.Fatalf("%d %+v", rec.Code, body)
	}
	rec = httptest.NewRecorder()
	RespondWithError(rec, 500, "failure")
	var fields map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &fields)
	if _, ok := fields["error_lang_key"]; ok {
		t.Fatal("ordinary error gained a language key")
	}
}
