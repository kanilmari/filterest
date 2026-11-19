// search_indexing_header.go
// Tells search engines which responses must never appear in their results.
// Between every response (through WithSecurityHeaders) and crawlers that obey X-Robots-Tag.
// Exists so data requests a crawler may fetch to draw a page, and the sign-in pages, stay out of results (WL175).
package middlewares

import (
	"net/http"
	"strings"
)

// setSearchIndexingHeader marks responses that are not documents of their own.
// Data requests: a crawler may fetch some of them while it draws an article
// (robots.txt allows exactly those), but their addresses must not be listed.
// Sign-in, first-run and administration pages: no visitor looks for them in a
// search engine, and their links lead nowhere public. The registration page's
// address is configurable, so its handler (auth.RegisterHandler) marks itself;
// a prefix here would also catch a dataset whose name starts the same way.
// A handler may still set a stricter value of its own.
func setSearchIndexingHeader(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.URL == nil {
		return
	}
	path := r.URL.Path
	switch {
	case strings.HasPrefix(path, "/api/"):
		w.Header().Set("X-Robots-Tag", "noindex")
	case path == "/login" || path == "/first-run" || strings.HasPrefix(path, "/admin/") || path == "/admin":
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	case path == "/" && (r.URL.Query().Get("login-entry") == "1" || r.URL.Query().Get("register-entry") == "1"):
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	}
}
