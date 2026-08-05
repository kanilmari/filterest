// csp_middleware.go
// Middleware that sets Content Security Policy headers on all HTTP responses.
// Bridges the CSP configuration and the response writer with per-request nonce generation.
// Exists to restrict script, style, and resource origins to prevent XSS attacks.
package middlewares

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
)

// ---------- 0) Context-avain ja apufunktio noncea varten -----------------------

type contextKey string

const cspNonceKey contextKey = "csp_nonce"

// GetCSPNonce palauttaa pyynnön CSP-nonce-arvon templateja varten.
func GetCSPNonce(r *http.Request) string {
	if val, ok := r.Context().Value(cspNonceKey).(string); ok {
		return val
	}
	return ""
}

// ---------- 1) Varsinainen middleware -----------------------------------------

func WithCSP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		/* 1) Luo 128-bittinen (16 tavua) nonce ja base64-enkoodaa se ---------- */
		randomByteSlice := make([]byte, 16)
		if _, err := rand.Read(randomByteSlice); err != nil {
			// Hätätilassa palvellaan ilman noncea ja lokitetaan virhe punaisella
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			next.ServeHTTP(w, r)
			return
		}
		nonceString := base64.StdEncoding.EncodeToString(randomByteSlice)

		/* 2) Rakenna CSP-header – kaikki yhdessä rivissä ---------------------- */
		cspHeaderValue := fmt.Sprintf(
			"default-src 'self'; "+
				"object-src 'none'; "+
				"script-src 'self' 'nonce-%[1]s'; "+
				"style-src 'self' 'nonce-%[1]s'; "+
				"connect-src 'self'; "+
				"img-src 'self'; "+
				"font-src    'self'; "+
				"frame-src   'self' https://maps.google.com https://www.google.com https://embed.here.com/; "+
				"base-uri    'self'; "+
				"form-action 'self'; "+
				"frame-ancestors 'self';",
			nonceString,
		)

		w.Header().Set("Content-Security-Policy", cspHeaderValue)

		/* 3) Välitä nonce eteenpäin, jotta templaten skriptit/tyylit voivat käyttää sitä */
		rWithNonce := r.WithContext(context.WithValue(r.Context(), cspNonceKey, nonceString))

		next.ServeHTTP(w, rWithNonce)
	})
}
