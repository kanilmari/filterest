// custom_root_handler.go
// Serves the operator's root document and its dedicated static asset prefix.
// Connects early private cache policy with delivery after root authentication checks.
// Keeps authentication authoritative while giving this page its own CSP and cache policy.
package router

import (
	backend "easelect/backend/core_components"
	"io"
	"net/http"
	"strings"
	"time"
)

const siteRootPrefix = "/.site_root/"

// Inline styles support operator-authored static mockups without a build step.
// Scripts must be local files; no inline/eval code or network API calls are allowed.
// All other directives and their reasons are documented in Frontend_Home_Page.md.
const siteRootCSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

func isSiteRootAssetRequest(r *http.Request) bool {
	return r.URL.Path == "/.site_root" || strings.HasPrefix(r.URL.Path, siteRootPrefix)
}

// WithCustomRootCachePolicy runs outside the mux and security pipeline, so even
// path-cleaning redirects, method refusals and authentication errors stay private.
// It changes no authentication decision or CSP for the existing shell/error pages.
func WithCustomRootCachePolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(siteRootCacheResponse(w, r), r)
	})
}

func siteRootCacheResponse(w http.ResponseWriter, r *http.Request) http.ResponseWriter {
	if _, wrapped := w.(siteRootResponseWriter); wrapped {
		return w
	}
	// Include malformed/encoded separators following the reserved asset marker;
	// their refusal must remain private even when they do not match its route.
	if !strings.HasPrefix(r.URL.Path, "/.site_root") {
		if r.URL.Path != "/" || isAuthShellEntryRequest(r) {
			return w
		}
		enabled, err := backend.ReadDisplayIndexHTMLAtStartup(r.Context(), backend.Db)
		if err != nil || !enabled || !backend.SiteRootAvailable(localStorageDir) {
			return w
		}
	}
	setSiteRootCacheHeaders(w)
	return siteRootResponseWriter{w}
}

// serveSiteRoot uses exactly the root's authentication boundary, including HEAD.
func serveSiteRoot(w http.ResponseWriter, r *http.Request) { rootHandler(w, r) }

// tryServeCustomRoot returns false to retain existing SPA behavior. Assets never fall
// through to the frontend file server, even when disabled or missing.
func tryServeCustomRoot(w http.ResponseWriter, r *http.Request, loginToBrowse bool, userID any) bool {
	asset := isSiteRootAssetRequest(r)
	if !asset && (r.URL.Path != "/" || isAuthShellEntryRequest(r)) {
		return false
	}
	if asset {
		setSiteRootHeaders(w)
		if loginToBrowse && !isSignedInUserID(userID) {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return true
		}
	}
	enabled, err := backend.ReadDisplayIndexHTMLAtStartup(r.Context(), backend.Db)
	if err != nil || !enabled {
		if !asset {
			return false
		}
		http.NotFound(w, r)
		return true
	}
	index, indexInfo, mimeType, err := backend.OpenSiteRootFile(localStorageDir, "index.html")
	if err != nil {
		if !asset {
			return false
		}
		http.NotFound(w, r)
		return true
	}
	defer index.Close()
	if loginToBrowse && !isSignedInUserID(userID) {
		setSiteRootHeaders(w)
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return true
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		setSiteRootHeaders(w)
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return true
	}
	file, info := index, indexInfo
	if asset {
		// Reject all URL escaping, including encoded and double-encoded separators.
		// Names use a deliberately small ASCII alphabet; nested directories are allowed.
		if r.URL.EscapedPath() != r.URL.Path || !strings.HasPrefix(r.URL.Path, siteRootPrefix) {
			http.NotFound(w, r)
			return true
		}
		file, info, mimeType, err = backend.OpenSiteRootFile(localStorageDir, strings.TrimPrefix(r.URL.Path, siteRootPrefix))
		if err != nil {
			http.NotFound(w, r)
			return true
		}
		defer file.Close()
	}
	setSiteRootHeaders(w)
	w.Header().Set("Content-Type", mimeType)
	// A section fixes the checked size even if the operator grows the file during delivery.
	// No Last-Modified validators: revocation and replacement must always hit authentication.
	http.ServeContent(siteRootResponseWriter{w}, r, info.Name(), time.Time{}, io.NewSectionReader(file, 0, info.Size()))
	return true
}

type siteRootResponseWriter struct{ http.ResponseWriter }

// ServeContent removes cache headers on errors (including invalid ranges).
// Restore our authentication-sensitive policy at the actual header commit.
func (w siteRootResponseWriter) WriteHeader(status int) {
	setSiteRootCacheHeaders(w)
	w.ResponseWriter.WriteHeader(status)
}

func (w siteRootResponseWriter) Write(body []byte) (int, error) {
	setSiteRootCacheHeaders(w)
	return w.ResponseWriter.Write(body)
}

func (w siteRootResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func setSiteRootCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
	for _, value := range w.Header().Values("Vary") {
		for _, field := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(field), "Cookie") {
				return
			}
		}
	}
	w.Header().Add("Vary", "Cookie")
}

func setSiteRootHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Security-Policy", siteRootCSP)
	setSiteRootCacheHeaders(w)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
}
