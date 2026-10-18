// route_auth_matrix_observation_test.go
// Observes real authorization decisions without changing production middleware.
// Connects per-request diagnostics to the matrix verdict and fault regressions.
// Unknown diagnostics fail closed; raw errors and cookie fragments never escape.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/pipeline/admin_check"
	"easelect/backend/pipeline/auth_check"
)

type matrixResponse struct {
	*httptest.ResponseRecorder
	decision, diagnostic string
}

var matrixANSI = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// These are successful reads or deliberate permission decisions, never error
// patterns. New diagnostics need review rather than silently becoming DENY.
var matrixRoutineLogs = regexp.MustCompile(`^(\[GetOrCreateSession\] (session cookie received: [^\n]*\.\.\.|session cookie not found|new session created|session fetched, user_id=[0-9]+|session fetched, but user_id missing)|\[WithAccessControl\]\[[^\]\n]+\] (session-cookie: [^\n]*\.\.\.|session cookie not received|anonymous visitor on a site that requires a sign-in|guest browsing is not allowed on this site)|\[EnsureLoggedIn\] login_to_browse=false → guest session \(user_id=1\))$`)

var matrixDeniedLogs = regexp.MustCompile(`^(\[WithAdminUserCheck\] user [0-9]+ blocked: admin_access_allowed = false|\[userHasFunctionPermissionOnTable\] no (permission row found for route='[^'\n]+'(, table(_uid)?='[^'\n]+')?|tableless function permission found for route='[^'\n]+') \(userID=[0-9]+\))$`)

type matrixDiagnostics struct{ decision, diagnostic string }

func (d *matrixDiagnostics) Write(data []byte) (int, error) {
	message := strings.TrimSpace(matrixANSI.ReplaceAllString(string(data), ""))
	switch {
	case matrixRoutineLogs.MatchString(message):
	case matrixDeniedLogs.MatchString(message):
		d.decision = "DENY"
	case message == "[session_expiry] sign-in no longer valid: no sign-in on a site that requires one",
		message == "[session_expiry] sign-in no longer valid: guest browsing is not allowed on this site",
		message == "[session_expiry] sign-in no longer valid: no sign-in on an administrator route":
		d.decision = "SIGNIN"
	default:
		if d.diagnostic == "" {
			// Only fixed categories leave this writer. In particular, neither an
			// arbitrary driver error nor the session-cookie debug prefix is kept.
			d.diagnostic = "unexpected pipeline diagnostic (details redacted)"
			for _, stage := range []string{"WithAdminUserCheck", "EnsureLoggedIn", "WithAccessControl", "userHasFunctionPermissionOnTable", "session_expiry", "GetOrCreateSession", "sessions"} {
				if strings.Contains(message, "["+stage+"]") {
					d.diagnostic = stage + ": unexpected pipeline diagnostic (details redacted)"
					break
				}
			}
			if strings.HasPrefix(message, "[WithAdminUserCheck] DB error checking admin_access_allowed") {
				d.diagnostic = "admin_check: administrator query failed (details redacted)"
			}
		}
	}
	return len(data), nil
}

// Matrix requests are serial because the real session store, database pools and
// legacy logger are process globals. Restore the logger even if a stage panics.
// Bypass configured log levels so a filtered error cannot hide an infra failure.
func matrixServeHTTP(handler http.Handler, request *http.Request) *matrixResponse {
	oldWriter, oldFlags, oldPrefix := log.Writer(), log.Flags(), log.Prefix()
	diagnostics := &matrixDiagnostics{}
	log.SetOutput(diagnostics)
	log.SetFlags(0)
	log.SetPrefix("")
	defer func() {
		log.SetOutput(oldWriter)
		log.SetFlags(oldFlags)
		log.SetPrefix(oldPrefix)
	}()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return &matrixResponse{response, diagnostics.decision, diagnostics.diagnostic}
}

// This driver never opens a socket or touches PostgreSQL. It injects the actual
// QueryRow failure consumed by the real administrator and authentication stages.
type matrixFaultDB struct {
	query        string
	adminAllowed bool
	fail         bool
}

func (d *matrixFaultDB) Driver() driver.Driver                        { return d }
func (d *matrixFaultDB) Connect(context.Context) (driver.Conn, error) { return d, nil }
func (d *matrixFaultDB) Close() error                                 { return nil }
func (d *matrixFaultDB) Open(string) (driver.Conn, error)             { return d, nil }
func (d *matrixFaultDB) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("matrix driver does not prepare statements")
}
func (d *matrixFaultDB) Begin() (driver.Tx, error) {
	return nil, errors.New("matrix driver does not open transactions")
}
func (d *matrixFaultDB) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	d.query = query
	if d.fail {
		return nil, errors.New("private-fixture-detail: connection failed; cookie=private-fixture-cookie")
	}
	return &rootHandlerMockRows{cols: []string{"admin_access_allowed"}, vals: []driver.Value{d.adminAllowed}}, nil
}

func TestRouteAuthorizationMatrixInfrastructureRefusals(t *testing.T) {
	for _, scenario := range []struct {
		name, expected, query string
		signedIn, fail        bool
		stage                 func(http.HandlerFunc) http.HandlerFunc
	}{
		{"administrator query failure", "DENY", "admin_access_allowed", true, true, admin_check.WithAdminUserCheck},
		{"administrator decision", "DENY", "admin_access_allowed", true, false, admin_check.WithAdminUserCheck},
		{"browsing policy failure", "SIGNIN", "login_to_browse", false, true, auth_check.EnsureLoggedIn},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			setupRootHandlerSessionStore(t)
			fake := &matrixFaultDB{fail: scenario.fail}
			db := sql.OpenDB(fake)
			t.Cleanup(func() { _ = db.Close() })
			oldDB := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = oldDB })
			request := httptest.NewRequest(http.MethodGet, "/admin/", nil)
			request.Header.Set("Accept", "application/json")
			if scenario.signedIn {
				attachRootHandlerSessionUser(t, request, 42)
			}
			// Decode the signed cookie afresh, as the full matrix does.
			wire := httptest.NewRequest(request.Method, request.URL.String(), nil)
			wire.Header = request.Header.Clone()
			response := matrixServeHTTP(scenario.stage(func(http.ResponseWriter, *http.Request) {
				t.Fatal("refusal reached the handler")
			}), wire)
			if response.Code != http.StatusForbidden || !strings.Contains(fake.query, scenario.query) {
				t.Fatal("regression did not exercise the expected authorization query and 403")
			}
			got := matrixResult(response, "unused")
			if scenario.fail {
				if !strings.HasPrefix(got, "ERROR: ") || matrixVerdict(scenario.expected, got) != "FAIL" {
					t.Fatalf("infrastructure refusal passed: %s", got)
				}
				if !strings.Contains(got, "details redacted") || strings.Contains(got, "private-fixture") {
					t.Fatal("diagnostic was lost or exposed private driver details")
				}
				t.Logf("HTTP 403 expected %s -> %s; verdict FAIL", scenario.expected, got)
			} else if got != "DENY" || matrixVerdict(scenario.expected, got) != "PASS" {
				t.Fatalf("real authorization denial rejected: %s", got)
			}
		})
	}
}

func TestRouteAuthorizationMatrixRefusalSignals(t *testing.T) {
	for _, scenario := range []struct{ name, diagnostic, body, expected string }{
		{"malformed", "", `not JSON`, "ERROR"},
		{"generic forbidden", "", `{"code":403,"error":"403 - Forbidden"}`, "ERROR"},
		{"unproven signin", "", `{"code":403,"auth_failure":true,"error":"session_no_longer_valid"}`, "ERROR"},
		{"unproven deny", "", `{"code":403,"error":"403 - Forbidden (function-level)"}`, "ERROR"},
		{"tableless decision", "[userHasFunctionPermissionOnTable] no tableless function permission found for route='/admin/' (userID=42)", `{"code":403,"error":"403 - Forbidden (function-level)"}`, "DENY"},
		{"dataset decision", "[userHasFunctionPermissionOnTable] no permission row found for route='/api/example', table='matrix_dataset_a' (userID=42)", `{"code":403,"error":"403 - Forbidden (single table)"}`, "DENY"},
		{"cookie diagnostic", "[WithAccessControl][example.Handler] session-cookie: private-fixture-cookie...\n[userHasFunctionPermissionOnTable] no tableless function permission found for route='/admin/' (userID=42)", `{"code":403,"error":"403 - Forbidden (function-level)"}`, "DENY"},
		{"signin decision", "[session_expiry] sign-in no longer valid: no sign-in on a site that requires one", `{"code":403,"auth_failure":true,"error":"session_no_longer_valid"}`, "SIGNIN"},
		{"infra before decision", "[EnsureLoggedIn] login_to_browse fetch failed: private-fixture-detail\n[session_expiry] sign-in no longer valid: no sign-in on a site that requires one", `{"code":403,"auth_failure":true,"error":"session_no_longer_valid"}`, "ERROR"},
		{"unknown before deny", "unrecognized-stage-message private-fixture-detail\n[userHasFunctionPermissionOnTable] no tableless function permission found for route='/admin/' (userID=42)", `{"code":403,"error":"403 - Forbidden (function-level)"}`, "ERROR"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			response := matrixServeHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				for _, line := range strings.Split(scenario.diagnostic, "\n") {
					if line != "" {
						log.Print(line)
					}
				}
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(scenario.body))
			}), httptest.NewRequest(http.MethodGet, "/admin/", nil))
			got := matrixResult(response, "unused")
			if got != scenario.expected && !(scenario.expected == "ERROR" && strings.HasPrefix(got, "ERROR: ")) {
				t.Fatalf("got %s, expected %s", got, scenario.expected)
			}
			if strings.Contains(got, "private-fixture") {
				t.Fatal("raw diagnostic escaped")
			}
		})
	}
}
