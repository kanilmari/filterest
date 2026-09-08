// login_access_policy_test.go
// Tests independent configuration defaults, canonical admin eligibility, and active-session admission.
// Bridges deterministic database records with the same policy functions used by login and public bootstrap.
// Prevents visibility toggles, stale role cookies, or read failures from bypassing sign-in restrictions.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gorilla/sessions"
)

type loginPolicyFixture struct {
	settings              map[string]driver.Value
	enabled, flag, member bool
	failure               bool
	generation            int64
}
type loginPolicyDriver struct{ cfg *loginPolicyFixture }
type loginPolicyConn struct{ cfg *loginPolicyFixture }
type loginPolicyRows struct {
	names  []string
	values []driver.Value
	done   bool
}

func (d loginPolicyDriver) Open(string) (driver.Conn, error)   { return &loginPolicyConn{d.cfg}, nil }
func (c *loginPolicyConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *loginPolicyConn) Close() error                        { return nil }
func (c *loginPolicyConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (r *loginPolicyRows) Columns() []string                   { return r.names }
func (r *loginPolicyRows) Close() error                        { return nil }
func (r *loginPolicyRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(values, r.values)
	r.done = true
	return nil
}
func (c *loginPolicyConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.cfg.failure {
		return nil, errors.New("policy database failed")
	}
	switch {
	case strings.Contains(query, "FROM system_config"):
		value, present := c.cfg.settings[args[0].Value.(string)]
		return &loginPolicyRows{names: []string{"boolean_value"}, values: []driver.Value{value}, done: !present}, nil
	case strings.Contains(query, "SELECT ur.authentication_generation"):
		return &loginPolicyRows{names: []string{"authentication_generation"}, values: []driver.Value{c.cfg.generation}, done: !c.cfg.enabled}, nil
	case strings.Contains(query, "admin_access_allowed IS TRUE"):
		return &loginPolicyRows{names: []string{"enabled", "admin_access_allowed"}, values: []driver.Value{c.cfg.enabled, c.cfg.flag}}, nil
	case strings.Contains(query, "system_user_group_memberships"):
		return &loginPolicyRows{names: []string{"membership"}, values: []driver.Value{int64(1)}, done: !c.cfg.member}, nil
	}
	return nil, fmt.Errorf("unexpected policy query")
}

var loginPolicyTestCounter int64

func setupLoginPolicyFixture(t *testing.T, cfg *loginPolicyFixture) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("login_policy_%d", atomic.AddInt64(&loginPolicyTestCounter, 1))
	sql.Register(name, loginPolicyDriver{cfg})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	original, guest := Db, DbGuest
	Db, DbGuest = db, db
	t.Cleanup(func() { Db, DbGuest = original, guest; _ = db.Close() })
	return db
}

func TestLoginAccessSettingsCompatibleDefaultsAndIndependentOverrides(t *testing.T) {
	cfg := &loginPolicyFixture{settings: map[string]driver.Value{}}
	db := setupLoginPolicyFixture(t, cfg)
	settings, err := ReadLoginAccessSettings(context.Background(), db)
	if err != nil || !settings.ShowLoginButton || settings.OnlyAdminCanLogin {
		t.Fatalf("missing-key defaults: %+v, %v", settings, err)
	}
	cfg.settings["show_login_button"] = false
	settings, err = ReadLoginAccessSettings(context.Background(), db)
	if err != nil || settings.ShowLoginButton || settings.OnlyAdminCanLogin {
		t.Fatalf("visibility changed admission: %+v, %v", settings, err)
	}
	allowed, err := UserLoginAllowed(context.Background(), db, 42)
	if err != nil || !allowed {
		t.Fatalf("hidden button blocked direct login: %v, %v", allowed, err)
	}
	cfg.settings["only_admin_can_login"] = true
	settings, err = ReadLoginAccessSettings(context.Background(), db)
	if err != nil || settings.ShowLoginButton || !settings.OnlyAdminCanLogin {
		t.Fatalf("independent settings: %+v, %v", settings, err)
	}
}

func TestAdminOnlyLoginRequiresEveryCurrentAdminCondition(t *testing.T) {
	for _, tc := range []struct {
		name                        string
		enabled, flag, member, want bool
	}{
		{"enabled admin", true, true, true, true},
		{"basic with flag", true, true, false, false},
		{"group without flag", true, false, true, false},
		{"disabled admin", false, true, true, false},
		{"ordinary user", true, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &loginPolicyFixture{settings: map[string]driver.Value{"only_admin_can_login": true}, enabled: tc.enabled, flag: tc.flag, member: tc.member}
			db := setupLoginPolicyFixture(t, cfg)
			got, err := UserLoginAllowed(context.Background(), db, 42)
			if err != nil || got != tc.want {
				t.Fatalf("allowed=%v,%v; want %v", got, err, tc.want)
			}
		})
	}
}

func TestLoginPolicyDoesNotFallBackOnMalformedOrUnavailableSettings(t *testing.T) {
	cfg := &loginPolicyFixture{settings: map[string]driver.Value{"only_admin_can_login": nil}}
	db := setupLoginPolicyFixture(t, cfg)
	if allowed, err := UserLoginAllowed(context.Background(), db, 42); err == nil || allowed {
		t.Fatal("NULL admission setting failed open")
	}
	cfg.settings["only_admin_can_login"] = false
	cfg.failure = true
	if allowed, err := UserLoginAllowed(context.Background(), db, 42); err == nil || allowed {
		t.Fatal("database failure failed open")
	}
	if _, err := ReadLoginAccessSettings(context.Background(), nil); err == nil {
		t.Fatal("missing database accepted")
	}
}

func TestActiveSessionRechecksAdmissionWithoutTrustingCookieRole(t *testing.T) {
	cfg := &loginPolicyFixture{settings: map[string]driver.Value{}, enabled: true, generation: 7}
	db := setupLoginPolicyFixture(t, cfg)
	session := &sessions.Session{Values: map[interface{}]interface{}{"authenticated": true, "user_id": 42, "user_role": "admin", "authentication_generation": int64(7)}}
	matches, err := AuthenticatedSessionMatches(context.Background(), db, session, 42)
	if err != nil || !matches {
		t.Fatalf("default policy rejected existing identity: %v,%v", matches, err)
	}
	cfg.settings["only_admin_can_login"] = true
	if matches, err = AuthenticatedSessionMatches(context.Background(), db, session, 42); err != nil || matches {
		t.Fatalf("stale admin cookie bypassed current membership: %v,%v", matches, err)
	}
	cfg.member = true
	cfg.flag = true
	if matches, err = AuthenticatedSessionMatches(context.Background(), db, session, 42); err != nil || !matches {
		t.Fatalf("current admin denied: %v,%v", matches, err)
	}
	cfg.generation = 8
	if matches, err = AuthenticatedSessionMatches(context.Background(), db, session, 42); err != nil || matches {
		t.Fatal("new policy bypassed credential generation")
	}
}
