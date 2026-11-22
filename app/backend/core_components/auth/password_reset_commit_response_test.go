// password_reset_commit_response_test.go
// Runs the password-reset request through the real transaction middleware.
// Connects commit-confirmed buffering with the handler's explicit acknowledgement flush.
// Keeps the acknowledgement ahead of background delivery for this pool-only handler.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
)

func TestRequestPasswordResetFlushesAcknowledgementThroughTransactionMiddleware(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	t.Setenv("SESSION_KEY", "reset-test-signing-key-32-characters")
	origDB, origGuest, origConf := backend.Db, backend.DbGuest, backend.DbConfidential
	pool := openPasswordResetMockDB(t, passwordResetMockConfig{userLookupFound: false})
	backend.Db, backend.DbGuest = pool, pool
	backend.DbConfidential = openPasswordResetMockDB(t, passwordResetMockConfig{})
	t.Cleanup(func() {
		backend.Db, backend.DbGuest, backend.DbConfidential = origDB, origGuest, origConf
	})

	cookie := seedSessionCookie(t, map[interface{}]interface{}{"csrf_token": "csrf-789"})
	req := httptest.NewRequest(http.MethodPost, "/api/request-password-reset-otp", strings.NewReader(`{"identifier":"ghost-user","csrf_token":"csrf-789"}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	// POST requests are buffered until commit. This handler opens no request
	// transaction, so its explicit flush must still reach the client at once.
	middlewares.WithLazyTransaction(http.HandlerFunc(RequestPasswordResetOTPHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK || !rr.Flushed {
		t.Fatalf("acknowledgement was not flushed: status=%d flushed=%t", rr.Code, rr.Flushed)
	}
	if body := decodeAuthJSONBody(t, rr); body["password_reset_requested"] != true {
		t.Fatalf("unexpected body: %#v", body)
	}
}
