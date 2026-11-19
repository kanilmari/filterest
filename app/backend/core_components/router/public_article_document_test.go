// public_article_document_test.go
// Pins what an article address answers once the visitor reader has looked the row up.
// Bridges rootHandler/tablesHandler with resolveArticleDocument, the redirect and "not found" rules (K428, WL175).
// The reader itself is stubbed here; its rights and row rules are proven against PostgreSQL in system_table_tools.
package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/system_table_tools"
)

const articleTestTitle = "The newest service"

func setupArticleSite(t *testing.T, loginToBrowse bool) {
	t.Helper()
	t.Setenv("BASE_URL", sitemapTestBaseURL)
	setupRootHandlerMockDB(t, loginToBrowse)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	stubPublicArticleReads(t, map[string]system_table_tools.PublicArticle{
		"app_service_catalog/125": {
			ID: "125", Title: articleTestTitle, TitleLanguage: "en", TitleLanguages: []string{"en", "fi"},
			Description: "Opens every morning. " + strings.Repeat("A long sentence about the service. ", 20),
			ImagePath:   "/storage/7/125/original/7_125_3.jpg",
			Slugs:       map[string]string{"en": "the-newest-service", "fi": "uusin-palvelu"},
		},
		// A title with no Latin letters has empty address words in every language.
		"app_service_catalog/126": {
			ID: "126", Title: "全部文章", TitleLanguage: "yue", TitleLanguages: []string{"yue"},
			Slugs: map[string]string{"en": "", "fi": "", "yue": ""},
		},
	})
}

func openAsVisitor(t *testing.T, target string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	rootHandler(response, httptest.NewRequest(http.MethodGet, target, nil))
	return response
}

func TestArticleAddressCarriesTheArticlesOwnHead(t *testing.T) {
	setupArticleSite(t, false)
	response := openAsVisitor(t, "/service_catalog/125-the-newest-service")
	body := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, body)
	}
	for _, want := range []string{
		"<title>" + articleTestTitle + " — ",
		`<link rel="canonical" href="` + sitemapTestBaseURL + `/service_catalog/125-the-newest-service">`,
		`<meta property="og:title" content="` + articleTestTitle + `">`,
		`<meta name="description" content="Opens every morning. A long sentence`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, strings.Repeat("A long sentence about the service. ", 20)) {
		t.Error("the description tag carries the whole text instead of an excerpt")
	}
}

func TestArticleHeadNamesPictureTypeAndAbsoluteAddresses(t *testing.T) {
	setupArticleSite(t, false)
	request := httptest.NewRequest(http.MethodGet, "/service_catalog/125-the-newest-service", nil)
	dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
	meta := resolvePageMetaForDataset(request, &dataset)
	document := resolveArticleDocument(request, &dataset, false, meta.LangCode)
	if document.outcome != articleDocumentFound {
		t.Fatalf("outcome = %v", document.outcome)
	}
	applyArticleHead(&meta, document, sitemapTestBaseURL)
	if meta.OGType != "article" || meta.OGImage != sitemapTestBaseURL+"/storage/7/125/original/7_125_3.jpg" || meta.OGImageSize != 0 {
		t.Fatalf("article preview: type %q image %q size %d", meta.OGType, meta.OGImage, meta.OGImageSize)
	}
	if meta.CanonicalURL != sitemapTestBaseURL+"/service_catalog/125-the-newest-service" || meta.OGURL != meta.CanonicalURL {
		t.Fatalf("canonical %q og:url %q", meta.CanonicalURL, meta.OGURL)
	}
}

func TestArticleAddressRedirectsPermanentlyToItsCanonicalWords(t *testing.T) {
	setupArticleSite(t, false)
	for _, c := range []struct{ target, location string }{
		{"/service_catalog/125", "/service_catalog/125-the-newest-service"},
		{"/service_catalog/125-", "/service_catalog/125-the-newest-service"},
		{"/service_catalog/125-old-name-of-the-service", "/service_catalog/125-the-newest-service"},
		{"/service_catalog/125-old-words?view=article_view", "/service_catalog/125-the-newest-service?view=article_view"},
		{"/app_service_catalog/125", "/service_catalog/125-the-newest-service"},
		{"/service_catalog/125-stale?lang=fi", "/service_catalog/125-uusin-palvelu?lang=fi"},
	} {
		response := openAsVisitor(t, c.target)
		if response.Code != http.StatusMovedPermanently || response.Header().Get("Location") != c.location {
			t.Errorf("%s: status %d Location %q, want 301 to %q", c.target, response.Code, response.Header().Get("Location"), c.location)
		}
	}
}

func TestArticleAddressInAnotherLanguagesWordsIsNotRedirected(t *testing.T) {
	setupArticleSite(t, false)
	for _, c := range []struct{ target, canonical string }{
		// The application writes the reader's own language into the address.
		{"/service_catalog/125-uusin-palvelu", "/service_catalog/125-the-newest-service"},
		{"/service_catalog/125-the-newest-service?lang=fi", "/service_catalog/125-uusin-palvelu?lang=fi"},
		{"/service_catalog/125-uusin-palvelu?lang=fi", "/service_catalog/125-uusin-palvelu?lang=fi"},
		// An alias with the right words keeps working; its canonical names the preferred address.
		{"/app_service_catalog/125-the-newest-service", "/service_catalog/125-the-newest-service"},
	} {
		response := openAsVisitor(t, c.target)
		want := `<link rel="canonical" href="` + sitemapTestBaseURL + strings.ReplaceAll(c.canonical, "?", "?") + `">`
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), want) {
			t.Errorf("%s: status %d, want 200 with %s:\n%s", c.target, response.Code, want, response.Body.String())
		}
	}
}

func TestMissingOrRefusedArticleAnswersNotFoundToAVisitor(t *testing.T) {
	setupArticleSite(t, false)
	response := openAsVisitor(t, "/service_catalog/999-whatever")
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}
	if !strings.Contains(response.Body.String(), "root-shell") || strings.Contains(response.Body.String(), articleTestTitle) {
		t.Fatalf("not-found page: %s", response.Body.String())
	}
}

func TestMissingArticleStillOpensTheApplicationForASignedInPerson(t *testing.T) {
	setupArticleSite(t, false)
	request := httptest.NewRequest(http.MethodGet, "/service_catalog/999-whatever", nil)
	attachRootHandlerSessionUser(t, request, 42)
	response := httptest.NewRecorder()
	dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
	tablesHandler(response, request, false, &dataset)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "root-shell") {
		t.Fatalf("signed-in person: status %d, body %s", response.Code, response.Body.String())
	}
}

func TestUnreadableArticleKeepsTheDatasetHead(t *testing.T) {
	setupArticleSite(t, false)
	stubPublicArticleReads(t, nil) // every read is "unavailable"
	response := openAsVisitor(t, "/service_catalog/125-the-newest-service")
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), articleTestTitle) ||
		!strings.Contains(response.Body.String(), `/service_catalog/125-the-newest-service">`) {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
}

func TestSignInOnlySiteNeverReadsAnArticle(t *testing.T) {
	setupArticleSite(t, true)
	publicArticleReader = func(context.Context, system_table_tools.PublicArticleDataset, string, string) (system_table_tools.PublicArticle, system_table_tools.PublicArticleStatus) {
		t.Fatal("a site behind sign-in read an article for its page")
		return system_table_tools.PublicArticle{}, system_table_tools.PublicArticleUnavailable
	}
	request := httptest.NewRequest(http.MethodGet, "/service_catalog/125", nil)
	attachRootHandlerSessionUser(t, request, 42)
	dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
	if document := resolveArticleDocument(request, &dataset, true, "en"); document.outcome != articleDocumentNone {
		t.Fatalf("outcome = %v", document.outcome)
	}
}

func TestOnlyRowAddressesAreArticleAddresses(t *testing.T) {
	setupArticleSite(t, false)
	dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
	for _, target := range []string{"/service_catalog", "/service_catalog/", "/service_catalog/new", "/service_catalog/125-x/edit"} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		if document := resolveArticleDocument(request, &dataset, false, "en"); document.outcome != articleDocumentNone {
			t.Errorf("%s: outcome = %v, want none", target, document.outcome)
		}
	}
	post := httptest.NewRequest(http.MethodPost, "/service_catalog/125", nil)
	if document := resolveArticleDocument(post, &dataset, false, "en"); document.outcome != articleDocumentNone {
		t.Errorf("POST: outcome = %v, want none", document.outcome)
	}
}

func TestArticleExcerptKeepsWholeWords(t *testing.T) {
	if got := articleExcerpt("short text", 300); got != "short text" {
		t.Fatalf("short: %q", got)
	}
	got := articleExcerpt(strings.Repeat("word ", 100), 30)
	if !strings.HasSuffix(got, "word…") || len([]rune(got)) > 31 {
		t.Fatalf("excerpt = %q", got)
	}
}

func TestArticleWithoutAddressWordsIsCanonicalAtItsBareIDAndNeverLoops(t *testing.T) {
	setupArticleSite(t, false)
	for _, target := range []string{"/service_catalog/126", "/service_catalog/126?view=article_view"} {
		response := openAsVisitor(t, target)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `/service_catalog/126">`) {
			t.Errorf("%s: status %d Location %q", target, response.Code, response.Header().Get("Location"))
		}
	}
	response := openAsVisitor(t, "/service_catalog/126-some-old-words")
	if response.Code != http.StatusMovedPermanently || response.Header().Get("Location") != "/service_catalog/126" {
		t.Fatalf("stale words: status %d Location %q", response.Code, response.Header().Get("Location"))
	}
}
