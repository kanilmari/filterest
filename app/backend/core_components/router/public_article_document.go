// public_article_document.go
// Decides what an article address (/{dataset}/{id}-{words}) answers before the page is printed.
// Between rootHandler's dataset authorisation and the visitor reader in system_table_tools.
// Exists so each article has its own title, description, picture and one canonical address (WL175, K428).
package router

import (
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/lang"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_table_tools"
)

// articleDocumentOutcome is what an address answers once its article was looked up.
type articleDocumentOutcome int

const (
	// articleDocumentNone: not an article address, or the read could not finish.
	// The page keeps the dataset's own head, as before articles were read.
	articleDocumentNone articleDocumentOutcome = iota
	// articleDocumentFound: the page carries the article's own head.
	articleDocumentFound
	// articleDocumentRedirect: the address names a readable article but not by
	// its canonical words; the answer is a permanent redirect to them.
	articleDocumentRedirect
	// articleDocumentNotFound: no row the signed-out visitor may read has this id.
	articleDocumentNotFound
)

// articleDocument is the decision for one article address.
type articleDocument struct {
	outcome       articleDocumentOutcome
	article       system_table_tools.PublicArticle
	canonicalPath string              // path (and ?lang=) of the article's canonical address
	location      string              // redirect target, with the request's own query kept
	languages     *lang.PageLanguages // the site's languages, when the lookup read them
}

// pageLanguagesOf answers the site's languages, reusing the article lookup's read.
func (document articleDocument) pageLanguagesOf(r *http.Request) lang.PageLanguages {
	if document.languages != nil {
		return *document.languages
	}
	return pageLanguagesReader(r.Context())
}

// The reads an article address makes, named so tests can answer them without a database.
var (
	publicArticleReader    = system_table_tools.ReadPublicArticle
	pageLanguagesReader    = lang.ReadPageLanguages
	requestIsSignedInCheck = requestIsSignedIn
)

// resolveArticleDocument reads the article an address names, always as the
// signed-out visitor and only on a site visitors may browse without signing in.
// The page shows public content only, so the requester's own rights never widen
// it (WL140); a signed-in person sees the rest in the application itself.
//
// The canonical words are the title's in the address language: an explicit
// enabled ?lang= value, otherwise the site's default language. Words built from
// the title in any enabled language are accepted without a redirect, because
// the application writes the reader's own language into the address; anything
// else, or no words, is redirected permanently to the canonical address.
func resolveArticleDocument(r *http.Request, dataset *dataset_routes.DatasetNamePool, loginToBrowse bool, pageLanguage string) articleDocument {
	if dataset == nil || loginToBrowse || r.Method != http.MethodGet && r.Method != http.MethodHead {
		return articleDocument{}
	}
	segments := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/"), "/", 3)
	if len(segments) < 2 || (len(segments) == 3 && segments[2] != "") {
		return articleDocument{}
	}
	rowID, incomingWords, ok := dataset_routes.ParseArticleRowSegment(segments[1])
	if !ok {
		return articleDocument{}
	}
	languages := pageLanguagesReader(r.Context())
	addressLanguage := explicitAddressLanguage(r, languages)
	slugLanguage := addressLanguage
	if slugLanguage == "" {
		slugLanguage = languages.Default
	}
	article, status := publicArticleReader(r.Context(), system_table_tools.PublicArticleDataset{
		TableUID: dataset.TableUID, Name: dataset.DatasetName, PreferredName: dataset.PreferredName,
	}, rowID, pageLanguage)
	switch status {
	case system_table_tools.PublicArticleNotFound:
		return articleDocument{outcome: articleDocumentNotFound, languages: &languages}
	case system_table_tools.PublicArticleFound:
	default:
		return articleDocument{}
	}

	canonicalWords, titled := article.Slugs[slugLanguage]
	if !titled {
		canonicalWords = article.Slugs[pageLanguage]
	}
	canonicalPath := "/" + url.PathEscape(dataset.PreferredName) + "/" + rowID
	if canonicalWords != "" {
		canonicalPath += "-" + canonicalWords
	}
	if addressLanguage != "" {
		canonicalPath += "?lang=" + url.QueryEscape(addressLanguage)
	}
	document := articleDocument{outcome: articleDocumentFound, article: article, canonicalPath: canonicalPath, languages: &languages}

	if len(article.Slugs) == 0 {
		// No title the server can read: the words cannot be judged, so none is
		// redirected and the canonical address is the bare row id.
		return document
	}
	// Equal words, including no words for a title with no Latin letters, are the canonical address.
	if incomingWords == canonicalWords {
		return document
	}
	if incomingWords != "" {
		for _, words := range article.Slugs {
			if incomingWords == words {
				return document
			}
		}
	}
	// The redirect names the dataset by its preferred name too, so an alias with
	// stale words reaches the canonical address in one step.
	location := "/" + url.PathEscape(dataset.PreferredName) + "/" + rowID
	if canonicalWords != "" {
		location += "-" + canonicalWords
	}
	if r.URL.RawQuery != "" {
		location += "?" + r.URL.RawQuery
	}
	if location == r.URL.RequestURI() {
		// Never redirect an address to itself, whatever the words turned out to be.
		return document
	}
	document.outcome = articleDocumentRedirect
	document.location = location
	return document
}

// explicitAddressLanguage is the ?lang= value when it names a published
// language exactly; any other value leaves the address without a language of
// its own. The browser application applies the same rule.
func explicitAddressLanguage(r *http.Request, languages lang.PageLanguages) string {
	requested := strings.TrimSpace(r.URL.Query().Get("lang"))
	if requested != "" && languages.Publishes(requested) {
		return requested
	}
	return ""
}

// requestIsSignedIn reports whether the request belongs to a person who signed
// in, as opposed to the signed-out visitor identity rootHandler gives guests.
func requestIsSignedIn(r *http.Request) bool {
	userID, err := e_sessions.GetUserIDFromSession(r)
	return err == nil && userID > 1
}

// articleExcerpt shortens plain text for a description tag: whole words, at
// most limit characters, with an ellipsis when cut.
func articleExcerpt(text string, limit int) string {
	text = strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	cut := limit
	for cut > limit/2 && !unicode.IsSpace(runes[cut]) {
		cut--
	}
	if cut <= limit/2 {
		cut = limit
	}
	return strings.TrimRightFunc(string(runes[:cut]), func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) }) + "…"
}

// absoluteSiteURL turns a site path into an absolute address on the canonical
// origin; an absolute address stays as it is.
func absoluteSiteURL(baseURL, path string) string {
	switch {
	case path == "":
		return ""
	case strings.HasPrefix(path, "https://") || strings.HasPrefix(path, "http://"):
		return path
	case strings.HasPrefix(path, "//"):
		return "https:" + path
	case strings.HasPrefix(path, "/"):
		return baseURL + path
	default:
		return baseURL + "/" + path
	}
}

// applyLanguageAddresses gives a page its language addresses (owner decision D3):
// every published language has its own address (?lang=xx, and for an article
// that language's words), the unqualified address is x-default and keeps the
// visitor's negotiated language, and a page opened in an explicit language is
// canonical at its own address. An article lists only the languages its title
// exists in; an article whose title has a single language gets no alternates.
func applyLanguageAddresses(meta *pageMeta, r *http.Request, document articleDocument, languages lang.PageLanguages, baseURL string) {
	addressLanguage := explicitAddressLanguage(r, languages)
	path := strings.SplitN(meta.CanonicalURL, "?", 2)[0]
	if document.outcome != articleDocumentFound {
		if addressLanguage != "" {
			meta.CanonicalURL = path + "?lang=" + url.QueryEscape(addressLanguage)
			meta.OGURL = meta.CanonicalURL
		}
		if len(languages.Published) < 2 {
			return
		}
		for _, code := range languages.Published {
			meta.Alternates = append(meta.Alternates, pageAlternate{Lang: code, URL: path + "?lang=" + url.QueryEscape(code)})
		}
		meta.Alternates = append(meta.Alternates, pageAlternate{Lang: "x-default", URL: path})
		applyLocaleAlternates(meta, languages.Published)
		return
	}
	article := document.article
	var versions []string
	for _, code := range languages.Published {
		for _, available := range article.TitleLanguages {
			if available == code {
				versions = append(versions, code)
			}
		}
	}
	if len(versions) < 2 {
		return
	}
	articleBase := strings.SplitN(document.canonicalPath, "/", 3)
	if len(articleBase) < 3 {
		return
	}
	for _, code := range versions {
		meta.Alternates = append(meta.Alternates, pageAlternate{Lang: code,
			URL: baseURL + articleAddressFor(articleBase[1], article, code, languages.Default)})
	}
	meta.Alternates = append(meta.Alternates, pageAlternate{Lang: "x-default",
		URL: baseURL + articleAddressFor(articleBase[1], article, "", languages.Default)})
	applyLocaleAlternates(meta, versions)
}

// articleAddressFor is an article's address in one language, given the escaped
// dataset segment: that language's words and ?lang=, or with "" the unqualified
// address with the words of the site's default language (K428, D3). Lists, the
// sitemap and language alternates all build article links here.
func articleAddressFor(datasetSegment string, article system_table_tools.PublicArticle, addressLanguage, defaultLanguage string) string {
	language := addressLanguage
	if language == "" {
		language = defaultLanguage
	}
	path := "/" + datasetSegment + "/" + article.ID
	if words := article.Slugs[language]; words != "" {
		path += "-" + words
	}
	if addressLanguage != "" {
		path += "?lang=" + url.QueryEscape(addressLanguage)
	}
	return path
}

func applyLocaleAlternates(meta *pageMeta, versions []string) {
	for _, code := range versions {
		if locale := langToLocale(code); locale != meta.OGLocale {
			meta.OGLocaleAlternates = append(meta.OGLocaleAlternates, locale)
		}
	}
}
