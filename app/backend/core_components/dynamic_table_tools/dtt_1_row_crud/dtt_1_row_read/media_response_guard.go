// media_response_guard.go
// Removes unavailable independent media links and derived cache fields from row responses.
// Between normal/semantic/related row serializers and the media library's read decision.
// Exists to make cache metadata obey the same revocation as original files without an import cycle.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"path"
	"strings"
	"sync"
	"unicode"
)

type independentMediaAuthorizer func(dbutils.Querier, dbutils.RequestActorContext, string) bool

var independentMediaRead struct {
	sync.RWMutex
	authorize independentMediaAuthorizer
}

// RegisterIndependentMediaAuthorizer connects the optional library at process
// composition time. An absent component always denies its reserved namespace.
func RegisterIndependentMediaAuthorizer(authorize func(dbutils.Querier, dbutils.RequestActorContext, string) bool) {
	independentMediaRead.Lock()
	defer independentMediaRead.Unlock()
	independentMediaRead.authorize = authorize
}

// FilterIndependentMediaRows changes only media URLs and derived cached_image
// fields. Authored title/description and every unrelated field remain intact.
func FilterIndependentMediaRows(q dbutils.Querier, actor dbutils.RequestActorContext, rows []map[string]interface{}) {
	independentMediaRead.RLock()
	authorize := independentMediaRead.authorize
	independentMediaRead.RUnlock()
	decisions := map[string]bool{}
	filterIndependentMediaRows(rows, func(reference string) bool {
		if allowed, seen := decisions[reference]; seen {
			return allowed
		}
		allowed := authorize != nil && authorize(q, actor, reference)
		decisions[reference] = allowed
		return allowed
	})
}

// mediaLibraryReferencesIn returns every media-library file path the browser could load
// from a picture value: the value itself, or each text inside a JSON object, such as a
// language map the browser reads in the viewer's language (extractLangValue). Each
// candidate is resolved as the browser resolves a picture name (browserMediaLibraryAddress),
// so a relative "media/<id>/…" counts as well as "/storage/media/<id>/…", with a query or
// fragment set aside. Spaces are trimmed more widely than the browser trims, so a value is
// checked whenever the browser could read a media-library address from it.
func mediaLibraryReferencesIn(value string) []string {
	var references []string
	add := func(candidate string) {
		if address, ok := browserMediaLibraryAddress(candidate); ok {
			references = append(references, address)
		}
	}
	trimmed := strings.TrimFunc(value, isPictureSpace)
	var parsed interface{}
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") || json.Unmarshal([]byte(trimmed), &parsed) != nil {
		add(trimmed)
		return references
	}
	var walk func(node interface{})
	walk = func(node interface{}) {
		switch typed := node.(type) {
		case string:
			add(typed)
		case map[string]interface{}:
			for _, child := range typed {
				walk(child)
			}
		case []interface{}:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(parsed)
	return references
}

// browserMediaLibraryAddress returns the media-library file path the browser would load for
// a picture name, in the form the media library's read decision reads, or false when the
// name loads no media-library file. The browser reads a name that is not an http(s)://,
// ./ or / address under /storage/ (resolveImagePath in row_article_content_builder_helpers.js),
// sends no #fragment, resolves ./ and ../ segments, and the storage route serves the path
// without its ?query; so the decision is asked about that file path, not about the text as
// written, or a picture the viewer may open would be refused. A full address of another or
// the same site and a percent-encoded path are not recognised here; the storage route still
// refuses such a file to a viewer who may not open it.
func browserMediaLibraryAddress(candidate string) (string, bool) {
	address := strings.TrimFunc(candidate, isPictureSpace)
	if address == "" || strings.HasPrefix(address, "http://") || strings.HasPrefix(address, "https://") ||
		strings.HasPrefix(address, "./") {
		return "", false
	}
	if !strings.HasPrefix(address, "/") {
		address = "/storage/" + address
	}
	if end := strings.IndexAny(address, "?#"); end >= 0 {
		address = address[:end]
	}
	address = path.Clean(address)
	if !strings.HasPrefix(address, "/storage/media/") {
		return "", false
	}
	return address, true
}

// isPictureSpace covers every character the browser's trim removes and more.
func isPictureSpace(r rune) bool {
	return unicode.IsSpace(r) || r == '\uFEFF'
}

func filterIndependentMediaRows(rows []map[string]interface{}, allowed func(string) bool) {
	for _, row := range rows {
		for _, key := range []string{"cached_image", "filename"} {
			reference, ok := row[key].(string)
			if !ok || !strings.HasPrefix(reference, "/storage/media/") {
				continue
			}
			if allowed(reference) {
				continue
			}
			row[key] = nil
			if key == "cached_image" {
				for field := range row {
					if strings.HasPrefix(field, "cached_image_") {
						delete(row, field)
					}
				}
			}
		}
	}
}
