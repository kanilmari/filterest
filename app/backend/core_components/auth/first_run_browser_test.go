// first_run_browser_test.go
// Proves setup-code lockouts, non-disclosure and per-form factor binding.
// Exercises the real first-run handler and template with signed visitor cookies.
// Keeps browser access usable without weakening the write, CSRF or resource boundary.
package auth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFirstRunWrongCodePrecedesValidationAndNeverUsesQuery(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	var previous string
	for _, email := range []string{"taken@example.invalid", "free@example.invalid"} {
		form := url.Values{"email": {email}, "setup_code": {"wrong-operator-proof"}}
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, firstRunPost(firstRunCaller{peer: "192.0.2.42:1234"}, form, nil))
		if response.Code != 403 || response.Header().Get("Set-Cookie") != "" {
			t.Fatal("wrong code reached session/validation")
		}
		if previous != "" && previous != response.Body.String() {
			t.Fatal("wrong-code response disclosed validation")
		}
		previous = response.Body.String()
		assertFirstRunCodeNotEchoed(t, response, "wrong-operator-proof")
	}
	req := firstRunPost(firstRunCaller{peer: "192.0.2.42:1234"}, nil, nil)
	req.URL.RawQuery = url.Values{"setup_code": {firstRunAccess.proof}}.Encode()
	response := httptest.NewRecorder()
	FirstRunAdminHandler(response, req)
	if response.Code != 403 {
		t.Fatalf("query-only code: status=%d", response.Code)
	}
	assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
	if *fixture.state != (firstRunTransactionState{}) {
		t.Fatal("unauthorized POST wrote application state")
	}
	if strings.Contains(fixture.logs.String(), firstRunAccess.proof) {
		t.Fatal("code reached logs")
	}
}

func TestFirstRunValidationAndCSRFFailuresNeverEchoCodeOrPasswords(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	caller := firstRunCaller{peer: "192.0.2.42:1234"}
	for _, failure := range []string{"validation", "csrf"} {
		t.Run(failure, func(t *testing.T) {
			formResponse := httptest.NewRecorder()
			FirstRunAdminHandler(formResponse, caller.request(http.MethodGet))
			form, _ := firstRunFormValues(t, formResponse)
			form.Set("setup_code", firstRunAccess.proof)
			status := 400
			if failure == "csrf" {
				form.Set("csrf_token", "wrong-csrf")
				status = 403
			} else {
				form.Set("site_name", "")
			}
			response := httptest.NewRecorder()
			FirstRunAdminHandler(response, firstRunPost(caller, form, formResponse))
			if response.Code != status {
				t.Fatalf("status=%d want %d", response.Code, status)
			}
			if failure == "validation" && !strings.Contains(response.Body.String(), `id="first-run-admin-form"`) {
				t.Fatal("validation did not render real form")
			}
			assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
			assertFirstRunCodeNotEchoed(t, response, loginFixturePassword)
			if *fixture.state != (firstRunTransactionState{}) {
				t.Fatal("failed form changed account/config")
			}
		})
	}
	if strings.Contains(fixture.logs.String(), firstRunAccess.proof) {
		t.Fatal("code reached logs beyond delivery")
	}
}

func TestFirstRunTOTPKeyIsFreshAndBoundToItsOwnForm(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	caller := firstRunCaller{peer: "192.0.2.42:1234"}
	first := httptest.NewRecorder()
	FirstRunAdminHandler(first, caller.request(http.MethodGet))
	formA, keyA := firstRunFormValues(t, first)
	other := httptest.NewRecorder()
	FirstRunAdminHandler(other, caller.request(http.MethodGet))
	formB, keyB := firstRunFormValues(t, other)
	// Reloading with the same session must also produce a fresh form/key pair.
	reload := caller.request(http.MethodGet)
	for _, cookie := range first.Result().Cookies() {
		reload.AddCookie(cookie)
	}
	third := httptest.NewRecorder()
	FirstRunAdminHandler(third, reload)
	formC, keyC := firstRunFormValues(t, third)
	if keyA == keyB || keyA == keyC || keyB == keyC {
		t.Fatal("enrolment key reused across renders")
	}
	if formA.Get("csrf_token") == formB.Get("csrf_token") || formA.Get("csrf_token") == formC.Get("csrf_token") {
		t.Fatal("form binding reused")
	}
	for _, pair := range []struct {
		response   *httptest.ResponseRecorder
		own, other string
	}{{first, keyA, keyB}, {other, keyB, keyA}, {third, keyC, keyA}} {
		body := pair.response.Body.String()
		if !strings.Contains(body, pair.own) || strings.Contains(body, pair.other) {
			t.Fatal("GET did not isolate displayed enrolment key")
		}
		if !strings.Contains(pair.response.Header().Get("Cache-Control"), "no-store") {
			t.Fatal("form is cacheable")
		}
	}
	formA.Set("setup_code", firstRunAccess.proof)
	mismatch := httptest.NewRecorder()
	FirstRunAdminHandler(mismatch, firstRunPost(caller, formA, other))
	if mismatch.Code != 403 || *fixture.state != (firstRunTransactionState{}) {
		t.Fatal("another visitor's form binding accepted")
	}
	// Even the valid code holder cannot inject an earlier visitor's displayed key:
	// the handler uses only the factor in this cookie, not an attacker-supplied field.
	codeA := firstRunTOTPCode(t, keyA)
	for verifyTOTPAt(keyB, codeA, time.Now()) { // Extremely rare accidental 6-digit collision.
		other = httptest.NewRecorder()
		FirstRunAdminHandler(other, caller.request(http.MethodGet))
		formB, keyB = firstRunFormValues(t, other)
	}
	formB.Set("setup_code", firstRunAccess.proof)
	formB.Set("verification_method", "totp")
	formB.Set("totp_secret", keyA)
	formB.Set("totp_code", codeA)
	refused := httptest.NewRecorder()
	FirstRunAdminHandler(refused, firstRunPost(caller, formB, other))
	if refused.Code != 400 || fixture.state.credentialMade {
		t.Fatal("foreign enrolment key was accepted")
	}
	// Own cookie, own CSRF binding and own factor complete real setup.
	formC.Set("setup_code", firstRunAccess.proof)
	formC.Set("verification_method", "totp")
	formC.Set("totp_code", firstRunTOTPCode(t, keyC))
	complete := httptest.NewRecorder()
	FirstRunAdminHandler(complete, firstRunPost(caller, formC, third))
	if complete.Code != 303 || !fixture.state.committed {
		t.Fatalf("own form/factor failed: status=%d", complete.Code)
	}
}

func firstRunTOTPCode(t *testing.T, key string) string {
	t.Helper()
	code, err := totpCodeForCounter(key, uint64(time.Now().Unix()/30))
	if err != nil {
		t.Fatal(err)
	}
	return code
}

func TestFirstRunCrossOriginAndMissingCSRFRefused(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	caller := firstRunCaller{peer: "192.0.2.42:1234"}
	get := httptest.NewRecorder()
	FirstRunAdminHandler(get, caller.request(http.MethodGet))
	for _, test := range []struct{ origin, referer, fetch, csrf string }{
		{origin: "https://evil.invalid"}, {origin: "null"}, {referer: "https://evil.invalid/path"},
		{origin: "http://example.com.evil.invalid"}, {origin: "http://example.com", fetch: "cross-site"},
		{origin: "http://example.com", csrf: "missing"},
	} {
		form, _ := firstRunFormValues(t, get)
		form.Set("setup_code", firstRunAccess.proof)
		if test.csrf != "" {
			form.Del("csrf_token")
		}
		req := firstRunPost(caller, form, get)
		req.Header.Del("Origin")
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		req.Header.Set("Referer", test.referer)
		req.Header.Set("Sec-Fetch-Site", test.fetch)
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, req)
		if response.Code != 403 || *fixture.state != (firstRunTransactionState{}) {
			t.Fatalf("foreign origin/missing CSRF: status=%d", response.Code)
		}
		assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
	}
}

func TestFirstRunClientLockoutBackoffAndNoCodeInLogs(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	now := time.Now()
	firstRunAttempts.now = func() time.Time { return now }
	caller := firstRunCaller{peer: "192.0.2.42:1234"}
	get := httptest.NewRecorder()
	FirstRunAdminHandler(get, caller.request(http.MethodGet))
	form, _ := firstRunFormValues(t, get)
	wrong := "lockout-private-wrong-proof"
	for i := 0; i < firstRunIPFailures; i++ {
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, firstRunPost(caller, url.Values{"setup_code": {wrong}}, nil))
		if response.Code != 403 {
			t.Fatalf("wrong code #%d status=%d", i+1, response.Code)
		}
		assertFirstRunCodeNotEchoed(t, response, wrong)
	}
	form.Set("setup_code", firstRunAccess.proof)
	blocked := httptest.NewRecorder()
	FirstRunAdminHandler(blocked, firstRunPost(caller, form, get))
	if blocked.Code != 429 || blocked.Header().Get("Retry-After") == "" || fixture.state.committed {
		t.Fatal("valid code bypassed lockout")
	}
	assertFirstRunCodeNotEchoed(t, blocked, firstRunAccess.proof)
	logs := fixture.logs.String()
	if !strings.Contains(logs, "ip=192.0.2.42 scope=client backoff=30s") || strings.Contains(logs, wrong) || strings.Contains(logs, firstRunAccess.proof) {
		t.Fatal("lockout logging missing IP/back-off or disclosed code")
	}
	now = now.Add(firstRunInitialBackoff)
	response := httptest.NewRecorder()
	FirstRunAdminHandler(response, firstRunPost(caller, form, get))
	if response.Code != 303 || !fixture.state.committed {
		t.Fatal("valid form did not recover after back-off")
	}
}

func TestFirstRunGlobalLockoutAcrossIPsAndRecovery(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	now := time.Now()
	firstRunAttempts.now = func() time.Time { return now }
	caller := firstRunCaller{peer: "198.51.100.42:1234"}
	get := httptest.NewRecorder()
	FirstRunAdminHandler(get, caller.request(http.MethodGet))
	for i := 0; i < firstRunGlobalAttempts; i++ {
		peer := firstRunCaller{peer: fmt.Sprintf("192.0.2.%d:1234", i+1)}
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, firstRunPost(peer, url.Values{"setup_code": {"wrong-global-proof"}}, nil))
		if response.Code != 403 {
			t.Fatalf("distributed attempt #%d: status=%d", i+1, response.Code)
		}
	}
	form, _ := firstRunFormValues(t, get)
	form.Set("setup_code", firstRunAccess.proof)
	response := httptest.NewRecorder()
	FirstRunAdminHandler(response, firstRunPost(caller, form, get))
	if response.Code != 429 || fixture.state.committed {
		t.Fatal("fresh IP bypassed global lockout")
	}
	assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
	logs := fixture.logs.String()
	if !strings.Contains(logs, "ip=192.0.2.30 scope=global backoff=30s") || strings.Contains(logs, "wrong-global-proof") || strings.Contains(logs, firstRunAccess.proof) {
		t.Fatal("global lockout log missing or contains code")
	}
	now = now.Add(firstRunInitialBackoff)
	response = httptest.NewRecorder()
	FirstRunAdminHandler(response, firstRunPost(caller, form, get))
	if response.Code != 303 || !fixture.state.committed {
		t.Fatal("global lockout did not recover")
	}
}

func TestFirstRunLockoutsEscalateAreAtomicAndExpire(t *testing.T) {
	prepareFirstRunAccessTest(t)
	limiter := newFirstRunAttemptLimiter()
	now := time.Now()
	limiter.now = func() time.Time { return now }
	req := firstRunPost(firstRunCaller{peer: "192.0.2.42:1234"}, nil, nil)
	for round := 0; round < 3; round++ {
		for i := 0; i < firstRunIPFailures; i++ {
			limiter.check(req)
		}
		_, retry := limiter.check(req)
		want := firstRunInitialBackoff * time.Duration(1<<round)
		if retry != want {
			t.Fatalf("round %d: back-off=%s want %s", round, retry, want)
		}
		now = now.Add(want)
	}
	now = now.Add(firstRunFailureWindow)
	limiter.check(req)
	if limiter.clients["192.0.2.42"].backoff != 0 {
		t.Fatal("idle history did not expire")
	}
	// Concurrent distinct clients cannot exceed the global budget.
	limiter = newFirstRunAttemptLimiter()
	var group sync.WaitGroup
	for i := 0; i < 100; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			limiter.check(firstRunPost(firstRunCaller{peer: fmt.Sprintf("198.51.100.%d:1234", i+1)}, nil, nil))
		}(i)
	}
	group.Wait()
	if len(limiter.clients) != firstRunGlobalAttempts || limiter.global.lockedUntil.IsZero() {
		t.Fatal("concurrent clients raced past global cap")
	}
}

func TestFirstRunFirstGETAnnouncesCodeExactlyOnce(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	original := firstRunAccess
	firstRunAccess = &firstRunAccessCode{}
	t.Cleanup(func() { firstRunAccess = original })
	for i := 0; i < 2; i++ {
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, httptest.NewRequest(http.MethodGet, "/first-run", nil))
		if response.Code != 200 || len(firstRunAccess.proof) != 64 {
			t.Fatal("first GET did not initialize accessible setup")
		}
		assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
	}
	req := firstRunPost(firstRunCaller{peer: "192.0.2.42:1234"}, url.Values{"setup_code": {"wrong-announcement-proof"}}, nil)
	response := httptest.NewRecorder()
	FirstRunAdminHandler(response, req)
	logs := fixture.logs.String()
	if strings.Count(logs, firstRunAccess.proof) != 1 || !strings.Contains(logs, "Setup code field of the first-run form") || strings.Contains(logs, "wrong-announcement-proof") {
		t.Fatal("code not delivered exactly once with browser instructions")
	}
	assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
}

func TestFirstRunKeepsExistingRequestQuotaWithoutDevelopmentBypass(t *testing.T) {
	fixture := prepareFirstRunAccessTest(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	caller := firstRunCaller{peer: "127.0.0.1:1234"}
	for i := 0; i <= loginRateLimitMax; i++ {
		req := firstRunPost(caller, url.Values{"setup_code": {firstRunAccess.proof}}, nil)
		req.Header.Set("X-Bypass-Ratelimit", "test-mode")
		response := httptest.NewRecorder()
		FirstRunAdminHandler(response, req)
		want := http.StatusForbidden // No CSRF binding; no account or session write.
		if i == loginRateLimitMax {
			want = http.StatusTooManyRequests
		}
		if response.Code != want || *fixture.state != (firstRunTransactionState{}) {
			t.Fatalf("request %d status=%d want %d", i+1, response.Code, want)
		}
		assertFirstRunCodeNotEchoed(t, response, firstRunAccess.proof)
	}
}
