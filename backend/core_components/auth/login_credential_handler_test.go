// login_credential_handler_test.go
// Unit tests for credential validation paths and JSON login rate-limiting.
// Between login_credential_handler.go and the auth pipeline.
// Exists to verify login handler behavior per ticket #824 goals.
package auth

import (
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

	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

type credentialMockConfig struct {
	userLookupOK       bool
	userID             int
	hashedPassword     string
	adminGroupMember   bool
	verificationMethod string
	fixedPINHash       string
	totpSecret         string
}

type credentialMockDriver struct{ cfg credentialMockConfig }
type credentialMockConn struct{ cfg credentialMockConfig }
type credentialMockTx struct{}

type credentialMockRows struct {
	cols []string
	vals []driver.Value
	done bool
}

func (d *credentialMockDriver) Open(_ string) (driver.Conn, error) {
	return &credentialMockConn{cfg: d.cfg}, nil
}

func (c *credentialMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}
func (c *credentialMockConn) Close() error              { return nil }
func (c *credentialMockConn) Begin() (driver.Tx, error) { return &credentialMockTx{}, nil }
func (t *credentialMockTx) Commit() error               { return nil }
func (t *credentialMockTx) Rollback() error             { return nil }
func (r *credentialMockRows) Columns() []string         { return r.cols }
func (r *credentialMockRows) Close() error              { return nil }
func (r *credentialMockRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, r.vals)
	return nil
}

func (c *credentialMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *credentialMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_users WHERE username"):
		if !c.cfg.userLookupOK {
			return &credentialMockRows{cols: []string{"id"}, done: true}, nil
		}
		return &credentialMockRows{cols: []string{"id"}, vals: []driver.Value{int64(c.cfg.userID)}}, nil
	case strings.Contains(query, "SELECT password FROM restricted.users_restricted"):
		if c.cfg.hashedPassword == "" {
			return &credentialMockRows{cols: []string{"password"}, done: true}, nil
		}
		return &credentialMockRows{cols: []string{"password"}, vals: []driver.Value{c.cfg.hashedPassword}}, nil
	case strings.Contains(query, "SELECT login_verification_method"):
		method := c.cfg.verificationMethod
		if method == "" {
			method = string(verificationNone)
		}
		return &credentialMockRows{
			cols: []string{"login_verification_method", "fixed_pin_hash", "totp_secret", "email"},
			vals: []driver.Value{method, c.cfg.fixedPINHash, c.cfg.totpSecret, ""},
		}, nil
	case strings.Contains(query, "FROM system_user_group_memberships"):
		if !c.cfg.adminGroupMember {
			return &credentialMockRows{cols: []string{"?column?"}, done: true}, nil
		}
		return &credentialMockRows{cols: []string{"?column?"}, vals: []driver.Value{int64(1)}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

var credentialMockCounter int64

func openCredentialMockDB(t *testing.T, cfg credentialMockConfig) *sql.DB {
	t.Helper()
	d := &credentialMockDriver{cfg: cfg}
	name := fmt.Sprintf("login_credential_%d_%d", time.Now().UnixNano(), atomic.AddInt64(&credentialMockCounter, 1))
	sql.Register(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func decodeJSONBody(t *testing.T, rr *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var payload map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode json body: %v", err)
	}
	return payload
}

func TestLoginAPIHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/login", nil)
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "Method not allowed" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestLoginAPIHandler_JSONRateLimitBlocked(t *testing.T) {
	resetRateLimiter()
	ip := "10.10.10.10"
	for i := 0; i < loginRateLimitMax; i++ {
		recordLoginFailure(ip)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":"u"}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":1234"
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "Too many login attempts. Please try again later." {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestLoginAPIHandler_JSONDevBypassSkipsRateLimit(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	resetRateLimiter()
	ip := "10.10.10.11"
	for i := 0; i < loginRateLimitMax+1; i++ {
		recordLoginFailure(ip)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bypass-Ratelimit", "test-mode")
	req.RemoteAddr = ip + ":1234"
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "invalid_request_body" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestLoginAPIHandler_JSONDevRateLimitWarnsWithoutBlocking(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	resetRateLimiter()
	ip := "10.10.10.12"
	for i := 0; i < loginRateLimitMax+1; i++ {
		recordLoginFailure(ip)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"username":`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":1234"
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	if rr.Header().Get(loginRateLimitHeader) != "true" {
		t.Fatalf("missing dev rate limit warning header: %#v", rr.Header())
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "invalid_request_body" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if got := loginFailureCount(ip); got != loginRateLimitMax+1 {
		t.Fatalf("invalid body changed failure count to %d", got)
	}
}

func TestHandleLoginJSON_CSRFFailureDoesNotConsumeLoginFailure(t *testing.T) {
	resetLoginFailureLimiter()
	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	prepareLoginHandlerSessionStore(t)
	ip := "10.10.10.13"
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/login",
		strings.NewReader(`{"username":"alice","password":"secret"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":1234"
	rr := httptest.NewRecorder()

	handleLoginJSON(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusForbidden, rr.Body.String())
	}
	if got := loginFailureCount(ip); got != 0 {
		t.Fatalf("CSRF failure count = %d, want 0", got)
	}
}

func TestHandleLoginOTPVerify_NoPendingChallengeDoesNotConsumeFailure(t *testing.T) {
	resetLoginFailureLimiter()
	ip := "10.10.10.14"
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = ip + ":1234"
	rr := httptest.NewRecorder()
	session := &sessions.Session{Values: map[interface{}]interface{}{}}

	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "1234"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
	if got := loginFailureCount(ip); got != 0 {
		t.Fatalf("missing challenge failure count = %d, want 0", got)
	}
}

func TestLoginAPIHandler_LegacyFormDisabledOutsideExplicitDev(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader("username=alice"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	LoginAPIHandler(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "legacy_form_login_disabled" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestLoginHandler_PostLegacyFormDisabledOutsideExplicitDev(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("username=alice"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	LoginHandler(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusForbidden)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "legacy_form_login_disabled" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestHandleLoginCredentials_UsernameAndPasswordRequired(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	rr := httptest.NewRecorder()
	session := &sessions.Session{Values: map[interface{}]interface{}{}}

	handleLoginCredentials(rr, req, session, loginJSONRequest{Username: "", Password: ""})

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusBadRequest)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "username_and_password_required" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestHandleLoginCredentials_WrongCredentialsOnUserLookup(t *testing.T) {
	resetLoginFailureLimiter()
	origDB := backend.Db
	backend.Db = openCredentialMockDB(t, credentialMockConfig{userLookupOK: false})
	t.Cleanup(func() { backend.Db = origDB })

	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.1:1234"
	rr := httptest.NewRecorder()
	session := &sessions.Session{Values: map[interface{}]interface{}{}}

	handleLoginCredentials(rr, req, session, loginJSONRequest{Username: "alice", Password: "secret"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "wrong_credentials" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if got := loginFailureCount("10.20.0.1"); got != 1 {
		t.Fatalf("wrong username failure count = %d, want 1", got)
	}
}

func TestHandleLoginCredentials_WrongCredentialsOnPasswordMismatch(t *testing.T) {
	resetLoginFailureLimiter()
	hashBytes, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userLookupOK:   true,
		userID:         42,
		hashedPassword: string(hashBytes),
	}

	origDB := backend.Db
	origConf := backend.DbConfidential
	backend.Db = openCredentialMockDB(t, mockCfg)
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
	})

	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.2:1234"
	rr := httptest.NewRecorder()
	session := &sessions.Session{Values: map[interface{}]interface{}{}}

	handleLoginCredentials(rr, req, session, loginJSONRequest{Username: "alice", Password: "wrong-password"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
	body := decodeJSONBody(t, rr)
	if body["error"] != "wrong_credentials" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if got := loginFailureCount("10.20.0.2"); got != 1 {
		t.Fatalf("wrong password failure count = %d, want 1", got)
	}
}

func TestHandleLoginCredentials_MalformedStoredPasswordHashDoesNotConsumeFailure(t *testing.T) {
	resetLoginFailureLimiter()
	mockCfg := credentialMockConfig{
		userLookupOK:   true,
		userID:         42,
		hashedPassword: "not-a-bcrypt-hash",
	}

	origDB := backend.Db
	origConf := backend.DbConfidential
	backend.Db = openCredentialMockDB(t, mockCfg)
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
	})

	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.8:1234"
	rr := httptest.NewRecorder()
	session := &sessions.Session{Values: map[interface{}]interface{}{}}

	handleLoginCredentials(rr, req, session, loginJSONRequest{Username: "alice", Password: "secret"})

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if got := loginFailureCount("10.20.0.8"); got != 0 {
		t.Fatalf("malformed stored hash failure count = %d, want 0", got)
	}
}

func TestHandleLoginOTPVerify_MalformedStoredPINHashDoesNotConsumeFailure(t *testing.T) {
	resetLoginFailureLimiter()
	mockCfg := credentialMockConfig{
		userID:             42,
		verificationMethod: string(verificationFixedPIN),
		fixedPINHash:       "not-a-bcrypt-hash",
	}

	origConf := backend.DbConfidential
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() { backend.DbConfidential = origConf })

	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.9:1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	setPendingLoginState(session, 42, "alice", "test-fingerprint")
	rr := httptest.NewRecorder()

	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "1357"})

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusInternalServerError, rr.Body.String())
	}
	if got := loginFailureCount("10.20.0.9"); got != 0 {
		t.Fatalf("malformed stored PIN hash failure count = %d, want 0", got)
	}
}

func TestHandleLoginCredentials_CorrectPasswordAndPendingPINDoNotConsumeFailure(t *testing.T) {
	resetLoginFailureLimiter()
	for i := 0; i < 3; i++ {
		recordLoginFailure("10.20.0.3")
	}
	hashBytes, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userLookupOK:       true,
		userID:             42,
		hashedPassword:     string(hashBytes),
		verificationMethod: string(verificationFixedPIN),
	}

	origDB := backend.Db
	origConf := backend.DbConfidential
	backend.Db = openCredentialMockDB(t, mockCfg)
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
	})

	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.3:1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	rr := httptest.NewRecorder()

	handleLoginCredentials(rr, req, session, loginJSONRequest{
		Username:    "alice",
		Password:    "correct-password",
		Fingerprint: "test-fingerprint",
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	if got := loginFailureCount("10.20.0.3"); got != 3 {
		t.Fatalf("successful password phase failure count = %d, want unchanged 3", got)
	}
}

func TestHandleLoginOTPVerify_WrongFixedPINRecordsFailure(t *testing.T) {
	resetLoginFailureLimiter()
	pinHash, err := hashFixedPIN("2468")
	if err != nil {
		t.Fatalf("fixed PIN hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userID:             42,
		verificationMethod: string(verificationFixedPIN),
		fixedPINHash:       pinHash,
	}

	origConf := backend.DbConfidential
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() { backend.DbConfidential = origConf })

	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.4:1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	setPendingLoginState(session, 42, "alice", "test-fingerprint")
	rr := httptest.NewRecorder()

	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "1357"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusUnauthorized, rr.Body.String())
	}
	if got := loginFailureCount("10.20.0.4"); got != 1 {
		t.Fatalf("wrong fixed PIN failure count = %d, want 1", got)
	}
}

func TestHandleLoginOTPVerify_WrongTOTPRecordsFailure(t *testing.T) {
	resetLoginFailureLimiter()
	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("TOTP secret setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userID:             42,
		verificationMethod: string(verificationTOTP),
		totpSecret:         secret,
	}

	origConf := backend.DbConfidential
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() { backend.DbConfidential = origConf })

	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = "10.20.0.6:1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	setPendingLoginState(session, 42, "alice", "test-fingerprint")
	rr := httptest.NewRecorder()

	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "not-a-code"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusUnauthorized, rr.Body.String())
	}
	if got := loginFailureCount("10.20.0.6"); got != 1 {
		t.Fatalf("wrong TOTP failure count = %d, want 1", got)
	}
}

func TestHandleLoginOTPVerify_CorrectFixedPINClearsFailures(t *testing.T) {
	resetLoginFailureLimiter()
	pinHash, err := hashFixedPIN("2468")
	if err != nil {
		t.Fatalf("fixed PIN hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userID:             42,
		adminGroupMember:   true,
		verificationMethod: string(verificationFixedPIN),
		fixedPINHash:       pinHash,
	}

	origConf := backend.DbConfidential
	origGuest := backend.DbGuest
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	backend.DbGuest = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.DbConfidential = origConf
		backend.DbGuest = origGuest
	})

	ip := "10.20.0.7"
	for i := 0; i < loginRateLimitMax-1; i++ {
		recordLoginFailure(ip)
	}
	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = ip + ":1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	setPendingLoginState(session, 42, "alice", "test-fingerprint")
	rr := httptest.NewRecorder()

	handleLoginOTPVerify(rr, req, session, loginJSONRequest{OTPCode: "2468"})

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	if got := loginFailureCount(ip); got != 0 {
		t.Fatalf("completed fixed-PIN login failure count = %d, want 0", got)
	}
}

func TestHandleLoginCredentials_CompleteSuccessClearsFailures(t *testing.T) {
	resetLoginFailureLimiter()
	hashBytes, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt hash setup failed: %v", err)
	}
	mockCfg := credentialMockConfig{
		userLookupOK:       true,
		userID:             42,
		hashedPassword:     string(hashBytes),
		adminGroupMember:   true,
		verificationMethod: string(verificationNone),
	}

	origDB := backend.Db
	origConf := backend.DbConfidential
	origGuest := backend.DbGuest
	backend.Db = openCredentialMockDB(t, mockCfg)
	backend.DbConfidential = openCredentialMockDB(t, mockCfg)
	backend.DbGuest = openCredentialMockDB(t, mockCfg)
	t.Cleanup(func() {
		backend.Db = origDB
		backend.DbConfidential = origConf
		backend.DbGuest = origGuest
	})

	ip := "10.20.0.5"
	for i := 0; i < loginRateLimitMax-1; i++ {
		recordLoginFailure(ip)
	}
	t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
	testStore := prepareLoginHandlerSessionStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.RemoteAddr = ip + ":1234"
	session, err := testStore.New(req, "session")
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	rr := httptest.NewRecorder()

	handleLoginCredentials(rr, req, session, loginJSONRequest{
		Username:    "alice",
		Password:    "correct-password",
		Fingerprint: "test-fingerprint",
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d; body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	if got := loginFailureCount(ip); got != 0 {
		t.Fatalf("completed login failure count = %d, want 0", got)
	}
}

func TestSetAuthenticatedSessionIdentityStoresResolvedUserRole(t *testing.T) {
	origGuest := backend.DbGuest
	backend.DbGuest = openCredentialMockDB(t, credentialMockConfig{adminGroupMember: true})
	t.Cleanup(func() { backend.DbGuest = origGuest })

	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	if err := setAuthenticatedSessionIdentity(session, 42, "alice"); err != nil {
		t.Fatalf("setAuthenticatedSessionIdentity() returned error: %v", err)
	}

	if got := session.Values["authenticated"]; got != true {
		t.Fatalf("authenticated = %#v, want true", got)
	}
	if got := session.Values["user_id"]; got != 42 {
		t.Fatalf("user_id = %#v, want 42", got)
	}
	if got := session.Values["username"]; got != "alice" {
		t.Fatalf("username = %#v, want alice", got)
	}
	if got := session.Values["user_role"]; got != "admin" {
		t.Fatalf("user_role = %#v, want admin", got)
	}
}

func TestLocalLoginFactorAttemptsAreEnvironmentIndependent(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	setPendingLoginState(session, 42, "alice", "fingerprint")

	for expected := 4; expected >= 0; expected-- {
		if got := localLoginFactorAttemptsRemaining(session, false); got != expected {
			t.Fatalf("attempts remaining = %d, want %d", got, expected)
		}
	}
	if got := localLoginFactorAttemptsRemaining(session, false); got != 0 {
		t.Fatalf("attempts remaining after lock = %d, want 0", got)
	}
}
