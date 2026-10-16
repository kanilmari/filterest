// sec4_read_boundary_test.go
// Exercises the accepted security lows through real handlers with in-memory SQL.
// Connects permission principals and controlled rows without network or installation data.
// Refusals must precede disclosure; administrator behavior remains covered.
package auth

import (
	"bytes"
	"context"
	"database/sql"
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/logging"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSEC4FirstRunRemoteRequiresSetupProof(t *testing.T) {
	old := firstRunPendingReader
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return true, nil }
	t.Cleanup(func() { firstRunPendingReader = old })
	var output bytes.Buffer
	logging.SetOutput(&output)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })
	for _, method := range []string{"GET", "POST"} {
		req := httptest.NewRequest(method, "/first-run", nil)
		req.RemoteAddr = "192.0.2.42:1234"
		req.Header.Set("X-Forwarded-For", "127.0.0.1")
		rec := httptest.NewRecorder()
		FirstRunAdminHandler(rec, req)
		if rec.Code != 403 {
			t.Fatalf("remote %s status=%d want 403", method, rec.Code)
		}
	}

	req := httptest.NewRequest("GET", "/first-run", nil)
	req.RemoteAddr = "192.0.2.42:1234"
	req.Header.Set("X-Filterest-Setup-Token", firstRunAccess.proof)
	if !firstRunAccessAllowed(req) {
		t.Fatal("valid setup header refused")
	}
	req.Header.Del("X-Filterest-Setup-Token")
	req.RemoteAddr = "127.0.0.1:1234"
	if !firstRunAccessAllowed(req) {
		t.Fatal("direct loopback refused")
	}
	req = req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, "192.0.2.42"))
	if firstRunAccessAllowed(req) {
		t.Fatal("remote visitor through trusted loopback proxy bypassed setup proof")
	}
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return false, nil }
	rec := httptest.NewRecorder()
	FirstRunAdminHandler(rec, req)
	if rec.Code != 303 || rec.Header().Get("Location") != "/login" {
		t.Fatal("closed setup changed")
	}
	if strings.Contains(rec.Body.String(), firstRunAccess.proof) {
		t.Fatal("setup proof reached HTTP output")
	}
}
func TestSEC4RegistrationConcealsDuplicatesAndUsesSharedRule(t *testing.T) {
	state := setupRegisterAdmin(t)
	registrationEnabledFunc = func() bool { return true }
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Run("duplicate answer", func(t *testing.T) {
		// A transaction read returns the duplicate flag for each individual account identity.
		for _, accept := range []string{"application/json", "text/html"} {
			var created string
			for _, duplicate := range []string{"", "login_name", "username", "email"} {
				state.duplicate = duplicate
				req := registerAdminRequest(t, validRegistrationAdminSession(), "test-csrf")
				req.Header.Set("Accept", accept)
				rec := httptest.NewRecorder()
				RegisterAPIHandler(rec, req)
				if rec.Code != 200 {
					t.Fatalf("%s %s: status=%d", accept, duplicate, rec.Code)
				}
				body := rec.Body.String()
				// CSRF and shell nonce are generated per request; compare the visible completion fragment.
				if accept == "text/html" {
					assertNeutralRegistrationHTML(t, rec)
					continue
				}
				if duplicate == "" {
					created = body
				} else if body != created {
					t.Fatalf("duplicate %s differs from created", duplicate)
				}
			}
		}
	})
	t.Run("shared rule", func(t *testing.T) {
		state.duplicate = ""
		before := state.inserts
		req := registerAdminRequest(t, validRegistrationAdminSession(), "test-csrf")
		req.ParseForm()
		req.PostForm.Set("password", "short")
		req.Form = nil
		req = withRegistrationFormBody(req, req.PostForm.Encode())
		req.Header.Set("Accept", "application/json")
		rec := httptest.NewRecorder()
		RegisterAPIHandler(rec, req)
		if rec.Code != 400 || state.inserts != before {
			t.Fatalf("shared rule missing: status=%d inserts=%d", rec.Code, state.inserts-before)
		}

	})
}
