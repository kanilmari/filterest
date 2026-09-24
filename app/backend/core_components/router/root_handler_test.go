// root_handler_test.go
// Verifies the public rootHandler keeps anonymous root requests gated while still allowing SPA auth-shell entry URLs.
// Bridges root route requests, mocked system_config reads, and a temporary frontend template for template execution.
// Exists to prevent /?login-entry=1 and /?register-entry=1 from regressing back into redirect loops.
// The installation these tests describe is built by root_handler_fixture_test.go.
package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

func TestRootHandlerRedirectsAnonymousRootWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if got := rr.Header().Get("Location"); got != "/login" {
		t.Fatalf("Location = %q, want /login", got)
	}
}

func TestRootHandlerClearsStaleAuthenticatedSessionBeforeRendering(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	withRootAuthenticationGenerationMatch(t, func(
		_ context.Context,
		database auth_generation.Querier,
		_ *gorillaSessions.Session,
		_ int,
	) (bool, error) {
		if database != backend.DbConfidential {
			t.Fatal("root authentication generation check did not use the confidential pool")
		}
		return false, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	attachRootHandlerSessionUser(t, req, 10000)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	// A sign-in that was revoked is not the same as never having signed in, so
	// the login page reached this way is told to explain why it appeared.
	if got := rr.Header().Get("Location"); got != "/login?auth_notice=session-ended&redirect=%2F" {
		t.Fatalf("Location = %q, want the login page with its explanation", got)
	}
	responseCookies := rr.Result().Cookies()
	if len(responseCookies) == 0 {
		t.Fatal("expected cleared session cookie")
	}
	readRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, cookie := range responseCookies {
		readRequest.AddCookie(cookie)
	}
	clearedSession, err := e_sessions.Store.Get(readRequest, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get() cleared session error = %v", err)
	}
	for _, key := range []string{"authenticated", "user_id", "username", "user_role", auth_generation.SessionKey} {
		if _, exists := clearedSession.Values[key]; exists {
			t.Fatalf("stale identity key %q remains in session", key)
		}
	}
}

func TestRootHandlerRedirectsAnonymousDatasetWithSessionNoticeWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/service_catalog?view=card", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	loc := rr.Header().Get("Location")
	parsed, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("url.Parse(%q) error = %v", loc, err)
	}
	if parsed.Path != "/login" {
		t.Fatalf("redirect path = %q, want /login", parsed.Path)
	}
	if got := parsed.Query().Get("auth_notice"); got != "session-ended" {
		t.Fatalf("auth_notice = %q, want session-ended", got)
	}
	if got := parsed.Query().Get("redirect"); got != "/service_catalog?view=card" {
		t.Fatalf("redirect = %q, want dataset return path", got)
	}
}

func TestRootHandlerReturns404ForAnonymousFileProbeWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	for _, path := range []string{"/wp-content/plugins/file-manager.php", "/favicon.ico"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rr := httptest.NewRecorder()

			rootHandler(rr, req)

			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
			}
			if location := rr.Header().Get("Location"); location != "" {
				t.Fatalf("unexpected login redirect for file probe: %q", location)
			}
		})
	}
}

func TestRootHandlerRedirectsFreshInstallToFirstRunSetup(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	originalDB := backend.Db
	backend.Db = openRootHandlerFirstRunDB(t)
	t.Cleanup(func() { backend.Db = originalDB })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if got := rr.Header().Get("Location"); got != "/first-run" {
		t.Fatalf("Location = %q, want /first-run", got)
	}
}

func TestRootHandlerAllowsLoginEntryShellWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/?login-entry=1", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	assertAuthShellNoStoreHeaders(t, rr)
	if !strings.Contains(rr.Body.String(), "root-shell") {
		t.Fatalf("expected root shell HTML, got %q", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "product Test Product") {
		t.Fatalf("expected configured product identity in root shell, got %q", rr.Body.String())
	}
}

func TestRootHandlerAllowsRegisterEntryShellWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/?register-entry=1", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	assertAuthShellNoStoreHeaders(t, rr)
	if !strings.Contains(rr.Body.String(), "root-shell") {
		t.Fatalf("expected root shell HTML, got %q", rr.Body.String())
	}
}

func TestRootHandlerAllowsDatasetShellWhenLoginRequired(t *testing.T) {
	setupRootHandlerMockDB(t, true)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/service_catalog?login-entry=1", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	assertAuthShellNoStoreHeaders(t, rr)
	if !strings.Contains(rr.Body.String(), "root-shell") {
		t.Fatalf("expected root shell HTML, got %q", rr.Body.String())
	}
}

func TestRootHandlerAllowsAliasedDatasetShell(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/service_catalog", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if !strings.Contains(rr.Body.String(), "root-shell") {
		t.Fatalf("expected root shell HTML, got %q", rr.Body.String())
	}
}

func TestRootHandlerRedirectsAnonymousProtectedDatasetToExplainedLogin(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/app_cloud_services", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	loc := rr.Header().Get("Location")
	if loc == "" {
		t.Fatal("expected redirect Location")
	}
	if !strings.HasPrefix(loc, "/login?") {
		t.Fatalf("Location = %q, want standalone login redirect", loc)
	}
	reqURL, err := http.NewRequest(http.MethodGet, loc, nil)
	if err != nil {
		t.Fatalf("parse redirect Location %q: %v", loc, err)
	}
	query := reqURL.URL.Query()
	if query.Get("auth_notice") != "session-ended" {
		t.Fatalf("auth_notice = %q, want session-ended in Location %q", query.Get("auth_notice"), loc)
	}
	if query.Get("redirect") != "/app_cloud_services" {
		t.Fatalf("redirect = %q, want /app_cloud_services in Location %q", query.Get("redirect"), loc)
	}
}

func TestRootHandlerRedirectsAnonymousUnknownSpaDeepLinkToExplainedLogin(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/unknown_private_or_missing", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	loc := rr.Header().Get("Location")
	if !strings.HasPrefix(loc, "/login?") {
		t.Fatalf("Location = %q, want standalone login redirect", loc)
	}
	reqURL, err := http.NewRequest(http.MethodGet, loc, nil)
	if err != nil {
		t.Fatalf("parse redirect Location %q: %v", loc, err)
	}
	if got := reqURL.URL.Query().Get("redirect"); got != "/unknown_private_or_missing" {
		t.Fatalf("redirect = %q, want /unknown_private_or_missing", got)
	}
	if got := reqURL.URL.Query().Get("auth_notice"); got != "session-ended" {
		t.Fatalf("auth_notice = %q, want session-ended", got)
	}
}

func TestRootHandlerRedirectsExistingGuestSessionProtectedDatasetToExplainedLogin(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	setupRootHandlerMockDBWithRole(t, false, backend.EaselectInstanceRoleManagement)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/app_cloud_services", nil)
	attachRootHandlerSessionUser(t, req, 1)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); !strings.Contains(loc, "auth_notice=session-ended") {
		t.Fatalf("Location = %q, want explained login redirect", loc)
	}
}

func TestDatasetExistsHidesCloudDatasetsOnApplicationRole(t *testing.T) {
	setupRootHandlerMockDB(t, false)

	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	if datasetExists("app_cloud_services") {
		t.Fatal("app_cloud_services should be hidden on application instances")
	}
}

func TestDatasetExistsShowsCloudDatasetsOnManagementRole(t *testing.T) {
	setupRootHandlerMockDBWithRole(t, false, backend.EaselectInstanceRoleManagement)

	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	if !datasetExists("app_cloud_services") {
		t.Fatal("app_cloud_services should exist when cloud-management role is enabled")
	}
}

func TestRootHandlerAllowsAnonymousPublicDatasetShell(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/service_catalog", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	if !strings.Contains(rr.Body.String(), "root-shell") {
		t.Fatalf("expected root shell HTML, got %q", rr.Body.String())
	}
}

func TestRootHandlerKeepsAnonymousMissingFileLikePathAsStatic404(t *testing.T) {
	setupRootHandlerMockDB(t, false)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "/missing.svg", nil)
	rr := httptest.NewRecorder()

	rootHandler(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
}
