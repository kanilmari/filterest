// first_run_attempt_checker.go
// Limits rejected setup codes per client and all submissions across the process.
// Connects the firewall's client identity to an atomic code check and back-off.
// Keeps setup protection independent of login quotas and development bypasses.
package auth

import (
	"easelect/backend/core_components/logging"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"
)

const (
	firstRunIPFailures     = 5
	firstRunGlobalAttempts = 30
	firstRunFailureWindow  = 15 * time.Minute
	firstRunInitialBackoff = 30 * time.Second
	firstRunMaximumBackoff = 15 * time.Minute
)

type firstRunFailureBucket struct {
	failures                 int
	backoff                  time.Duration
	lastFailure, lockedUntil time.Time
}

type firstRunAttemptLimiter struct {
	sync.Mutex
	clients map[string]*firstRunFailureBucket
	global  firstRunFailureBucket
	now     func() time.Time
}

var firstRunAttempts = newFirstRunAttemptLimiter()

func newFirstRunAttemptLimiter() *firstRunAttemptLimiter {
	return &firstRunAttemptLimiter{clients: make(map[string]*firstRunFailureBucket), now: time.Now}
}

// check serializes checking both quotas and recording a failure, so concurrent
// requests cannot race past either limit. Blocked requests never prolong a lock.
func (limiter *firstRunAttemptLimiter) check(r *http.Request) (bool, time.Duration) {
	limiter.Lock()
	defer limiter.Unlock()
	now := limiter.now()
	ip := "unknown"
	if address, err := netip.ParseAddr(getClientIP(r)); err == nil {
		ip = address.Unmap().String()
	}
	for client, bucket := range limiter.clients {
		if now.Sub(bucket.lastFailure) >= firstRunFailureWindow && !now.Before(bucket.lockedUntil) {
			delete(limiter.clients, client)
		}
	}
	if now.Sub(limiter.global.lastFailure) >= firstRunFailureWindow && !now.Before(limiter.global.lockedUntil) {
		limiter.global = firstRunFailureBucket{}
	}
	bucket := limiter.clients[ip]
	until := limiter.global.lockedUntil
	if bucket != nil && bucket.lockedUntil.After(until) {
		until = bucket.lockedUntil
	}
	if now.Before(until) {
		return false, until.Sub(now)
	}
	allowed := firstRunAccessAllowed(r)
	if bucket == nil {
		bucket = &firstRunFailureBucket{}
		limiter.clients[ip] = bucket
	}
	for _, item := range []struct {
		bucket    *firstRunFailureBucket
		threshold int
		scope     string
	}{{bucket, firstRunIPFailures, "client"}, {&limiter.global, firstRunGlobalAttempts, "global"}} {
		// The global resource cap counts every POST, including valid-code
		// validation retries. Client back-off counts rejected codes only.
		if allowed && item.scope == "client" {
			continue
		}
		item.bucket.failures++
		item.bucket.lastFailure = now
		if item.bucket.failures >= item.threshold {
			item.bucket.failures = 0
			item.bucket.backoff = min(max(item.bucket.backoff*2, firstRunInitialBackoff), firstRunMaximumBackoff)
			item.bucket.lockedUntil = now.Add(item.bucket.backoff)
			logging.Warnf("First-run setup lockout: ip=%s scope=%s backoff=%s", ip, item.scope, item.bucket.backoff)
		}
	}
	return allowed, 0
}

func requireFirstRunCode(w http.ResponseWriter, r *http.Request) bool {
	// Retain the existing request quota as well as setup-specific lockouts.
	// Already-locked requests must not allocate another login-quota IP bucket.
	allowed, retry := firstRunAttempts.check(r)
	if retry == 0 && checkLoginRateLimit(getClientIP(r)) {
		retry = loginRateLimitWindow
	}
	if retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int((retry+time.Second-1)/time.Second)))
		http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
		return false
	}
	if !allowed {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	}
	return allowed
}
