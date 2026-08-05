// register_test.go
// Verifies that GET /register now hands off into the SPA guest shell instead of rendering directly.
// Bridges RegisterHandler route behavior and the register-entry redirect contract without invoking template rendering.
// Exists to keep the guest-shell register entry stable while the actual form stays server-rendered.
package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func withRegistrationEnabledForTest(t *testing.T) {
	t.Helper()
	original := registrationEnabledFunc
	registrationEnabledFunc = func() bool { return true }
	t.Cleanup(func() {
		registrationEnabledFunc = original
	})
}

func TestRegisterHandlerRedirectsGuestEntryWithoutRedirectParam(t *testing.T) {
	withRegistrationEnabledForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/register_ndYOyXV0INOK3F", nil)
	rr := httptest.NewRecorder()

	RegisterHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}

	if got := rr.Header().Get("Location"); got != "/?register-entry=1" {
		t.Fatalf("Location = %q, want %q", got, "/?register-entry=1")
	}
}

func TestRegisterHandlerRedirectsGuestEntryWithEncodedRedirectParam(t *testing.T) {
	withRegistrationEnabledForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/register_ndYOyXV0INOK3F?redirect=%2Fapp_service_catalog%3Ffoo%3D1%26bar%3D2", nil)
	rr := httptest.NewRecorder()

	RegisterHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}

	got := rr.Header().Get("Location")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("Location parse failed for %q: %v", got, err)
	}

	if parsed.Path != "/" {
		t.Fatalf("Location path = %q, want %q", parsed.Path, "/")
	}
	if parsed.Query().Get("register-entry") != "1" {
		t.Fatalf("register-entry = %q, want %q", parsed.Query().Get("register-entry"), "1")
	}
	if parsed.Query().Get("redirect") != "/app_service_catalog?foo=1&bar=2" {
		t.Fatalf("redirect = %q, want %q", parsed.Query().Get("redirect"), "/app_service_catalog?foo=1&bar=2")
	}
}
