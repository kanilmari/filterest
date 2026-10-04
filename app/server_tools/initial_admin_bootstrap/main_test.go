// main_test.go
// Verifies the initial Filterest admin bootstrap helper's safety logic and its existing-admin check.
// Bridges site-slug normalization, handoff-file permissions, generated credential text, and a fake database.
// Exists so the public setup path keeps deterministic username and secret-file behavior.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"easelect/backend/core_components/auth/credentials"
)

var bootstrapDriverCounter int64

// bootstrapDatabaseState is a fake installation. Both accounts are enabled admins-group members
// allowed administrator access; the automation account is also API-only.
type bootstrapDatabaseState struct {
	humanAdministrator bool
	automationAccount  bool

	began           bool
	committed       bool
	userInserted    bool
	membershipMade  bool
	credentialsMade bool
	firstRunClosed  bool
}

type bootstrapDriver struct{ state *bootstrapDatabaseState }
type bootstrapConn struct{ state *bootstrapDatabaseState }
type bootstrapTx struct{ state *bootstrapDatabaseState }
type bootstrapRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (d *bootstrapDriver) Open(string) (driver.Conn, error) {
	return &bootstrapConn{state: d.state}, nil
}

func (c *bootstrapConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}
func (c *bootstrapConn) Close() error { return nil }
func (c *bootstrapConn) Begin() (driver.Tx, error) {
	c.state.began = true
	return &bootstrapTx{state: c.state}, nil
}
func (tx *bootstrapTx) Commit() error {
	tx.state.committed = true
	return nil
}
func (tx *bootstrapTx) Rollback() error { return nil }

func (r *bootstrapRows) Columns() []string { return r.columns }
func (r *bootstrapRows) Close() error      { return nil }
func (r *bootstrapRows) Next(destination []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(destination, r.values[r.index])
	r.index++
	return nil
}

func (c *bootstrapConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "WHERE u.username = $1"):
		return &bootstrapRows{columns: []string{"username", "enabled", "admin_access_allowed", "admins_member", "restricted"}}, nil
	case strings.Contains(query, "SELECT id FROM system_user_groups WHERE name = 'admins'"):
		return &bootstrapRows{columns: []string{"id"}, values: [][]driver.Value{{int64(1)}}}, nil
	case strings.Contains(query, "INSERT INTO system_users"):
		c.state.userInserted = true
		return &bootstrapRows{columns: []string{"id"}, values: [][]driver.Value{{int64(42)}}}, nil
	case strings.Contains(query, "FROM system_users u"):
		// The existing-admin check must ask the shared login-ready question. The answer then follows
		// PostgreSQL: the automation account counts only when the query fails to exclude API-only accounts.
		if !strings.Contains(query, credentials.LoginReadyAdministratorSource) {
			return nil, fmt.Errorf("existing-admin check does not read the shared login-ready definition: %s", query)
		}
		rows := &bootstrapRows{columns: []string{"username"}}
		if c.state.humanAdministrator {
			rows.values = append(rows.values, []driver.Value{"owner_admin"})
		}
		if c.state.automationAccount && !strings.Contains(query, "AND ur.api_only IS NOT TRUE") {
			rows.values = append(rows.values, []driver.Value{"filterest_agent"})
		}
		return rows, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (c *bootstrapConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(query, "INSERT INTO system_user_group_memberships"):
		c.state.membershipMade = true
	case strings.Contains(query, "INSERT INTO restricted.users_restricted"):
		c.state.credentialsMade = true
	case strings.Contains(query, "UPDATE system_config") && strings.Contains(query, "'first_run'"):
		c.state.firstRunClosed = true
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
	return driver.RowsAffected(1), nil
}

func openBootstrapDB(t *testing.T, state *bootstrapDatabaseState) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("initial_admin_bootstrap_%d", atomic.AddInt64(&bootstrapDriverCounter, 1))
	sql.Register(name, &bootstrapDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestEnsureInitialAdminIgnoresTheAutomationAccount proves an API-only automation account alone never
// makes setup skip the first administrator, while a real login-ready administrator still does.
func TestEnsureInitialAdminIgnoresTheAutomationAccount(t *testing.T) {
	t.Setenv("LOGIN_OTP_CODE", "246810")
	cfg := initialAdminConfig{siteSlug: "filterest", email: "admin@example.test"}

	automationOnly := &bootstrapDatabaseState{automationAccount: true}
	result, err := ensureInitialAdmin(context.Background(), openBootstrapDB(t, automationOnly), cfg)
	if err != nil {
		t.Fatalf("ensureInitialAdmin() beside the automation account error = %v", err)
	}
	if result.status != "created" || result.username != "admin_filterest" || result.password == "" {
		t.Fatalf("result status=%q username=%q password-present=%t, want a generated first administrator",
			result.status, result.username, result.password != "")
	}
	if !automationOnly.userInserted || !automationOnly.membershipMade || !automationOnly.credentialsMade ||
		!automationOnly.firstRunClosed || !automationOnly.committed {
		t.Fatalf("database state = %+v, want the first administrator committed", automationOnly)
	}

	humanPresent := &bootstrapDatabaseState{humanAdministrator: true, automationAccount: true}
	result, err = ensureInitialAdmin(context.Background(), openBootstrapDB(t, humanPresent), cfg)
	if err != nil {
		t.Fatalf("ensureInitialAdmin() with a login-ready administrator error = %v", err)
	}
	if result.status != "exists" || result.username != "owner_admin" || result.password != "" {
		t.Fatalf("result status=%q username=%q, want the existing administrator and no generated password",
			result.status, result.username)
	}
	if humanPresent.began || humanPresent.userInserted || humanPresent.credentialsMade {
		t.Fatalf("database state = %+v, want nothing written", humanPresent)
	}
}

func TestSanitizeSiteSlugDefaultsToFilterest(t *testing.T) {
	tests := map[string]string{
		"":              "filterest",
		"   ":           "filterest",
		"Filterest":     "filterest",
		"My Site.fi":    "my_site_fi",
		"---Example---": "example",
	}

	for input, want := range tests {
		if got := sanitizeSiteSlug(input); got != want {
			t.Fatalf("sanitizeSiteSlug(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBootstrapStatusKeepsLoginMaterialOutOfOutput(t *testing.T) {
	result := initialAdminResult{
		status:   "created",
		username: "username-must-stay-private",
		password: "password-must-stay-private",
		email:    "email-must-stay-private.invalid",
	}
	var output bytes.Buffer

	writeBootstrapStatus(&output, "/protected/initial_admin_credentials.txt", result)

	text := output.String()
	for _, secret := range []string{result.username, result.password, result.email} {
		if strings.Contains(text, secret) {
			t.Fatalf("bootstrap status exposed login material %q in %q", secret, text)
		}
	}
	if !strings.Contains(text, "/protected/initial_admin_credentials.txt") {
		t.Fatalf("bootstrap status did not identify the handoff file: %q", text)
	}
}

func TestUsernameUsesAdminSiteSlugFormat(t *testing.T) {
	cfg := initialAdminConfig{siteSlug: "Example Site"}

	if got := cfg.username(); got != "admin_example_site" {
		t.Fatalf("username = %q, want admin_example_site", got)
	}
}

func TestParseConfigRequiresEmailUnlessDevOverride(t *testing.T) {
	t.Setenv("FILTEREST_DB_PASSWORD", "secret")

	if _, err := parseConfig([]string{}); err == nil || !strings.Contains(err.Error(), "FILTEREST_INITIAL_ADMIN_EMAIL") {
		t.Fatalf("parseConfig without email error = %v, want FILTEREST_INITIAL_ADMIN_EMAIL requirement", err)
	}

	cfg, err := parseConfig([]string{"--allow-invalid-email"})
	if err != nil {
		t.Fatalf("parseConfig with dev override returned error: %v", err)
	}
	if cfg.email != "admin@filterest.invalid" {
		t.Fatalf("email = %q, want admin@filterest.invalid", cfg.email)
	}
}

func TestParseConfigAcceptsExplicitEmail(t *testing.T) {
	t.Setenv("FILTEREST_DB_PASSWORD", "secret")

	cfg, err := parseConfig([]string{"--site-slug", "Customer Site", "--email", "admin@example.test"})
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}
	if cfg.username() != "admin_customer_site" {
		t.Fatalf("username = %q, want admin_customer_site", cfg.username())
	}
	if cfg.email != "admin@example.test" {
		t.Fatalf("email = %q, want admin@example.test", cfg.email)
	}
}

func TestWriteCredentialHandoffUses0600File(t *testing.T) {
	tmp := t.TempDir()
	handoffPath := filepath.Join(tmp, "data", "bootstrap", "initial_admin_credentials.txt")
	result := initialAdminResult{
		username:  "admin_filterest",
		password:  "secret-password",
		email:     "admin@filterest.invalid",
		createdAt: time.Date(2026, 7, 5, 4, 0, 0, 0, time.UTC),
	}

	if err := writeCredentialHandoff(handoffPath, result); err != nil {
		t.Fatalf("writeCredentialHandoff returned error: %v", err)
	}

	info, err := os.Stat(handoffPath)
	if err != nil {
		t.Fatalf("handoff file missing: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("handoff file mode = %o, want 600", got)
	}

	content, err := os.ReadFile(handoffPath)
	if err != nil {
		t.Fatalf("read handoff file: %v", err)
	}
	text := string(content)
	for _, fragment := range []string{
		"Username: admin_filterest",
		"Password: secret-password",
		"Delete this file after the first login and password rotation.",
		"The public bootstrap seed does not contain reusable admin credentials.",
	} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("handoff content missing %q\n%s", fragment, text)
		}
	}
}
