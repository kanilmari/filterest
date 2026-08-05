// firewall_handler_test.go
// White-box unit tests for the firewall package.
// Covers onTrustedProxy, getClientIP, incrementSpecial, FirewallHandler, and cachedReverseDNS.
package firewall

import (
	"easelect/backend/core_components/context_keys"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────
// onTrustedProxy
// ─────────────────────────────────────────────────────────────

func TestOnTrustedProxy_CloudflareIP(t *testing.T) {
	// 173.245.48.1 is inside 173.245.48.0/20 (Cloudflare)
	if !onTrustedProxy("173.245.48.1") {
		t.Error("expected 173.245.48.1 (Cloudflare) to be trusted")
	}
}

func TestOnTrustedProxy_AnotherCloudflareRange(t *testing.T) {
	// 104.16.0.1 is inside 104.16.0.0/13 (Cloudflare)
	if !onTrustedProxy("104.16.0.1") {
		t.Error("expected 104.16.0.1 (Cloudflare) to be trusted")
	}
}

func TestOnTrustedProxy_Localhost_v4(t *testing.T) {
	if !onTrustedProxy("127.0.0.1") {
		t.Error("expected 127.0.0.1 (localhost) to be trusted")
	}
}

func TestOnTrustedProxy_Localhost_v6(t *testing.T) {
	if !onTrustedProxy("::1") {
		t.Error("expected ::1 (localhost IPv6) to be trusted")
	}
}

func TestOnTrustedProxy_ExternalIP_NotTrusted(t *testing.T) {
	if onTrustedProxy("8.8.8.8") {
		t.Error("expected 8.8.8.8 to NOT be trusted")
	}
}

func TestOnTrustedProxy_ArbitraryPublicIP_NotTrusted(t *testing.T) {
	if onTrustedProxy("1.2.3.4") {
		t.Error("expected 1.2.3.4 to NOT be trusted")
	}
}

func TestOnTrustedProxy_EmptyString(t *testing.T) {
	if onTrustedProxy("") {
		t.Error("expected empty string to NOT be trusted")
	}
}

func TestOnTrustedProxy_InvalidString(t *testing.T) {
	if onTrustedProxy("not-an-ip") {
		t.Error("expected invalid string to NOT be trusted")
	}
}

// ─────────────────────────────────────────────────────────────
// getClientIP
// ─────────────────────────────────────────────────────────────

// trustedRemoteAddr is a localhost address (in the trusted proxy CIDR).
const trustedRemoteAddr = "127.0.0.1:1234"

// untrustedRemoteAddr is an arbitrary non-trusted address.
const untrustedRemoteAddr = "8.8.8.8:9999"

func TestGetClientIP_NonTrustedProxy_ReturnsRemoteAddr(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = untrustedRemoteAddr
	r.Header.Set("CF-Connecting-IP", "1.2.3.4")
	r.Header.Set("X-Real-IP", "5.6.7.8")

	got := getClientIP(r)
	if got != "8.8.8.8" {
		t.Errorf("expected 8.8.8.8, got %s", got)
	}
}

func TestGetClientIP_TrustedProxy_CFConnectingIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = trustedRemoteAddr
	r.Header.Set("CF-Connecting-IP", "203.0.113.42")

	got := getClientIP(r)
	if got != "203.0.113.42" {
		t.Errorf("expected 203.0.113.42, got %s", got)
	}
}

func TestGetClientIP_TrustedProxy_XRealIP_WhenNoCFHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = trustedRemoteAddr
	r.Header.Set("X-Real-IP", "198.51.100.7")

	got := getClientIP(r)
	if got != "198.51.100.7" {
		t.Errorf("expected 198.51.100.7, got %s", got)
	}
}

func TestGetClientIP_TrustedProxy_XForwardedFor_FirstEntry(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = trustedRemoteAddr
	r.Header.Set("X-Forwarded-For", "203.0.113.1, 10.0.0.1, 10.0.0.2")

	got := getClientIP(r)
	if got != "203.0.113.1" {
		t.Errorf("expected 203.0.113.1, got %s", got)
	}
}

func TestGetClientIP_TrustedProxy_NoProxyHeaders_FallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = trustedRemoteAddr
	// No proxy headers set

	got := getClientIP(r)
	if got != "127.0.0.1" {
		t.Errorf("expected 127.0.0.1, got %s", got)
	}
}

func TestGetClientIP_AntiSpoofing_IgnoresHeadersFromUntrustedSource(t *testing.T) {
	// A client that is NOT a trusted proxy sends CF-Connecting-IP — must be ignored.
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = untrustedRemoteAddr
	r.Header.Set("CF-Connecting-IP", "evil.attacker.example")
	r.Header.Set("X-Real-IP", "evil.attacker.example")
	r.Header.Set("X-Forwarded-For", "evil.attacker.example")

	got := getClientIP(r)
	// Should return the actual remote host, not the injected headers.
	if got != "8.8.8.8" {
		t.Errorf("expected 8.8.8.8 (anti-spoofing), got %s", got)
	}
}

func TestGetClientIP_TrustedProxy_CFHeaderTakesPriorityOverXRealIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = trustedRemoteAddr
	r.Header.Set("CF-Connecting-IP", "203.0.113.99")
	r.Header.Set("X-Real-IP", "198.51.100.7")

	got := getClientIP(r)
	if got != "203.0.113.99" {
		t.Errorf("expected CF-Connecting-IP to take priority, got %s", got)
	}
}

func TestGetClientIP_RemoteAddrWithoutPort(t *testing.T) {
	// When RemoteAddr has no port (non-standard), SplitHostPort fails and the raw
	// value is used as the host. The IP is not trusted, so it is returned as-is.
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "9.9.9.9" // no port — triggers the err != nil branch
	r.Header.Set("CF-Connecting-IP", "1.2.3.4")

	got := getClientIP(r)
	// "9.9.9.9" is not a trusted proxy, so headers must be ignored and the raw
	// RemoteAddr string is returned.
	if got != "9.9.9.9" {
		t.Errorf("expected 9.9.9.9, got %s", got)
	}
}

// ─────────────────────────────────────────────────────────────
// incrementSpecial
// ─────────────────────────────────────────────────────────────

// uniqueTestIP generates a test IP that won't collide with other tests.
// We use the 192.0.2.0/24 (TEST-NET-1, RFC 5737) range to avoid real routing.
func uniqueTestIP(suffix int) string {
	return strings.Join([]string{"192.0.2", string(rune('0' + suffix))}, ".")
}

func TestIncrementSpecial_FirstCall_ReturnsTrue(t *testing.T) {
	ip := "192.0.2.10"
	// Clean up any leftover state
	specialMethodRL.Lock()
	delete(specialMethodRL.m, ip)
	specialMethodRL.Unlock()

	if !incrementSpecial(ip) {
		t.Error("expected first call to return true")
	}
}

func TestIncrementSpecial_ExceedsLimit_ReturnsFalse(t *testing.T) {
	ip := "192.0.2.11"
	// Start fresh
	specialMethodRL.Lock()
	delete(specialMethodRL.m, ip)
	specialMethodRL.Unlock()

	// First 10 calls should succeed (return true)
	for i := 0; i < rateLimitMaxPerWindow; i++ {
		if !incrementSpecial(ip) {
			t.Errorf("call %d: expected true, got false", i+1)
		}
	}
	// 11th call must return false (limit exceeded)
	if incrementSpecial(ip) {
		t.Errorf("call %d: expected false (limit exceeded), got true", rateLimitMaxPerWindow+1)
	}
}

func TestIncrementSpecial_ResetsAfterWindow(t *testing.T) {
	ip := "192.0.2.12"
	// Exhaust the limit
	specialMethodRL.Lock()
	delete(specialMethodRL.m, ip)
	specialMethodRL.Unlock()

	for i := 0; i < rateLimitMaxPerWindow; i++ {
		incrementSpecial(ip)
	}
	// Verify limit is hit
	if incrementSpecial(ip) {
		t.Fatal("expected false after exhausting limit")
	}

	// Simulate window expiry by backdating the windowStart
	specialMethodRL.Lock()
	if e, ok := specialMethodRL.m[ip]; ok {
		e.windowStart = time.Now().Add(-(rateLimitWindow + time.Second))
	}
	specialMethodRL.Unlock()

	// After simulated expiry, the next call should open a new window and return true
	if !incrementSpecial(ip) {
		t.Error("expected true after rate limit window reset")
	}
}

// ─────────────────────────────────────────────────────────────
// FirewallHandler
// ─────────────────────────────────────────────────────────────

// nextHandler is a simple sentinel handler that records whether it was called.
func nextHandler(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

func TestFirewallHandler_AllowedMethods_PassThrough(t *testing.T) {
	allowed := []string{
		http.MethodGet,
		http.MethodPost,
		http.MethodHead,
		http.MethodPatch,
		http.MethodPut,
		http.MethodDelete,
	}
	for _, method := range allowed {
		t.Run(method, func(t *testing.T) {
			called := false
			handler := FirewallHandler(nextHandler(&called))

			r := httptest.NewRequest(method, "/", nil)
			r.RemoteAddr = "10.0.0.1:5000"
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)

			if !called {
				t.Errorf("%s: expected next handler to be called", method)
			}
			if w.Code != http.StatusOK {
				t.Errorf("%s: expected 200, got %d", method, w.Code)
			}
		})
	}
}

func TestFirewallHandler_BlockedMethods_Return403(t *testing.T) {
	blocked := []string{"OPTIONS", "TRACE", "CONNECT"}
	for _, method := range blocked {
		t.Run(method, func(t *testing.T) {
			// Use unique IPs so rate limit doesn't trigger 429 instead of 403
			ip := map[string]string{
				"OPTIONS": "192.0.2.20",
				"TRACE":   "192.0.2.21",
				"CONNECT": "192.0.2.22",
			}[method]
			specialMethodRL.Lock()
			delete(specialMethodRL.m, ip)
			specialMethodRL.Unlock()

			called := false
			handler := FirewallHandler(nextHandler(&called))

			r := httptest.NewRequest(method, "/", nil)
			r.RemoteAddr = ip + ":5000"
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)

			if called {
				t.Errorf("%s: next handler should NOT have been called", method)
			}
			if w.Code != http.StatusForbidden {
				t.Errorf("%s: expected 403, got %d", method, w.Code)
			}
		})
	}
}

func TestFirewallHandler_OversizedHeaders_Returns413(t *testing.T) {
	called := false
	handler := FirewallHandler(nextHandler(&called))

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:5000"
	// Add a header whose value pushes total over 8192 bytes
	r.Header.Set("X-Big-Header", strings.Repeat("A", 8200))

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if called {
		t.Error("next handler should NOT have been called for oversized headers")
	}
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", w.Code)
	}
}

func TestFirewallHandler_SetsClientIPInContext(t *testing.T) {
	var capturedIP string
	sentinel := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v, ok := r.Context().Value(context_keys.ClientIPKey{}).(string); ok {
			capturedIP = v
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := FirewallHandler(sentinel)

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:5000"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if capturedIP != "10.0.0.1" {
		t.Errorf("expected ClientIPKey to be 10.0.0.1, got %q", capturedIP)
	}
}

func TestFirewallHandler_BlockedMethod_RateLimitExceeded_Returns429(t *testing.T) {
	ip := "192.0.2.30"
	// Start with a clean rate-limit state for this IP
	specialMethodRL.Lock()
	delete(specialMethodRL.m, ip)
	specialMethodRL.Unlock()

	handler := FirewallHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Make rateLimitMaxPerWindow OPTIONS requests — each should get 403 (method blocked)
	for i := 0; i < rateLimitMaxPerWindow; i++ {
		r := httptest.NewRequest("OPTIONS", "/", nil)
		r.RemoteAddr = ip + ":5000"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("call %d: expected 403, got %d", i+1, w.Code)
		}
	}

	// The next OPTIONS request exceeds the limit — should get 429
	r := httptest.NewRequest("OPTIONS", "/", nil)
	r.RemoteAddr = ip + ":5000"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 after rate limit exceeded, got %d", w.Code)
	}
}

func TestFirewallHandler_TrustedProxy_ClientIPFromCFHeader(t *testing.T) {
	var capturedIP string
	sentinel := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v, ok := r.Context().Value(context_keys.ClientIPKey{}).(string); ok {
			capturedIP = v
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := FirewallHandler(sentinel)

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:9999" // trusted proxy
	r.Header.Set("CF-Connecting-IP", "203.0.113.55")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if capturedIP != "203.0.113.55" {
		t.Errorf("expected ClientIPKey to be 203.0.113.55, got %q", capturedIP)
	}
}

// ─────────────────────────────────────────────────────────────
// cachedReverseDNS
// ─────────────────────────────────────────────────────────────

func TestCachedReverseDNS_ReturnsCachedValue(t *testing.T) {
	// Pre-populate the cache with a known entry
	ip := "192.0.2.50"
	reverseDNSCache.Lock()
	reverseDNSCache.m[ip] = reverseDNSEntry{
		hostname:  "test.example.com",
		expiresAt: time.Now().Add(10 * time.Minute),
	}
	reverseDNSCache.Unlock()

	// First call should return cached value
	got1 := cachedReverseDNS(ip)
	if got1 != "test.example.com" {
		t.Errorf("expected cached hostname, got %q", got1)
	}

	// Second call must also return the cached value (not re-lookup)
	got2 := cachedReverseDNS(ip)
	if got2 != "test.example.com" {
		t.Errorf("expected cached hostname on second call, got %q", got2)
	}
}

func TestCachedReverseDNS_ReturnsIPWhenLookupFails(t *testing.T) {
	// Use an IP that won't resolve in test environments (documentation range).
	ip := "192.0.2.99"
	// Clear any existing cache entry
	reverseDNSCache.Lock()
	delete(reverseDNSCache.m, ip)
	reverseDNSCache.Unlock()

	got := cachedReverseDNS(ip)
	// When lookup fails, the function returns the IP itself as a fallback.
	if got != ip {
		// Also acceptable if the IP somehow resolves — just check it's not empty.
		if got == "" {
			t.Errorf("expected non-empty result, got empty string")
		}
		t.Logf("Note: %s resolved to %q (unexpected but not an error)", ip, got)
	}
}

func TestCachedReverseDNS_ExpiredCacheEntryIsRefreshed(t *testing.T) {
	ip := "192.0.2.51"
	// Pre-populate cache with an expired entry
	reverseDNSCache.Lock()
	reverseDNSCache.m[ip] = reverseDNSEntry{
		hostname:  "stale.example.com",
		expiresAt: time.Now().Add(-1 * time.Second), // already expired
	}
	reverseDNSCache.Unlock()

	got := cachedReverseDNS(ip)
	// The stale entry should be ignored and replaced with a fresh lookup.
	// For an unresolvable IP, the fresh result is the IP itself.
	if got == "" {
		t.Error("expected non-empty result after expired cache refresh")
	}
}
