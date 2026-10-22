// file_server.go
// Serves mutable browser code without retaining an incompatible module generation.
// Bridges core, extension and fallback frontend routes with one cache policy.
// Keeps fingerprinted build assets and media on their normal conditional path.
package frontendassets

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var fingerprintedBrowserAsset = regexp.MustCompile(`^/dist/[^/]+\.[A-Za-z0-9_-]{8,}\.min\.(js|css)$`)

// FileServer expects the request path relative to the mounted frontend directory.
func FileServer(directory string) http.Handler {
	normal := fileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		urlPath := "/" + strings.TrimPrefix(r.URL.Path, "/")
		// Decide on the cleaned name: the ordinary handler cleans an alias such as a
		// trailing slash or "/." into a dark file and would follow its link.
		if !strings.HasSuffix(path.Clean(urlPath), "-128-dark-v1.png") {
			normal.ServeHTTP(w, r)
			return
		}
		// Only the maintained sibling family gets content revalidation. Never clean
		// an unsafe path into an accepted one; reject links before opening bytes.
		const prefix = "/icons/site_favicons/"
		fileName := strings.TrimPrefix(urlPath, prefix)
		if !strings.HasPrefix(urlPath, prefix) || !safeSiteFaviconFilename.MatchString(fileName) || filepath.Base(fileName) != fileName {
			http.NotFound(w, r)
			return
		}
		diskPath := filepath.Join(directory, "icons", "site_favicons", fileName)
		info, err := os.Lstat(diskPath)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(diskPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		content, err := io.ReadAll(file)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, no-cache")
		w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sha256.Sum256(content)))
		// A content validator, rather than a one-second file date, owns freshness.
		http.ServeContent(w, r, fileName, time.Time{}, bytes.NewReader(content))
	})
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
