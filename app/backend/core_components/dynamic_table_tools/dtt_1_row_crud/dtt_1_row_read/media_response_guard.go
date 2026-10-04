// media_response_guard.go
// Removes unavailable independent media links and derived cache fields from row responses.
// Between normal/semantic/related row serializers and the media library's read decision.
// Exists to make cache metadata obey the same revocation as original files without an import cycle.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"path"
	"slices"
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
// Each media-library file path is decided once per call, however a row writes it.
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

// mediaLibraryReferencesIn returns every media-library file the browser could load from a
// picture value, as file paths the read decision reads: from the value itself, or from each
// text inside a JSON object, such as a language map the browser reads in the viewer's
// language (extractLangValue). Each text is read as the browser reads a picture name
// (browserMediaLibraryAddresses), so a relative "media/<id>/…" counts as well as
// "/storage/media/<id>/…", with a query or fragment set aside and backslashes read as
// slashes. A text that reaches the library in a way that reading cannot pin to one file
// gives unresolvedMediaLibraryAddress, which is always refused. Spaces and control
// characters are trimmed more widely than the browser trims, so a value is checked whenever
// the browser could read a media-library address from it.
func mediaLibraryReferencesIn(value string) []string {
	var references []string
	add := func(candidate string) {
		references = append(references, browserMediaLibraryAddresses(candidate)...)
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

// unresolvedMediaLibraryAddress stands for a picture name that could reach the media library
// but whose readings do not agree on one library file. The row filter refuses it without
// asking the read decision (mayOpenEveryMediaLibraryFile), and the decision could not parse it.
const unresolvedMediaLibraryAddress = "/storage/media/%unresolved"

// browserMediaLibraryAddresses returns the media-library file the browser could load for a
// picture name, as the file path the media library's read decision reads; none when no
// reading of the name reaches the library; and unresolvedMediaLibraryAddress when some
// reading reaches it but the readings do not agree on one file.
//
// The card and the article pass on an http(s)://, ./ or / name as it is and put any other
// name under /storage/ (resolveImagePath in row_article_content_builder_helpers.js). The
// browser then reads the result as an address of this site: it drops tabs and line breaks,
// reads a backslash as a slash, sends no #fragment, and resolves ./ and ../ segments, also
// written with %2e, in the text as written. The server decodes the percent-escapes after
// that and cleans the path again, and the storage route serves it without its ?query.
//
// Where a reading depends on what this check cannot know, the name is read every way it
// could be (reachablePaths): a full or //host address by its path as this site's, a ./
// address from the site root and as a stored name, and escapes decoded before and after the
// dot segments, again until nothing changes. When any reading reaches /storage/media, the
// name is a library reference; it names a file only when every reading is that one file. The
// decision is then asked about the file, not about the text as written, so a picture the
// viewer may open is not refused for how it is spelled.
func browserMediaLibraryAddresses(candidate string) []string {
	name := strings.TrimFunc(candidate, isPictureSpace)
	var paths []string
	switch {
	case name == "":
		return nil
	case strings.HasPrefix(name, "http://"), strings.HasPrefix(name, "https://"):
		paths = []string{pathAfterHost(browserURLText(name[strings.Index(name, ":")+1:]))}
	case strings.HasPrefix(name, "./"):
		rest := browserURLText(name[len("./"):])
		paths = []string{"/" + rest, "/storage/" + rest}
	case strings.HasPrefix(name, "/"):
		address := browserURLText(name)
		if strings.HasPrefix(address, "//") {
			address = pathAfterHost(address)
		}
		paths = []string{address}
	default:
		paths = []string{"/storage/" + browserURLText(name)}
	}
	var readings []string
	library := false
	for _, address := range paths {
		if end := strings.IndexAny(address, "?#"); end >= 0 {
			address = address[:end]
		}
		for _, reading := range reachablePaths(address) {
			if !slices.Contains(readings, reading) {
				readings = append(readings, reading)
			}
			library = library || reachesMediaLibrary(reading)
		}
		// Decoding and cleaning only turn escapes into characters and drop whole segments, so
		// an escaped name reaches the library in no order unless its fully decoded text has a
		// "storage" segment with a "media" segment after it; with them, it counts as reaching it.
		if strings.Contains(address, "%") && namesStorageThenMedia(fullyDecodedPath(address)) {
			library = true
		}
	}
	switch {
	case !library:
		return nil
	case len(readings) == 1 && strings.HasPrefix(readings[0], "/storage/media/") && !strings.Contains(readings[0], "%"):
		return readings
	default:
		return []string{unresolvedMediaLibraryAddress}
	}
}

// reachablePaths returns every path the storage route could be asked for by an address: as
// the browser sends it, with its dot segments resolved in the text as written; as a plain
// cleaning reads it; and with its escapes decoded as the server decodes them, both after the
// dot segments are resolved and before, each again until nothing changes, so that double
// encoding is read too.
func reachablePaths(address string) []string {
	readings := []string{browserCleanPath(address), path.Clean(address)}
	for text := readings[0]; ; {
		decoded := browserURLText(decodePercentEscapes(text))
		if decoded == text {
			break
		}
		text = browserCleanPath(decoded)
		readings = append(readings, text)
	}
	for text := address; ; {
		decoded := browserURLText(decodePercentEscapes(text))
		if decoded == text {
			break
		}
		text = decoded
		readings = append(readings, browserCleanPath(text))
	}
	return readings
}

// browserCleanPath resolves the dot segments of a path as the browser's URL parser does: a
// segment that is "." or "%2e" in either case is a single dot, and "..", ".%2e", "%2e." or
// "%2e%2e" a double dot. It drops empty segments as the server's cleaning does and keeps every
// other escape as written.
func browserCleanPath(address string) string {
	var kept []string
	for _, segment := range strings.Split(address, "/") {
		switch strings.ToLower(segment) {
		case "", ".", "%2e":
		case "..", ".%2e", "%2e.", "%2e%2e":
			if len(kept) > 0 {
				kept = kept[:len(kept)-1]
			}
		default:
			kept = append(kept, segment)
		}
	}
	return "/" + strings.Join(kept, "/")
}

// decodePercentEscapes decodes every well-formed %XX escape of a path once, in either case,
// as the server does, and keeps a % that starts no escape.
func decodePercentEscapes(address string) string {
	if !strings.Contains(address, "%") {
		return address
	}
	var decoded strings.Builder
	for i := 0; i < len(address); i++ {
		if address[i] == '%' && i+2 < len(address) {
			high, highOK := hexDigitValue(address[i+1])
			low, lowOK := hexDigitValue(address[i+2])
			if highOK && lowOK {
				decoded.WriteByte(high<<4 | low)
				i += 2
				continue
			}
		}
		decoded.WriteByte(address[i])
	}
	return decoded.String()
}

func hexDigitValue(c byte) (byte, bool) {
	switch {
	case '0' <= c && c <= '9':
		return c - '0', true
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10, true
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// fullyDecodedPath decodes a path's escapes again and again, reading each result as the
// browser reads text, until nothing changes.
func fullyDecodedPath(address string) string {
	for {
		decoded := browserURLText(decodePercentEscapes(address))
		if decoded == address {
			return address
		}
		address = decoded
	}
}

// namesStorageThenMedia reports whether a path has a "storage" segment with a "media" segment
// somewhere after it.
func namesStorageThenMedia(address string) bool {
	afterStorage := false
	for _, segment := range strings.Split(address, "/") {
		switch {
		case segment == "storage":
			afterStorage = true
		case afterStorage && segment == "media":
			return true
		}
	}
	return false
}

// browserURLText reads a picture address as the browser's URL parser does before it splits
// it: tabs and line breaks anywhere are dropped, and a backslash is a slash.
func browserURLText(address string) string {
	return browserURLReplacer.Replace(address)
}

var browserURLReplacer = strings.NewReplacer("\t", "", "\n", "", "\r", "", `\`, "/")

// pathAfterHost returns the path of an address that names a host (//host/path) as the
// browser reads it: every slash before the host is skipped, and the path starts at the first
// slash after it.
func pathAfterHost(address string) string {
	rest := strings.TrimLeft(address, "/")
	if end := strings.IndexAny(rest, "/?#"); end >= 0 && rest[end] == '/' {
		return rest[end:]
	}
	return "/"
}

// reachesMediaLibrary reports whether a cleaned path is the media library's folder or lies in
// it, the only place the storage route serves library files from.
func reachesMediaLibrary(cleaned string) bool {
	return cleaned == "/storage/media" || strings.HasPrefix(cleaned, "/storage/media/")
}

// isPictureSpace covers every character the card's trim and the browser's URL parser remove
// from the ends of a picture address, and more: spaces, control characters and the BOM.
func isPictureSpace(r rune) bool {
	return r < 0x20 || unicode.IsSpace(r) || r == '\uFEFF'
}

// filterIndependentMediaRows reads the cached_image and filename values as the browser does
// (mediaLibraryReferencesIn): a /storage/media/… or relative media/… address, alone or inside
// a language map, with backslashes read as slashes, ./ and ../ resolved and a ?query or
// #fragment set aside. It asks the media library's read decision about each file path found,
// so a picture the viewer may open is kept as written, also with a query, and a refused one
// is removed. A name this reading cannot pin to one library file is removed without asking.
// A refused cached_image also takes its derived cached_image_* fields with it. A value that
// names no media-library file is kept without asking, and every other field is left alone.
func filterIndependentMediaRows(rows []map[string]interface{}, allowed func(string) bool) {
	for _, row := range rows {
		for _, key := range []string{"cached_image", "filename"} {
			value, ok := row[key].(string)
			if !ok || mayOpenEveryMediaLibraryFile(value, allowed) {
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

// mayOpenEveryMediaLibraryFile reports whether the read decision allows every media-library
// file the browser could load from value. One refused file refuses the whole value, because
// the server cannot tell which language of a map the viewer will read, and a name that
// reaches the library without naming one file is refused without asking.
func mayOpenEveryMediaLibraryFile(value string, allowed func(string) bool) bool {
	for _, reference := range mediaLibraryReferencesIn(value) {
		if reference == unresolvedMediaLibraryAddress || !allowed(reference) {
			return false
		}
	}
	return true
}
