// access_control_test.go
// Integration tests for the WithAccessControl pipeline middleware and the ensureGuestSession helper.
// Session setup: same approach as csrf_check_test.go — replace e_sessions.Store with a test CookieStore, encode a session cookie into a throwaway recorder, then copy the Set-Cookie header onto each real test request. DB setup: replace backend.Db with a scripted database/sql driver (same pattern as ensure_logged_in_test.go).
// The acMockConn.QueryContext method matches query fragments to return controlled values for each query type: - "login_to_browse"             → loginToBrowse config - "FROM system_users"           → username string ("testuser") - "specific_table_related"      → specificRelated bool - "group_id = 1"               → isAdmin (1 row or ErrNoRows) - "system_group_table_func_rights" → permissionGranted (1 row or ErrNoRows) - "information_schema.tables"  → tableExists bool NOTE: WithAccessControl captures isDev = os.Getenv("ENVIRONMENT_TYPE") == "dev" at middleware creation time (closure), not per request. Tests that exercise the dev bypass must call t.Setenv BEFORE calling WithAccessControl(...).
package access_control

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

// ── Session store helpers ──────────────────────────────────────────────────

var testKey = []byte("test-secret-key-32-bytes-padding!")

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

// buildReq creates an *http.Request carrying a session cookie.
//   - userID == nil  → anonymous session (no user_id key)
//   - userID == int  → valid authenticated session
//   - userID == other type → wrong-type session (triggers auth failure path)
func buildReq(t *testing.T, store *gorillaSessions.CookieStore, method, target string, userID interface{}, body io.Reader, contentType string) *http.Request {
	t.Helper()
	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, target, nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	if userID != nil {
		sess.Values["user_id"] = userID
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}
	req := httptest.NewRequest(method, target, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

// noopHandler records whether it was called and writes 200 OK.
func noopHandler(called *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	}
}

// ── Scripted mock DB driver ────────────────────────────────────────────────

// acMockConfig controls what the scripted DB driver returns for each query type
// encountered inside WithAccessControl and its callees.
type acMockConfig struct {
	loginToBrowse     bool // returned for system_config/login_to_browse query
	loginToBrowseErr  bool // simulate DB error for login_to_browse
	instanceRole      string
	specificRelated   bool // returned for system_functions/specific_table_related
	isAdmin           bool // whether admin membership row exists (group_id=1)
	permissionGranted bool // whether permission row exists in system_group_table_func_rights
	tableExists       bool // returned for information_schema.tables EXISTS check
}

type acMockDriver struct{ cfg acMockConfig }
type acMockConn struct{ cfg acMockConfig }
type acMockTx struct{}

type acMockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

func (d *acMockDriver) Open(_ string) (driver.Conn, error) {
	return &acMockConn{cfg: d.cfg}, nil
}

func (c *acMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *acMockConn) Close() error              { return nil }
func (c *acMockConn) Begin() (driver.Tx, error) { return &acMockTx{}, nil }
func (t *acMockTx) Commit() error               { return nil }
func (t *acMockTx) Rollback() error             { return nil }
func (r *acMockRows) Columns() []string         { return r.cols }
func (r *acMockRows) Close() error              { return nil }
func (r *acMockRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

// mockOneRow returns a single-row result with one int64(1) column.
func mockOneRow(col string) driver.Rows {
	return &acMockRows{cols: []string{col}, vals: []driver.Value{int64(1)}}
}

// mockBoolRow returns a single-row result with one bool column.
func mockBoolRow(col string, val bool) driver.Rows {
	return &acMockRows{cols: []string{col}, vals: []driver.Value{val}}
}

// mockStringRow returns a single-row result with one string column.
func mockStringRow(col string, val string) driver.Rows {
	return &acMockRows{cols: []string{col}, vals: []driver.Value{val}}
}

// mockEmptyRows returns a rows result with no data (triggers sql.ErrNoRows on Scan).
func mockEmptyRows(col string) driver.Rows {
	return &acMockRows{cols: []string{col}, done: true}
}

// Query implements driver.Queryer (non-context version) by delegating to QueryContext.
func (c *acMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

// QueryContext routes each SQL query to the appropriate scripted response based
// on distinctive substrings in the query text.
func (c *acMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_config") &&
		len(args) > 0 &&
		args[0].Value == "easelect_instance_role":
		role := c.cfg.instanceRole
		if role == "" {
			role = backend.EaselectInstanceRoleApplication
		}
		return mockStringRow("text_value", role), nil

	case strings.Contains(query, "login_to_browse"):
		if c.cfg.loginToBrowseErr {
			return nil, fmt.Errorf("simulated DB error")
		}
		return mockBoolRow("boolean_value", c.cfg.loginToBrowse), nil

	case strings.Contains(query, "FROM system_users"):
		// Username lookup — never fails; uses fallback "id:N" on error in real code.
		return mockStringRow("username", "testuser"), nil

	case strings.Contains(query, "specific_table_related"):
		// Queried twice: once in WithAccessControl, once in userHasFunctionPermissionOnTable.
		return mockBoolRow("specific_table_related", c.cfg.specificRelated), nil

	case strings.Contains(query, "group_id = 1"):
		// Admin membership check in userIsAdmin.
		if c.cfg.isAdmin {
			return mockOneRow("col"), nil
		}
		return mockEmptyRows("col"), nil

	case strings.Contains(query, "system_group_table_func_rights"):
		// Permission check (table-specific or table-less JOIN query).
		if c.cfg.permissionGranted {
			return mockOneRow("col"), nil
		}
		return mockEmptyRows("col"), nil

	case strings.Contains(query, "information_schema.tables"):
		// Table existence check in the ?datasets= multi-table path.
		return mockBoolRow("exists", c.cfg.tableExists), nil

	default:
		return nil, fmt.Errorf("acMockConn: unexpected query: %s", query)
	}
}

var acDriverCounter int64

// setupMockDB replaces backend.Db with a scripted mock and restores it after the test.
func setupMockDB(t *testing.T, cfg acMockConfig) {
	t.Helper()
	orig := backend.Db
	d := &acMockDriver{cfg: cfg}
	name := fmt.Sprintf("ac_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&acDriverCounter, 1))
	sql.Register(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	backend.Db = db
	backend.ResetEaselectInstanceRoleCache()
	t.Cleanup(func() {
		db.Close()
		backend.Db = orig
		backend.ResetEaselectInstanceRoleCache()
	})
}

// ── WithAccessControl tests ────────────────────────────────────────────────

// TestWithAccessControl_DevBypass verifies that in dev mode, schema-modification
// endpoints skip all access control and call the handler directly.
// The isDev flag is captured at WithAccessControl creation time, so ENVIRONMENT_TYPE
// must be set before the middleware is created.
func TestWithAccessControl_DevBypass(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")

	store := setupTestStore(t)
	// No user_id in session — the bypass must fire before any session/DB checks.
	req := buildReq(t, store, http.MethodPost, "/api/modify-columns", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/modify-columns", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called for dev-bypass route (no auth check)")
	}
}

// TestWithAccessControl_DevBypassRequiresExplicitDev verifies that an unset
// environment no longer activates the schema-modification bypass.
func TestWithAccessControl_DevBypassRequiresExplicitDev(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "")

	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		loginToBrowse: true,
	})
	req := buildReq(t, store, http.MethodPost, "/api/modify-columns", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/modify-columns", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when dev bypass is not explicitly enabled")
	}
	if rr.Code != http.StatusSeeOther {
		t.Errorf("expected redirect, got %d", rr.Code)
	}
}

// TestWithAccessControl_DevBypass_NonBypassRoute verifies that in dev mode,
// routes not in the bypass list still go through normal access control.
func TestWithAccessControl_DevBypass_NonBypassRoute(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")

	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		loginToBrowse: true, // force redirect for anonymous user
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called: non-bypass route still requires auth")
	}
	if rr.Code != http.StatusSeeOther {
		t.Errorf("expected redirect, got %d", rr.Code)
	}
}

// TestWithAccessControl_AnonymousUser_LoginRequired redirects anonymous users
// to /login when login_to_browse = true.
func TestWithAccessControl_AnonymousUser_LoginRequired(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{loginToBrowse: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for anonymous user when login required")
	}
	if rr.Code != http.StatusSeeOther {
		t.Errorf("status: got %d, want %d (redirect)", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Errorf("Location: got %q, want /login", loc)
	}
}

// TestWithAccessControl_StaleGuestSession_LoginRequired blocks pre-existing
// guest sessions when login_to_browse becomes true.
func TestWithAccessControl_StaleGuestSession_LoginRequired(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{loginToBrowse: true})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", 1, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for stale guest session when login required")
	}
	if rr.Code != http.StatusSeeOther {
		t.Errorf("status: got %d, want %d (redirect)", rr.Code, http.StatusSeeOther)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Errorf("Location: got %q, want /login", loc)
	}
}

// TestWithAccessControl_AnonymousUser_GuestAllowed assigns a guest session
// (user_id=1) when login_to_browse = false and then proceeds with permission checks.
func TestWithAccessControl_AnonymousUser_GuestAllowed(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		loginToBrowse:     false,
		specificRelated:   false, // tableless function → no table extraction needed
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/list", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/list", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called for guest user when login not required and permission granted")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
}

// TestWithAccessControl_AnonymousUser_GuestDenied returns 403 when the guest
// user has no permission (login_to_browse=false path).
func TestWithAccessControl_AnonymousUser_GuestDenied(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		loginToBrowse:     false,
		specificRelated:   false,
		permissionGranted: false,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/list", nil, nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/list", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when guest permission denied")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
}

// TestWithAccessControl_WrongTypeUserID returns 403 with auth_failure=true when
// the session carries a user_id of the wrong Go type (string instead of int).
func TestWithAccessControl_WrongTypeUserID(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{loginToBrowse: false})
	req := buildReq(t, store, http.MethodGet, "/api/get-results", "not-an-int", nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when user_id has wrong type")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	var body map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("response body not JSON: %v", err)
	}
	if body["auth_failure"] != true {
		t.Errorf("expected auth_failure=true in body, got %v", body)
	}
}

// TestWithAccessControl_NonSpecificTable_Granted calls the handler when the
// function is not table-specific and the user has function-level permission.
func TestWithAccessControl_NonSpecificTable_Granted(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   false,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/list", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/list", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when function-level permission granted")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rr.Code)
	}
}

// TestWithAccessControl_NonSpecificTable_Denied returns 403 when the function
// is not table-specific and the user lacks function-level permission.
func TestWithAccessControl_NonSpecificTable_Denied(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   false,
		permissionGranted: false,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/list", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/list", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when permission denied")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", rr.Code)
	}
}

// TestWithAccessControl_SpecificTable_QueryParam_Dataset extracts the table name
// from ?dataset=... and allows access when the user has table permission.
func TestWithAccessControl_SpecificTable_QueryParam_Dataset(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=mytable", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table permission granted via ?dataset param")
	}
}

// TestWithAccessControl_SpecificTable_QueryParam_Dataset_Denied returns 403 when
// ?dataset is set but the user lacks table permission.
func TestWithAccessControl_SpecificTable_QueryParam_Dataset_Denied(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: false,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=mytable", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when permission denied")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", rr.Code)
	}
}

func TestWithAccessControl_HidesCloudDatasetWhenManagementUIDisabled(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "0")
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=app_cloud_services", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for hidden cloud-management datasets")
	}
	if rr.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rr.Code)
	}
}

func TestWithAccessControl_AllowsCloudDatasetWhenManagementUIEnabled(t *testing.T) {
	t.Setenv("CLOUD_MANAGEMENT_UI_ENABLED", "1")
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		instanceRole:      backend.EaselectInstanceRoleManagement,
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=app_cloud_services", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when cloud-management UI is explicitly enabled")
	}
}

// TestWithAccessControl_SpecificTable_QueryParam_Table extracts table name from
// the legacy ?table=... query parameter.
func TestWithAccessControl_SpecificTable_QueryParam_Table(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?table=mytable", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when permission granted via ?table param")
	}
}

// TestWithAccessControl_SpecificTable_QueryParam_DatasetUID extracts the table
// UID from ?dataset_uid=... and uses it for the permission check.
func TestWithAccessControl_SpecificTable_QueryParam_DatasetUID(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset_uid=abc-123", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when permission granted via ?dataset_uid param")
	}
}

// TestWithAccessControl_SpecificTable_QueryParam_TableUID extracts the table
// UID from the legacy ?table_uid=... query parameter.
func TestWithAccessControl_SpecificTable_QueryParam_TableUID(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?table_uid=abc-123", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when permission granted via ?table_uid param")
	}
}

// TestWithAccessControl_SpecificTable_URLPath extracts the table name from the
// URL path suffix when no query parameters are present.
// Route /api/get-results + URL /api/get-results/mytable → tableName = "mytable".
func TestWithAccessControl_SpecificTable_URLPath(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results/mytable", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table permission granted via URL path suffix")
	}
}

// TestWithAccessControl_SpecificTable_JSONBody_DatasetName extracts the table
// name from JSON body field "dataset_name" for non-GET requests when no query
// parameters are set.
func TestWithAccessControl_SpecificTable_JSONBody_DatasetName(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	body, _ := json.Marshal(map[string]string{"dataset_name": "mytable"})
	req := buildReq(t, store, http.MethodPost, "/api/add-row", int(42),
		bytes.NewReader(body), "application/json")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/add-row", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table extracted from JSON body dataset_name")
	}
}

// TestWithAccessControl_SpecificTable_JSONBody_TableName extracts the table
// name from JSON body field "table_name".
func TestWithAccessControl_SpecificTable_JSONBody_TableName(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	body, _ := json.Marshal(map[string]string{"table_name": "mytable"})
	req := buildReq(t, store, http.MethodPost, "/api/add-row", int(42),
		bytes.NewReader(body), "application/json")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/add-row", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table extracted from JSON body table_name")
	}
}

// TestWithAccessControl_SpecificTable_JSONBody_TableUID extracts the table UID
// from JSON body field "table_uid" and uses it for the permission check.
func TestWithAccessControl_SpecificTable_JSONBody_TableUID(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	body, _ := json.Marshal(map[string]string{"table_uid": "abc-uid-123"})
	req := buildReq(t, store, http.MethodPost, "/api/add-row", int(42),
		bytes.NewReader(body), "application/json")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/add-row", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table extracted from JSON body table_uid")
	}
}

// TestWithAccessControl_SpecificTable_JSONBody_NumericDatasetUID verifies that
// numeric dataset_uid values in JSON bodies still resolve table-specific access.
// This covers routes like /api/update-table-folder that send dataset_uid as a number.
func TestWithAccessControl_SpecificTable_JSONBody_NumericDatasetUID(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	body := []byte(`{"item_id":4,"item_type":"table","dataset_uid":77,"dataset_name":"users","new_folder_id":10}`)
	req := buildReq(t, store, http.MethodPost, "/api/update-table-folder", int(42),
		bytes.NewReader(body), "application/json")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/update-table-folder", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when numeric dataset_uid is provided in JSON body")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", rr.Code, http.StatusOK)
	}
}

// TestWithAccessControl_SpecificTable_JSONBody_ReferencingDataset extracts the
// table name from JSON body field "referencing_dataset".
func TestWithAccessControl_SpecificTable_JSONBody_ReferencingDataset(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	body, _ := json.Marshal(map[string]string{"referencing_dataset": "mytable"})
	req := buildReq(t, store, http.MethodPost, "/api/add-row", int(42),
		bytes.NewReader(body), "application/json")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/add-row", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when table extracted from JSON body referencing_dataset")
	}
}

// TestWithAccessControl_JSONBodyRestored verifies that the request body is still
// readable by the downstream handler after access control reads and rebuffers it.
func TestWithAccessControl_JSONBodyRestored(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		isAdmin:           false,
	})
	payload := map[string]string{"dataset_name": "mytable", "extra": "canary"}
	bodyBytes, _ := json.Marshal(payload)

	req := buildReq(t, store, http.MethodPost, "/api/add-row", int(42),
		bytes.NewReader(bodyBytes), "application/json")
	rr := httptest.NewRecorder()

	var downstreamBody map[string]string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&downstreamBody); err != nil {
			t.Errorf("downstream body read failed: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	})

	WithAccessControl("/api/add-row", "test", handler)(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rr.Code)
	}
	if downstreamBody["extra"] != "canary" {
		t.Errorf("downstream body not restored correctly: got %v", downstreamBody)
	}
}

// TestWithAccessControl_MultiDataset_AllGranted handles ?datasets=t1,t2 where
// both tables exist in the schema and the user has permission for all.
func TestWithAccessControl_MultiDataset_AllGranted(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		tableExists:       true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?datasets=t1,t2", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called when all dataset permissions granted")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rr.Code)
	}
}

// TestWithAccessControl_MultiDataset_Denied returns 403 when the user lacks
// permission for any of the datasets in ?datasets=t1,t2.
func TestWithAccessControl_MultiDataset_Denied(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: false,
		tableExists:       true,
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?datasets=t1,t2", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called when permission denied for any dataset")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", rr.Code)
	}
}

// TestWithAccessControl_MultiDataset_NoValidTables verifies that when none of the
// dataset names exist in the schema, the middleware falls back to a tableless
// userHasFunctionPermissionOnTable call. Because the function is specific_table_related,
// that call returns false (specific_table_related=true requires a table name → denied).
// This is the expected production behavior: a specific-table function with no resolvable
// table is always denied.
func TestWithAccessControl_MultiDataset_NoValidTables(t *testing.T) {
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: true,
		tableExists:       false, // no tables exist → validTables is empty
		isAdmin:           false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?datasets=ghost1,ghost2", int(42), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	// Tableless fallback fails: specific_table_related=true but no table name → denied.
	if called {
		t.Error("handler must not be called when specific_table_related=true but no valid tables")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", rr.Code)
	}
}

// TestWithAccessControl_AdminRecoveryModeRequiresDevFlag verifies that admin
// recovery is opt-in and dev-only instead of production fail-open behavior.
func TestWithAccessControl_AdminRecoveryModeRequiresDevFlag(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "true")
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: false, // no permission row exists…
		isAdmin:           true,  // …but dev recovery mode allows it
		tableExists:       false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=mytable", int(1), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if !called {
		t.Error("handler must be called for admin user even without explicit permission row (recovery mode)")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rr.Code)
	}
}

func TestWithAccessControl_AdminRecoveryModeDeniedByDefault(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "true")
	store := setupTestStore(t)
	setupMockDB(t, acMockConfig{
		specificRelated:   true,
		permissionGranted: false,
		isAdmin:           true,
		tableExists:       false,
	})
	req := buildReq(t, store, http.MethodGet, "/api/get-results?dataset=mytable", int(1), nil, "")
	rr := httptest.NewRecorder()
	called := false

	WithAccessControl("/api/get-results", "test", noopHandler(&called))(rr, req)

	if called {
		t.Error("handler must not be called for admin recovery mode outside dev")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", rr.Code)
	}
}

// ── ensureGuestSession tests ───────────────────────────────────────────────

// TestEnsureGuestSession_SetsUserID verifies that an empty session gets user_id=1.
func TestEnsureGuestSession_SetsUserID(t *testing.T) {
	store := setupTestStore(t)

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, "/", nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("sess.Save: %v", saveErr)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	rr := httptest.NewRecorder()

	ensureGuestSession(rr, req, sess)

	uid, ok := sess.Values["user_id"].(int)
	if !ok {
		t.Fatalf("user_id not set as int after ensureGuestSession")
	}
	if uid != 1 {
		t.Errorf("user_id: got %d, want 1", uid)
	}
}

// TestEnsureGuestSession_PreservesExistingDeviceID verifies that an existing
// device_id cookie is preserved rather than overwritten with a new UUID.
func TestEnsureGuestSession_PreservesExistingDeviceID(t *testing.T) {
	store := setupTestStore(t)

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, "/", nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("sess.Save: %v", saveErr)
	}

	const existingDeviceID = "my-existing-device-id"
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	req.AddCookie(&http.Cookie{Name: "device_id", Value: existingDeviceID})
	rr := httptest.NewRecorder()

	ensureGuestSession(rr, req, sess)

	deviceID, _ := sess.Values["device_id"].(string)
	if deviceID != existingDeviceID {
		t.Errorf("device_id: got %q, want %q", deviceID, existingDeviceID)
	}
}

// ── GetTablesVisibleToUser tests ───────────────────────────────────────────

// TestGetTablesVisibleToUser_Admin verifies that an admin user returns nil
// (meaning "all tables visible") without querying the permissions table.
func TestGetTablesVisibleToUser_Admin(t *testing.T) {
	setupMockDB(t, acMockConfig{isAdmin: true})

	result, err := GetTablesVisibleToUser(backend.Db, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil map for admin (all tables visible), got %v", result)
	}
}

// TestGetTablesVisibleToUser_NonAdmin_WithTables returns a map of accessible
// table UIDs when a non-admin user has some permissions.
func TestGetTablesVisibleToUser_NonAdmin_WithTables(t *testing.T) {
	// permissionGranted=true → mock returns one row with int64(1) as target_table_uid
	setupMockDB(t, acMockConfig{isAdmin: false, permissionGranted: true})

	result, err := GetTablesVisibleToUser(backend.Db, 42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil map for non-admin with permissions")
	}
	if !result[1] {
		t.Errorf("expected table UID 1 in result map, got %v", result)
	}
}

// TestGetTablesVisibleToUser_NonAdmin_NoTables returns an empty map when the
// non-admin user has no permissions at all.
func TestGetTablesVisibleToUser_NonAdmin_NoTables(t *testing.T) {
	// permissionGranted=false → mock returns empty rows
	setupMockDB(t, acMockConfig{isAdmin: false, permissionGranted: false})

	result, err := GetTablesVisibleToUser(backend.Db, 42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty map for non-admin with no permissions, got %v", result)
	}
}

// TestEnsureGuestSession_GeneratesDeviceIDIfMissing verifies that a new UUID is
// generated for device_id when neither the session nor the cookie has one.
func TestEnsureGuestSession_GeneratesDeviceIDIfMissing(t *testing.T) {
	store := setupTestStore(t)

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, "/", nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("sess.Save: %v", saveErr)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	// No device_id cookie added.
	rr := httptest.NewRecorder()

	ensureGuestSession(rr, req, sess)

	deviceID, _ := sess.Values["device_id"].(string)
	if deviceID == "" {
		t.Error("device_id must be generated when missing from session and cookies")
	}
}
