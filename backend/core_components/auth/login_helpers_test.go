// login_helpers_test.go
// Table-driven unit tests for checkLoginRateLimit, getClientIP, login DNS logging, and respondJSON.
// Between login_rate_checker.go and login_credential_handler.go helper functions.
// Exists to verify auth helper logic without DB or network dependencies.
package auth

import (
	"context"
	"easelect/backend/core_components/context_keys"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// resetRateLimiter clears the global authRateLimiter map between tests.
func resetRateLimiter() {
	authRateLimiter.Lock()
	authRateLimiter.attempts = make(map[string]*loginAttempt)
	authRateLimiter.Unlock()
}

// resetLoginReverseDNSCache clears cached login hostname lookups between tests.
func resetLoginReverseDNSCache() {
	loginReverseDNSCache.Lock()
	loginReverseDNSCache.entries = make(map[string]loginReverseDNSEntry)
	loginReverseDNSCache.Unlock()
}

// ── checkLoginRateLimit ───────────────────────────────────────────────────────

func TestCheckLoginRateLimit(t *testing.T) {
	t.Run("first attempt is allowed", func(t *testing.T) {
		resetRateLimiter()
		blocked := checkLoginRateLimit("10.0.0.1")
		if blocked {
			t.Error("first attempt should not be blocked")
		}
	})

	t.Run("attempts up to limit are allowed", func(t *testing.T) {
		resetRateLimiter()
		ip := "10.0.0.2"
		// loginRateLimitMax == 10; attempts 1..10 should all return false
		for i := 1; i <= loginRateLimitMax; i++ {
			blocked := checkLoginRateLimit(ip)
			if blocked {
				t.Errorf("attempt %d should not be blocked (limit is %d)", i, loginRateLimitMax)
			}
		}
	})

	t.Run("attempt exceeding limit is blocked", func(t *testing.T) {
		resetRateLimiter()
		ip := "10.0.0.3"
		for i := 0; i < loginRateLimitMax; i++ {
			checkLoginRateLimit(ip)
		}
		// 11th attempt must be blocked
		blocked := checkLoginRateLimit(ip)
		if !blocked {
			t.Errorf("attempt %d should be blocked", loginRateLimitMax+1)
		}
	})

	t.Run("different IPs are tracked independently", func(t *testing.T) {
		resetRateLimiter()
		ipA := "10.1.0.1"
		ipB := "10.1.0.2"

		// Exhaust ipA
		for i := 0; i <= loginRateLimitMax; i++ {
			checkLoginRateLimit(ipA)
		}
		// ipA must be blocked
		if !checkLoginRateLimit(ipA) {
			t.Error("ipA should be blocked after exceeding limit")
		}
		// ipB must still be allowed
		if checkLoginRateLimit(ipB) {
			t.Error("ipB should not be blocked (independent tracking)")
		}
	})

	t.Run("expired window resets counter and allows attempt", func(t *testing.T) {
		resetRateLimiter()
		ip := "10.0.0.4"

		// Exhaust the limit
		for i := 0; i <= loginRateLimitMax; i++ {
			checkLoginRateLimit(ip)
		}

		// Manually backdate the window start so it appears expired
		authRateLimiter.Lock()
		authRateLimiter.attempts[ip].windowStart = time.Now().Add(-(loginRateLimitWindow + time.Second))
		authRateLimiter.Unlock()

		// First call after expiry should reset and be allowed
		blocked := checkLoginRateLimit(ip)
		if blocked {
			t.Error("first attempt after window expiry should not be blocked")
		}
	})

	t.Run("boundary: exactly at max is not blocked, one over is", func(t *testing.T) {
		resetRateLimiter()
		ip := "10.0.0.5"
		var last bool
		for i := 1; i <= loginRateLimitMax; i++ {
			last = checkLoginRateLimit(ip)
		}
		if last {
			t.Errorf("attempt %d (== max) should not be blocked", loginRateLimitMax)
		}
		over := checkLoginRateLimit(ip)
		if !over {
			t.Errorf("attempt %d (> max) should be blocked", loginRateLimitMax+1)
		}
	})
}

func TestShouldBlockLoginAttempt(t *testing.T) {
	t.Run("production blocks exceeded rate limit", func(t *testing.T) {
		resetRateLimiter()
		ip := "10.2.0.1"
		for i := 0; i < loginRateLimitMax; i++ {
			checkLoginRateLimit(ip)
		}

		req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
		req.RemoteAddr = ip + ":1234"
		rr := httptest.NewRecorder()

		if !shouldBlockLoginAttempt(rr, req) {
			t.Fatal("expected rate limit to block request outside dev")
		}
		if got := rr.Header().Get(loginRateLimitHeader); got != "" {
			t.Fatalf("unexpected dev warning header: %q", got)
		}
	})

	t.Run("dev warns instead of blocking", func(t *testing.T) {
		t.Setenv("ENVIRONMENT_TYPE", "dev")
		resetRateLimiter()
		ip := "10.2.0.2"
		for i := 0; i < loginRateLimitMax; i++ {
			checkLoginRateLimit(ip)
		}

		req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
		req.RemoteAddr = ip + ":1234"
		rr := httptest.NewRecorder()

		if shouldBlockLoginAttempt(rr, req) {
			t.Fatal("dev should not hard-block exceeded login rate limit")
		}
		if got := rr.Header().Get(loginRateLimitHeader); got != "true" {
			t.Fatalf("warning header = %q, want true", got)
		}
	})

	t.Run("dev bypass header still short-circuits limiter", func(t *testing.T) {
		t.Setenv("ENVIRONMENT_TYPE", "dev")
		resetRateLimiter()
		ip := "10.2.0.3"
		for i := 0; i < loginRateLimitMax+5; i++ {
			checkLoginRateLimit(ip)
		}

		req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
		req.RemoteAddr = ip + ":1234"
		req.Header.Set("X-Bypass-Ratelimit", "test-mode")
		rr := httptest.NewRecorder()

		if shouldBlockLoginAttempt(rr, req) {
			t.Fatal("dev bypass header should skip rate limit blocking")
		}
		if got := rr.Header().Get(loginRateLimitHeader); got != "" {
			t.Fatalf("warning header = %q, want empty", got)
		}
	})
}

// ── getClientIP ───────────────────────────────────────────────────────────────

type getClientIPCase struct {
	name          string
	contextIP     string
	xForwardedFor string
	xRealIP       string
	remoteAddr    string
	want          string
}

func TestGetClientIP(t *testing.T) {
	tests := []getClientIPCase{
		{
			name:          "context IP wins over spoofable headers",
			contextIP:     "203.0.113.10",
			xForwardedFor: "1.2.3.4",
			xRealIP:       "5.5.5.5",
			remoteAddr:    "9.9.9.9:1234",
			want:          "203.0.113.10",
		},
		{
			name:          "X-Forwarded-For is ignored without firewall context",
			xForwardedFor: "1.2.3.4, 5.6.7.8, 9.10.11.12",
			remoteAddr:    "9.9.9.9:1234",
			want:          "9.9.9.9",
		},
		{
			name:       "X-Real-IP is ignored without firewall context",
			xRealIP:    "5.5.5.5",
			remoteAddr: "9.9.9.9:1234",
			want:       "9.9.9.9",
		},
		{
			name:       "fallback to RemoteAddr host",
			remoteAddr: "192.168.1.1:8080",
			want:       "192.168.1.1",
		},
		{
			name:       "RemoteAddr without port — returned as-is",
			remoteAddr: "192.168.1.99", // no port → SplitHostPort fails
			want:       "192.168.1.99",
		},
		{
			name:          "spoofed proxy headers do not change fallback RemoteAddr",
			xForwardedFor: "3.3.3.3",
			xRealIP:       "4.4.4.4",
			remoteAddr:    "9.9.9.9:1234",
			want:          "9.9.9.9",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.xForwardedFor != "" {
				req.Header.Set("X-Forwarded-For", tc.xForwardedFor)
			}
			if tc.xRealIP != "" {
				req.Header.Set("X-Real-IP", tc.xRealIP)
			}
			if tc.contextIP != "" {
				req = req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, tc.contextIP))
			}
			got := getClientIP(req)
			if got != tc.want {
				t.Errorf("getClientIP() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLogLoginAttemptDomainDoesNotWaitForReverseDNS(t *testing.T) {
	resetLoginReverseDNSCache()
	ip := "203.0.113.10"

	started := make(chan struct{})
	release := make(chan struct{})
	originalResolver := resolveLoginHostname
	resolveLoginHostname = func(gotIP string) string {
		if gotIP != ip {
			t.Errorf("resolver ip = %q, want %q", gotIP, ip)
		}
		close(started)
		<-release
		return "login.example.test"
	}
	defer func() {
		resolveLoginHostname = originalResolver
	}()

	start := time.Now()
	logLoginAttemptDomain(ip)
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		close(release)
		t.Fatalf("logLoginAttemptDomain waited %s for reverse DNS", elapsed)
	}

	select {
	case <-started:
	case <-time.After(250 * time.Millisecond):
		close(release)
		t.Fatal("reverse DNS lookup was not started asynchronously")
	}

	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		hostname, ok := getCachedLoginHostname(ip)
		if ok && hostname == "login.example.test" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("cached hostname not refreshed; got %q cached=%v", hostname, ok)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// ── maskEmail ─────────────────────────────────────────────────────────────────

type maskEmailCase struct {
	name  string
	input string
	want  string
}

func TestMaskEmail(t *testing.T) {
	tests := []maskEmailCase{
		{
			name:  "typical email",
			input: "user@example.com",
			want:  "u***@e***.com",
		},
		{
			name:  "single-char local part — not truncated further",
			input: "a@example.com",
			want:  "a@e***.com",
		},
		{
			name:  "long local part",
			input: "longusername@example.com",
			want:  "l***@e***.com",
		},
		{
			name:  "no @ sign",
			input: "notanemail",
			want:  "***",
		},
		{
			name:  "empty string",
			input: "",
			want:  "***",
		},
		{
			name:  "domain with no dot — domain returned as-is after first char",
			input: "user@localhost",
			// dotIdx == -1 → condition dotIdx > 1 is false → domain unchanged
			want: "u***@localhost",
		},
		{
			name:  "dot at index 0 — not masked (dotIdx not > 1)",
			input: "u@.com",
			// dotIdx == 0, not > 1
			want: "u@.com",
		},
		{
			name:  "dot at index 1 — not masked (dotIdx not > 1)",
			input: "u@a.b",
			// dotIdx == 1, not > 1
			want: "u@a.b",
		},
		{
			name:  "subdomain email",
			input: "user@mail.example.com",
			// domain = "mail.example.com", LastIndex('.') = 11 → m***+.com
			want: "u***@m***.com",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := maskEmail(tc.input)
			if got != tc.want {
				t.Errorf("maskEmail(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// ── respondJSON ───────────────────────────────────────────────────────────────

type respondJSONCase struct {
	name       string
	status     int
	data       map[string]interface{}
	wantStatus int
	wantKeys   []string // keys that must appear in parsed JSON
}

func TestRespondJSON(t *testing.T) {
	tests := []respondJSONCase{
		{
			name:       "200 OK with payload",
			status:     http.StatusOK,
			data:       map[string]interface{}{"authenticated": true, "redirect": "/"},
			wantStatus: http.StatusOK,
			wantKeys:   []string{"authenticated", "redirect"},
		},
		{
			name:       "403 Forbidden",
			status:     http.StatusForbidden,
			data:       map[string]interface{}{"error": "csrf_token_invalid"},
			wantStatus: http.StatusForbidden,
			wantKeys:   []string{"error"},
		},
		{
			name:       "429 Too Many Requests",
			status:     http.StatusTooManyRequests,
			data:       map[string]interface{}{"error": "Too many login attempts. Please try again later."},
			wantStatus: http.StatusTooManyRequests,
			wantKeys:   []string{"error"},
		},
		{
			name:       "500 Internal Server Error",
			status:     http.StatusInternalServerError,
			data:       map[string]interface{}{"error": "session_error"},
			wantStatus: http.StatusInternalServerError,
			wantKeys:   []string{"error"},
		},
		{
			name:       "empty data map",
			status:     http.StatusOK,
			data:       map[string]interface{}{},
			wantStatus: http.StatusOK,
			wantKeys:   []string{},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			respondJSON(rr, tc.status, tc.data)

			// Status code
			if rr.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d", rr.Code, tc.wantStatus)
			}

			// Content-Type
			ct := rr.Header().Get("Content-Type")
			if !strings.HasPrefix(ct, "application/json") {
				t.Errorf("Content-Type: got %q, want application/json", ct)
			}

			// Valid JSON body
			var parsed map[string]interface{}
			if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
				t.Fatalf("body is not valid JSON: %v — body: %s", err, rr.Body.String())
			}

			// Required keys present
			for _, key := range tc.wantKeys {
				if _, ok := parsed[key]; !ok {
					t.Errorf("response JSON missing key %q; body: %s", key, rr.Body.String())
				}
			}
		})
	}
}

// ── checkLoginRateLimit concurrent safety ────────────────────────────────────

func TestCheckLoginRateLimit_Concurrent(t *testing.T) {
	resetRateLimiter()

	const goroutines = 20
	results := make(chan bool, goroutines)

	for i := 0; i < goroutines; i++ {
		ip := fmt.Sprintf("10.2.0.%d", i)
		go func(addr string) {
			// Each goroutine uses its own IP so results are independent
			results <- checkLoginRateLimit(addr)
		}(ip)
	}

	for i := 0; i < goroutines; i++ {
		blocked := <-results
		if blocked {
			t.Errorf("first attempt for unique IP should never be blocked")
		}
	}
}
