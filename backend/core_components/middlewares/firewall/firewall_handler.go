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

// ───────────────────────────────────────────────────
// Luotettujen välipalvelimien verkot (CIDR) – MUOKKAA!
//
//	✅  Lisää tänne omat Nginx-/Cloudflare-/Kubernetes-load-balancer-
//	   verkot.  Cloudflaren ajantasaiset IP-blokit voit hakea esim.
//	   https://www.cloudflare.com/ips-v4  ja  ips-v6.
//
// ───────────────────────────────────────────────────
var trustedProxyNets []*net.IPNet

func init() {
	cidrs := []string{
		// 🔻 Cloudflare v4 – esimerkinomaisesti muutama
		"173.245.48.0/20",
		"103.21.244.0/22",
		"103.22.200.0/22",
		"103.31.4.0/22",
		"141.101.64.0/18",
		"108.162.192.0/18",
		"190.93.240.0/20",
		"188.114.96.0/20",
		"197.234.240.0/22",
		"198.41.128.0/17",
		"162.158.0.0/15",
		"104.16.0.0/13",
		"104.24.0.0/14",
		"172.64.0.0/13",
		"131.0.72.0/22",

		// 🔻 Cloudflare v6 – esimerkinomaisesti
		"2400:cb00::/32",
		"2606:4700::/32",
		"2803:f800::/32",
		"2405:b500::/32",
		"2405:8100::/32",
		"2a06:98c0::/29",
		"2c0f:f248::/32",

		// 🔻 Paikallinen reverse-proxy (esim. Nginx samassa kontissa)
		"127.0.0.1/32",
		"::1/128",
	}

	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			trustedProxyNets = append(trustedProxyNets, n)
		} else {
			// virhe käynnistyksessä → punaisella
			fmt.Printf("\033[31merror: proxy CIDR %s invalid: %v\033[0m\n", c, err)
		}
	}
}

// onTrustedProxy kertoo, tuleeko yhteys joltakin tunnetulta välityspalvelimelta.
func onTrustedProxy(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, n := range trustedProxyNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
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

	// 0) Poimi todellinen lähde-IP socketista
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr // epästandardi muoto, mutta käytetään silti
	}

	// Jos pyyntö EI tule luotetulta välipalvelimelta → ota se sellaisenaan
	if !onTrustedProxy(remoteHost) {
		return remoteHost
	}

	// 1) CF-Connecting-IP
	if ip := net.ParseIP(r.Header.Get("CF-Connecting-IP")); ip != nil {
		return ip.String()
	}

	// 2) X-Real-IP
	if ip := net.ParseIP(r.Header.Get("X-Real-IP")); ip != nil {
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

// ───────────────────────────────────────────────────
// Käänteinen DNS -välimuisti (vain lokitusta varten)
//
// Asynkroninen haku, max 500 ms timeout.
// Tulokset välimuistitetaan IP-kohtaisesti 10 minuutiksi.
// Ei koskaan estä pyyntöjen käsittelyä.
// ───────────────────────────────────────────────────
type reverseDNSEntry struct {
	hostname  string
	expiresAt time.Time
}

var reverseDNSCache = struct {
	sync.RWMutex
	m map[string]reverseDNSEntry
}{m: make(map[string]reverseDNSEntry)}

// cachedReverseDNS performs a reverse DNS lookup with a short timeout and caching.
// Always returns immediately — never blocks the request.
func cachedReverseDNS(ip string) string {
	// 1) Check cache
	reverseDNSCache.RLock()
	if entry, ok := reverseDNSCache.m[ip]; ok && time.Now().Before(entry.expiresAt) {
		reverseDNSCache.RUnlock()
		return entry.hostname
	}
	reverseDNSCache.RUnlock()

	// 2) Lookup with a 500ms deadline context so the goroutine is cancelled on timeout
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	var hostname string
	names, err := net.DefaultResolver.LookupAddr(ctx, ip)
	if err == nil && len(names) > 0 {
		hostname = strings.TrimSuffix(names[0], ".")
	} else {
		hostname = ip // timeout or error — use IP as fallback
	}

	// 3) Tallenna välimuistiin
	reverseDNSCache.Lock()
	reverseDNSCache.m[ip] = reverseDNSEntry{
		hostname:  hostname,
		expiresAt: time.Now().Add(10 * time.Minute),
	}
	reverseDNSCache.Unlock()

	return hostname
}

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
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		// ► Poimitaan oikea IP välityspalvelin-otsikoista
		remoteIP := getClientIP(r)

		// Käänteinen DNS (vain lokitukseen, välimuistitettu, max 500 ms)
		reverseDNS := cachedReverseDNS(remoteIP)

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
			fmt.Printf("\033[31merror: oversized header (%d bytes) - ip: %s (%s)\033[0m\n",
				total, remoteIP, reverseDNS)
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
				fmt.Printf("\033[31merror: %s method rate limit exceeded - ip: %s (%s)\033[0m\n",
					r.Method, remoteIP, reverseDNS)
				httpresponse.RespondWithError(w, http.StatusTooManyRequests, "429 - Too Many Requests (special methods)")
				return
			}

			// b) Blokataan itse metodi
			fmt.Printf("\033[31merror: %s method blocked by firewall - ip: %s (%s)\033[0m\n",
				r.Method, remoteIP, reverseDNS)
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
