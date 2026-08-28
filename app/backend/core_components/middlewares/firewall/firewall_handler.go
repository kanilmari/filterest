// firewall_handler.go
// Enforces IP allow/block list rules on incoming requests.
// Bridges the firewall rule database and HTTP request filtering plus admin management endpoints.
// Exists to gate access by IP address and let admins manage firewall rules via the UI.
package firewall

import (
	"context"
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/httpresponse"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// onTrustedProxy kertoo, tuleeko yhteys joltakin tunnetulta välityspalvelimelta.
func onTrustedProxy(ipStr string) bool {
	return defaultTrustedProxyResolver.isTrusted(ipStr)
}

// ───────────────────────────────────────────────────
//
//	IP-apu: Cloudflare + Nginx oikea osoite  (SPOOFING-KORJAUS 🛡️)
//
//	Järjestys (vain jos yhteys luotetulta proxyltä):
//	  1) CF-Connecting-IP   (Cloudflare, aina yksi osoite)
//	  2) X-Real-IP          (Nginx real_ip_header)
//	  3) X-Forwarded-For    (ensimmäinen pilkkueroteltu)
//	  4) r.RemoteAddr       (fallback)
//
// ───────────────────────────────────────────────────
func getClientIP(r *http.Request) string {
	return defaultTrustedProxyResolver.clientIP(r)
}

func (resolver *trustedProxyResolver) clientIP(r *http.Request) string {

	// 0) Poimi todellinen lähde-IP socketista
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr // epästandardi muoto, mutta käytetään silti
	}

	// Jos pyyntö EI tule luotetulta välipalvelimelta → ota se sellaisenaan
	if !resolver.isTrusted(remoteHost) {
		return remoteHost
	}

	// 1) CF-Connecting-IP
	if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); ip != nil {
		return ip.String()
	}

	// 2) X-Real-IP
	if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); ip != nil {
		return ip.String()
	}

	// 3) X-Forwarded-For (ensimmäinen arvo listasta)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for _, part := range strings.Split(xff, ",") {
			if ip := net.ParseIP(strings.TrimSpace(part)); ip != nil {
				return ip.String()
			}
		}
	}

	// 4) Fallback
	return remoteHost
}

// ───────────────────────────────────────────────────
//
//	Rate-limit erikoismetodeille (muut kuin GET/POST/HEAD)
//
// ───────────────────────────────────────────────────
const (
	rateLimitWindow       = 1 * time.Hour // aikaikkuna erikoismetodeille
	rateLimitMaxPerWindow = 10            // erikoispyyntöä / aikaikkuna / IP
)

type rlEntry struct {
	count       int
	windowStart time.Time
}

var specialMethodRL = struct {
	sync.Mutex
	m map[string]*rlEntry
}{m: make(map[string]*rlEntry)}

func incrementSpecial(ip string) bool {
	specialMethodRL.Lock()
	defer specialMethodRL.Unlock()

	now := time.Now()
	entry, exists := specialMethodRL.m[ip]

	if !exists || now.Sub(entry.windowStart) >= rateLimitWindow {
		// uusi ikkunan alku
		specialMethodRL.m[ip] = &rlEntry{count: 1, windowStart: now}
		return true
	}

	if entry.count >= rateLimitMaxPerWindow {
		entry.count++ // kirjataan silti
		return false
	}

	entry.count++
	return true
}

// ───────────────────────────────────────────────────
//
//	FirewallHandler – pääkäsittelijä
//
// ───────────────────────────────────────────────────
func FirewallHandler(next http.Handler) http.Handler {
	// Load after backend.LoadEnvironmentVariables has populated the protected
	// runtime environment. Central config validation has already checked it;
	// this defensive repeat still refuses drift before HTTP starts.
	resolver, err := trustedProxyResolverFromEnvironment()
	if err != nil {
		panic(err)
	}
	return firewallHandlerWithResolver(next, resolver)
}

func firewallHandlerWithResolver(next http.Handler, resolver *trustedProxyResolver) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		// ► Poimitaan oikea IP välityspalvelin-otsikoista
		remoteIP := resolver.clientIP(r)

		// 1) Rate-limit placeholder
		// 2) Geo IP placeholder

		// 3) Header-kokoraja
		maxHeaderSize := 8192
		total := 0
		for k, vs := range r.Header {
			total += len(k)
			for _, v := range vs {
				total += len(v)
			}
		}
		if total > maxHeaderSize {
			fmt.Printf("\033[31merror: oversized header (%d bytes) - ip: %s\033[0m\n",
				total, remoteIP)
			httpresponse.RespondWithError(w, http.StatusRequestEntityTooLarge, "413 - Payload Too Large (headers)")
			return
		}

		// 4) Sallitaan vain GET, POST, HEAD, PATCH, PUT ja DELETE
		if r.Method != http.MethodGet &&
			r.Method != http.MethodPost &&
			r.Method != http.MethodHead &&
			r.Method != http.MethodPatch &&
			r.Method != http.MethodPut &&
			r.Method != http.MethodDelete {

			// a) Rate-limit erikoismetodeille
			if !incrementSpecial(remoteIP) {
				fmt.Printf("\033[31merror: %s method rate limit exceeded - ip: %s\033[0m\n",
					r.Method, remoteIP)
				httpresponse.RespondWithError(w, http.StatusTooManyRequests, "429 - Too Many Requests (special methods)")
				return
			}

			// b) Blokataan itse metodi
			fmt.Printf("\033[31merror: %s method blocked by firewall - ip: %s\033[0m\n",
				r.Method, remoteIP)
			httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (Only GET/POST/HEAD allowed)")
			return
		}

		// Kaikki OK → injektoi selvitetty IP kontekstiin ja kutsu seuraava handler.
		// Downstream-middleware (esim. rate_limiting) lukee tämän arvon r.RemoteAddr:n
		// sijaan, jotta proxy-tauksen takana oleva oikea IP saadaan käyttöön.
		ctx := context.WithValue(r.Context(), context_keys.ClientIPKey{}, remoteIP)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
