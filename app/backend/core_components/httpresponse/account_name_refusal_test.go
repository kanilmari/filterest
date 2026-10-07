// account_name_refusal_test.go
// Verifies all account writers share value-free, translated name conflict responses.
// Bridges PostgreSQL constraint identities and HTTP refusal bodies.
// Exists to prevent private names in database details escaping through generic errors.
package httpresponse

import (
	"fmt"
	"github.com/lib/pq"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAccountNameRefusalHidesDatabaseDetails(t *testing.T) {
	for _, test := range []struct{ constraint, code, key string }{
		{"administrator_names_differ", "23514", "error_admin_display_name_equals_login_name"},
		{"user_names_differ", "23514", "error_user_display_name_equals_login_name"},
		{"uq_system_users_username_lower", "23505", "username_exists"},
		{"system_users_username_key", "23505", "username_exists"},
		{"unique_username", "23505", "username_exists"},
		{"users_restricted_email_key", "23505", "email_exists"},
		{"uq_users_restricted_email", "23505", "email_exists"},
		{"uq_users_restricted_login_name_lower", "23505", "login_name_exists"},
	} {
		err := fmt.Errorf("wrapped: %w", &pq.Error{Code: pq.ErrorCode(test.code), Constraint: test.constraint, Message: "private-canary", Detail: "private-canary"})
		refusal := AccountNameRefusal(err)
		if refusal == nil || refusal.Status != 409 || refusal.LangKey != test.key {
			t.Fatalf("mapping=%v", refusal)
		}
		w := httptest.NewRecorder()
		RespondWithRefusal(w, refusal)
		if strings.Contains(w.Body.String(), "canary") || !strings.Contains(w.Body.String(), `"error_lang_key":"`+test.key+`"`) {
			t.Fatal(w.Body.String())
		}
	}
	if AccountNameRefusal(&pq.Error{Code: "23505", Constraint: "unrelated"}) != nil {
		t.Fatal("unrelated constraint was claimed")
	}
}
