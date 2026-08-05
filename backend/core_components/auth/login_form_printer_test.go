// login_form_printer_test.go
// Verifies the login route chooses the correct standalone or SPA entry behavior.
// Bridges LoginHandler, mocked login_to_browse reads, and a temporary login template.
// Exists to keep forced-login standalone rendering from regressing back into an
// empty SPA shell while preserving the modal fragment contract.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

var loginHandlerDriverCounter int64

type loginHandlerMockDriver struct {
	loginToBrowse bool
}

type loginHandlerMockConn struct {
	loginToBrowse bool
}

type loginHandlerMockTx struct{}

type loginHandlerMockRows struct {
	cols  []string
	vals  []driver.Value
	done  bool
	empty bool
}

func (d *loginHandlerMockDriver) Open(_ string) (driver.Conn, error) {
	return &loginHandlerMockConn{loginToBrowse: d.loginToBrowse}, nil
}

func (c *loginHandlerMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *loginHandlerMockConn) Close() error              { return nil }
func (c *loginHandlerMockConn) Begin() (driver.Tx, error) { return &loginHandlerMockTx{}, nil }
func (t *loginHandlerMockTx) Commit() error               { return nil }
func (t *loginHandlerMockTx) Rollback() error             { return nil }
func (r *loginHandlerMockRows) Columns() []string         { return r.cols }
func (r *loginHandlerMockRows) Close() error              { return nil }

func (r *loginHandlerMockRows) Next(dest []driver.Value) error {
	if r.done || r.empty {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *loginHandlerMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	namedArgs := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		namedArgs[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, namedArgs)
}

func (c *loginHandlerMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "login_to_browse"):
		return &loginHandlerMockRows{
			cols: []string{"boolean_value"},
			vals: []driver.Value{c.loginToBrowse},
		}, nil
	case strings.Contains(query, "use_minified_js_css_in_dev_env"):
		return &loginHandlerMockRows{cols: []string{"boolean_value"}, empty: true}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func prepareLoginHandlerSessionStore(t *testing.T) *sessions.CookieStore {
	t.Helper()

	origStore := e_sessions.Store
	origSessionName := e_sessions.SessionName
	origAuthStore := store

	testStore := sessions.NewCookieStore([]byte("01234567890123456789012345678901"))
	testStore.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	store = testStore

	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origSessionName
		store = origAuthStore
	})

	return testStore
}

func setupLoginHandlerMockDB(t *testing.T, loginToBrowse bool) {
	t.Helper()

	orig := backend.Db
	origFirstRunReader := firstRunPendingReader
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return false, nil }
	name := fmt.Sprintf(
		"login_handler_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&loginHandlerDriverCounter, 1),
	)
	sql.Register(name, &loginHandlerMockDriver{loginToBrowse: loginToBrowse})

	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	backend.Db = db

	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
		firstRunPendingReader = origFirstRunReader
	})
}

func TestLoginHandlerRedirectsToFirstRunSetupWhenPending(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, true)
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return true, nil }

	req := httptest.NewRequest(http.MethodGet, "https://localhost/login", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if got := rr.Header().Get("Location"); got != "/first-run" {
		t.Fatalf("Location = %q, want /first-run", got)
	}
}

func setupLoginHandlerFrontend(t *testing.T) {
	t.Helper()

	origFrontendDir := frontend_dir
	frontendDir := t.TempDir()
	templateDir := filepath.Join(frontendDir, "templates")
	if err := os.MkdirAll(templateDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	loginTemplate := `{{if .StandalonePage}}standalone{{else}}fragment{{end}}|{{if .ShowCloseButton}}close{{else}}noclose{{end}}|{{if .ShowTourScreenshots}}tourshots{{else}}notourshots{{end}}|{{.SiteName}}`
	if err := os.WriteFile(filepath.Join(templateDir, "login.html"), []byte(loginTemplate), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	InitAuth(store, frontendDir)
	t.Cleanup(func() {
		frontend_dir = origFrontendDir
	})
}

func TestLoginHandlerRendersStandalonePageWhenBrowsingIsOptional(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:5173/login", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	if got := rr.Body.String(); got != "standalone|noclose|tourshots|localhost" {
		t.Fatalf("body = %q, want %q", got, "standalone|noclose|tourshots|localhost")
	}
}

func TestLoginHandlerRendersStandalonePageWithRedirectParamWhenBrowsingIsOptional(t *testing.T) {
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, false)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "http://localhost:5173/login?redirect=%2Fapp_service_catalog%3Ffoo%3D1%26bar%3D2", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	if got := rr.Body.String(); got != "standalone|noclose|tourshots|localhost" {
		t.Fatalf("body = %q, want %q", got, "standalone|noclose|tourshots|localhost")
	}
}

func TestLoginHandlerRendersStandalonePageWithRequestHostSiteName(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("SITE_NAME", "Serlog.com")
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, true)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "https://filterest.com/login", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if loc := rr.Header().Get("Location"); loc != "" {
		t.Fatalf("unexpected redirect Location = %q", loc)
	}
	if got := rr.Body.String(); got != "standalone|noclose|notourshots|filterest.com" {
		t.Fatalf("body = %q, want %q", got, "standalone|noclose|notourshots|filterest.com")
	}
}

func TestLoginHandlerRendersFragmentTemplateWithRequestHostSiteName(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("SITE_NAME", "Serlog.com")
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, true)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "https://filterest.com/login?fragment=1", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Body.String(); got != "fragment|close|notourshots|filterest.com" {
		t.Fatalf("body = %q, want %q", got, "fragment|close|notourshots|filterest.com")
	}
}

func TestLoginHandlerKeepsFilterestTourScreenshotsHiddenWhenEnvEnablesThem(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("LOGIN_PAGE_TOUR_SCREENSHOTS_ENABLED", "true")
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, true)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "https://filterest.com/login", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Body.String(); got != "standalone|noclose|notourshots|filterest.com" {
		t.Fatalf("body = %q, want %q", got, "standalone|noclose|notourshots|filterest.com")
	}
}

func TestLoginHandlerCanDisableStandaloneTourScreenshotsViaEnv(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("SITE_NAME", "easelect.com")
	t.Setenv("LOGIN_PAGE_TOUR_SCREENSHOTS_ENABLED", "false")
	prepareLoginHandlerSessionStore(t)
	setupLoginHandlerMockDB(t, true)
	setupLoginHandlerFrontend(t)

	req := httptest.NewRequest(http.MethodGet, "https://easelect.com/login", nil)
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Body.String(); got != "standalone|noclose|notourshots|easelect.com" {
		t.Fatalf("body = %q, want %q", got, "standalone|noclose|notourshots|easelect.com")
	}
}

func TestResolveLoginSiteNameUsesForwardedHostAndStripsPort(t *testing.T) {
	t.Setenv("SITE_NAME", "Serlog.com")

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/login", nil)
	req.Host = "127.0.0.1:8082"
	req.Header.Set("X-Forwarded-Host", "Filterest.com:443")

	if got := resolveLoginSiteName(req); got != "filterest.com" {
		t.Fatalf("resolveLoginSiteName() = %q, want %q", got, "filterest.com")
	}
}

func TestResolveLoginSiteNamePrefersAdministratorOwnedIdentity(t *testing.T) {
	original := configuredSiteNameReader
	configuredSiteNameReader = func(context.Context, *sql.DB) string { return "Customer Workspace" }
	t.Cleanup(func() { configuredSiteNameReader = original })

	req := httptest.NewRequest(http.MethodGet, "https://filterest.example/login", nil)
	if got := resolveLoginSiteName(req); got != "Customer Workspace" {
		t.Fatalf("resolveLoginSiteName() = %q, want %q", got, "Customer Workspace")
	}
}

func TestResolveLoginSiteNameFallsBackToEnvWithoutRequestHost(t *testing.T) {
	t.Setenv("SITE_NAME", "Serlog.com")

	if got := resolveLoginSiteName(nil); got != "Serlog.com" {
		t.Fatalf("resolveLoginSiteName(nil) = %q, want %q", got, "Serlog.com")
	}
}
