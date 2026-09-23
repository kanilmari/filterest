// seo_meta_builder.go
// Helpers for generating SEO metadata (title, description, og: tags) for dynamic table and
// app pages. Reads table-level SEO configuration from the database.
// Exists to keep crawler-facing metadata aligned with dataset and app page context.
package router

import (
	"context"
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"

	backend "easelect/backend/core_components"
)

// pageMeta holds all SEO-relevant fields that are injected into the
// index.html Go template alongside the existing indexTemplateData fields.
type pageMeta struct {
	PageTitle       string // <title> tag content
	MetaDescription string // <meta name="description">
	CanonicalURL    string // <link rel="canonical">
	OGTitle         string // og:title
	OGDescription   string // og:description
	OGType          string // og:type  (website | article)
	OGURL           string // og:url
	OGImage         string // og:image (absolute URL)
	SiteName        string // og:site_name and title suffix
	OGLocale        string // og:locale (e.g. fi_FI, en_US)
	LangCode        string // 2-letter lang code for <html lang="">
}

// supportedLangs lists the language columns available in system_lang_keys.
var supportedLangs = []string{"fi", "en", "yue"}

// isIndexingAllowed checks system_config for 'allow_search_indexing' and
// 'login_to_browse'. Indexing is blocked when:
//   - allow_search_indexing is explicitly set to false, OR
//   - login_to_browse is true (content is behind authentication)
//
// When allow_search_indexing doesn't exist in system_config, we default to true.
func isIndexingAllowed() bool {
	if backend.Db == nil {
		return true
	}

	// Check explicit indexing toggle
	var allowIndexing sql.NullBool
	err := backend.Db.QueryRow(`
		SELECT boolean_value FROM system_config WHERE key = 'allow_search_indexing'
	`).Scan(&allowIndexing)
	if err == nil && allowIndexing.Valid && !allowIndexing.Bool {
		return false
	}

	// Check login_to_browse — if true, content is gated
	var loginToBrowse sql.NullBool
	err = backend.Db.QueryRow(`
		SELECT boolean_value FROM system_config WHERE key = 'login_to_browse'
	`).Scan(&loginToBrowse)
	if err == nil && loginToBrowse.Valid && loginToBrowse.Bool {
		return false
	}

	return true
}

// resolvePageMeta inspects the request URL and returns SEO metadata.
// It tries to match the first URL segment to a dataset name and fetch
// translated titles/descriptions from system_lang_keys.
func resolvePageMeta(r *http.Request) pageMeta {
	siteName := resolvePageSiteName(r)
	lang := resolveLanguage(r)
	locale := langToLocale(lang)
	baseURL := resolveBaseURL(r)
	canonicalPath := r.URL.Path

	meta := pageMeta{
		PageTitle:       siteName,
		MetaDescription: fmt.Sprintf("%s — modern service catalog", siteName),
		CanonicalURL:    baseURL + canonicalPath,
		OGTitle:         siteName,
		OGDescription:   fmt.Sprintf("%s — modern service catalog", siteName),
		OGType:          "website",
		OGURL:           baseURL + canonicalPath,
		OGImage:         baseURL + "/frontend/favicon4S.png",
		SiteName:        siteName,
		OGLocale:        locale,
		LangCode:        lang,
	}

	// Extract dataset name from first URL segment
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		return meta
	}
	segments := strings.SplitN(path, "/", 3)
	datasetSegment := segments[0]
	datasetName := resolveRawDatasetName(datasetSegment)

	if datasetSegment == "" || datasetSegment == "admin" || datasetName == "" {
		return meta
	}

	// Check if dataset exists
	if !datasetExists(datasetName) {
		return meta
	}
	canonicalPath = buildCanonicalDatasetPath(datasetName, segments)
	meta.CanonicalURL = baseURL + canonicalPath
	meta.OGURL = meta.CanonicalURL

	title := resolveDatasetTabTitle(datasetName, lang)

	// Fetch description / search slogan
	sloganKey := "search_slogan_" + datasetName
	description := fetchTranslation(sloganKey, lang)
	if description == "" {
		// Fallback: use table description from system_db_tables
		description = fetchDatasetDescription(datasetName)
	}
	if description == "" {
		description = title
	}

	meta.PageTitle = composeBrowserTabTitle("", title, siteName)
	meta.MetaDescription = description
	meta.OGTitle = title
	meta.OGDescription = description
	meta.OGType = "website"

	// If a row ID is present (e.g. /{dataset}/{id} or /{dataset}/{id}-{slug}), enrich with per-row data
	if len(segments) >= 2 && segments[1] != "" {
		rowID := segments[1]
		// Strip optional SEO slug: "125-some-title" → "125"
		if idx := strings.IndexByte(rowID, '-'); idx > 0 {
			rowID = rowID[:idx]
		}
		rowTitle := fetchRowTitle(datasetName, rowID, lang)
		if rowTitle != "" {
			meta.PageTitle = composeBrowserTabTitle(rowTitle, title, siteName)
			meta.OGTitle = rowTitle
			meta.OGType = "article"
		}
	}

	return meta
}

// browserTabTitleSeparator joins the parts of the browser tab title.
// Its frontend twin is BROWSER_TAB_TITLE_SEPARATOR in
// app/frontend/core_components/navigation/nav_engine/browser_tab_title_writer.js.
const browserTabTitleSeparator = " — "

// resolveDatasetTabTitle answers what the application's own tab calls this dataset.
// Between the translated interface copy and the first-load browser tab title.
// Why: the browser tab must open with the words the tab bar prints, and the tab bar
// labels a dataset tab by the language key that is the dataset's own name
// (main_tab_lang_keys.js). The remaining steps are the fallback chain for an
// installation that has not translated that label, in the same order as
// resolveTabTitleForBrowserTab in
// app/frontend/core_components/navigation/nav_engine/browser_tab_title_writer.js.
func resolveDatasetTabTitle(datasetName string, lang string) string {
	if title := datasetTitleTranslationReader(mainTabLangKey(datasetName), lang); title != "" {
		return title
	}
	if title := datasetTitleTranslationReader(datasetName+"_front_page", lang); title != "" {
		return title
	}
	if title := datasetDisplayNameReader(datasetName); title != "" {
		return title
	}
	return humanizeDatasetNameForTitle(datasetName)
}

// The dataset title sources this package reads, named so a test can answer them without a
// database, the same way configuredSiteNameReader does for the site identity.
var (
	datasetTitleTranslationReader = fetchTranslation
	datasetDisplayNameReader      = fetchDatasetDisplayName
)

// mainTabLangKeyOverrides lists the tabs whose visible label comes from a different
// language key than the tab's own name. Everything else is labelled by its own name.
// Its frontend twin is MAIN_TAB_LANG_KEY_OVERRIDES in
// app/frontend/core_components/navigation/main_tabs/main_tab_lang_keys.js, and both are
// checked against the same examples in
// app/testing/shared_contracts/site_name_in_title_examples.json.
var mainTabLangKeyOverrides = map[string]string{
	// The people dataset is named system_users, but its tab says "Users".
	"system_users": "users",
	// The account view is named user, but its tab says "Account".
	"user": "account",
}

// mainTabLangKey answers which language key the application's own tab bar prints for
// one tab. Its frontend twin is getMainTabLangKey in main_tab_lang_keys.js.
func mainTabLangKey(tabIdentity string) string {
	identity := strings.TrimSpace(tabIdentity)
	if identity == "" {
		return ""
	}
	if labelKey, overridden := mainTabLangKeyOverrides[identity]; overridden {
		return labelKey
	}
	return identity
}

// humanizeDatasetNameForTitle turns a raw dataset name into readable copy.
// Its frontend twin is humanizeDatasetNameForTitle in
// app/frontend/core_components/navigation/nav_engine/browser_tab_title_writer.js.
func humanizeDatasetNameForTitle(datasetName string) string {
	readable := strings.ReplaceAll(datasetName, "_", " ")
	return strings.Title(readable) //nolint:staticcheck
}

// composeBrowserTabTitle joins the first-load browser tab title in the order the
// application keeps after it takes the title over: the open article, then the
// application tab's own label, then the site name. Empty parts are dropped.
// Its frontend twin is composeBrowserTabTitle in
// app/frontend/core_components/navigation/nav_engine/browser_tab_title_writer.js.
func composeBrowserTabTitle(articleTitle string, tabTitle string, siteName string) string {
	readableTabTitle := strings.TrimSpace(tabTitle)
	readableSiteName := strings.TrimSpace(siteName)
	sitePart := readableSiteName
	if titleAlreadyOpensWithSiteName(readableTabTitle, readableSiteName) {
		sitePart = ""
	}

	parts := make([]string, 0, 3)
	for _, part := range []string{strings.TrimSpace(articleTitle), readableTabTitle, sitePart} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, browserTabTitleSeparator)
}

// titleAlreadyOpensWithSiteName tells whether a title already opens with the site's own
// name, so the tab title must not name the site a second time.
//
// The name counts as repeated only at the very start of the title, compared without case
// or surrounding whitespace, and only when the title either ends there or continues with
// something that is not a letter or a digit. That keeps a longer word such as
// "Serlogistics" a different word, and leaves a site name in the middle of a title alone.
//
// Its frontend twin is titleAlreadyOpensWithSiteName in
// app/frontend/core_components/state_stores/site_identity_reader.js. Both are checked
// against the same examples in
// app/testing/shared_contracts/site_name_in_title_examples.json, so the pair cannot
// drift apart silently.
func titleAlreadyOpensWithSiteName(title string, siteName string) bool {
	readableTitle := []rune(strings.TrimSpace(title))
	readableSiteName := []rune(strings.TrimSpace(siteName))
	if len(readableTitle) == 0 || len(readableSiteName) == 0 {
		return false
	}
	if len(readableTitle) < len(readableSiteName) {
		return false
	}
	if !strings.EqualFold(string(readableTitle[:len(readableSiteName)]), string(readableSiteName)) {
		return false
	}
	if len(readableTitle) == len(readableSiteName) {
		return true
	}
	characterAfterSiteName := readableTitle[len(readableSiteName)]
	return !unicode.IsLetter(characterAfterSiteName) && !unicode.IsDigit(characterAfterSiteName)
}

// resolvePageSiteName returns the browser-facing site name for SEO metadata.
// The administrator-owned First Run value wins over deployment and host fallbacks.
// Why: the chosen site identity must replace Filterest and legacy domain branding.
func resolvePageSiteName(r *http.Request) string {
	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}
	if siteName := configuredSiteNameReader(ctx, backend.Db); siteName != "" {
		return siteName
	}
	if r != nil {
		if host := normalizePageDisplayHost(r.Header.Get("X-Forwarded-Host")); host != "" {
			return host
		}
		if host := normalizePageDisplayHost(r.Host); host != "" {
			return host
		}
	}

	return getSiteName()
}

// normalizePageDisplayHost formats a host header for page title and OG metadata.
// Between proxy/client host headers and template values it strips ports and commas.
// Why: titles should say filterest.com, not filterest.com:443 or stale env branding.
func normalizePageDisplayHost(rawHost string) string {
	host := strings.TrimSpace(rawHost)
	if host == "" {
		return ""
	}
	if firstHost, _, found := strings.Cut(host, ","); found {
		host = strings.TrimSpace(firstHost)
	}
	if splitHost, _, err := net.SplitHostPort(host); err == nil {
		host = splitHost
	}
	host = strings.Trim(host, "[]")
	host = strings.TrimSuffix(host, ".")
	return strings.ToLower(strings.TrimSpace(host))
}

// buildCanonicalDatasetPath returns the preferred public path for a dataset request.
func buildCanonicalDatasetPath(datasetName string, segments []string) string {
	if datasetName == "" {
		return "/"
	}

	path := "/" + resolvePublicDatasetName(datasetName)
	if len(segments) >= 2 && segments[1] != "" {
		path += "/" + segments[1]
	}
	return path
}

// resolveLanguage determines the preferred language from:
// 1. ?lang= query parameter
// 2. Accept-Language header
// Falls back to "en".
func resolveLanguage(r *http.Request) string {
	// 1. Explicit query parameter
	if qLang := r.URL.Query().Get("lang"); qLang != "" {
		qLang = strings.ToLower(strings.TrimSpace(qLang))
		for _, supported := range supportedLangs {
			if qLang == supported {
				return supported
			}
		}
	}

	// 2. Accept-Language header (simplified parsing)
	accept := r.Header.Get("Accept-Language")
	if accept != "" {
		// Parse comma-separated language tags, ignore quality values
		parts := strings.Split(accept, ",")
		for _, part := range parts {
			tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
			tag = strings.ToLower(tag)
			// Match exact or prefix (e.g. "fi-FI" → "fi")
			for _, supported := range supportedLangs {
				if tag == supported || strings.HasPrefix(tag, supported+"-") {
					return supported
				}
			}
		}
	}

	return "en"
}

// langToLocale converts a 2-letter lang code to an Open Graph locale string.
func langToLocale(lang string) string {
	switch lang {
	case "fi":
		return "fi_FI"
	case "ch":
		return "zh_CN"
	case "yue":
		return "yue_HK"
	default:
		return "en_US"
	}
}

// resolveBaseURL builds the scheme+host from the request or env var.
func resolveBaseURL(r *http.Request) string {
	// Allow override via environment variable (useful for canonical URLs)
	if base := os.Getenv("BASE_URL"); base != "" {
		return strings.TrimRight(base, "/")
	}

	scheme := "https"
	if r.TLS == nil {
		// Check X-Forwarded-Proto (behind reverse proxy like Traefik)
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = proto
		} else {
			scheme = "http"
		}
	}

	host := r.Host
	if fwdHost := r.Header.Get("X-Forwarded-Host"); fwdHost != "" {
		host = fwdHost
	}
	if normalizedHost := normalizeCanonicalHost(host, scheme); normalizedHost != "" {
		host = normalizedHost
	}

	return scheme + "://" + host
}

// normalizeCanonicalHost formats host headers for canonical URLs and OG links.
// Between proxy host metadata and SEO URL output it removes only default ports.
// Why: production URLs should avoid :443/:80 while local dev ports stay intact.
func normalizeCanonicalHost(rawHost string, scheme string) string {
	host := strings.TrimSpace(rawHost)
	if host == "" {
		return ""
	}
	if firstHost, _, found := strings.Cut(host, ","); found {
		host = strings.TrimSpace(firstHost)
	}

	splitHost, port, err := net.SplitHostPort(host)
	if err != nil {
		return normalizePageDisplayHost(host)
	}

	displayHost := normalizePageDisplayHost(splitHost)
	if displayHost == "" {
		return ""
	}
	if port == "" || isDefaultSchemePort(scheme, port) {
		return displayHost
	}
	if strings.Contains(displayHost, ":") && !strings.HasPrefix(displayHost, "[") {
		displayHost = "[" + displayHost + "]"
	}
	return displayHost + ":" + port
}

// isDefaultSchemePort reports whether a port is implicit for a URL scheme.
// Between canonical host normalization and request-derived schemes it keeps URL output tidy.
// Why: canonical links should not include default HTTP/HTTPS ports.
func isDefaultSchemePort(scheme string, port string) bool {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https":
		return port == "443"
	case "http":
		return port == "80"
	default:
		return false
	}
}

// fetchTranslation retrieves a single translation from system_lang_keys.
func fetchTranslation(langKey string, lang string) string {
	if backend.Db == nil {
		return ""
	}

	// Validate lang column name to prevent SQL injection
	validCol := false
	for _, supported := range supportedLangs {
		if lang == supported {
			validCol = true
			break
		}
	}
	if !validCol {
		lang = "en"
	}

	query := fmt.Sprintf(`SELECT %s FROM system_lang_keys WHERE lang_key = $1`, lang)
	var value sql.NullString
	err := backend.Db.QueryRow(query, langKey).Scan(&value)
	if err != nil {
		return ""
	}
	if value.Valid {
		return strings.TrimSpace(value.String)
	}
	return ""
}

// fetchDatasetDisplayName retrieves the administrator-given display name from
// system_db_tables, the same value the frontend reads from its table_specs cache.
func fetchDatasetDisplayName(tableName string) string {
	if backend.Db == nil {
		return ""
	}
	var displayName sql.NullString
	err := backend.Db.QueryRow(`SELECT display_name FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&displayName)
	if err != nil || !displayName.Valid {
		return ""
	}
	return strings.TrimSpace(displayName.String)
}

// fetchDatasetDescription retrieves the description column from system_db_tables.
func fetchDatasetDescription(tableName string) string {
	if backend.Db == nil {
		return ""
	}
	var desc sql.NullString
	err := backend.Db.QueryRow(`SELECT description FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&desc)
	if err != nil {
		return ""
	}
	if desc.Valid {
		return strings.TrimSpace(desc.String)
	}
	return ""
}

// fetchRowTitle retrieves a human-readable title for a specific row.
// It looks at system_column_details for the dataset's "header" card_element
// and fetches the corresponding column value from the row.
func fetchRowTitle(tableName string, rowID string, lang string) string {
	if backend.Db == nil {
		return ""
	}

	// Find the column that is the card header for this dataset
	var headerCol sql.NullString
	err := backend.Db.QueryRow(`
		SELECT scd.column_name
		FROM system_column_details scd
		JOIN system_db_tables sdt ON scd.table_uid = sdt.id
		WHERE sdt.table_name = $1
		  AND scd.card_element LIKE '%header%'
		ORDER BY scd.column_name
		LIMIT 1
	`, tableName).Scan(&headerCol)
	if err != nil || !headerCol.Valid || headerCol.String == "" {
		return ""
	}

	// Fetch the header value from the actual row
	// We use a safe approach: only allow alphanumeric + underscore column names
	col := headerCol.String
	for _, c := range col {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return "" // invalid column name, bail out
		}
	}

	query := fmt.Sprintf(`SELECT %s FROM %s WHERE id = $1 LIMIT 1`,
		col, tableName)
	var value sql.NullString
	err = backend.Db.QueryRow(query, rowID).Scan(&value)
	if err != nil || !value.Valid {
		return ""
	}

	rawTitle := strings.TrimSpace(value.String)

	// The value may be a JSON lang object like {"fi":"Otsikko","en":"Title"}
	// Try to extract the language-specific value
	if strings.HasPrefix(rawTitle, "{") {
		extracted := extractLangFromJSON(rawTitle, lang)
		if extracted != "" {
			return extracted
		}
	}

	return rawTitle
}

// extractLangFromJSON tries to pull a language value from a simple JSON
// object like {"fi":"Suomi","en":"English"}. Returns empty string on failure.
func extractLangFromJSON(jsonStr string, lang string) string {
	// Simple key extraction without importing encoding/json for performance
	// Look for "lang":"value" pattern
	searchKey := `"` + lang + `"`
	idx := strings.Index(jsonStr, searchKey)
	if idx < 0 {
		return ""
	}
	rest := jsonStr[idx+len(searchKey):]
	// Skip colon and whitespace
	rest = strings.TrimLeft(rest, ": \t\n")
	if len(rest) == 0 || rest[0] != '"' {
		return ""
	}
	rest = rest[1:] // skip opening quote
	endIdx := strings.Index(rest, `"`)
	if endIdx < 0 {
		return ""
	}
	return rest[:endIdx]
}

// =====================================================
//  SITEMAP XML ENDPOINT
//  Generates /sitemap.xml dynamically from public datasets.
// =====================================================

// urlEntry represents a single <url> element in sitemap XML.
type urlEntry struct {
	XMLName    xml.Name `xml:"url"`
	Loc        string   `xml:"loc"`
	LastMod    string   `xml:"lastmod,omitempty"`
	ChangeFreq string   `xml:"changefreq,omitempty"`
	Priority   string   `xml:"priority,omitempty"`
}

// urlSet represents the root <urlset> element in sitemap XML.
type urlSet struct {
	XMLName xml.Name   `xml:"urlset"`
	XMLNS   string     `xml:"xmlns,attr"`
	URLs    []urlEntry `xml:"url"`
}

// sitemapHandler generates a dynamic sitemap.xml from public datasets.
func sitemapHandler(w http.ResponseWriter, r *http.Request) {
	// If indexing is disabled, return an empty sitemap
	if !isIndexingAllowed() {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, xml.Header)
		fmt.Fprint(w, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`)
		return
	}

	baseURL := resolveBaseURL(r)

	urls := []urlEntry{
		{
			Loc:        baseURL + "/",
			ChangeFreq: "daily",
			Priority:   "1.0",
		},
	}

	// Fetch all public dataset names
	if backend.Db != nil {
		rows, err := backend.Db.Query(`
			SELECT t.table_name, t.updated
			FROM system_db_tables t
			WHERE t.schema_name = 'public' AND NOT t.ui_hidden
			ORDER BY t.table_name
		`)
		if err != nil {
			log.Printf("\033[31m[sitemapHandler] query error: %v\033[0m", err)
		} else {
			defer rows.Close()
			for rows.Next() {
				var name string
				var updated sql.NullTime
				if err := rows.Scan(&name, &updated); err != nil {
					continue
				}
				entry := urlEntry{
					Loc:        baseURL + "/" + resolvePublicDatasetName(name),
					ChangeFreq: "weekly",
					Priority:   "0.8",
				}
				if updated.Valid {
					entry.LastMod = updated.Time.Format(time.RFC3339)
				}
				urls = append(urls, entry)
			}
		}
	}

	smap := urlSet{
		XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs:  urls,
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600") // Cache 1 hour
	w.WriteHeader(http.StatusOK)

	fmt.Fprint(w, xml.Header)
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(smap); err != nil {
		log.Printf("\033[31m[sitemapHandler] encode error: %v\033[0m", err)
	}
}
