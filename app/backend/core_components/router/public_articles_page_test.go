// public_articles_page_test.go
// Pins the plain article pages (/articles, /articles/{dataset}) and the language addresses of page heads.
// The visitor reads are stubbed; their rights are proven against PostgreSQL in system_table_tools.
package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/system_table_tools"
)

func setupPlainArticlePages(t *testing.T, loginToBrowse bool, count int) {
	t.Helper()
	setupArticleSite(t, loginToBrowse)
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "public_articles.html"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localFrontendDir, "public_articles.html"), source, 0o644); err != nil {
		t.Fatal(err)
	}
	original := publicArticlesLoginToBrowse
	publicArticlesLoginToBrowse = func() (bool, error) { return loginToBrowse, nil }
	t.Cleanup(func() { publicArticlesLoginToBrowse = original })
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return []system_table_tools.PublicArticleDataset{{TableUID: 7, Name: "app_service_catalog", PreferredName: "service_catalog"}}, nil
	}
	publicArticlesListReader = func(_ context.Context, _ system_table_tools.PublicArticleDataset, offset, size int, _ string) ([]system_table_tools.PublicArticle, bool, error) {
		var page []system_table_tools.PublicArticle
		for id := offset; id < count && len(page) < size; id++ {
			page = append(page, system_table_tools.PublicArticle{ID: strconv.Itoa(1000 - id), Title: "Article <" + strconv.Itoa(id) + ">",
				Description: "About it.", Slugs: map[string]string{"en": "article-" + strconv.Itoa(id), "fi": "artikkeli-" + strconv.Itoa(id)}})
		}
		return page, offset+len(page) < count, nil
	}
}

func openPlainPage(t *testing.T, target string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	publicArticlesHandler(response, httptest.NewRequest(http.MethodGet, target, nil))
	return response
}

func TestPlainIndexListsNewestArticlesWithOrdinaryLinks(t *testing.T) {
	setupPlainArticlePages(t, false, 25)
	response := openPlainPage(t, "/articles")
	body := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, body)
	}
	for _, want := range []string{
		`<h1>All articles</h1>`,
		`<a href="/service_catalog/1000-article-0">Article &lt;0&gt;</a>`,
		`<a href="/articles/service_catalog">More articles</a>`,
		`<link rel="canonical" href="` + sitemapTestBaseURL + `/articles">`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("index lacks %q", want)
		}
	}
	if strings.Count(body, `<li>`) != publicArticlesIndexPerDataset || strings.Contains(body, "<script src") {
		t.Errorf("index shows %d articles (want %d) or loads the application", strings.Count(body, `<li>`), publicArticlesIndexPerDataset)
	}
}

func TestPlainDatasetListPagesThroughEveryArticle(t *testing.T) {
	setupPlainArticlePages(t, false, 25)
	first := openPlainPage(t, "/articles/service_catalog").Body.String()
	if strings.Count(first, `<li>`) != publicArticlesPageSize || !strings.Contains(first, `href="/articles/service_catalog?page=2" rel="next"`) ||
		strings.Contains(first, `rel="prev"`) {
		t.Fatalf("first page:\n%s", first)
	}
	second := openPlainPage(t, "/articles/service_catalog?page=2")
	body := second.Body.String()
	if second.Code != http.StatusOK || strings.Count(body, `<li>`) != 5 || !strings.Contains(body, `href="/articles/service_catalog" rel="prev"`) ||
		strings.Contains(body, `rel="next"`) || !strings.Contains(body, `/articles/service_catalog?page=2">`) {
		t.Fatalf("second page %d:\n%s", second.Code, body)
	}
	finnish := openPlainPage(t, "/articles/service_catalog?lang=fi").Body.String()
	if !strings.Contains(finnish, `<a href="/service_catalog/1000-artikkeli-0?lang=fi">`) {
		t.Fatalf("Finnish address words missing:\n%s", finnish)
	}
	for _, target := range []string{"/articles/service_catalog?page=3", "/articles/service_catalog?page=0", "/articles/service_catalog?page=x",
		"/articles/unknown_dataset", "/articles/service_catalog/extra"} {
		if code := openPlainPage(t, target).Code; code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, code)
		}
	}
	if response := openPlainPage(t, "/articles/app_service_catalog?page=2"); response.Code != http.StatusMovedPermanently ||
		response.Header().Get("Location") != "/articles/service_catalog?page=2" {
		t.Errorf("alias: status %d Location %q", response.Code, response.Header().Get("Location"))
	}
}

func TestPlainPagesDoNotExistOnASignInOnlySite(t *testing.T) {
	setupPlainArticlePages(t, true, 3)
	for _, target := range []string{"/articles", "/articles/service_catalog"} {
		if code := openPlainPage(t, target).Code; code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, code)
		}
	}
}

func TestPageHeadsNameEveryLanguageVersion(t *testing.T) {
	languages := lang.PageLanguages{Enabled: []string{"en", "fi", "sv"}, Published: []string{"en", "fi"}, Default: "en"}
	article := system_table_tools.PublicArticle{ID: "125", TitleLanguages: []string{"fi", "en", "sv"},
		Slugs: map[string]string{"en": "the-newest-service", "fi": "uusin-palvelu", "sv": "den-nyaste"}}
	document := articleDocument{outcome: articleDocumentFound, article: article, canonicalPath: "/service_catalog/125-the-newest-service"}
	meta := pageMeta{CanonicalURL: sitemapTestBaseURL + "/service_catalog/125-the-newest-service", OGLocale: "en_US"}
	applyLanguageAddresses(&meta, httptest.NewRequest(http.MethodGet, "/service_catalog/125-the-newest-service", nil), document, languages, sitemapTestBaseURL)
	var got []string
	for _, alternate := range meta.Alternates {
		got = append(got, alternate.Lang+"="+strings.TrimPrefix(alternate.URL, sitemapTestBaseURL))
	}
	want := "en=/service_catalog/125-the-newest-service?lang=en fi=/service_catalog/125-uusin-palvelu?lang=fi x-default=/service_catalog/125-the-newest-service"
	if strings.Join(got, " ") != want || strings.Join(meta.OGLocaleAlternates, ",") != "fi_FI" {
		t.Fatalf("article alternates %q locales %v", strings.Join(got, " "), meta.OGLocaleAlternates)
	}

	single := document
	single.article.TitleLanguages = nil
	meta = pageMeta{CanonicalURL: sitemapTestBaseURL + "/service_catalog/125-the-newest-service"}
	applyLanguageAddresses(&meta, httptest.NewRequest(http.MethodGet, "/service_catalog/125", nil), single, languages, sitemapTestBaseURL)
	if len(meta.Alternates) != 0 {
		t.Fatalf("a single-language article got alternates: %v", meta.Alternates)
	}

	meta = pageMeta{CanonicalURL: sitemapTestBaseURL + "/service_catalog", OGURL: sitemapTestBaseURL + "/service_catalog", OGLocale: "fi_FI"}
	applyLanguageAddresses(&meta, httptest.NewRequest(http.MethodGet, "/service_catalog?lang=fi", nil), articleDocument{}, languages, sitemapTestBaseURL)
	if meta.CanonicalURL != sitemapTestBaseURL+"/service_catalog?lang=fi" || meta.OGURL != meta.CanonicalURL || len(meta.Alternates) != 3 ||
		meta.Alternates[2].URL != sitemapTestBaseURL+"/service_catalog" {
		t.Fatalf("dataset page: %+v", meta)
	}
}

func TestReadableFallbackCarriesTheArticleOutsideTheShell(t *testing.T) {
	setupArticleSite(t, false)
	stubPublicArticleReads(t, map[string]system_table_tools.PublicArticle{"app_service_catalog/125": {
		ID: "125", Title: "Open <every> morning", Paragraphs: []string{"First & second.", "<script>alert(1)</script>"},
		ImagePath: "/storage/7/125/original/7_125_3.jpg", Slugs: map[string]string{"en": "open-every-morning"},
	}})
	request := httptest.NewRequest(http.MethodGet, "/service_catalog/125-open-every-morning", nil)
	dataset := dataset_routes.DatasetNamePool{DatasetName: "app_service_catalog", PreferredName: "service_catalog", SchemaName: "public", TableUID: 7}
	document := resolveArticleDocument(request, &dataset, false, "en")
	fallback := buildServerFallback(request.Context(), request, &dataset, "Service catalog", document, false, "en", "All articles")
	if fallback == nil || fallback.Article == nil || fallback.Article.Title != "Open <every> morning" || len(fallback.Links) != 2 ||
		fallback.Links[0].URL != "/service_catalog" || fallback.Links[1].URL != "/articles" {
		t.Fatalf("fallback = %+v", fallback)
	}
	if buildServerFallback(request.Context(), request, &dataset, "Service catalog", document, true, "en", "All articles") != nil {
		t.Fatal("a sign-in-only site printed a fallback")
	}
}

func TestPlainIndexNeverTakesOverADatasetNamedArticles(t *testing.T) {
	setupPlainArticlePages(t, false, 3)
	original := articlesNameIsOwnedByADataset
	articlesNameIsOwnedByADataset = func() bool { return true }
	t.Cleanup(func() { articlesNameIsOwnedByADataset = original })
	response := openPlainPage(t, "/articles")
	if strings.Contains(response.Body.String(), "<h1>All articles</h1>") {
		t.Fatalf("the plain index answered an address an existing dataset owns: %d", response.Code)
	}
}
