// csrf_token_handler_test.go
// Regression tests for the CSRF token endpoint that the sign-in page asks when its own token went stale.
// Covers the handler between the session store and the frontend token refresh, without a database.
package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func readCSRFTokenAnswer(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		CSRFToken string `json:"csrf_token"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode token answer: %v", err)
	}
	return body.CSRFToken
}

// The sign-in page recovers a stale token by asking this endpoint and sending
// its request again, so the answer must be the session's own token, the same
// on every call, and never a copy kept by the browser.
func TestCSRFTokenHandlerAnswersWithTheSessionTokenAndForbidsStoring(t *testing.T) {
	prepareLoginHandlerSessionStore(t)

	first := httptest.NewRecorder()
	CSRFTokenHandler(first, httptest.NewRequest(http.MethodGet, "https://localhost/api/csrf-token", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", first.Code, http.StatusOK)
	}
	if got := first.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	token := readCSRFTokenAnswer(t, first)
	if token == "" {
		t.Fatal("token answer is empty")
	}

	again := httptest.NewRequest(http.MethodGet, "https://localhost/api/csrf-token", nil)
	for _, cookie := range first.Result().Cookies() {
		again.AddCookie(cookie)
	}
	second := httptest.NewRecorder()
	CSRFTokenHandler(second, again)
	if got := readCSRFTokenAnswer(t, second); got != token {
		t.Fatalf("second answer = %q, want the session's token %q", got, token)
	}
}
