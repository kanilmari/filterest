// first_run_admin_test.go
// Verifies the first administrator form's fail-closed state and input boundary.
package auth

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var firstRunTransactionDriverCounter int64

type firstRunTransactionState struct {
	committed       bool
	rolledBack      bool
	credentialMade  bool
	environmentMade bool
	siteNameMade    bool
	configClosed    bool
	failCredential  bool
}

type firstRunTransactionDriver struct{ state *firstRunTransactionState }
type firstRunTransactionConn struct{ state *firstRunTransactionState }
type firstRunTransactionTx struct{ state *firstRunTransactionState }
type firstRunTransactionRows struct {
	values []driver.Value
	done   bool
}

func (d *firstRunTransactionDriver) Open(string) (driver.Conn, error) {
	return &firstRunTransactionConn{state: d.state}, nil
}

func (c *firstRunTransactionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}
func (c *firstRunTransactionConn) Close() error { return nil }
func (c *firstRunTransactionConn) Begin() (driver.Tx, error) {
	return &firstRunTransactionTx{state: c.state}, nil
}
func (tx *firstRunTransactionTx) Commit() error {
	tx.state.committed = true
	return nil
}
func (tx *firstRunTransactionTx) Rollback() error {
	tx.state.rolledBack = true
	return nil
}
func (r *firstRunTransactionRows) Columns() []string { return []string{"value"} }
func (r *firstRunTransactionRows) Close() error      { return nil }
func (r *firstRunTransactionRows) Next(destination []driver.Value) error {
	if r.done || len(r.values) == 0 {
		return io.EOF
	}
	r.done = true
	copy(destination, r.values)
	return nil
}

func (c *firstRunTransactionConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FOR UPDATE"):
		return &firstRunTransactionRows{values: []driver.Value{true}}, nil
	case strings.Contains(query, "JOIN restricted.users_restricted"):
		return &firstRunTransactionRows{}, nil
	case strings.Contains(query, "lower(username)"):
		return &firstRunTransactionRows{}, nil
	case strings.Contains(query, "lower(email)"):
		return &firstRunTransactionRows{}, nil
	case strings.Contains(query, "SELECT id FROM system_user_groups"):
		return &firstRunTransactionRows{values: []driver.Value{int64(1)}}, nil
	case strings.Contains(query, "INSERT INTO system_users"):
		return &firstRunTransactionRows{values: []driver.Value{int64(42)}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (c *firstRunTransactionConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(query, "system_user_group_memberships"):
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "restricted.users_restricted"):
		if c.state.failCredential {
			return nil, errors.New("credential insert failed")
		}
		c.state.credentialMade = true
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "text_value = $1"):
		if len(args) < 2 {
			return nil, errors.New("configuration update is missing its key")
		}
		switch args[1].Value {
		case installationEnvironmentConfigKey:
			c.state.environmentMade = true
		case siteNameConfigKey:
			c.state.siteNameMade = true
		default:
			return nil, fmt.Errorf("unexpected configuration key: %v", args[1].Value)
		}
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "UPDATE system_config"):
		c.state.configClosed = true
		return driver.RowsAffected(1), nil
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
}

func openFirstRunTransactionDB(t *testing.T, state *firstRunTransactionState) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("first_run_transaction_%d", atomic.AddInt64(&firstRunTransactionDriverCounter, 1))
	sql.Register(name, &firstRunTransactionDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestValidateFirstRunAdminInputAcceptsStrongForm(t *testing.T) {
	errs := validateFirstRunAdminInput(firstRunAdminInput{
		SiteName:           "Example Workspace",
		Username:           "owner.admin",
		Email:              "owner@example.com",
		Password:           "correct horse battery staple",
		ConfirmPassword:    "correct horse battery staple",
		Environment:        "dev",
		VerificationMethod: "none",
	})
	if errs != (firstRunAdminErrors{}) {
		t.Fatalf("validation errors = %+v, want none", errs)
	}
}

func TestValidateFirstRunAdminInputAcceptsQAEnvironment(t *testing.T) {
	errs := validateFirstRunAdminInput(firstRunAdminInput{
		SiteName:           "QA Workspace",
		Username:           "owner.admin",
		Email:              "owner@example.com",
		Password:           "correct horse battery staple",
		ConfirmPassword:    "correct horse battery staple",
		Environment:        "qa",
		VerificationMethod: "none",
	})
	if errs != (firstRunAdminErrors{}) {
		t.Fatalf("QA environment validation errors = %+v, want none", errs)
	}
}

func TestValidateFirstRunAdminInputRejectsUnsafeValues(t *testing.T) {
	errs := validateFirstRunAdminInput(firstRunAdminInput{
		SiteName:           "Unsafe Test",
		Username:           "x / admin",
		Email:              "not-an-email",
		Password:           "short",
		ConfirmPassword:    "different",
		Environment:        "dev",
		VerificationMethod: "none",
	})
	if errs.Username == "" || errs.Email == "" || errs.Password == "" {
		t.Fatalf("validation errors = %+v, want username, email, and password errors", errs)
	}
}

func TestValidateFirstRunAdminInputRejectsPasswordMismatch(t *testing.T) {
	errs := validateFirstRunAdminInput(firstRunAdminInput{
		SiteName:           "Example Workspace",
		Username:           "owner",
		Email:              "owner@example.com",
		Password:           "a sufficiently long password",
		ConfirmPassword:    "a different long password",
		Environment:        "dev",
		VerificationMethod: "none",
	})
	if errs.Password != "first_run_password_mismatch" {
		t.Fatalf("password error = %q, want mismatch", errs.Password)
	}
}

func TestValidateFirstRunAdminInputRequiresAbsoluteFixedPINRules(t *testing.T) {
	base := firstRunAdminInput{
		SiteName: "Example Workspace",
		Username: "owner", Email: "owner@example.com",
		Password: "a sufficiently long password", ConfirmPassword: "a sufficiently long password",
		Environment: "test", VerificationMethod: "fixed_pin",
	}
	base.FixedPIN, base.ConfirmFixedPIN = "1234", "1234"
	if errs := validateFirstRunAdminInput(base); errs != (firstRunAdminErrors{}) {
		t.Fatalf("four-digit PIN validation errors = %+v", errs)
	}
	base.FixedPIN, base.ConfirmFixedPIN = "123", "123"
	if errs := validateFirstRunAdminInput(base); errs.Factor != "first_run_fixed_pin_invalid" {
		t.Fatalf("short PIN factor error = %q", errs.Factor)
	}
	base.FixedPIN, base.ConfirmFixedPIN = "12345", "54321"
	if errs := validateFirstRunAdminInput(base); errs.Factor != "first_run_fixed_pin_mismatch" {
		t.Fatalf("mismatched PIN factor error = %q", errs.Factor)
	}
}

func TestValidateFirstRunAdminInputConfirmsTOTPEnrollment(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	code, err := totpCodeForCounter(secret, uint64(time.Now().Unix()/totpPeriod))
	if err != nil {
		t.Fatalf("build TOTP code: %v", err)
	}
	input := firstRunAdminInput{
		SiteName: "Example Workspace",
		Username: "owner", Email: "owner@example.com",
		Password: "a sufficiently long password", ConfirmPassword: "a sufficiently long password",
		Environment: "prod", VerificationMethod: "totp", TOTPSecret: secret, TOTPCode: code,
	}
	if errs := validateFirstRunAdminInput(input); errs != (firstRunAdminErrors{}) {
		t.Fatalf("valid TOTP enrollment errors = %+v", errs)
	}
	input.TOTPCode = "000000"
	if errs := validateFirstRunAdminInput(input); errs.Factor != "first_run_totp_invalid" {
		t.Fatalf("invalid TOTP factor error = %q", errs.Factor)
	}
}

func TestValidateFirstRunAdminInputRejectsMissingOrOversizedSiteName(t *testing.T) {
	input := firstRunAdminInput{
		Username: "owner", Email: "owner@example.com",
		Password: "a sufficiently long password", ConfirmPassword: "a sufficiently long password",
		Environment: "prod", VerificationMethod: "none",
	}
	if errs := validateFirstRunAdminInput(input); errs.SiteName != "first_run_site_name_invalid" {
		t.Fatalf("empty site-name error = %q, want first_run_site_name_invalid", errs.SiteName)
	}
	input.SiteName = strings.Repeat("界", maximumSiteName+1)
	if errs := validateFirstRunAdminInput(input); errs.SiteName != "first_run_site_name_invalid" {
		t.Fatalf("oversized site-name error = %q, want first_run_site_name_invalid", errs.SiteName)
	}
	input.SiteName = "Monikielinen 工作区"
	if errs := validateFirstRunAdminInput(input); errs != (firstRunAdminErrors{}) {
		t.Fatalf("multilingual site-name validation errors = %+v, want none", errs)
	}
}

func TestFirstRunAdminHandlerRedirectsWhenSetupIsClosed(t *testing.T) {
	original := firstRunPendingReader
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return false, nil }
	t.Cleanup(func() { firstRunPendingReader = original })

	req := httptest.NewRequest(http.MethodGet, "/first-run", nil)
	rr := httptest.NewRecorder()
	FirstRunAdminHandler(rr, req)

	if rr.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusSeeOther)
	}
	if got := rr.Header().Get("Location"); got != "/login" {
		t.Fatalf("Location = %q, want /login", got)
	}
}

func TestFirstRunAdminHandlerFailsClosedWhenStateCannotBeRead(t *testing.T) {
	original := firstRunPendingReader
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return false, sql.ErrConnDone }
	t.Cleanup(func() { firstRunPendingReader = original })

	req := httptest.NewRequest(http.MethodGet, "/first-run", nil)
	rr := httptest.NewRecorder()
	FirstRunAdminHandler(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusServiceUnavailable)
	}
}

func TestCreateFirstRunAdminCommitsAccountAndFlagTogether(t *testing.T) {
	state := &firstRunTransactionState{}
	db := openFirstRunTransactionDB(t, state)
	input := firstRunAdminInput{
		SiteName: "Owner Workspace", Username: "owner", Email: "owner@example.com", Password: "correct horse battery staple",
		Environment: "dev", VerificationMethod: "none",
	}

	if err := createFirstRunAdmin(context.Background(), db, input); err != nil {
		t.Fatalf("createFirstRunAdmin() error = %v", err)
	}
	if !state.credentialMade || !state.environmentMade || !state.siteNameMade || !state.configClosed || !state.committed {
		t.Fatalf("transaction state = %+v, want credential, environment, site identity, flag closure, and commit", state)
	}
}

func TestCreateFirstRunAdminRollsBackBeforeFlagClosureOnCredentialFailure(t *testing.T) {
	state := &firstRunTransactionState{failCredential: true}
	db := openFirstRunTransactionDB(t, state)
	input := firstRunAdminInput{
		SiteName: "Owner Workspace", Username: "owner", Email: "owner@example.com", Password: "correct horse battery staple",
		Environment: "dev", VerificationMethod: "none",
	}

	if err := createFirstRunAdmin(context.Background(), db, input); err == nil {
		t.Fatal("createFirstRunAdmin() error = nil, want credential failure")
	}
	if state.committed || state.configClosed || !state.rolledBack {
		t.Fatalf("transaction state = %+v, want rollback without flag closure", state)
	}
}

func TestFirstRunAdminTemplateRendersBothSections(t *testing.T) {
	tmpl, err := template.ParseFiles(filepath.Join("..", "..", "..", "frontend", "templates", "first_run_admin.html"))
	if err != nil {
		t.Fatalf("parse first-run template: %v", err)
	}
	data := map[string]interface{}{
		"FirstRunSiteName": "Example Workspace", "InitialSection": "settings",
		"Environment": "test", "VerificationMethod": "totp", "TOTPSecret": "ABCDEF",
		"Username": "", "Email": "", "CSRFToken": "csrf",
		"SiteNameErr": "", "UsernameErr": "", "EmailErr": "", "PasswordErr": "", "GeneralErr": "",
		"EnvironmentErr": "", "VerificationErr": "", "FactorErr": "",
	}
	var output bytes.Buffer
	if err = tmpl.Execute(&output, data); err != nil {
		t.Fatalf("execute first-run template: %v", err)
	}
	markup := output.String()
	for _, expected := range []string{"Welcome to Filterest!", "data-section-key=\"settings\"", "data-section-key=\"credentials\"", "name=\"site_name\" value=\"Example Workspace\"", "value=\"test\" checked", "value=\"totp\" checked"} {
		if !strings.Contains(markup, expected) {
			t.Fatalf("rendered template missing %q", expected)
		}
	}
}
