// rate_limiting.go
// Pipeline stage that enforces per-IP rate limits on incoming requests.
// Bridges incoming request IPs and the in-memory rate counter.
// Exists to reject requests that exceed the configured per-IP threshold.
package rate_limiting

import (
	"database/sql"
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// devRateLimitingOff is set once at startup via InitDevRateLimitingFlag().
// When true AND ENVIRONMENT_TYPE=dev, all rate limiting is skipped.
var devRateLimitingOff bool

// Rate limit cache entry
type rateLimitCache struct {
	amount   int
	minutes  int
	cachedAt time.Time
}

// Cache for rate limits: map[functionName] = rateLimitCache
var (
	rateLimitCacheMap = make(map[string]*rateLimitCache)
	rateLimitCacheMu  sync.RWMutex
	cacheTTL          = 5 * time.Minute // Cache rate limits for 5 minutes
)

// Request tracking for rate limiting: map[ "handlerName|ip" ] = []time.Time
var (
	functionRequests = make(map[string][]time.Time)
	functionReqMu    sync.Mutex
)

// Periodic cleanup of old request tracking entries
func cleanupOldRequests() {
	for {
		time.Sleep(10 * time.Minute) // Clean up every 10 minutes
		functionReqMu.Lock()
		now := time.Now()
		for key, times := range functionRequests {
			// Find the oldest time in the slice to determine if we can remove the whole entry
			if len(times) > 0 {
				// Assume times are sorted, check if the oldest is older than 24 hours
				if now.Sub(times[0]) > 24*time.Hour {
					delete(functionRequests, key)
				}
			}
		}
		functionReqMu.Unlock()
	}
}

// getCachedRateLimit retrieves rate limit from cache or DB
func getCachedRateLimit(db *sql.DB, funcName string) (int, int, error) {
	rateLimitCacheMu.RLock()
	if entry, exists := rateLimitCacheMap[funcName]; exists {
		if time.Since(entry.cachedAt) < cacheTTL {
			rateLimitCacheMu.RUnlock()
			return entry.amount, entry.minutes, nil
		}
	}
	rateLimitCacheMu.RUnlock()

	// Cache miss or expired, query DB
	var amount, minutes int
	err := db.QueryRow(`
		SELECT rate_limit_amount, rate_limit_minutes
		FROM system_functions
		WHERE name = $1
		LIMIT 1
	`, funcName).Scan(&amount, &minutes)

	if err != nil {
		return 0, 0, err
	}

	// Cache the result
	rateLimitCacheMu.Lock()
	rateLimitCacheMap[funcName] = &rateLimitCache{
		amount:   amount,
		minutes:  minutes,
		cachedAt: time.Now(),
	}
	rateLimitCacheMu.Unlock()

	return amount, minutes, nil
}

// Clean up expired cache entries periodically
func cleanupExpiredCache() {
	for {
		time.Sleep(cacheTTL)
		rateLimitCacheMu.Lock()
		now := time.Now()
		for funcName, entry := range rateLimitCacheMap {
			if now.Sub(entry.cachedAt) >= cacheTTL {
				delete(rateLimitCacheMap, funcName)
			}
		}
		rateLimitCacheMu.Unlock()
	}
}

// Initialize cleanup goroutines
func init() {
	go cleanupExpiredCache()
	go cleanupOldRequests()
}

// InitDevRateLimitingFlag reads the dev_rate_limiting_off flag from system_config
// and caches it for the lifetime of the process. Call once at startup after DB is ready.
// Only has effect when ENVIRONMENT_TYPE=dev.
func InitDevRateLimitingFlag(db *sql.DB) {
	if os.Getenv("ENVIRONMENT_TYPE") != "dev" {
		return
	}
	var val bool
	err := db.QueryRow(`SELECT boolean_value FROM system_config WHERE key = 'dev_rate_limiting_off'`).Scan(&val)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("\033[31merror: reading dev_rate_limiting_off from system_config: %v\033[0m", err)
		}
		return
	}
	devRateLimitingOff = val
	if val {
		log.Println("Rate limiting disabled in dev mode (dev_rate_limiting_off = true)")
	}
}

// rateLimitHTML is a minimal self-contained HTML page shown to browsers
// when the page-level request itself is rate-limited (Accept: text/html).
// API/XHR calls still receive the JSON error via httpresponse.RespondWithError.
const rateLimitHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Too Many Requests</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
  .card { text-align: center; padding: 2rem 3rem; background: #fff;
          border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); max-width: 420px; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p  { margin: .5rem 0; color: #666; }
  .retry { margin-top: 1.5rem; }
  .retry button { padding: .5rem 1.5rem; font-size: 1rem; cursor: pointer;
                  border: 1px solid #ccc; border-radius: 4px; background: #fff; }
  .retry button:hover { background: #f0f0f0; }
</style>
</head>
<body>
<div class="card">
  <h1>Too Many Requests</h1>
  <p>You are sending requests too quickly. Please wait a moment and try again.</p>
  <div class="retry"><button onclick="location.reload()">Try again</button></div>
</div>
</body>
</html>`

// noRateLimitFunctions lists functions that should NEVER be rate limited.
// These are critical recovery endpoints and public static assets that must
// remain accessible even when the user has exhausted an API request quota.
var noRateLimitFunctions = map[string]bool{
	"e_sessions.ResetSessionHandler": true,
	"auth.LogoutHandler":             true,
	"router.handleFrontend":          true,
}

// WithFunctionRateLimiting hakee funktiolta rate_limit_amount, rate_limit_minutes
// ja estää pyynnön, jos raja ylittyy. Käyttää (IP + funktioNimi)-avainta.
// Optimized with caching to avoid DB queries on every request.
func WithFunctionRateLimiting(db *sql.DB, funcName string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		// Skip rate limiting for critical recovery endpoints
		if noRateLimitFunctions[funcName] {
			next.ServeHTTP(w, r)
			return
		}

		// Dev environment: skip all rate limiting when system_config flag is set.
		// This is checked before the per-request header bypass so it's zero-overhead.
		if devRateLimitingOff {
			next.ServeHTTP(w, r)
			return
		}

		// In dev environment, allow bypass via header (for E2E test suites).
		// The header value must match to prevent accidental use.
		if os.Getenv("ENVIRONMENT_TYPE") == "dev" && r.Header.Get("X-Bypass-Ratelimit") == "test-mode" {
			next.ServeHTTP(w, r)
			return
		}

		// Admin users are exempt from per-route rate limits — they manage the system
		// and batch operations (e.g. bulk table drops during test cleanup) must not
		// be throttled.  Regular and guest users remain limited.
		if session, err := e_sessions.GetOrCreateSession(nil, r); err == nil {
			if role, _ := session.Values["user_role"].(string); role == "admin" {
				next.ServeHTTP(w, r)
				return
			}
		}

		// Haetaan välimuistista tai tietokannasta rajoitukset:
		rateLimitAmount, rateLimitMinutes, err := getCachedRateLimit(db, funcName)
		if err != nil {
			// Jos ei riviä (sql.ErrNoRows) tai virhe => ohitetaan rate-limitti
			if err.Error() != "sql: no rows in result set" {
				// Lokitetaan mahdollinen virhe
				log.Printf("\033[31merror: rate limit fetch for function='%s': %v\033[0m\n", funcName, err)
			}
			next.ServeHTTP(w, r)
			return
		}

		// Jos taulussa on nolla-arvoja, ohitetaan rajoitus
		if rateLimitAmount <= 0 || rateLimitMinutes <= 0 {
			next.ServeHTTP(w, r)
			return
		}

		// Selvitetään kutsujan IP — luetaan firewall-middlewaren injektoima arvo
		// (proxy-headereista johdettu), jotta jokainen käyttäjä saa oman laskurinsa.
		// Fallback r.RemoteAddr:iin, jos kontekstiarvo puuttuu (esim. testeissä).
		var clientIP string
		if ip, ok := r.Context().Value(context_keys.ClientIPKey{}).(string); ok && ip != "" {
			clientIP = ip
		} else {
			clientIP, _, _ = net.SplitHostPort(r.RemoteAddr)
			if clientIP == "" {
				clientIP = r.RemoteAddr
			}
		}

		key := fmt.Sprintf("%s|%s", funcName, clientIP)

		now := time.Now()
		limitDuration := time.Duration(rateLimitMinutes) * time.Minute

		// Suojataan map-lukeminen/lisääminen mutexilla
		functionReqMu.Lock()

		times := functionRequests[key]
		// Siivotaan vanhat kutsut pois
		cutoff := now.Add(-limitDuration)
		var filtered []time.Time
		for _, t := range times {
			if t.After(cutoff) {
				filtered = append(filtered, t)
			}
		}
		times = filtered

		// Lisätään tämänhetkinen pyyntö
		times = append(times, now)
		functionRequests[key] = times

		// Tarkistetaan määrä
		currentCount := len(times)
		functionReqMu.Unlock()

		if currentCount > rateLimitAmount {
			log.Printf("\033[31mvirhe: rate limit ylittyi funktiolle='%s' ip='%s'\033[0m\n", funcName, clientIP)

			// Browser page requests (Accept: text/html) get a friendly HTML page
			// instead of raw JSON. Follows the maintenance_mode.go pattern.
			if strings.Contains(r.Header.Get("Accept"), "text/html") {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(rateLimitHTML))
				return
			}

			httpresponse.RespondWithError(w, http.StatusTooManyRequests, "429 - Too Many Requests")
			return
		}

		next.ServeHTTP(w, r)
	}
}
