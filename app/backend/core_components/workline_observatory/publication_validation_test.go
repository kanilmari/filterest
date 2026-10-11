// publication_validation_test.go
// Checks database precision and text refusals before publication requests reach storage.
// Connects HTTP validation with the publication constraint and translated reasons.
// Protects every accepted text field and both scheduling boundaries.
package workline_observatory

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

var publicationTimeCases = []struct {
	value string
	valid bool
}{
	{"0001-01-01T00:00:00Z", true},
	{"0001-01-01T01:00:00+01:00", true},
	{"0001-01-01T00:00:00+01:00", false},
	{"0001-01-01T00:59:59.9999999+01:00", true},
	{"0001-01-01T00:59:59.9999994+01:00", false},
	{"9999-12-31T23:59:59.999999Z", true},
	{"9999-12-31T23:59:59.9999994Z", true},
	{"9999-12-31T23:59:59.9999995Z", false},
	{"9999-12-31T23:59:59.999999999Z", false},
	{"9999-12-31T23:59:59.999999499999999999Z", false},
	{"9999-12-31T22:59:59.999999999-01:00", false},
	{"9999-12-31T23:00:00-01:00", false},
	{"0000-01-01T00:00:00Z", false},
	{"infinity", false},
}

func TestPublicationTimeStoragePrecisionBeforeDatabaseAccess(t *testing.T) {
	for _, tc := range publicationTimeCases {
		t.Run(tc.value, func(t *testing.T) {
			_, err := normalizePublicationDetails(publicationDetails{PublicationVersion: "9.4.0", Published: true, PublishedAt: &tc.value})
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
			if tc.valid {
				return
			}
			for _, method := range []string{http.MethodPost, http.MethodPatch} {
				body := map[string]any{"identity_key": "precision-proof", "version": 1, "title": "Proof", "outcome": "Plan", "id": 1, "action": "update", "expected_revision": 0, "publication_version": "9.4.0", "published": true, "published_at": tc.value}
				publicationValidationCall(t, method, body, "invalid_publication_time")
			}
		})
	}
}

func TestPublicationTextRejectsNULBeforeDatabaseAccess(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPatch} {
		fields := []string{"publication_version", "reader_description", "target_date", "published_at"}
		if method == http.MethodPost {
			fields = append(fields, "identity_key", "title", "outcome")
		} else {
			fields = append(fields, "action")
		}
		for _, field := range fields {
			t.Run(method+"/"+field, func(t *testing.T) {
				body := map[string]any{"identity_key": "nul-proof", "version": 1, "title": "Proof", "outcome": "Plan", "id": 1, "action": "update", "expected_revision": 0, "publication_version": "9.4.0"}
				body[field] = "a\x00b"
				publicationValidationCall(t, method, body, "invalid_publication_text")
			})
		}
	}
}

func TestPublicationContractTextRejectsNULBeforeDatabaseAccess(t *testing.T) {
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("publication-nul-fixture-only-key"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	req := httptest.NewRequest(http.MethodPost, "/api/app/workline-observatory/release-contracts",
		strings.NewReader(`{"release_goal_id":1,"workline_id":1,"completion_rule":"must_\u0000complete"}`))
	session, err := e_sessions.Load(req)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 2
	w := httptest.NewRecorder()
	ReleaseContractsHandler(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"error_lang_key":"invalid_publication_text"`) {
		t.Fatalf("NUL contract reason = %d %s", w.Code, w.Body.String())
	}
}

func publicationValidationCall(t *testing.T, method string, body map[string]any, reason string) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, "/api/app/workline-observatory/release-goals", strings.NewReader(string(encoded)))
	w := httptest.NewRecorder()
	// No transaction is attached: reaching the database would return 500.
	if method == http.MethodPost {
		createReleaseGoal(w, req, 2)
	} else {
		applyReleaseGoalAction(w, req, 2)
	}
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"error_lang_key":"`+reason+`"`) {
		t.Fatalf("status=%d, body=%s; want 400/%s before database access", w.Code, w.Body.String(), reason)
	}
}
