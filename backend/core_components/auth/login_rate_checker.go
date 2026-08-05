// login_rate_checker.go
// Provides IP-based rate limiting for login attempts within a sliding window.
// Bridges client IP extraction and the login handlers that check attempt thresholds.
// Exists to prevent brute-force login attacks by tracking per-IP attempt counts.
package auth

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"easelect/backend/core_components/context_keys"
)

// authRateLimiter tracks login attempt counts per IP to prevent brute-force attacks.
var authRateLimiter = struct {
	sync.Mutex
	attempts map[string]*loginAttempt
}{attempts: make(map[string]*loginAttempt)}

type loginReverseDNSEntry struct {
	hostname  string
	expiresAt time.Time
}

var loginReverseDNSCache = struct {
	sync.RWMutex
	entries map[string]loginReverseDNSEntry
}{entries: make(map[string]loginReverseDNSEntry)}

var resolveLoginHostname = lookupHostname

type loginAttempt struct {
	count       int
	windowStart time.Time
}

const (
	loginRateLimitWindow      = 15 * time.Minute
	loginRateLimitMax         = 10 // max login attempts per IP per window
	loginRateLimitHeader      = "X-Dev-RateLimit-Would-Exceed"
	loginReverseDNSCacheTTL   = 10 * time.Minute
	loginReverseDNSLookupWait = 500 * time.Millisecond
)

const loginRateLimitErrorMessage = "Too many login attempts. Please try again later."

// checkLoginRateLimit returns true if the IP has exceeded the rate limit.
func checkLoginRateLimit(ip string) bool {
	authRateLimiter.Lock()
	defer authRateLimiter.Unlock()

	now := time.Now()
	entry, exists := authRateLimiter.attempts[ip]
	if !exists || now.Sub(entry.windowStart) > loginRateLimitWindow {
		authRateLimiter.attempts[ip] = &loginAttempt{count: 1, windowStart: now}
		return false
	}
	entry.count++
	return entry.count > loginRateLimitMax
}

// shouldBlockLoginAttempt returns true when login rate limiting should hard-block the request.
// In dev, the limiter is downgraded to a warning so local tooling does not get stuck behind 429s.
func shouldBlockLoginAttempt(w http.ResponseWriter, r *http.Request) bool {
	if os.Getenv("ENVIRONMENT_TYPE") == "dev" && r.Header.Get("X-Bypass-Ratelimit") == "test-mode" {
		return false
	}

	clientIP := getClientIP(r)
	if !checkLoginRateLimit(clientIP) {
		return false
	}

	if os.Getenv("ENVIRONMENT_TYPE") == "dev" {
		w.Header().Set(loginRateLimitHeader, "true")
		log.Printf("\033[33mwarning: login rate limit would have blocked ip=%s outside dev\033[0m", clientIP)
		return false
	}

	return true
}

// getClientIP extracts the client IP address from the trusted firewall context.
// It falls back to RemoteAddr for tests and non-standard middleware order.
func getClientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(context_keys.ClientIPKey{}).(string); ok && ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr // fallback
	}
	return host
}

// getCachedLoginHostname returns the cached reverse-DNS result for login logging.
// It bridges the login request path and the background resolver cache.
// It exists so login handlers can log hostnames without blocking on DNS.
func getCachedLoginHostname(ip string) (string, bool) {
	loginReverseDNSCache.RLock()
	entry, ok := loginReverseDNSCache.entries[ip]
	loginReverseDNSCache.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return "", false
	}
	return entry.hostname, true
}

// cacheLoginHostname refreshes the login reverse-DNS cache in the background.
// It bridges IP logging and the bounded resolver lookup used outside request flow.
// It exists to keep legacy login diagnostics useful without request-path DNS waits.
func cacheLoginHostname(ip string) {
	hostname := resolveLoginHostname(ip)

	loginReverseDNSCache.Lock()
	loginReverseDNSCache.entries[ip] = loginReverseDNSEntry{
		hostname:  hostname,
		expiresAt: time.Now().Add(loginReverseDNSCacheTTL),
	}
	loginReverseDNSCache.Unlock()
}

// logLoginAttemptDomain logs the current login IP and starts reverse DNS asynchronously on cache miss.
// It bridges legacy login handling and reverse-DNS diagnostics.
// It exists to avoid synchronous DNS latency while preserving domain information when cached.
func logLoginAttemptDomain(ip string) {
	if hostname, ok := getCachedLoginHostname(ip); ok {
		if hostname != "" {
			log.Printf("login attempt IP=%s, domain=%s 🌐", ip, hostname)
			return
		}
		log.Printf("login attempt IP=%s (domain not found) 🌐", ip)
		return
	}

	log.Printf("login attempt IP=%s (domain lookup pending) 🌐", ip)
	go cacheLoginHostname(ip)
}

// lookupHostname performs a bounded reverse DNS lookup for background cache refresh.
// It bridges the asynchronous login resolver worker and net.DefaultResolver.
// It exists to keep the only DNS wait outside the HTTP request path.
func lookupHostname(ip string) string {
	ctx, cancel := context.WithTimeout(context.Background(), loginReverseDNSLookupWait)
	defer cancel()

	names, err := net.DefaultResolver.LookupAddr(ctx, ip)
	if err == nil && len(names) > 0 {
		return strings.TrimSuffix(names[0], ".")
	}
	return ""
}
