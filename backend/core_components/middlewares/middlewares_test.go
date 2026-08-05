package middlewares

import (
	"bytes"
	"context"
	"database/sql"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------- helpers -----------------------------------------------------------

func okHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

// ---------- WithSecurityHeaders -----------------------------------------------

func TestWithSecurityHeaders_HeadersPresent(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	WithSecurityHeaders(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	tests := []struct{ header, want string }{
		{"Strict-Transport-Security", "max-age=63072000; includeSubDomains"},
		{"X-Frame-Options", "DENY"},
		{"X-Content-Type-Options", "nosniff"},
		{"Referrer-Policy", "no-referrer"},
	}
	for _, tc := range tests {
		if got := rr.Header().Get(tc.header); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.header, got, tc.want)
		}
	}
}

func TestWithSecurityHeaders_NextHandlerCalled(t *testing.T) {
	called := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WithSecurityHeaders(handler).ServeHTTP(rr, req)

	if !called {
		t.Error("next handler was not called")
	}
}

// ---------- WithCSP / GetCSPNonce --------------------------------------------

func TestWithCSP_HeaderPresent(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	WithCSP(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	csp := rr.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("Content-Security-Policy header missing")
	}
}

func TestWithCSP_HeaderContainsNonce(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	WithCSP(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	csp := rr.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "nonce-") {
		t.Errorf("CSP header missing nonce, got: %s", csp)
	}
}

func TestWithCSP_HeaderContainsExpectedDirectives(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	WithCSP(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	csp := rr.Header().Get("Content-Security-Policy")
	for _, directive := range []string{"default-src 'self'", "script-src", "style-src"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP header missing directive %q, got: %s", directive, csp)
		}
	}
}

func TestGetCSPNonce_InsideMiddleware(t *testing.T) {
	var nonce string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce = GetCSPNonce(r)
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WithCSP(inner).ServeHTTP(rr, req)

	if nonce == "" {
		t.Error("GetCSPNonce returned empty string inside WithCSP handler")
	}

	// nonce must also appear in the CSP header
	csp := rr.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, nonce) {
		t.Errorf("nonce %q not found in CSP header: %s", nonce, csp)
	}
}

func TestGetCSPNonce_WithoutMiddleware(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := GetCSPNonce(req); got != "" {
		t.Errorf("expected empty nonce without middleware, got %q", got)
	}
}

// ---------- WithPanicRecovery ------------------------------------------------

func TestWithPanicRecovery_NormalRequest(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	WithPanicRecovery(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Body.String() != "ok" {
		t.Errorf("unexpected body: %s", rr.Body.String())
	}
}

func TestWithPanicRecovery_StringPanic(t *testing.T) {
	panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something went wrong")
	})

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	WithPanicRecovery(panicHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "Internal Server Error") {
		t.Errorf("expected 'Internal Server Error' in body, got: %s", body)
	}
	if !strings.Contains(logBuf.String(), "PANIC_RECOVERY") {
		t.Errorf("expected PANIC_RECOVERY in log output, got: %s", logBuf.String())
	}
}

func TestWithPanicRecovery_IntPanic(t *testing.T) {
	panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(42)
	})

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	// Must not propagate panic to caller
	WithPanicRecovery(panicHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

func TestWithPanicRecovery_ErrorPanic(t *testing.T) {
	panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	})

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WithPanicRecovery(panicHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

// ---------- WithMaintenanceMode ----------------------------------------------

func setupMaintenance(t *testing.T, active bool) {
	original := configuredMaintenanceSiteNameReader
	configuredMaintenanceSiteNameReader = func(context.Context, *sql.DB) string { return "" }
	t.Setenv("MAINTENANCE_MODE", "false")
	t.Setenv("SITE_NAME", "TestSite")
	InitMaintenanceMode()
	SetMaintenanceMode(active)
	t.Cleanup(func() {
		SetMaintenanceMode(false)
		configuredMaintenanceSiteNameReader = original
	})
}

func TestInitMaintenanceModePrefersAdministratorOwnedIdentity(t *testing.T) {
	original := configuredMaintenanceSiteNameReader
	configuredMaintenanceSiteNameReader = func(context.Context, *sql.DB) string { return "Customer Workspace" }
	t.Cleanup(func() { configuredMaintenanceSiteNameReader = original })
	t.Setenv("SITE_NAME", "Filterest")

	InitMaintenanceMode()

	if !strings.Contains(maintenanceRendered, "Customer Workspace") {
		t.Fatalf("maintenance page did not use saved site identity: %q", maintenanceRendered)
	}
}

func TestWithMaintenanceMode_Off(t *testing.T) {
	setupMaintenance(t, false)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/some/page", nil)
	WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 when maintenance off, got %d", rr.Code)
	}
	if rr.Body.String() != "ok" {
		t.Errorf("expected next handler body, got: %s", rr.Body.String())
	}
}

func TestWithMaintenanceMode_BrowserNavigation(t *testing.T) {
	setupMaintenance(t, true)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/some/page", nil)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for browser navigation, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "TestSite") {
		t.Errorf("expected site name in maintenance HTML body")
	}
}

func TestWithMaintenanceMode_APIPath(t *testing.T) {
	setupMaintenance(t, true)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/some/endpoint", nil)
	req.Header.Set("Accept", "text/html")
	WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 for API path, got %d", rr.Code)
	}
}

func TestWithMaintenanceMode_Favicon(t *testing.T) {
	setupMaintenance(t, true)

	for _, path := range []string{"/favicon.ico", "/favicon4S.png"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

		if rr.Code != http.StatusNoContent {
			t.Errorf("%s: expected 204, got %d", path, rr.Code)
		}
	}
}

func TestWithMaintenanceMode_NonHTMLAccept(t *testing.T) {
	setupMaintenance(t, true)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/some/resource", nil)
	req.Header.Set("Accept", "application/json")
	WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 for non-HTML accept, got %d", rr.Code)
	}
}

func TestWithMaintenanceMode_RetryAfterHeader(t *testing.T) {
	setupMaintenance(t, true)

	for _, path := range []string{"/page", "/api/endpoint"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		WithMaintenanceMode(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

		if got := rr.Header().Get("Retry-After"); got != "300" {
			t.Errorf("%s: expected Retry-After: 300, got %q", path, got)
		}
	}
}
