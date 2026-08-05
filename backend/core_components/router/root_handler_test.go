// root_handler_test.go
// Verifies the public rootHandler keeps anonymous root requests gated while still allowing SPA auth-shell entry URLs.
// Bridges root route requests, mocked system_config reads, and a temporary frontend template for template execution.
// Exists to prevent /?login-entry=1 and /?register-entry=1 from regressing back into redirect loops.
package router

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

	gorillaSessions "github.com/gorilla/sessions"
)

var rootHandlerDriverCounter int64
var rootHandlerTestKey = []byte("root-handler-test-secret-32-bytes")

type rootHandlerMockDriver struct {
	loginToBrowse bool
	instanceRole  string
	firstRun      bool
}

type rootHandlerMockConn struct {
	loginToBrowse bool
	instanceRole  string
	firstRun      bool
}

type rootHandlerMockTx struct{}

type rootHandlerMockRows struct {
	cols  []string
	vals  []driver.Value
	done  bool
	empty bool
}

func (d *rootHandlerMockDriver) Open(_ string) (driver.Conn, error) {
	return &rootHandlerMockConn{
		loginToBrowse: d.loginToBrowse,
		instanceRole:  d.instanceRole,
		firstRun:      d.firstRun,
	}, nil
}

func (c *rootHandlerMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (c *rootHandlerMockConn) Close() error              { return nil }
func (c *rootHandlerMockConn) Begin() (driver.Tx, error) { return &rootHandlerMockTx{}, nil }
func (t *rootHandlerMockTx) Commit() error               { return nil }
func (t *rootHandlerMockTx) Rollback() error             { return nil }
func (r *rootHandlerMockRows) Columns() []string         { return r.cols }
func (r *rootHandlerMockRows) Close() error              { return nil }

func (r *rootHandlerMockRows) Next(dest []driver.Value) error {
	if r.done || r.empty {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *rootHandlerMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	namedArgs := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		namedArgs[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, namedArgs)
}

func (c *rootHandlerMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "WHERE key = $1") &&
		len(args) > 0 &&
		args[0].Value == "first_run":
		return &rootHandlerMockRows{
			cols: []string{"boolean_value"},
			vals: []driver.Value{c.firstRun},
		}, nil
	case strings.Contains(query, "FROM system_config") &&
		len(args) > 0 &&
		args[0].Value == "easelect_instance_role":
		role := c.instanceRole
		if role == "" {
			role = backend.EaselectInstanceRoleApplication
		}
		return &rootHandlerMockRows{
			cols: []string{"text_value"},
			vals: []driver.Value{role},
		}, nil
	case strings.Contains(query, "allow_search_indexing"):
		return &rootHandlerMockRows{cols: []string{"boolean_value"}, empty: true}, nil
	case strings.Contains(query, "login_to_browse"):
		return &rootHandlerMockRows{
			cols: []string{"boolean_value"},
			vals: []driver.Value{c.loginToBrowse},
		}, nil
	case strings.Contains(query, "SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)"):
		exists := len(args) > 0 && (args[0].Value == "app_service_catalog" || args[0].Value == "app_cloud_services")
		return &rootHandlerMockRows{
			cols: []string{"exists"},
			vals: []driver.Value{exists},
		}, nil
	case strings.Contains(query, "FROM system_group_table_func_rights"):
		allowed := len(args) > 2 &&
			fmt.Sprint(args[0].Value) == "/api/get-results" &&
			fmt.Sprint(args[1].Value) == "1" &&
			fmt.Sprint(args[2].Value) == "app_service_catalog"
		return &rootHandlerMockRows{
			cols:  []string{"exists"},
			vals:  []driver.Value{1},
			empty: !allowed,
		}, nil
	case strings.Contains(query, "FROM system_lang_keys"):
		return &rootHandlerMockRows{cols: []string{"en"}, empty: true}, nil
	case strings.Contains(query, "SELECT description FROM system_db_tables WHERE table_name = $1"):
		return &rootHandlerMockRows{cols: []string{"description"}, empty: true}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func setupRootHandlerMockDB(t *testing.T, loginToBrowse bool) {
	setupRootHandlerMockDBWithRole(t, loginToBrowse, backend.EaselectInstanceRoleApplication)
}

func setupRootHandlerMockDBWithRole(t *testing.T, loginToBrowse bool, instanceRole string) {
	t.Helper()

	orig := backend.Db
	name := fmt.Sprintf(
		"root_handler_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&rootHandlerDriverCounter, 1),
	)
	sql.Register(name, &rootHandlerMockDriver{
		loginToBrowse: loginToBrowse,
		instanceRole:  instanceRole,
	})

	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	backend.Db = db
	backend.ResetEaselectInstanceRoleCache()

	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
		backend.ResetEaselectInstanceRoleCache()
	})
}

func openRootHandlerFirstRunDB(t *testing.T) *sql.DB {
	t.Helper()
	name := fmt.Sprintf(
		"root_handler_first_run_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&rootHandlerDriverCounter, 1),
	)
	sql.Register(name, &rootHandlerMockDriver{firstRun: true})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func setupRootHandlerSessionStore(t *testing.T) {
	t.Helper()

	origStore := e_sessions.Store
	origSessionName := e_sessions.SessionName

	store := gorillaSessions.NewCookieStore(rootHandlerTestKey)
	store.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		Secure:   false,
	}
	e_sessions.Store = store
	e_sessions.SessionName = "session"

	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origSessionName
	})
}

func setupRootHandlerFrontend(t *testing.T) {
	t.Helper()

	origFrontendDir := localFrontendDir
	frontendDir := t.TempDir()
	t.Setenv("SITE_NAME", "Test Product")

	indexHTML := `<!DOCTYPE html><html><head><title>{{.PageTitle}}</title></head><body>root-shell {{.SiteName}} product {{.ProductName}}</body></html>`
	if err := os.WriteFile(filepath.Join(frontendDir, "index.html"), []byte(indexHTML), 0o644); err != nil {
		t.Fatalf("WriteFile(index.html) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendDir, "favicon4S.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("WriteFile(favicon4S.png) error = %v", err)
	}

	localFrontendDir = frontendDir
	t.Cleanup(func() {
		localFrontendDir = origFrontendDir
	})
}

func attachRootHandlerSessionUser(t *testing.T, req *http.Request, userID int) {
	t.Helper()

	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get() error = %v", err)
	}
	session.Values["user_id"] = userID

	rr := httptest.NewRecorder()
	if err := session.Save(req, rr); err != nil {
		t.Fatalf("session.Save() error = %v", err)
	}
	for _, cookie := range rr.Result().Cookies() {
		req.AddCookie(cookie)
	}
}

func assertAuthShellNoStoreHeaders(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()

	if got := rr.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("Cache-Control = %q, want no-store directive", got)
	}
	if got := rr.Header().Get("Pragma"); got != "no-cache" {
		t.Fatalf("Pragma = %q, want no-cache", got)
	}
	if got := rr.Header().Get("Expires"); got != "0" {
		t.Fatalf("Expires = %q, want 0", got)
	}
	if got := rr.Header().Get("Vary"); !strings.Contains(got, "Cookie") {
		t.Fatalf("Vary = %q, want Cookie to be listed", got)
	}
}

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

func TestRootHandlerRedirectsAnonymousProtectedDatasetToLoginEntry(t *testing.T) {
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
	if !strings.HasPrefix(loc, "/?") {
		t.Fatalf("Location = %q, want login-entry shell redirect", loc)
	}
	reqURL, err := http.NewRequest(http.MethodGet, loc, nil)
	if err != nil {
		t.Fatalf("parse redirect Location %q: %v", loc, err)
	}
	query := reqURL.URL.Query()
	if query.Get("login-entry") != "1" {
		t.Fatalf("login-entry = %q, want 1 in Location %q", query.Get("login-entry"), loc)
	}
	if query.Get("redirect") != "/app_cloud_services" {
		t.Fatalf("redirect = %q, want /app_cloud_services in Location %q", query.Get("redirect"), loc)
	}
}

func TestRootHandlerRedirectsAnonymousUnknownSpaDeepLinkToLoginEntry(t *testing.T) {
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
	if !strings.Contains(loc, "login-entry=1") {
		t.Fatalf("Location = %q, want login-entry redirect", loc)
	}
	reqURL, err := http.NewRequest(http.MethodGet, loc, nil)
	if err != nil {
		t.Fatalf("parse redirect Location %q: %v", loc, err)
	}
	if got := reqURL.URL.Query().Get("redirect"); got != "/unknown_private_or_missing" {
		t.Fatalf("redirect = %q, want /unknown_private_or_missing", got)
	}
}

func TestRootHandlerRedirectsExistingGuestSessionProtectedDatasetToLoginEntry(t *testing.T) {
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
	if loc := rr.Header().Get("Location"); !strings.Contains(loc, "login-entry=1") {
		t.Fatalf("Location = %q, want login-entry redirect", loc)
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
