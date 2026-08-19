// admin_user_authentication_handler_test.go
// Verifies safe administrator provisioning and method-only authentication readback.
// Bridges the admin handler, lazy transaction pipeline, and public/restricted SQL contract.
// Exists to prove secrets never leave the API and partial grants always roll back.
package auth

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	gorillaSessions "github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

type adminAuthenticationMockState struct {
	mu sync.Mutex

	listRows             [][]driver.Value
	missingUser          bool
	failRestrictedUpdate bool

	beginCount             int
	commitCount            int
	rollbackCount          int
	userUpdateCount        int
	membershipInsertCount  int
	restrictedUpdateCount  int
	mutationOutsideTxCount int
	storedMethod           string
	storedPINHash          string
	storedTOTPWasNil       bool
}

type adminAuthenticationMockDriver struct{ state *adminAuthenticationMockState }
type adminAuthenticationMockConn struct {
	state *adminAuthenticationMockState
	inTx  bool
}
type adminAuthenticationMockTx struct {
	conn *adminAuthenticationMockConn
}

type adminAuthenticationMockRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

func (driverInstance *adminAuthenticationMockDriver) Open(_ string) (driver.Conn, error) {
	return &adminAuthenticationMockConn{state: driverInstance.state}, nil
}

func (connection *adminAuthenticationMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (connection *adminAuthenticationMockConn) Close() error { return nil }

func (connection *adminAuthenticationMockConn) Begin() (driver.Tx, error) {
	return connection.BeginTx(context.Background(), driver.TxOptions{})
}

func (connection *adminAuthenticationMockConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()
	connection.inTx = true
	connection.state.beginCount++
	return &adminAuthenticationMockTx{conn: connection}, nil
}

func (transaction *adminAuthenticationMockTx) Commit() error {
	transaction.conn.state.mu.Lock()
	defer transaction.conn.state.mu.Unlock()
	transaction.conn.state.commitCount++
	transaction.conn.inTx = false
	return nil
}

func (transaction *adminAuthenticationMockTx) Rollback() error {
	transaction.conn.state.mu.Lock()
	defer transaction.conn.state.mu.Unlock()
	transaction.conn.state.rollbackCount++
	transaction.conn.inTx = false
	return nil
}

func (rows *adminAuthenticationMockRows) Columns() []string { return rows.columns }
func (rows *adminAuthenticationMockRows) Close() error      { return nil }
func (rows *adminAuthenticationMockRows) Next(destination []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(destination, rows.rows[rows.index])
	rows.index++
	return nil
}

func (connection *adminAuthenticationMockConn) QueryContext(
	_ context.Context,
	query string,
	_ []driver.NamedValue,
) (driver.Rows, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()

	switch {
	case strings.Contains(normalized, "SELECT id FROM system_functions WHERE url_route_endpoint"):
		return &adminAuthenticationMockRows{columns: []string{"id"}}, nil
	case strings.Contains(normalized, "ORDER BY lower(u.username), u.id"):
		return &adminAuthenticationMockRows{
			columns: []string{"id", "username", "enabled", "admin_group_member", "admin_access_allowed", "login_verification_method"},
			rows:    connection.state.listRows,
		}, nil
	case strings.Contains(normalized, "FOR UPDATE OF u, ur"):
		if connection.state.missingUser {
			return &adminAuthenticationMockRows{columns: []string{"username"}}, nil
		}
		return &adminAuthenticationMockRows{
			columns: []string{"username"},
			rows:    [][]driver.Value{{"ai_admin_7768"}},
		}, nil
	case strings.Contains(normalized, "SELECT id FROM system_user_groups WHERE name = 'admins'"):
		return &adminAuthenticationMockRows{
			columns: []string{"id"},
			rows:    [][]driver.Value{{int64(1)}},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", normalized)
	}
}

func (connection *adminAuthenticationMockConn) ExecContext(
	_ context.Context,
	query string,
	arguments []driver.NamedValue,
) (driver.Result, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()

	if strings.Contains(normalized, "set_config('app.user_id'") {
		return driver.RowsAffected(1), nil
	}
	if strings.Contains(normalized, "INSERT INTO system_transaction_log") {
		return driver.RowsAffected(1), nil
	}
	if !connection.inTx {
		connection.state.mutationOutsideTxCount++
	}

	switch {
	case strings.Contains(normalized, "UPDATE system_users SET enabled = TRUE"):
		connection.state.userUpdateCount++
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "INSERT INTO system_user_group_memberships"):
		connection.state.membershipInsertCount++
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "UPDATE restricted.users_restricted"):
		connection.state.restrictedUpdateCount++
		if connection.state.failRestrictedUpdate {
			return nil, errors.New("restricted update failed")
		}
		connection.state.storedMethod = arguments[0].Value.(string)
		if arguments[1].Value != nil {
			connection.state.storedPINHash = arguments[1].Value.(string)
		}
		connection.state.storedTOTPWasNil = true
		return driver.RowsAffected(1), nil
	default:
		return nil, fmt.Errorf("unexpected exec: %s", normalized)
	}
}

var adminAuthenticationMockCounter int64

func openAdminAuthenticationMockDB(t *testing.T, state *adminAuthenticationMockState) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf(
		"admin_authentication_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&adminAuthenticationMockCounter, 1),
	)
	sql.Register(driverName, &adminAuthenticationMockDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func serveAdminAuthenticationWithTransaction(
	t *testing.T,
	db *sql.DB,
	request *http.Request,
) *httptest.ResponseRecorder {
	t.Helper()
	previousAdminDB := backend.DbAdmin
	previousDB := backend.Db
	previousStore := e_sessions.Store
	backend.DbAdmin = db
	backend.Db = db
	e_sessions.Store = gorillaSessions.NewCookieStore([]byte("admin-authentication-handler-test-key"))
	t.Cleanup(func() {
		backend.DbAdmin = previousAdminDB
		backend.Db = previousDB
		e_sessions.Store = previousStore
	})

	actor := dbutils.NewRequestActorContext(99, "admin")
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), actor))
	recorder := httptest.NewRecorder()
	middlewares.WithLazyTransaction(http.HandlerFunc(AdminUserAuthenticationHandler)).ServeHTTP(recorder, request)
	return recorder
}

func decodeAdminAuthenticationResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var response map[string]interface{}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	return response
}

func TestAdminUserAuthenticationGetReturnsMethodOnlyState(t *testing.T) {
	state := &adminAuthenticationMockState{listRows: [][]driver.Value{
		{int64(42), "ai_admin_7768", true, false, false, "email"},
		{int64(43), "existing_totp_admin", true, true, true, "totp"},
	}}
	db := openAdminAuthenticationMockDB(t, state)
	previousAdminDB := backend.DbAdmin
	backend.DbAdmin = db
	t.Cleanup(func() { backend.DbAdmin = previousAdminDB })

	request := httptest.NewRequest(http.MethodGet, "/api/admin/user-authentication", nil)
	recorder := httptest.NewRecorder()
	AdminUserAuthenticationHandler(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, forbidden := range []string{"email_address", "fixed_pin", "fixed_pin_hash", "totp_secret", "password"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response leaked forbidden field %q: %s", forbidden, body)
		}
	}
	response := decodeAdminAuthenticationResponse(t, recorder)
	users, ok := response["users"].([]interface{})
	if !ok || len(users) != 2 {
		t.Fatalf("users = %#v, want two records", response["users"])
	}
	first := users[0].(map[string]interface{})
	if first["verification_method"] != "email" || first["username"] != "ai_admin_7768" {
		t.Fatalf("first user = %#v", first)
	}
}

func TestAdminUserAuthenticationGetExcludesReservedGuestIdentity(t *testing.T) {
	source, err := os.ReadFile("admin_user_authentication_handler.go")
	if err != nil {
		t.Fatalf("read handler source: %v", err)
	}
	if !strings.Contains(string(source), "WHERE u.id > 1") {
		t.Fatal("administrator user list must exclude the reserved guest identity")
	}
}

func TestAdminUserAuthenticationPostProvisioningIsAtomicAndHashesPIN(t *testing.T) {
	state := &adminAuthenticationMockState{}
	db := openAdminAuthenticationMockDB(t, state)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/user-authentication",
		bytes.NewBufferString(`{"user_id":42,"verification_method":"fixed_pin","fixed_pin":"1234"}`),
	)
	recorder := serveAdminAuthenticationWithTransaction(t, db, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.beginCount != 1 || state.commitCount != 1 || state.rollbackCount != 0 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d", state.beginCount, state.commitCount, state.rollbackCount)
	}
	if state.userUpdateCount != 1 || state.membershipInsertCount != 1 || state.restrictedUpdateCount != 1 {
		t.Fatalf("mutation counts = user:%d membership:%d restricted:%d", state.userUpdateCount, state.membershipInsertCount, state.restrictedUpdateCount)
	}
	if state.mutationOutsideTxCount != 0 {
		t.Fatalf("mutations outside transaction = %d", state.mutationOutsideTxCount)
	}
	if state.storedMethod != "fixed_pin" || state.storedPINHash == "" || state.storedPINHash == "1234" {
		t.Fatalf("stored factor = method:%q hash-present:%t", state.storedMethod, state.storedPINHash != "")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(state.storedPINHash), []byte("1234")); err != nil {
		t.Fatalf("stored PIN hash does not match submitted PIN: %v", err)
	}
	if !state.storedTOTPWasNil {
		t.Fatal("expected TOTP secret to be cleared")
	}
	if strings.Contains(recorder.Body.String(), "1234") || strings.Contains(recorder.Body.String(), state.storedPINHash) {
		t.Fatalf("response leaked PIN material: %s", recorder.Body.String())
	}
	response := decodeAdminAuthenticationResponse(t, recorder)
	if response["verification_method"] != "fixed_pin" || response["admin_group_member"] != true {
		t.Fatalf("response = %#v", response)
	}
}

func TestAdminUserAuthenticationPostRollsBackPartialGrant(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "test-token")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "admin@example.test")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")
	state := &adminAuthenticationMockState{failRestrictedUpdate: true}
	db := openAdminAuthenticationMockDB(t, state)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/user-authentication",
		bytes.NewBufferString(`{"user_id":42,"verification_method":"email"}`),
	)
	recorder := serveAdminAuthenticationWithTransaction(t, db, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", recorder.Code, recorder.Body.String())
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.beginCount != 1 || state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d", state.beginCount, state.commitCount, state.rollbackCount)
	}
	if state.userUpdateCount != 1 || state.membershipInsertCount != 1 || state.restrictedUpdateCount != 1 {
		t.Fatalf("expected all pre-failure mutations inside the rolled-back transaction")
	}
}

func TestAdminUserAuthenticationPostRejectsUnavailableEmailVerification(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/user-authentication",
		bytes.NewBufferString(`{"user_id":42,"verification_method":"email"}`),
	)
	recorder := httptest.NewRecorder()
	AdminUserAuthenticationHandler(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "email_verification_unavailable") {
		t.Fatalf("body = %s, want email_verification_unavailable", recorder.Body.String())
	}
}

func TestAdminUserAuthenticationPostRejectsMissingUser(t *testing.T) {
	state := &adminAuthenticationMockState{missingUser: true}
	db := openAdminAuthenticationMockDB(t, state)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/user-authentication",
		bytes.NewBufferString(`{"user_id":404,"verification_method":"none"}`),
	)
	recorder := serveAdminAuthenticationWithTransaction(t, db, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", recorder.Code, recorder.Body.String())
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf("transaction counts = commit:%d rollback:%d", state.commitCount, state.rollbackCount)
	}
	if state.userUpdateCount != 0 || state.membershipInsertCount != 0 || state.restrictedUpdateCount != 0 {
		t.Fatal("missing user must not start provisioning mutations")
	}
}

func TestAdminUserAuthenticationPostValidation(t *testing.T) {
	testCases := []struct {
		name string
		body string
	}{
		{name: "invalid json", body: `{`},
		{name: "unknown field", body: `{"user_id":42,"verification_method":"none","unknown":true}`},
		{name: "extra json", body: `{"user_id":42,"verification_method":"none"}{}`},
		{name: "guest target", body: `{"user_id":1,"verification_method":"none"}`},
		{name: "unsupported totp", body: `{"user_id":42,"verification_method":"totp"}`},
		{name: "short pin", body: `{"user_id":42,"verification_method":"fixed_pin","fixed_pin":"123"}`},
		{name: "non numeric pin", body: `{"user_id":42,"verification_method":"fixed_pin","fixed_pin":"12ab"}`},
		{name: "whitespace pin", body: `{"user_id":42,"verification_method":"fixed_pin","fixed_pin":" 1234 "}`},
		{name: "pin supplied for email", body: `{"user_id":42,"verification_method":"email","fixed_pin":"1234"}`},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/admin/user-authentication",
				bytes.NewBufferString(testCase.body),
			)
			recorder := httptest.NewRecorder()
			AdminUserAuthenticationHandler(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestAdminUserAuthenticationHandlerMethodContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodDelete, "/api/admin/user-authentication", nil)
	recorder := httptest.NewRecorder()
	AdminUserAuthenticationHandler(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", recorder.Code)
	}
	if recorder.Header().Get("Allow") != "GET, POST" {
		t.Fatalf("Allow = %q, want GET, POST", recorder.Header().Get("Allow"))
	}
}
