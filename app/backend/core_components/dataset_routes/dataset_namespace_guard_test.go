// dataset_namespace_guard_test.go
// Pins translated refusal keys for preflight and persistence backstops.
// Connects database SQLSTATEs with the standard API refusal envelope.
// Prevents generic writers turning a namespace conflict into a server error.
package dataset_routes

import (
	"encoding/json"
	"github.com/lib/pq"
	"net/http/httptest"
	"testing"
)

func TestNamespaceRefusalsKeepStableKeys(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
		key    string
	}{
		{&RouteConflictError{Segment: "reports"}, 409, NamespaceConflictKey},
		{&pq.Error{Code: "P0001", Message: NamespaceConflictKey}, 409, NamespaceConflictKey},
		{&pq.Error{Code: "23505", Constraint: "idx_system_db_table_aliases_active_name"}, 409, NamespaceConflictKey},
		{&pq.Error{Code: "40001"}, 409, NamespaceRetryKey},
		{&pq.Error{Code: "P0001", Message: NamespaceInvalidKey}, 400, NamespaceInvalidKey},
		{&AliasValidationError{Message: "invalid slug"}, 400, NamespaceInvalidKey},
	} {
		response := httptest.NewRecorder()
		if !RespondNamespaceRefusal(response, test.err) {
			t.Fatal("refusal was not handled", test.err)
		}
		var body struct {
			Key  string `json:"error_lang_key"`
			Code int    `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != test.status || body.Key != test.key || body.Code != test.status {
			t.Fatalf("unstable refusal: %d %s", response.Code, response.Body.String())
		}
	}
}
