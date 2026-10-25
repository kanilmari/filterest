// storage_binding.go
// Removes unbound signed-in identities on every storage path, including public logos.
// Bridges StorageProfile to the same anonymous fallback used by the storage actor.
// Later stages see anonymous state; a bounded server-only trace records downgrades.
package pipeline

import (
	"log"
	"net/http"
	"sync"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
)

const (
	storageBindingTraceInterval = time.Minute
	storageBindingTraceMaxUsers = 1024
)

// Keep live entries until expiry: evicting one could let the same user log
// again within the interval. Saturation instead suppresses new users' traces.
type storageBindingTraceLimiter struct {
	mu          sync.Mutex
	expires     map[int]time.Time
	nextCleanup time.Time
}

var storageBindingTrace = &storageBindingTraceLimiter{}

func (limiter *storageBindingTraceLimiter) allow(userID int, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if expiry, exists := limiter.expires[userID]; exists && now.Before(expiry) {
		return false
	}
	if !now.Before(limiter.nextCleanup) || len(limiter.expires) >= storageBindingTraceMaxUsers {
		for id, expiry := range limiter.expires {
			if !now.Before(expiry) {
				delete(limiter.expires, id)
			}
		}
		limiter.nextCleanup = now.Add(storageBindingTraceInterval)
	}
	if len(limiter.expires) >= storageBindingTraceMaxUsers {
		return false
	}
	if limiter.expires == nil {
		limiter.expires = make(map[int]time.Time)
	}
	limiter.expires[userID] = now.Add(storageBindingTraceInterval)
	return true
}

func withStorageBinding(next http.HandlerFunc, _ RouteContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if e_sessions.Store != nil {
			// Decode only: no cookie writes, policy reads or authentication checks
			// may distinguish an unbound signed-in request from an anonymous one.
			if session, err := e_sessions.Load(r); err == nil {
				userID, _ := session.Values["user_id"].(int) // read first: the downgrade empties the session in place
				if downgraded := e_sessions.AnonymizeUnboundSession(r, session); downgraded != r {
					// Server-side trace only (a binding-less sign-in cookie may be a stolen one); the
					// response stays byte-equal to an anonymous request's.
					if storageBindingTrace.allow(userID, time.Now()) {
						log.Printf("[storage_binding] sign-in without its browser binding treated as anonymous for user_id=%d", userID)
					}
					r = downgraded
				}
			}
		}
		next(w, r)
	}
}
