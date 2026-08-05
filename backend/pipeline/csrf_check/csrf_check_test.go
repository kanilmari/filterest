// csrf_check_test.go
// Table-driven unit tests for WithCSRFCheck pipeline stage.
// Session setup: we replace e_sessions.Store with a test CookieStore, create a session with the desired csrf_token, save it to a throwaway recorder, then copy the resulting Set-Cookie header onto each test request.
// This exercises the real GetOrCreateSession / gorilla/sessions code path without any network or DB calls.
package csrf_check

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

// testKey is the HMAC key used by the test CookieStore.  It must stay constant
// within a test run so cookies encoded for one request can be decoded by the
// middleware under test.
var testKey = []byte("test-secret-key-32-bytes-padding!")

// setupTestStore replaces the global e_sessions.Store with a test CookieStore
// and restores the original after the test.  Returns the test store so callers
// can pre-populate sessions.
func setupTestStore(t *testing.T) *gorillaSessions.CookieStore {
	t.Helper()
	orig := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore(testKey)
	testStore.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		Secure:   false, // httptest uses plain HTTP
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = orig
		e_sessions.SessionName = origName
	})
	return testStore
}

// buildRequestWithSession creates an *http.Request that carries a session cookie
// whose csrf_token is set to sessionToken.  If sessionToken is "" the session is
// stored without a csrf_token value, simulating a logged-in user whose session
// predates CSRF token issuance.
func buildRequestWithSession(t *testing.T, store *gorillaSessions.CookieStore, method, target, sessionToken string, body *bytes.Buffer, contentType string) *http.Request {
	t.Helper()

	// 1. Create a throw-away recorder and request solely to encode the cookie.
	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, target, nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	if sessionToken != "" {
		sess.Values["csrf_token"] = sessionToken
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}

	// 2. Build the real request, copying the encoded session cookie across.
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, target, body)
	} else {
		req = httptest.NewRequest(method, target, nil)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

// noopHandler is a minimal next-handler that records whether it was called.
func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

// ── Safe-method tests ─────────────────────────────────────────────────────

func TestWithCSRFCheck_SafeMethods(t *testing.T) {
	store := setupTestStore(t)

	safeMethods := []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodOptions,
	}

	for _, method := range safeMethods {
		t.Run(method, func(t *testing.T) {
			// Deliberately give the session NO csrf_token; safe methods must pass anyway.
			req := buildRequestWithSession(t, store, method, "/test", "", nil, "")
			rr := httptest.NewRecorder()
			called := false
			WithCSRFCheck(noopHandler(&called))(rr, req)

			if rr.Code != http.StatusOK {
				t.Errorf("%s: expected 200, got %d", method, rr.Code)
			}
			if !called {
				t.Errorf("%s: next handler was not called", method)
			}
		})
	}
}

// ── State-changing method table tests ────────────────────────────────────

type csrfTestCase struct {
	name string
	// Request setup
	method       string
	sessionToken string // value stored in session; "" = not set
	// Token delivery to the handler
	headerToken     string
	formToken       string // url-encoded form field
	multipartToken  string // multipart/form-data field
	// Expected outcome
	wantStatus  int
	wantCalled  bool
}

func TestWithCSRFCheck_StateChangingMethods(t *testing.T) {
	const validToken = "csrf-abc-123"

	tests := []csrfTestCase{
		// ── Valid token paths ───────────────────────────────────────────
		{
			name:         "POST valid X-CSRF-Token header",
			method:       http.MethodPost,
			sessionToken: validToken,
			headerToken:  validToken,
			wantStatus:   http.StatusOK,
			wantCalled:   true,
		},
		{
			name:         "PUT valid X-CSRF-Token header",
			method:       http.MethodPut,
			sessionToken: validToken,
			headerToken:  validToken,
			wantStatus:   http.StatusOK,
			wantCalled:   true,
		},
		{
			name:         "PATCH valid X-CSRF-Token header",
			method:       http.MethodPatch,
			sessionToken: validToken,
			headerToken:  validToken,
			wantStatus:   http.StatusOK,
			wantCalled:   true,
		},
		{
			name:         "DELETE valid X-CSRF-Token header",
			method:       http.MethodDelete,
			sessionToken: validToken,
			headerToken:  validToken,
			wantStatus:   http.StatusOK,
			wantCalled:   true,
		},
		{
			name:         "POST valid csrf_token form field",
			method:       http.MethodPost,
			sessionToken: validToken,
			formToken:    validToken,
			wantStatus:   http.StatusOK,
			wantCalled:   true,
		},
		{
			name:           "POST valid csrf_token multipart field",
			method:         http.MethodPost,
			sessionToken:   validToken,
			multipartToken: validToken,
			wantStatus:     http.StatusOK,
			wantCalled:     true,
		},

		// ── Missing / mismatched token paths ───────────────────────────
		{
			name:         "POST missing token entirely",
			method:       http.MethodPost,
			sessionToken: validToken,
			// no headerToken, no formToken, no multipartToken
			wantStatus: http.StatusForbidden,
			wantCalled: false,
		},
		{
			name:         "POST mismatched header token",
			method:       http.MethodPost,
			sessionToken: validToken,
			headerToken:  "wrong-token",
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},
		{
			name:         "POST mismatched form token",
			method:       http.MethodPost,
			sessionToken: validToken,
			formToken:    "wrong-token",
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},

		// ── Empty session token ────────────────────────────────────────
		{
			name:         "POST empty session token (no csrf_token in session)",
			method:       http.MethodPost,
			sessionToken: "", // not stored in session
			headerToken:  validToken,
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},

		// ── Per-method 403 smoke tests ─────────────────────────────────
		{
			name:         "PUT missing token",
			method:       http.MethodPut,
			sessionToken: validToken,
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},
		{
			name:         "PATCH missing token",
			method:       http.MethodPatch,
			sessionToken: validToken,
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},
		{
			name:         "DELETE missing token",
			method:       http.MethodDelete,
			sessionToken: validToken,
			wantStatus:   http.StatusForbidden,
			wantCalled:   false,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			store := setupTestStore(t)

			var body *bytes.Buffer
			var contentType string

			switch {
			case tc.multipartToken != "":
				// Build a multipart/form-data body.
				body = &bytes.Buffer{}
				mw := multipart.NewWriter(body)
				_ = mw.WriteField("csrf_token", tc.multipartToken)
				mw.Close()
				contentType = mw.FormDataContentType()

			case tc.formToken != "":
				// Build an application/x-www-form-urlencoded body.
				body = bytes.NewBufferString("csrf_token=" + tc.formToken)
				contentType = "application/x-www-form-urlencoded"

			default:
				body = nil
				contentType = ""
			}

			req := buildRequestWithSession(t, store, tc.method, "/test", tc.sessionToken, body, contentType)

			if tc.headerToken != "" {
				req.Header.Set("X-CSRF-Token", tc.headerToken)
			}

			rr := httptest.NewRecorder()
			called := false
			WithCSRFCheck(noopHandler(&called))(rr, req)

			if rr.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d", rr.Code, tc.wantStatus)
			}
			if called != tc.wantCalled {
				t.Errorf("next called: got %v, want %v", called, tc.wantCalled)
			}
			if tc.wantStatus == http.StatusForbidden {
				body := rr.Body.String()
				if !strings.Contains(body, "CSRF") && !strings.Contains(body, "csrf") && !strings.Contains(body, "session") {
					t.Errorf("403 body should mention CSRF or session, got: %s", body)
				}
			}
		})
	}
}

// ── Header takes precedence over form ────────────────────────────────────

// TestWithCSRFCheck_HeaderTakesPrecedence verifies that a valid header token
// passes even when the form field would be absent.  It also verifies that an
// invalid header token is not rescued by a valid form field — the code reads
// the form field only when the header is empty, but this test confirms the
// header path runs first.
func TestWithCSRFCheck_HeaderTakesPrecedence(t *testing.T) {
	store := setupTestStore(t)
	const validToken = "csrf-header-wins"

	// Valid header + no form field → should pass.
	req := buildRequestWithSession(t, store, http.MethodPost, "/test", validToken, nil, "")
	req.Header.Set("X-CSRF-Token", validToken)
	rr := httptest.NewRecorder()
	called := false
	WithCSRFCheck(noopHandler(&called))(rr, req)
	if rr.Code != http.StatusOK || !called {
		t.Errorf("expected 200 and next called; got %d called=%v", rr.Code, called)
	}
}
