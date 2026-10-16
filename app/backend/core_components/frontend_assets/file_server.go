// file_server.go
// Serves mutable browser code without retaining an incompatible module generation.
// Bridges core, extension and fallback frontend routes with one cache policy.
// Keeps fingerprinted build assets and media on their normal conditional path.
package frontendassets

import (
	"net/http"
	"path"
	"regexp"
	"strings"
)

var fingerprintedBrowserAsset = regexp.MustCompile(`^/dist/[^/]+\.[A-Za-z0-9_-]{8,}\.min\.(js|css)$`)

// FileServer expects the request path relative to the mounted frontend directory.
func FileServer(directory string) http.Handler {
	return fileServer(http.Dir(directory))
}

func fileServer(filesystem http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Refuse directories even when they contain an index document. Files retain
		// normal MIME, range and conditional-response handling.
		file, err := filesystem.Open(path.Clean("/" + r.URL.Path))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		info, statErr := file.Stat()
		defer file.Close()
		if statErr != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if isMutableBrowserAsset(r.URL.Path) {
			w.Header().Set("Cache-Control", "no-store")
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				// FileServer otherwise compares Last-Modified at one-second precision.
				// A copied or quickly edited module must not reuse old bytes via 304.
				r = r.Clone(r.Context())
				r.Header.Del("If-Modified-Since")
				r.Header.Del("If-None-Match")
			}
		}
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
}

func isMutableBrowserAsset(urlPath string) bool {
	cleanPath := path.Clean("/" + urlPath)
	if fingerprintedBrowserAsset.MatchString(cleanPath) {
		return false
	}
	switch strings.ToLower(path.Ext(cleanPath)) {
	case ".js", ".mjs", ".css", ".json", ".html":
		return true
	default:
		return false
	}
}
