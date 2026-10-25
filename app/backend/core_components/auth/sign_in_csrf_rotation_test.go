// sign_in_csrf_rotation_test.go
// Exercises CSRF rotation through all six successful sign-in paths.
// Bridges real login/exchange handlers, signed cookies and the production CSRF stage.
// Uses only in-memory SQL fixtures; no PostgreSQL or external services are needed.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/otp"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/csrf_check"

	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

func TestEverySignInRotatesCSRFAndRejectsThePreviousToken(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("fixture-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	pinHash, err := bcrypt.GenerateFromPassword([]byte("2468"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"password", "email", "fixed_pin", "totp", "automation", "delegation"} {
		t.Run(path, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("ALLOW_INSECURE_DEV_PROXY", "true")
			resetLoginFailureLimiter()
			const totpSeed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
			cfg := credentialMockConfig{userLookupOK: true, userID: 42, hashedPassword: string(passwordHash),
				adminGroupMember: true, authGeneration: 4, verificationMethod: "none",
				fixedPINHash: string(pinHash), totpSecret: totpSeed, apiOnly: path == "automation"}
			factor := path == "email" || path == "fixed_pin" || path == "totp"
			if factor {
				cfg.verificationMethod = path
			}
			setupAdmissionFixture(t, cfg)
			if path == "email" {
				// The code was delivered before this request. Only its verification
				// transaction needs an additional in-memory answer.
				db := sql.OpenDB(csrfEmailConnector{base: backend.DbConfidential})
				backend.DbConfidential = db
				t.Cleanup(func() { _ = db.Close() })
			}
			store := prepareLoginHandlerSessionStore(t)
			endpoint := "/api/login"
			handler := LoginAPIHandler
			body := `{"username":"fixture","password":"fixture-password","fingerprint":"fixture","csrf_token":"before-sign-in"}`
			if factor {
				code := "2468"
				if path == "totp" {
					code, err = totpCodeForCounter(totpSeed, uint64(time.Now().Unix()/totpPeriod))
					if err != nil {
						t.Fatal(err)
					}
				}
				body = fmt.Sprintf(`{"otp_code":%q,"csrf_token":"before-sign-in"}`, code)
			}
			if path == "delegation" {
				delegations, exchangeStore := setupExchangeTest(t)
				store = exchangeStore
				// Unlike the isolated exchange tests, exercise the real identity boundary.
				siteAssistantIdentitySetter = setAuthenticatedSessionIdentity
				code, _, issueErr := delegations.Issue(42, "csrf-job", "localhost", 10*time.Minute)
				if issueErr != nil {
					t.Fatal(issueErr)
				}
				endpoint = "/api/site-assistant/delegation/exchange"
				handler = SiteAssistantDelegationExchangeHandler
				body = `{"code":` + quoteForJSON(code) + `}`
			}
			seed := httptest.NewRequest(http.MethodGet, "/", nil)
			session, err := store.New(seed, e_sessions.SessionName)
			if err != nil {
				t.Fatal(err)
			}
			session.Values["csrf_token"] = "before-sign-in"
			if factor {
				setPendingLoginState(session, 42, "fixture", 4)
			}
			seeded := httptest.NewRecorder()
			if err := session.Save(seed, seeded); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			if path == "automation" {
				request.Header.Set(auth_generation.AutomationHeader, "1")
			}
			for _, cookie := range seeded.Result().Cookies() {
				request.AddCookie(cookie)
			}
			response := httptest.NewRecorder()
			handler(response, request)
			if response.Code != http.StatusOK || decodeJSONBody(t, response)["authenticated"] != true {
				t.Fatalf("sign-in failed: status=%d body=%s", response.Code, response.Body)
			}
			assertSignedInCSRFRotation(t, store, response.Result().Cookies())
		})
	}
}

func assertSignedInCSRFRotation(t *testing.T, store *sessions.CookieStore, cookies []*http.Cookie) {
	t.Helper()
	// Sign-in expires the previous cookie before saving its replacement. Model
	// the browser jar: the last Set-Cookie of each name wins, including deletion.
	jar := map[string]*http.Cookie{}
	for _, cookie := range cookies {
		if cookie.MaxAge < 0 {
			delete(jar, cookie.Name)
		} else {
			jar[cookie.Name] = cookie
		}
	}
	cookies = nil
	for _, cookie := range jar {
		cookies = append(cookies, cookie)
	}
	carrier := httptest.NewRequest(http.MethodGet, "/api/csrf-token", nil)
	for _, cookie := range cookies {
		carrier.AddCookie(cookie)
	}
	signedIn, err := store.Get(carrier, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	current, _ := signedIn.Values["csrf_token"].(string)
	if current == "" || current == "before-sign-in" {
		t.Fatal("successful sign-in did not replace the pre-sign-in CSRF token")
	}
	pickup := httptest.NewRecorder()
	CSRFTokenHandler(pickup, carrier)
	if pickup.Code != http.StatusOK || decodeJSONBody(t, pickup)["csrf_token"] != current {
		t.Fatal("the existing frontend pickup endpoint did not return the signed-in token")
	}
	for _, proof := range []struct {
		value  string
		status int
	}{{"before-sign-in", http.StatusForbidden}, {current, http.StatusNoContent}} {
		request := httptest.NewRequest(http.MethodPost, "/api/csrf-protected-write", nil)
		for _, cookie := range cookies {
			request.AddCookie(cookie)
		}
		request.Header.Set("X-CSRF-Token", proof.value)
		response := httptest.NewRecorder()
		csrf_check.WithCSRFCheck(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})(response, request)
		if response.Code != proof.status {
			t.Fatalf("post-sign-in POST status=%d, want %d", response.Code, proof.status)
		}
		if proof.status == http.StatusForbidden && !strings.Contains(response.Body.String(), "missing CSRF token") {
			t.Fatalf("old token did not receive the existing CSRF refusal: %s", response.Body)
		}
	}
}

// csrfEmailConnector adds the already-issued email challenge to the ordinary
// login fixture. All identity queries still use that fixture's normal answers.
type csrfEmailConnector struct{ base *sql.DB }
type csrfEmailConn struct{ base *sql.DB }
type csrfEmailTx struct{}
type csrfEmailRows struct{ *sql.Rows }

func (c csrfEmailConnector) Connect(context.Context) (driver.Conn, error) {
	return csrfEmailConn(c), nil
}
func (c csrfEmailConnector) Driver() driver.Driver            { return c }
func (c csrfEmailConnector) Open(string) (driver.Conn, error) { return c.Connect(context.Background()) }
func (c csrfEmailConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (c csrfEmailConn) Close() error              { return nil }
func (c csrfEmailConn) Begin() (driver.Tx, error) { return csrfEmailTx{}, nil }
func (csrfEmailTx) Commit() error                 { return nil }
func (csrfEmailTx) Rollback() error               { return nil }
func (c csrfEmailConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "DELETE FROM restricted.verification_codes") {
		return nil, fmt.Errorf("unexpected email fixture write: %s", query)
	}
	return driver.RowsAffected(1), nil
}
func (c csrfEmailConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM restricted.verification_codes") {
		return &credentialMockRows{cols: []string{"id", "code_hash", "target_email", "attempts", "max_attempts", "expired"},
			vals: []driver.Value{int64(1), otp.HashCode("2468"), "", int64(0), int64(5), false}}, nil
	}
	values := make([]any, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	rows, err := c.base.QueryContext(ctx, query, values...)
	if err != nil {
		return nil, err
	}
	return csrfEmailRows{rows}, nil
}
func (r csrfEmailRows) Columns() []string { columns, _ := r.Rows.Columns(); return columns }
func (r csrfEmailRows) Next(dest []driver.Value) error {
	if !r.Rows.Next() {
		if err := r.Rows.Err(); err != nil {
			return err
		}
		return io.EOF
	}
	values := make([]any, len(dest))
	for i := range dest {
		values[i] = &dest[i]
	}
	return r.Rows.Scan(values...)
}
