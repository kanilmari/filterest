// rate_limiting_test.go
// Unit tests for WithFunctionRateLimiting pipeline stage.
// Strategy: pre-populate rateLimitCacheMap so no real DB is required. All tests use a nil *sql.DB — safe as long as the cache entry exists before the handler is invoked (cache hit bypasses the DB query entirely).
// Package-level maps are cleared via t.Cleanup to prevent cross-test pollution.
package rate_limiting

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/middlewares/firewall"
	e_sessions "easelect/backend/core_components/sessions"
	gorillaSessions "github.com/gorilla/sessions"
)

// TestMain initialises a throwaway CookieStore so that e_sessions.GetOrCreateSession
// (called inside the admin-role bypass) never sees a nil Store.
func TestMain(m *testing.M) {
	store := gorillaSessions.NewCookieStore([]byte("test-key-32-bytes-padding-here!!"))
	store.Options = &gorillaSessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	m.Run()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// injectCache pre-populates the rate-limit cache so tests don't need a real DB.
func injectCache(funcName string, amount, minutes int) {
	rateLimitCacheMu.Lock()
	rateLimitCacheMap[funcName] = &rateLimitCache{
		amount:   amount,
		minutes:  minutes,
		cachedAt: time.Now(),
	}
	rateLimitCacheMu.Unlock()
}

// purgeTestState removes all rate-limit cache and request-tracking entries for
// a given function name.  Call via t.Cleanup to keep tests independent.
func purgeTestState(funcName string) {
	rateLimitCacheMu.Lock()
	delete(rateLimitCacheMap, funcName)
	rateLimitCacheMu.Unlock()

	functionReqMu.Lock()
	for k := range functionRequests {
		if strings.HasPrefix(k, funcName+"|") || strings.HasPrefix(k, funcName+"#") {
			delete(functionRequests, k)
		}
	}
	functionReqMu.Unlock()
}

// reqWithIP builds an *http.Request whose context carries clientIP via
// context_keys.ClientIPKey{} (the same key the real middleware reads).
func reqWithIP(ip string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	ctx := context.WithValue(req.Context(), context_keys.ClientIPKey{}, ip)
	return req.WithContext(ctx)
}

// invoke sends one request through the middleware and returns the recorder.
func invoke(funcName, ip string, next http.HandlerFunc) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, funcName, next)(rr, reqWithIP(ip))
	return rr
}

// counter is a minimal next-handler that counts how many times it is invoked.
func counter(n *int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*n++
		w.WriteHeader(http.StatusOK)
	}
}

func invokeThroughProxy(handler http.Handler, peer, client string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/test", nil)
	request.RemoteAddr = peer + ":54321"
	request.Header.Set("X-Real-IP", client)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestTrustedProxyIdentitySeparatesClientsAndUntrustedSpoofCannotSplitBucket(t *testing.T) {
	const trustedFunction = "test.TrustedProxyBuckets"
	const spoofFunction = "test.UntrustedProxySpoof"
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("EASELECT_TRUSTED_PROXY_PEER_IPS", "172.25.0.1")
	injectCache(trustedFunction, 1, 1)
	injectCache(spoofFunction, 1, 1)
	t.Cleanup(func() {
		purgeTestState(trustedFunction)
		purgeTestState(spoofFunction)
	})

	trustedHandler := firewall.FirewallHandler(
		WithFunctionRateLimiting(nil, trustedFunction, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})),
	)
	if got := invokeThroughProxy(trustedHandler, "172.25.0.1", "203.0.113.10").Code; got != http.StatusOK {
		t.Fatalf("client A first request = %d, want 200", got)
	}
	if got := invokeThroughProxy(trustedHandler, "172.25.0.1", "203.0.113.10").Code; got != http.StatusTooManyRequests {
		t.Fatalf("client A over-limit request = %d, want 429", got)
	}
	if got := invokeThroughProxy(trustedHandler, "172.25.0.1", "198.51.100.20").Code; got != http.StatusOK {
		t.Fatalf("client B was merged into client A bucket: status %d", got)
	}

	untrustedHandler := firewall.FirewallHandler(
		WithFunctionRateLimiting(nil, spoofFunction, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})),
	)
	if got := invokeThroughProxy(untrustedHandler, "172.25.0.2", "203.0.113.10").Code; got != http.StatusOK {
		t.Fatalf("untrusted peer first request = %d, want 200", got)
	}
	if got := invokeThroughProxy(untrustedHandler, "172.25.0.2", "198.51.100.20").Code; got != http.StatusTooManyRequests {
		t.Fatalf("spoofed header split the untrusted peer bucket: status %d", got)
	}
}

// ── Core rate limiting behaviour ─────────────────────────────────────────────

func TestFirstRequestAllowed(t *testing.T) {
	const fn, ip = "test.FirstRequest", "1.2.3.4"
	injectCache(fn, 5, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	rr := invoke(fn, ip, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	if rr.Code != http.StatusOK {
		t.Errorf("first request: got %d, want 200", rr.Code)
	}
}

func TestRequestsWithinLimitAllowed(t *testing.T) {
	const fn, ip = "test.WithinLimit", "1.2.3.5"
	const limit = 3
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	for i := 0; i < limit; i++ {
		rr := invoke(fn, ip, counter(&called))
		if rr.Code != http.StatusOK {
			t.Errorf("request %d/%d: got %d, want 200", i+1, limit, rr.Code)
		}
	}
	if called != limit {
		t.Errorf("next called %d times, want %d", called, limit)
	}
}

func TestExceedRateLimitReturns429(t *testing.T) {
	const fn, ip = "test.ExceedLimit", "1.2.3.6"
	const limit = 3
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	// First `limit` requests must succeed.
	for i := 0; i < limit; i++ {
		rr := invoke(fn, ip, counter(&called))
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rr.Code)
		}
	}
	// The (limit+1)-th request must be rejected.
	rr := invoke(fn, ip, counter(&called))
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("over-limit request: got %d, want 429", rr.Code)
	}
	if called != limit {
		t.Errorf("next should not have been called on rejected request; called=%d", called)
	}
}

func TestUnverifiedAdminCookieDoesNotBypassRateLimit(t *testing.T) {
	const fn, ip = "test.UnverifiedAdminCookie", "1.2.3.7"
	injectCache(fn, 1, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	request := reqWithIP(ip)
	response := httptest.NewRecorder()
	session, err := e_sessions.Store.Get(request, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"] = 42
	session.Values["user_role"] = "admin"
	if err = session.Save(request, response); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range response.Result().Cookies() {
		request.AddCookie(cookie)
	}

	called := 0
	next := counter(&called)
	first := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(first, request)
	second := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(second, request)

	if first.Code != http.StatusOK || second.Code != http.StatusTooManyRequests || called != 1 {
		t.Fatalf("unverified admin cookie result: first=%d second=%d called=%d", first.Code, second.Code, called)
	}
}

func TestDifferentIPsAreIndependent(t *testing.T) {
	const fn = "test.IPIndep"
	const ipA, ipB = "10.0.0.1", "10.0.0.2"
	const limit = 2
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	calledA, calledB := 0, 0

	// IP A fills its individual quota; IP B makes only one request.
	for i := 0; i < limit; i++ {
		invoke(fn, ipA, counter(&calledA))
	}
	invoke(fn, ipB, counter(&calledB)) // B at 1/2

	// IP A exceeds its limit — must be rejected.
	rrA := invoke(fn, ipA, counter(&calledA))
	if rrA.Code != http.StatusTooManyRequests {
		t.Errorf("IP A over limit: got %d, want 429", rrA.Code)
	}

	// IP B is still under limit (independent counter) — must be allowed.
	rrB := invoke(fn, ipB, counter(&calledB)) // B at 2/2
	if rrB.Code != http.StatusOK {
		t.Errorf("IP B within limit: got %d, want 200", rrB.Code)
	}
}

func TestLoginPageNavigationUsesDedicated100Per30MinuteLimit(t *testing.T) {
	const ip = "203.0.113.70"
	const fn = loginPageFunctionName
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	next := counter(&called)
	for requestNumber := 1; requestNumber <= loginPageRateLimitAmount; requestNumber++ {
		recorder := invoke(fn, ip, next)
		if recorder.Code != http.StatusOK {
			t.Fatalf("login page request %d = %d, want 200", requestNumber, recorder.Code)
		}
	}

	overLimitRequest := reqWithIP(ip)
	overLimitRequest.Header.Set("Accept", "text/html")
	recorder := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(recorder, overLimitRequest)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("login page over-limit request = %d, want 429", recorder.Code)
	}
	if retryAfter := recorder.Header().Get("Retry-After"); retryAfter != "1800" {
		t.Fatalf("Retry-After = %q, want 1800", retryAfter)
	}
	if called != loginPageRateLimitAmount {
		t.Fatalf("login page handler calls = %d, want %d", called, loginPageRateLimitAmount)
	}
}

func TestLoginPagePostRetainsDatabaseBackedCredentialCeiling(t *testing.T) {
	const ip = "203.0.113.71"
	const fn = loginPageFunctionName
	injectCache(fn, 1, 20)
	t.Cleanup(func() { purgeTestState(fn) })

	next := counter(new(int))
	for requestNumber := 1; requestNumber <= loginPageRateLimitAmount; requestNumber++ {
		if recorder := invoke(fn, ip, next); recorder.Code != http.StatusOK {
			t.Fatalf("navigation request %d = %d, want 200", requestNumber, recorder.Code)
		}
	}

	request := reqWithIP(ip)
	request.Method = http.MethodPost
	first := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(first, request)
	second := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(second, request)

	if first.Code != http.StatusOK || second.Code != http.StatusTooManyRequests {
		t.Fatalf("login POST statuses = %d, %d; want 200, 429", first.Code, second.Code)
	}
}

func TestStorageBurstAllowsImageRichPageWithoutWeakeningPerIPIsolation(t *testing.T) {
	const fn = "router.ServeStorage"
	const ipA, ipB = "203.0.113.40", "198.51.100.41"
	const productionLimit = 5000
	const imageRichPageBurst = 600
	injectCache(fn, productionLimit, 20)
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	for requestNumber := 1; requestNumber <= imageRichPageBurst; requestNumber++ {
		recorder := invoke(fn, ipA, counter(&called))
		if recorder.Code != http.StatusOK {
			t.Fatalf("image request %d/%d = %d, want 200", requestNumber, imageRichPageBurst, recorder.Code)
		}
	}
	if called != imageRichPageBurst {
		t.Fatalf("served image requests = %d, want %d", called, imageRichPageBurst)
	}

	functionReqMu.Lock()
	key := fn + "|" + ipA
	remaining := productionLimit - len(functionRequests[key])
	functionRequests[key] = append(functionRequests[key], make([]time.Time, remaining)...)
	for index := range functionRequests[key] {
		functionRequests[key][index] = time.Now()
	}
	functionReqMu.Unlock()

	if recorder := invoke(fn, ipA, counter(&called)); recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("client A over-limit image request = %d, want 429", recorder.Code)
	}
	if recorder := invoke(fn, ipB, counter(&called)); recorder.Code != http.StatusOK {
		t.Fatalf("client B image request shared client A bucket: status %d", recorder.Code)
	}
}

// ── Rate limit window reset ───────────────────────────────────────────────────

// TestWindowResetAllowsNewRequests verifies that requests made before the sliding
// window are not counted, allowing fresh requests to proceed even after the quota
// was previously filled.
func TestWindowResetAllowsNewRequests(t *testing.T) {
	const fn, ip = "test.WindowReset", "10.1.0.1"
	const limit = 2
	injectCache(fn, limit, 1) // 2 requests per 1-minute window
	t.Cleanup(func() { purgeTestState(fn) })

	key := fn + "|" + ip

	// Inject `limit` old timestamps that fall outside the 1-minute window.
	old := time.Now().Add(-2 * time.Minute)
	functionReqMu.Lock()
	functionRequests[key] = []time.Time{old, old}
	functionReqMu.Unlock()

	// A fresh request must be allowed because the old entries are evicted.
	rr := invoke(fn, ip, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	if rr.Code != http.StatusOK {
		t.Errorf("after window reset: got %d, want 200", rr.Code)
	}
}

// ── Dev bypass mechanisms ─────────────────────────────────────────────────────

func TestDevRateLimitingOffFlagBypassesAllLimits(t *testing.T) {
	const fn, ip = "test.DevFlag", "10.2.0.1"
	const limit = 1
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	// Save and restore the package-level flag.
	orig := devRateLimitingOff
	devRateLimitingOff = true
	t.Cleanup(func() { devRateLimitingOff = orig })

	called := 0
	// Send far more requests than the configured limit — all must pass.
	for i := 0; i < limit+5; i++ {
		rr := invoke(fn, ip, counter(&called))
		if rr.Code != http.StatusOK {
			t.Errorf("request %d with devRateLimitingOff: got %d, want 200", i+1, rr.Code)
		}
	}
	if called != limit+5 {
		t.Errorf("expected next called %d times, got %d", limit+5, called)
	}
}

func TestDevHeaderBypassSkipsRateLimit(t *testing.T) {
	const fn, ip = "test.HeaderBypass", "10.3.0.1"
	const limit = 1
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	t.Setenv("ENVIRONMENT_TYPE", "dev")

	called := 0
	next := counter(&called)

	// First request fills the quota.
	invoke(fn, ip, next)

	// Second request would normally be rejected (count=2 > limit=1), but the
	// bypass header must short-circuit rate limiting entirely.
	req := reqWithIP(ip)
	req.Header.Set("X-Bypass-Ratelimit", "test-mode")
	rr := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, next)(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("bypass header: got %d, want 200", rr.Code)
	}
}

// ── No-rate-limit function exemptions ────────────────────────────────────────

func TestNoRateLimitFunctionsAreAlwaysAllowed(t *testing.T) {
	exemptFuncs := []string{
		"e_sessions.ResetSessionHandler",
		"auth.LogoutHandler",
		"router.handleFrontend",
	}

	for _, fn := range exemptFuncs {
		fn := fn
		t.Run(fn, func(t *testing.T) {
			// Even with a very tight limit in cache, exempt functions must pass.
			injectCache(fn, 1, 1)
			t.Cleanup(func() { purgeTestState(fn) })

			called := 0
			for i := 0; i < 5; i++ {
				rr := invoke(fn, "10.4.0.1", counter(&called))
				if rr.Code != http.StatusOK {
					t.Errorf("%s request %d: got %d, want 200", fn, i+1, rr.Code)
				}
			}
			if called != 5 {
				t.Errorf("%s: expected next called 5 times, got %d", fn, called)
			}
		})
	}
}

// ── Zero-value rate limit skips enforcement ───────────────────────────────────

func TestZeroAmountSkipsRateLimit(t *testing.T) {
	const fn, ip = "test.ZeroAmount", "10.5.0.1"
	injectCache(fn, 0, 1) // amount=0 → no limit enforced
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	for i := 0; i < 10; i++ {
		rr := invoke(fn, ip, counter(&called))
		if rr.Code != http.StatusOK {
			t.Errorf("zero-amount request %d: got %d, want 200", i+1, rr.Code)
		}
	}
}

func TestZeroMinutesSkipsRateLimit(t *testing.T) {
	const fn, ip = "test.ZeroMinutes", "10.5.0.2"
	injectCache(fn, 5, 0) // minutes=0 → no limit enforced
	t.Cleanup(func() { purgeTestState(fn) })

	called := 0
	for i := 0; i < 10; i++ {
		rr := invoke(fn, ip, counter(&called))
		if rr.Code != http.StatusOK {
			t.Errorf("zero-minutes request %d: got %d, want 200", i+1, rr.Code)
		}
	}
}

// ── Response format when rate-limited ────────────────────────────────────────

func TestHTMLResponseForBrowserRequests(t *testing.T) {
	const fn, ip = "test.HTMLResponse", "10.6.0.1"
	const limit = 1
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// Fill the quota.
	invoke(fn, ip, noop)

	// Over-limit request with browser Accept header.
	req := reqWithIP(ip)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	rr := httptest.NewRecorder()
	WithFunctionRateLimiting(nil, fn, noop)(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("HTML 429: got status %d, want 429", rr.Code)
	}
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Errorf("HTML 429: Content-Type=%q, want text/html", ct)
	}
	if !strings.Contains(rr.Body.String(), "<html") {
		t.Errorf("HTML 429: body does not contain HTML, got: %s", rr.Body.String())
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("HTML 429: missing Retry-After header")
	}
}

func TestJSONResponseForAPIRequests(t *testing.T) {
	const fn, ip = "test.JSONResponse", "10.7.0.1"
	const limit = 1
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// Fill the quota.
	invoke(fn, ip, noop)

	// Over-limit request without an HTML Accept header (API / XHR call).
	rr := invoke(fn, ip, noop)

	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("JSON 429: got status %d, want 429", rr.Code)
	}
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("JSON 429: Content-Type=%q, want application/json", ct)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "429") {
		t.Errorf("JSON 429: body should mention 429, got: %s", body)
	}
}

// ── IP extraction fallback ────────────────────────────────────────────────────

// TestRemoteAddrFallbackWhenNoContextIP verifies that when the ClientIPKey is
// absent from the request context the middleware falls back to r.RemoteAddr and
// still enforces per-address limits correctly.
func TestRemoteAddrFallbackWhenNoContextIP(t *testing.T) {
	const fn = "test.RemoteAddrFallback"
	const limit = 2
	injectCache(fn, limit, 1)
	t.Cleanup(func() { purgeTestState(fn) })

	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// Build requests without context IP — RemoteAddr is used instead.
	sendPlain := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.RemoteAddr = "192.168.1.100:12345"
		rr := httptest.NewRecorder()
		WithFunctionRateLimiting(nil, fn, noop)(rr, req)
		return rr
	}

	for i := 0; i < limit; i++ {
		rr := sendPlain()
		if rr.Code != http.StatusOK {
			t.Errorf("request %d/%d: got %d, want 200", i+1, limit, rr.Code)
		}
	}

	// One more — must be rejected.
	rr := sendPlain()
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("over-limit with RemoteAddr: got %d, want 429", rr.Code)
	}
}
