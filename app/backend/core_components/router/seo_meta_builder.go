// seo_meta_builder.go
// Helpers for generating SEO metadata (title, description, og: tags) for dynamic table and
// app pages. Shares shell Home translations and the resolved site favicon.
// Keeps previews aligned with site identity without reading row content; Home presentation selects the description policy.
package router

import (
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/lang"
)

// pageMeta holds all SEO-relevant fields that are injected into the
// index.html Go template alongside the existing indexTemplateData fields.
type pageMeta struct {
	frontendassets.SiteFaviconData
	ShellBoot       frontendassets.ShellBootData
	PageTitle       string // <title> tag content
	MetaDescription string // <meta name="description">
	CanonicalURL    string // <link rel="canonical">
	OGTitle         string // og:title
	OGDescription   string // og:description
	OGType          string // og:type  (website)
	OGURL           string // og:url
	OGImage         string // og:image (absolute URL)
	OGImageSize     int    // known square display variant; zero omits dimensions
	SiteName        string // og:site_name and title suffix
	OGLocale        string // og:locale (e.g. fi_FI, en_US)
	LangCode        string // negotiated language code for <html lang="">
	// Language versions of this page (WL175, D3): one address per published
	// language plus x-default, and their Open Graph locales.
	Alternates         []pageAlternate
	OGLocaleAlternates []string
}

// pageAlternate is one <link rel="alternate" hreflang> of a page.
type pageAlternate struct {
	Lang string
	URL  string
}

// isIndexingAllowed reports whether search engines may index the site. It is
// false whenever that cannot be known: robots.txt, the sitemap and every page
// then keep search engines out until the settings can be read again.
func isIndexingAllowed() bool {
	allowed, known := readIndexingPolicy()
	return allowed && known
}

// readIndexingPolicy reads system_config's 'allow_search_indexing' and
// 'login_to_browse'. Indexing is blocked when:
//   - allow_search_indexing is explicitly set to false, OR
//   - login_to_browse is true (content is behind authentication).
//
// A setting that does not exist leaves indexing allowed, as before; a setting
// that cannot be read answers known=false, so a database failure can no longer
// open a closed site to search engines.
func readIndexingPolicy() (allowed bool, known bool) {
	return readIndexingPolicyContext(context.Background())
}

// readIndexingPolicyContext is readIndexingPolicy bounded by ctx: a setting that
// cannot be read in time counts as unknown.
func readIndexingPolicyContext(ctx context.Context) (allowed bool, known bool) {
	if backend.Db == nil {
		return true, true
	}
	for _, setting := range []struct {
		key     string
		query   string
		blocked bool // the value that keeps search engines out
	}{
		{"allow_search_indexing", `SELECT boolean_value FROM system_config WHERE key = 'allow_search_indexing'`, false},
		{"login_to_browse", `SELECT boolean_value FROM system_config WHERE key = 'login_to_browse'`, true},
	} {
		var value sql.NullBool
		err := backend.Db.QueryRowContext(ctx, setting.query).Scan(&value)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			continue
		case err != nil:
			log.Printf("\033[31m[seo] indexing setting %s unreadable; search engines kept out: %v\033[0m", setting.key, err)
			return false, false
		case value.Valid && value.Bool == setting.blocked:
			return false, true
		}
	}
	return true, true
}

// resolvePageMeta inspects the request URL and returns SEO metadata.
// It tries to match the first URL segment to a dataset name and fetch
// translated titles/descriptions from system_lang_keys.
func resolvePageMeta(r *http.Request) pageMeta {
	segment := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/"), "/", 2)[0]
	dataset, exists := resolveDocumentDataset(segment)
	if !exists || segment == "admin" {
		return resolvePageMetaForDataset(r, nil)
	}
	return resolvePageMetaForDataset(r, &dataset)
}

// resolvePageMetaForDataset uses the exact pool rootHandler already authorized.
// Re-resolving its name here could select a different UID after an alias change.
// A generic or sign-in shell supplies nil and publishes only site metadata.
func resolvePageMetaForDataset(r *http.Request, dataset *dataset_routes.DatasetNamePool) pageMeta {
	siteName := resolvePageSiteName(r)
	// One language for the whole page, negotiated against the site's own enabled
	// languages and default (an explicit ?lang= first, then the browser's
	// weighted preferences), the same as the recovery and sign-in copy.
	language := lang.ResolvePageLanguage(r)
	shellBoot := frontendassets.NewShellBootData(r, language)
	favicon := frontendassets.NewSiteFaviconData(localFrontendDir, siteName, configuredFaviconReader(r.Context(), backend.Db))
	baseURL := resolveBaseURL(r)
	canonicalPath := r.URL.Path

	meta := pageMeta{
		SiteFaviconData: favicon,
		ShellBoot:       shellBoot,
		PageTitle:       siteName,
		MetaDescription: siteName,
		CanonicalURL:    baseURL + canonicalPath,
		OGTitle:         siteName,
		OGDescription:   siteName,
		OGType:          "website",
		OGURL:           baseURL + canonicalPath,
		OGImage:         baseURL + favicon.Favicon128Path,
		SiteName:        siteName,
		OGLocale:        langToLocale(language),
		LangCode:        language,
	}
	// Missing variants retain the resolver's original image; do not claim 128 px
	// dimensions for a 16 px or administrator-supplied PNG of unknown size.
	if strings.HasSuffix(favicon.Favicon128Path, "-128.png") {
		meta.OGImageSize = 128
	}

	if dataset == nil {
		preset := "default"
		if presentation, _, err := backend.ReadFrontPagePresentation(r.Context(), backend.Db); err == nil {
			preset = presentation.TextStyle.Preset
		}
		meta.MetaDescription = sitePreviewDescription(siteName, shellBoot.Texts, preset)
		meta.OGDescription = meta.MetaDescription
		return meta
	}

	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		return meta
	}
	segments := strings.SplitN(path, "/", 3)
	datasetName := dataset.DatasetName
	canonicalPath = buildCanonicalDatasetPath(dataset.PreferredName, segments)
	meta.CanonicalURL = baseURL + canonicalPath
	meta.OGURL = meta.CanonicalURL

	title := resolveDatasetTabTitle(datasetName, dataset.TableUID, language)

	// Fetch description / search slogan
	sloganKey := "search_slogan_" + datasetName
	description := fetchTranslation(sloganKey, language)
	if description == "" {
		// Fallback: use table description from system_db_tables
		description = fetchDatasetDescription(dataset.TableUID)
	}
	if description == "" {
		description = title
	}
	if description == "" {
		description = siteName
	}

	meta.PageTitle = composeBrowserTabTitle("", title, siteName)
	meta.MetaDescription = description
	meta.OGTitle = title
	meta.OGDescription = description
	meta.OGType = "website"

	// A row address (/{dataset}/{id}-{slug}) still gets the dataset's head here.
	// This function does not read rows: an earlier version printed the row's
	// header column with no rights or row rule (WL140). The article's own head is
	// added afterwards by applyArticleHead, from resolveArticleDocument, which reads
	// the row only as the signed-out visitor through the canonical row reader and
	// its rights, presentation and visibility checks (WL175).

	return meta
}

// applyArticleHead replaces the dataset head with the article's own: its title
// first in the browser tab, its description, its picture, og:type article and
// the canonical address. Everything comes from the visitor's read.
func applyArticleHead(meta *pageMeta, document articleDocument, baseURL string) {
	article := document.article
	datasetTitle := meta.OGTitle
	if article.Title != "" {
		meta.PageTitle = composeBrowserTabTitle(article.Title, datasetTitle, meta.SiteName)
		meta.OGTitle = article.Title
	}
	if description := articleExcerpt(article.Description, 300); description != "" {
		meta.MetaDescription = description
		meta.OGDescription = description
	} else if article.Title != "" {
		meta.MetaDescription = article.Title
		meta.OGDescription = article.Title
	}
	meta.OGType = "article"
	if document.canonicalPath != "" {
		meta.CanonicalURL = baseURL + document.canonicalPath
		meta.OGURL = meta.CanonicalURL
	}
	if image := absoluteSiteURL(baseURL, article.ImagePath); image != "" {
		meta.OGImage = image
		meta.OGImageSize = 0
	}
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
func resolveDatasetTabTitle(datasetName string, tableUID int, lang string) string {
	if title := datasetTitleTranslationReader(mainTabLangKey(datasetName), lang); title != "" {
		return title
	}
	if title := datasetTitleTranslationReader(datasetName+"_front_page", lang); title != "" {
		return title
	}
	if title := datasetDisplayNameReader(tableUID); title != "" {
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
// application tab's own label, then the site name. Empty parts are dropped. The
// server itself always passes an empty article title, because it never reads a row
// before authorisation (WL140); the parameter keeps the twin and the shared
// examples in step.
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

// buildCanonicalDatasetPath preserves the accepted pool's preferred name and row suffix.
func buildCanonicalDatasetPath(publicName string, segments []string) string {
	if publicName == "" {
		return "/"
	}

	path := "/" + publicName
	if len(segments) >= 2 && segments[1] != "" {
		path += "/" + segments[1]
	}
	return path
}

// langToLocale maps canonical shell and legacy dataset codes to Open Graph locales.
func langToLocale(lang string) string {
	switch lang {
	case "fi":
		return "fi_FI"
	case "ch", "zh-CN":
		return "zh_CN"
	case "zh-TW":
		return "zh_TW"
	case "zh-HK":
		return "zh_HK"
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

// fetchTranslation retrieves the copy one language is served for one key, from
// the site's language registry (its own column or the normalized translations).
func fetchTranslation(langKey string, language string) string {
	return lang.ReadDisplayTranslation(language, langKey)
}

// fetchDatasetDisplayName retrieves the administrator-given display name from
// system_db_tables, the same value the frontend reads from its table_specs cache.
func fetchDatasetDisplayName(tableUID int) string {
	if backend.Db == nil || tableUID <= 0 {
		return ""
	}
	var displayName sql.NullString
	err := backend.Db.QueryRow(`SELECT display_name FROM system_db_tables WHERE table_uid = $1`, tableUID).Scan(&displayName)
	if err != nil || !displayName.Valid {
		return ""
	}
	return strings.TrimSpace(displayName.String)
}

// fetchDatasetDescription retrieves the description column from system_db_tables.
func fetchDatasetDescription(tableUID int) string {
	if backend.Db == nil || tableUID <= 0 {
		return ""
	}
	var desc sql.NullString
	err := backend.Db.QueryRow(`SELECT description FROM system_db_tables WHERE table_uid = $1`, tableUID).Scan(&desc)
	if err != nil {
		return ""
	}
	if desc.Valid {
		return strings.TrimSpace(desc.String)
	}
	return ""
}

// =====================================================
//  SITEMAP XML ENDPOINT
//  Generates /sitemap.xml dynamically from public datasets.
// =====================================================

// urlEntry represents a single <url> element in sitemap XML.
type urlEntry struct {
	XMLName    xml.Name           `xml:"url"`
	Loc        string             `xml:"loc"`
	LastMod    string             `xml:"lastmod,omitempty"`
	ChangeFreq string             `xml:"changefreq,omitempty"`
	Priority   string             `xml:"priority,omitempty"`
	Alternates []sitemapAlternate `xml:"xhtml:link"`
}

// sitemapAlternate is one language version of an address (xhtml:link, D3).
type sitemapAlternate struct {
	Rel      string `xml:"rel,attr"`
	Hreflang string `xml:"hreflang,attr"`
	Href     string `xml:"href,attr"`
}

// urlSet represents the root <urlset> element in sitemap XML.
type urlSet struct {
	XMLName xml.Name   `xml:"urlset"`
	XMLNS   string     `xml:"xmlns,attr"`
	XHTML   string     `xml:"xmlns:xhtml,attr,omitempty"`
	URLs    []urlEntry `xml:"url"`
}

// sitemapLanguageVersions turns one page into its sitemap entries: one per
// language version, each naming every version and the x-default address, or the
// single unqualified address when the page has fewer than two versions.
func sitemapLanguageVersions(entry urlEntry, defaultAddress string, versions map[string]string, order []string) []urlEntry {
	var present []string
	for _, code := range order {
		if _, exists := versions[code]; exists {
			present = append(present, code)
		}
	}
	if len(present) < 2 {
		entry.Loc = defaultAddress
		return []urlEntry{entry}
	}
	alternates := make([]sitemapAlternate, 0, len(present)+1)
	for _, code := range present {
		alternates = append(alternates, sitemapAlternate{Rel: "alternate", Hreflang: code, Href: versions[code]})
	}
	alternates = append(alternates, sitemapAlternate{Rel: "alternate", Hreflang: "x-default", Href: defaultAddress})
	entries := make([]urlEntry, 0, len(present))
	for _, code := range present {
		version := entry
		version.Loc = versions[code]
		version.Alternates = alternates
		entries = append(entries, version)
	}
	return entries
}

// sitemapPartSize is how many addresses one sitemap document lists (the plan's
// threshold, well under the protocol's 50,000). A site with more is announced
// as a sitemap index whose parts are /sitemap.xml?part=1, ?part=2, ….
const sitemapPartSize = 10000

// sitemapBudget bounds one sitemap answer as a whole, however many datasets and
// pages it reads; a sitemap that cannot finish in time answers 503.
var sitemapBudget = 25 * time.Second

// sitemapListPageSize is the bounded page each list read asks for.
const sitemapListPageSize = 20

// sitemapIndex is the root <sitemapindex> of a sitemap split into parts.
type sitemapIndex struct {
	XMLName  xml.Name          `xml:"sitemapindex"`
	XMLNS    string            `xml:"xmlns,attr"`
	Sitemaps []sitemapIndexRef `xml:"sitemap"`
}

type sitemapIndexRef struct {
	Loc string `xml:"loc"`
}

// sitemapHandler lists what a signed-out visitor can open: Home, each dataset
// in the visitor's main menu (owner decision D2, WL175) and every article the
// visitor may read in those datasets, at its canonical address with the words
// of its title in the site's default language (K428). Everything is read as the
// visitor through the canonical row reader, so the sitemap can never name a row
// or dataset a visitor may not read. A date is given only when the visitor may
// read the row's own modification time. The answer is not cached: a sitemap
// read later must not list a row whose rights have since changed. When the
// settings or the catalogue cannot be read, or the whole answer cannot finish
// within sitemapBudget, the answer is 503, so search engines retry instead of
// dropping the site's addresses.
func sitemapHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	ctx, cancel := context.WithTimeout(r.Context(), sitemapBudget)
	defer cancel()
	allowed, known := readIndexingPolicyContext(ctx)
	if !known {
		http.Error(w, "sitemap temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if !allowed {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, xml.Header)
		fmt.Fprint(w, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`)
		return
	}

	baseURL := resolveBaseURL(r)
	urls, err := collectSitemapURLs(ctx, baseURL)
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		log.Printf("\033[31m[sitemapHandler] sitemap unavailable: %v\033[0m", err)
		http.Error(w, "sitemap temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	parts := (len(urls) + sitemapPartSize - 1) / sitemapPartSize
	var document any = newURLSet(urls)
	if rawPart := r.URL.Query().Get("part"); rawPart != "" {
		part, err := strconv.Atoi(rawPart)
		if err != nil || part < 1 || part > parts || parts < 2 {
			http.NotFound(w, r)
			return
		}
		end := part * sitemapPartSize
		if end > len(urls) {
			end = len(urls)
		}
		document = newURLSet(urls[(part-1)*sitemapPartSize : end])
	} else if parts > 1 {
		index := sitemapIndex{XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
		for part := 1; part <= parts; part++ {
			index.Sitemaps = append(index.Sitemaps, sitemapIndexRef{Loc: baseURL + "/sitemap.xml?part=" + strconv.Itoa(part)})
		}
		document = index
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, xml.Header)
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(document); err != nil {
		log.Printf("\033[31m[sitemapHandler] encode error: %v\033[0m", err)
	}
}

// newURLSet wraps entries in a <urlset>, declaring the xhtml namespace only
// when some entry names its language versions.
func newURLSet(urls []urlEntry) urlSet {
	set := urlSet{XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: urls}
	for _, entry := range urls {
		if len(entry.Alternates) > 0 {
			set.XHTML = "http://www.w3.org/1999/xhtml"
			break
		}
	}
	return set
}

// collectSitemapURLs reads every address the sitemap announces, in order: Home,
// then each published dataset followed by its articles, newest first.
func collectSitemapURLs(ctx context.Context, baseURL string) ([]urlEntry, error) {
	datasets, err := publicArticlesDatasetsReader(ctx)
	if err != nil {
		return nil, fmt.Errorf("published datasets: %w", err)
	}
	languages := pageLanguagesReader(ctx)
	language := languages.Default
	pageVersions := func(path string) map[string]string {
		versions := map[string]string{}
		for _, code := range languages.Published {
			versions[code] = baseURL + path + "?lang=" + url.QueryEscape(code)
		}
		return versions
	}
	urls := sitemapLanguageVersions(urlEntry{ChangeFreq: "daily", Priority: "1.0"}, baseURL+"/", pageVersions("/"), languages.Published)
	for _, dataset := range datasets {
		datasetPath := "/" + url.PathEscape(dataset.PreferredName)
		datasetStart := len(urls)
		urls = append(urls, sitemapLanguageVersions(urlEntry{ChangeFreq: "daily", Priority: "0.8"},
			baseURL+datasetPath, pageVersions(datasetPath), languages.Published)...)
		datasetEnd := len(urls)
		var newest time.Time
		for offset := 0; ; {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			articles, more, err := publicArticlesListReader(ctx, dataset, offset, sitemapListPageSize, language)
			if err != nil {
				return nil, fmt.Errorf("articles of %s: %w", dataset.Name, err)
			}
			for _, article := range articles {
				entry := urlEntry{}
				if !article.Updated.IsZero() {
					entry.LastMod = article.Updated.UTC().Format(time.RFC3339)
					if article.Updated.After(newest) {
						newest = article.Updated
					}
				}
				versions := map[string]string{}
				for _, code := range article.TitleLanguages {
					if languages.Publishes(code) {
						versions[code] = baseURL + articleAddressFor(url.PathEscape(dataset.PreferredName), article, code, language)
					}
				}
				urls = append(urls, sitemapLanguageVersions(entry,
					baseURL+articleAddressFor(url.PathEscape(dataset.PreferredName), article, "", language), versions, languages.Published)...)
			}
			if !more || len(articles) == 0 {
				break
			}
			offset += len(articles)
		}
		if !newest.IsZero() {
			for index := datasetStart; index < datasetEnd; index++ {
				urls[index].LastMod = newest.UTC().Format(time.RFC3339)
			}
		}
	}
	return urls, nil
}
