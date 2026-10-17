// first_run_access_test.go
// Proves browser-readable setup and code-required submissions for every peer.
// Connects real templates, isolated SQL/session fixtures and the firewall chain.
// Keeps network identity out of authorization and the setup code out of output.
package auth

import (
	"bytes"
	"context"
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/middlewares/firewall"
	e_sessions "easelect/backend/core_components/sessions"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type firstRunCaller struct {
	name, peer, resolvedIP string
	headers                http.Header
}

func firstRunCallers() []firstRunCaller {
	cases := []firstRunCaller{
		{name: "remote", peer: "192.0.2.42:1234"},
		{name: "remote IPv6", peer: "[2001:db8::42]:1234"},
		{name: "loopback without headers", peer: "127.0.0.1:1234"},
		{name: "IPv6 loopback", peer: "[::1]:1234"},
		{name: "mapped loopback", peer: "[::ffff:127.0.0.1]:1234"},
		{name: "other loopback", peer: "127.0.0.2:1234"},
		{name: "invalid peer", peer: "localhost:1234"},
		{name: "empty peer"},
		{name: "spoofed context", peer: "192.0.2.42:1234", resolvedIP: "127.0.0.1"},
		{name: "trusted gateway", peer: "172.22.0.1:1234", headers: http.Header{"CF-Connecting-IP": {"127.0.0.1"}}},
	}
	for _, header := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For", "Forwarded", "True-Client-IP"} {
		for _, peer := range []string{"192.0.2.42:1234", "127.0.0.1:1234"} {
			for _, value := range []string{"127.0.0.1", "", "garbage"} {
				cases = append(cases, firstRunCaller{name: header + "=" + value + " from " + peer, peer: peer, headers: http.Header{header: {value}}})
			}
		}
	}
	return cases
}

type firstRunAccessFixture struct {
	state *firstRunTransactionState
	logs  *bytes.Buffer
}

func resetFirstRunLimits(t *testing.T) {
	t.Helper()
	old := firstRunAttempts
	firstRunAttempts = newFirstRunAttemptLimiter()
	authRateLimiter.Lock()
	oldAttempts := authRateLimiter.attempts
	authRateLimiter.attempts = make(map[string]*loginAttempt)
	authRateLimiter.Unlock()
	t.Cleanup(func() {
		firstRunAttempts = old
		authRateLimiter.Lock()
		authRateLimiter.attempts = oldAttempts
		authRateLimiter.Unlock()
	})
}

func prepareFirstRunAccessTest(t *testing.T) *firstRunAccessFixture {
	t.Helper()
	output := &bytes.Buffer{}
	logging.SetOutput(output)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })
	oldPending := firstRunPendingReader
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return true, nil }
	t.Cleanup(func() { firstRunPendingReader = oldPending })
	ensureFirstRunAccessCode()
	if firstRunAccess.err != nil || len(firstRunAccess.proof) != 64 {
		t.Fatal("setup code was not generated")
	}
	output.Reset() // Only the one-time delivery line may include the code.
	resetFirstRunLimits(t)
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("FILTEREST_FRONTEND_ASSET_MODE", "source")
	oldFrontend := frontend_dir
	frontend_dir = filepath.Join("..", "..", "..", "frontend")
	t.Cleanup(func() { frontend_dir = oldFrontend })
	setupAuthModesTestStore(t).Options.SameSite = http.SameSiteLaxMode
	state := &firstRunTransactionState{}
	db := openFirstRunTransactionDB(t, state)
	oldDB, oldAdminDB := backend.Db, backend.DbAdmin
	backend.Db, backend.DbAdmin = db, db
	t.Cleanup(func() { backend.Db, backend.DbAdmin = oldDB, oldAdminDB })
	return &firstRunAccessFixture{state: state, logs: output}
}

func (caller firstRunCaller) request(method string) *http.Request {
	req := httptest.NewRequest(method, "/first-run", nil)
	req.RemoteAddr = caller.peer
	if caller.headers != nil {
		req.Header = caller.headers.Clone()
	}
	return req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, caller.resolvedIP))
}

func assertFirstRunCodeNotEchoed(t *testing.T, response *httptest.ResponseRecorder, code string) {
	t.Helper()
	if code == "" {
		t.Fatal("code-disclosure assertion requires a generated code")
	}
	if strings.Contains(response.Body.String(), code) {
		t.Fatal("setup code reached HTTP body")
	}
	for _, values := range response.Header() {
		if strings.Contains(strings.Join(values, " "), code) {
			t.Fatal("setup code reached response headers")
		}
	}
}

func firstRunFormValues(t *testing.T, response *httptest.ResponseRecorder) (url.Values, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/first-run", nil)
	for _, cookie := range response.Result().Cookies() {
		req.AddCookie(cookie)
	}
	session, err := e_sessions.Load(req)
	if err != nil {
		t.Fatal(err)
	}
	csrf, _ := session.Values["csrf_token"].(string)
	secret, _ := session.Values["first_run_totp_secret"].(string)
	if csrf == "" || secret == "" {
		t.Fatal("missing form binding")
	}
	return url.Values{
		"site_name": {"Setup Fixture"}, "username": {"owner.admin"}, "display_name": {"admin_1"},
		"display_name_may_equal_login_name": {"true"}, "email": {"owner@example.invalid"},
		"password": {loginFixturePassword}, "confirm_password": {loginFixturePassword},
		"installation_environment": {"prod"}, "verification_method": {"none"}, "csrf_token": {csrf},
	}, secret
}

func firstRunPost(caller firstRunCaller, form url.Values, response *httptest.ResponseRecorder) *http.Request {
	req := caller.request(http.MethodPost)
	withBody := withRegistrationFormBody(req, form.Encode())
	withBody.RemoteAddr = req.RemoteAddr
	req = withBody.WithContext(req.Context())
	req.Header.Set("Origin", "http://example.com")
	if response != nil {
		for _, cookie := range response.Result().Cookies() {
			req.AddCookie(cookie)
		}
	}
	return req
}

func TestFirstRunEveryCallerRequiresSetupCode(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	for _, caller := range firstRunCallers() {
		t.Run(caller.name, func(t *testing.T) {
			resetFirstRunLimits(t)
			// GET needs no code and shows only this form's own enrolment key.
			formResponse := httptest.NewRecorder()
			FirstRunAdminHandler(formResponse, caller.request(http.MethodGet))
			body := formResponse.Body.String()
			if formResponse.Code != http.StatusOK || !strings.Contains(body, `id="setup_code" name="setup_code" autocomplete="off" required`) || !strings.Contains(body, `data-lang-key="first_run_setup_code_help"`) {
				t.Fatalf("GET: status=%d or setup field/help missing", formResponse.Code)
			}
			assertFirstRunCodeNotEchoed(t, formResponse, firstRunAccess.proof)
			for _, code := range []string{"", "wrong-code", firstRunAccess.proof[:63], firstRunAccess.proof + "0"} {
				for _, source := range []string{"field", "header"} {
					resetFirstRunLimits(t)
					form, _ := firstRunFormValues(t, formResponse)
					if source == "field" {
						form.Set("setup_code", code)
					}
					req := firstRunPost(caller, form, formResponse)
					if source == "header" {
						req.Header.Set("X-Filterest-Setup-Token", code)
					}
					response := httptest.NewRecorder()
					FirstRunAdminHandler(response, req)
					if response.Code != http.StatusForbidden || response.Header().Get("Set-Cookie") != "" {
						t.Fatalf("%s code length %d: status=%d or session saved", source, len(code), response.Code)
					}
					if *fixture.state != (firstRunTransactionState{}) {
						t.Fatal("refused setup changed account/config state")
					}
					assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
					assertFirstRunCodeNotEchoed(t, response, codeOrFixture(code))
				}
			}
		})
	}
}

func codeOrFixture(code string) string {
	if code == "" {
		return "missing-code-fixture"
	}
	return code
}

func TestFirstRunRejectsForwardedLoopbackThroughFirewall(t *testing.T) {
	prepareFirstRunAccessTest(t)
	t.Setenv("EASELECT_TRUSTED_PROXY_PEER_IPS", "172.22.0.1")
	req := httptest.NewRequest(http.MethodPost, "/first-run", nil)
	req.RemoteAddr = "172.22.0.1:1234"
	req.Header.Set("CF-Connecting-IP", "127.0.0.1")
	called := false
	response := httptest.NewRecorder()
	firewall.FirewallHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Context().Value(context_keys.ClientIPKey{}) != "127.0.0.1" {
			t.Fatal("fixture did not reproduce firewall resolving loopback")
		}
		FirstRunAdminHandler(w, r)
	})).ServeHTTP(response, req)
	if !called || response.Code != http.StatusForbidden {
		t.Fatalf("through firewall: called=%v status=%d", called, response.Code)
	}
	assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
}

func TestFirstRunValidCodeShowsFormAndCompletesSetupFromEveryPeer(t *testing.T) {
	for _, caller := range firstRunCallers() {
		for _, source := range []string{"field", "header"} {
			t.Run(caller.name+"/"+source, func(t *testing.T) {
				fixture := prepareFirstRunAccessTest(t)
				formResponse := httptest.NewRecorder()
				FirstRunAdminHandler(formResponse, caller.request(http.MethodGet))
				if formResponse.Code != http.StatusOK {
					t.Fatalf("GET status=%d", formResponse.Code)
				}
				form, _ := firstRunFormValues(t, formResponse)
				if source == "field" {
					form.Set("setup_code", firstRunAccess.proof)
				}
				req := firstRunPost(caller, form, formResponse)
				if source == "header" {
					req.Header.Set("X-Filterest-Setup-Token", firstRunAccess.proof)
					req.Header.Del("Origin") // Scripts still prove the form's session and CSRF binding.
				}
				response := httptest.NewRecorder()
				FirstRunAdminHandler(response, req)
				if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/login?first-run-complete=1" {
					t.Fatalf("POST status=%d want setup-complete redirect", response.Code)
				}
				state := fixture.state
				if !state.committed || state.rolledBack || !state.credentialMade || !state.configClosed || !state.environmentMade || !state.siteNameMade {
					t.Fatalf("setup did not commit together: %+v", state)
				}
				assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
				if strings.Contains(fixture.logs.String(), firstRunAccess.proof) {
					t.Fatal("setup code reached logs beyond delivery line")
				}
			})
		}
	}
}

func TestFirstRunClosedRedirectsEveryCallerRegardlessOfCode(t *testing.T) {
	prepareFirstRunAccessTest(t)
	firstRunPendingReader = func(context.Context, *sql.DB) (bool, error) { return false, nil }
	for _, caller := range firstRunCallers() {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			for _, code := range []string{"", "wrong-code", firstRunAccess.proof} {
				req := caller.request(method)
				req.Header.Set("X-Filterest-Setup-Token", code)
				response := httptest.NewRecorder()
				FirstRunAdminHandler(response, req)
				if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/login" {
					t.Fatalf("%s %s: status=%d", method, caller.name, response.Code)
				}
				assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
			}
		}
	}
}

func TestFirstRunCodeGenerationFailureRefusesEveryCaller(t *testing.T) {
	prepareFirstRunAccessTest(t)
	oldProof, oldError := firstRunAccess.proof, firstRunAccess.err
	t.Cleanup(func() { firstRunAccess.proof, firstRunAccess.err = oldProof, oldError })
	firstRunAccess.err = errors.New("setup code generation failed")
	for _, caller := range firstRunCallers() {
		t.Run(caller.name, func(t *testing.T) {
			resetFirstRunLimits(t)
			req := caller.request(http.MethodPost)
			req.Header.Set("X-Filterest-Setup-Token", oldProof)
			response := httptest.NewRecorder()
			FirstRunAdminHandler(response, req)
			if response.Code != http.StatusForbidden {
				t.Fatalf("failed generation status=%d", response.Code)
			}
			assertFirstRunCodeNotEchoed(t, response, oldProof)
		})
	}
}
