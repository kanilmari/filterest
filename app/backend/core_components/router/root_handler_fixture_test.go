// root_handler_fixture_test.go
// Builds the fake database, session store, frontend and browser a root-page test needs.
// Between the root page's tests and the configuration, session and metadata sources it reads.
// Exists so the several test files that exercise the root page describe one installation
// rather than each inventing its own, and so a test can say what that installation's
// datasets are called and what their rows say without reaching a real database.
// Uses no network and no database.
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
	"easelect/backend/core_components/auth_generation"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

var rootHandlerDriverCounter int64
var rootHandlerTestKey = []byte("root-handler-test-secret-32-bytes")

// The one browser every root-handler fixture speaks for. See
// attachRootHandlerSessionUser for why a test session carries a binding at all.
const (
	rootHandlerTestDeviceID    = "root-handler-test-device"
	rootHandlerTestFingerprint = "root-handler-test-fingerprint"
)

// The dataset column this fixture's rows are titled by, the way an installation
// marks one column as a card's header.
const rootHandlerTestRowTitleColumn = "otsikko"

// A public file of the frontend's own, and what it contains.
const (
	rootHandlerTestStylesheet     = "root_handler_fixture.css"
	rootHandlerTestStylesheetBody = ":root{--fixture:1}"
)

// rootHandlerMockConfig is everything one test's installation says about itself:
// whether it lets a visitor browse without signing in, which role it runs in,
// whether it is still waiting for its first administrator, and what its one
// dataset and that dataset's row are called. The last two exist because the root
// page writes a dataset's description and a row's title into the page it returns,
// so a test that asks whether those reached the wrong browser needs them to have
// been worth reading in the first place.
type rootHandlerMockConfig struct {
	loginToBrowse      bool
	instanceRole       string
	firstRun           bool
	datasetDescription string
	rowTitle           string
}

type rootHandlerMockDriver struct {
	config rootHandlerMockConfig
}

type rootHandlerMockConn struct {
	config rootHandlerMockConfig
}

type rootHandlerMockTx struct{}

type rootHandlerMockRows struct {
	cols  []string
	vals  []driver.Value
	done  bool
	empty bool
}

func (d *rootHandlerMockDriver) Open(_ string) (driver.Conn, error) {
	return &rootHandlerMockConn{config: d.config}, nil
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
			vals: []driver.Value{c.config.firstRun},
		}, nil
	case strings.Contains(query, "FROM system_config") &&
		len(args) > 0 &&
		args[0].Value == "easelect_instance_role":
		role := c.config.instanceRole
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
			vals: []driver.Value{c.config.loginToBrowse},
		}, nil
	case strings.Contains(query, "dataset.ui_hidden"):
		return &rootHandlerMockRows{cols: []string{"hidden"}, vals: []driver.Value{false}}, nil
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
		return &rootHandlerMockRows{
			cols:  []string{"description"},
			vals:  []driver.Value{c.config.datasetDescription},
			empty: c.config.datasetDescription == "",
		}, nil
	// The two steps that turn a row address into the row's own title: first which
	// column of the dataset is the card header, then that column's value in the row.
	case strings.Contains(query, "FROM system_column_details"):
		return &rootHandlerMockRows{
			cols:  []string{"column_name"},
			vals:  []driver.Value{rootHandlerTestRowTitleColumn},
			empty: c.config.rowTitle == "",
		}, nil
	case strings.Contains(query, "WHERE id = $1 LIMIT 1"):
		return &rootHandlerMockRows{
			cols:  []string{rootHandlerTestRowTitleColumn},
			vals:  []driver.Value{c.config.rowTitle},
			empty: c.config.rowTitle == "",
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func setupRootHandlerMockDB(t *testing.T, loginToBrowse bool) {
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{
		loginToBrowse: loginToBrowse,
		instanceRole:  backend.EaselectInstanceRoleApplication,
	})
}

func setupRootHandlerMockDBWithRole(t *testing.T, loginToBrowse bool, instanceRole string) {
	setupRootHandlerMockDBWithConfig(t, rootHandlerMockConfig{
		loginToBrowse: loginToBrowse,
		instanceRole:  instanceRole,
	})
}

func setupRootHandlerMockDBWithConfig(t *testing.T, config rootHandlerMockConfig) {
	t.Helper()

	orig := backend.Db
	origAdmin := backend.DbAdmin
	origConfidential := backend.DbConfidential
	name := fmt.Sprintf(
		"root_handler_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&rootHandlerDriverCounter, 1),
	)
	sql.Register(name, &rootHandlerMockDriver{config: config})

	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	backend.Db = db
	backend.DbAdmin = nil
	backend.DbConfidential = db
	backend.ResetEaselectInstanceRoleCache()

	t.Cleanup(func() {
		_ = db.Close()
		backend.Db = orig
		backend.DbAdmin = origAdmin
		backend.DbConfidential = origConfidential
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
	sql.Register(name, &rootHandlerMockDriver{config: rootHandlerMockConfig{firstRun: true}})
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

	// The head carries the same four fields the real app/frontend/index.html
	// fills from the server, because those are what a page returned to the wrong
	// browser would have disclosed. The rest of that file is irrelevant here.
	indexHTML := `<!DOCTYPE html><html><head>` +
		`<title>{{.PageTitle}}</title>` +
		`<meta name="description" content="{{.MetaDescription}}">` +
		`<meta property="og:title" content="{{.OGTitle}}">` +
		`<meta property="og:description" content="{{.OGDescription}}">` +
		`</head><body>root-shell {{.SiteName}} product {{.ProductName}}</body></html>`
	if err := os.WriteFile(filepath.Join(frontendDir, "index.html"), []byte(indexHTML), 0o644); err != nil {
		t.Fatalf("WriteFile(index.html) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendDir, "favicon4S.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("WriteFile(favicon4S.png) error = %v", err)
	}
	// One of the frontend's own files, so a test can ask whether the site still
	// hands out the stylesheet its login page needs in order to look like a page.
	if err := os.WriteFile(filepath.Join(frontendDir, rootHandlerTestStylesheet), []byte(rootHandlerTestStylesheetBody), 0o644); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", rootHandlerTestStylesheet, err)
	}

	localFrontendDir = frontendDir
	t.Cleanup(func() {
		localFrontendDir = origFrontendDir
	})
}

// attachRootHandlerSessionUser gives the request the session of a real browser:
// an identity, and the device and fingerprint values that bind that identity to
// this one browser. A signed-in request always carries both, because they are
// written at sign-in and the pipeline stages compare every protected request
// against them; the root page refuses a sign-in that arrives without them. A
// fixture that supplied only the identity would therefore describe a browser
// that cannot exist. The values are the same for every test session, which is
// all a single-browser test needs.
func attachRootHandlerSessionUser(t *testing.T, req *http.Request, userID int) {
	t.Helper()

	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("Store.Get() error = %v", err)
	}
	session.Values["user_id"] = userID
	session.Values["device_id"] = rootHandlerTestDeviceID
	session.Values["fingerprint_hash"] = rootHandlerTestFingerprint

	rr := httptest.NewRecorder()
	if err := session.Save(req, rr); err != nil {
		t.Fatalf("session.Save() error = %v", err)
	}
	for _, cookie := range rr.Result().Cookies() {
		req.AddCookie(cookie)
	}
	req.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: rootHandlerTestDeviceID})
	req.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: rootHandlerTestFingerprint})
}

func withRootAuthenticationGenerationMatch(
	t *testing.T,
	matcher func(context.Context, auth_generation.Querier, *gorillaSessions.Session, int) (bool, error),
) {
	t.Helper()
	original := rootAuthenticationGenerationMatches
	rootAuthenticationGenerationMatches = matcher
	t.Cleanup(func() { rootAuthenticationGenerationMatches = original })
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
