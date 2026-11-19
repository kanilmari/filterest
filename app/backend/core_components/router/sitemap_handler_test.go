// sitemap_handler_test.go
// Verifies what /sitemap.xml and /robots.txt tell search engines, given what the visitor reader answers.
// Bridges the sitemap and robots documents with the indexing settings and the published-article reads.
// Which datasets and rows a signed-out visitor may read is proven against real PostgreSQL grants and
// row rules in system_table_tools (public_article_reader_postgres_test.go); here the reads are stubbed.
package router

import (
	"context"
	"database/sql/driver"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/system_table_tools"
)

// sitemapTestBaseURL is the address the test installation publishes itself under.
const sitemapTestBaseURL = "https://visitor.example"

// sitemapTestUpdated is when one test article last changed, so the sitemap's lastmod can be checked.
var sitemapTestUpdated = time.Date(2026, 10, 8, 12, 30, 0, 0, time.UTC)

// sitemapMockConn and sitemapMockRows are small answers other root-page
// fixtures build on (dataset_address_collision_test.go, root_handler_fixture_test.go).
type sitemapMockConn struct {
	*rootHandlerMockConn
}

type sitemapMockRows struct {
	cols []string
	vals [][]driver.Value
	next int
}

func (r *sitemapMockRows) Columns() []string { return r.cols }
func (r *sitemapMockRows) Close() error      { return nil }

func (r *sitemapMockRows) Next(dest []driver.Value) error {
	if r.next >= len(r.vals) {
		return io.EOF
	}
	copy(dest, r.vals[r.next])
	r.next++
	return nil
}

func (c sitemapMockConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.rootHandlerMockConn.QueryContext(ctx, query, args)
}

func setupSitemapSite(t *testing.T, loginToBrowse bool) {
	t.Helper()
	t.Setenv("BASE_URL", sitemapTestBaseURL)
	setupRootHandlerMockDB(t, loginToBrowse)
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
}

func readSitemap(t *testing.T) (urlSet, *httptest.ResponseRecorder) {
	t.Helper()
	response := httptest.NewRecorder()
	sitemapHandler(response, httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil))
	var sitemap urlSet
	if response.Code == http.StatusOK {
		if err := xml.Unmarshal(response.Body.Bytes(), &sitemap); err != nil {
			t.Fatalf("sitemap is not readable XML: %v\n%s", err, response.Body.String())
		}
	}
	return sitemap, response
}

func TestSitemapListsPublishedDatasetsAndEveryVisitorReadableArticle(t *testing.T) {
	setupSitemapSite(t, false)
	catalog := system_table_tools.PublicArticleDataset{TableUID: 7, Name: "app_service_catalog", PreferredName: "service_catalog"}
	deals := system_table_tools.PublicArticleDataset{TableUID: 8, Name: "travel_deals", PreferredName: "travel_deals"}
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return []system_table_tools.PublicArticleDataset{catalog, deals}, nil
	}
	pages := map[string][][]system_table_tools.PublicArticle{
		"app_service_catalog": {{
			{ID: "396", Slugs: map[string]string{"en": "matrix", "fi": "matrix"}, Updated: sitemapTestUpdated},
			{ID: "12", Slugs: map[string]string{}},
		}},
		"travel_deals": {
			{{ID: "287", Slugs: map[string]string{"en": "helsinki-to-vienna", "fi": "helsingista-wieniin"}, TitleLanguages: []string{"fi", "en", "sv"}}},
			{{ID: "286", Slugs: map[string]string{"en": "spa-weekend", "fi": "kylpylaviikonloppu"}}},
		},
	}
	var offsets []int
	publicArticlesListReader = func(_ context.Context, dataset system_table_tools.PublicArticleDataset, offset int, _ int, language string) ([]system_table_tools.PublicArticle, bool, error) {
		if language != "en" {
			t.Fatalf("articles listed in %q, want the site default language", language)
		}
		list := pages[dataset.Name]
		if dataset.Name == "travel_deals" {
			offsets = append(offsets, offset)
		}
		// One article per page here, so the offset is the page number.
		page := offset
		if dataset.Name != "travel_deals" {
			page = 0
			if offset > 0 {
				return nil, false, nil
			}
		}
		if page >= len(list) {
			return nil, false, nil
		}
		return list[page], page+1 < len(list), nil
	}

	sitemap, response := readSitemap(t)
	if response.Code != http.StatusOK {
		t.Fatalf("sitemap status = %d: %s", response.Code, response.Body.String())
	}
	var listed []string
	for _, entry := range sitemap.URLs {
		listed = append(listed, entry.Loc)
	}
	// Home and dataset pages have a version per published language (en, fi); an
	// article has one per language its title exists in, otherwise one address.
	want := []string{
		sitemapTestBaseURL + "/?lang=en",
		sitemapTestBaseURL + "/?lang=fi",
		sitemapTestBaseURL + "/service_catalog?lang=en",
		sitemapTestBaseURL + "/service_catalog?lang=fi",
		sitemapTestBaseURL + "/service_catalog/396-matrix",
		sitemapTestBaseURL + "/service_catalog/12",
		sitemapTestBaseURL + "/travel_deals?lang=en",
		sitemapTestBaseURL + "/travel_deals?lang=fi",
		sitemapTestBaseURL + "/travel_deals/287-helsinki-to-vienna?lang=en",
		sitemapTestBaseURL + "/travel_deals/287-helsingista-wieniin?lang=fi",
		sitemapTestBaseURL + "/travel_deals/286-spa-weekend",
	}
	if strings.Join(listed, "\n") != strings.Join(want, "\n") {
		t.Fatalf("sitemap lists\n  %s\nwant\n  %s", strings.Join(listed, "\n  "), strings.Join(want, "\n  "))
	}
	if len(offsets) != 2 || offsets[0] != 0 || offsets[1] != 1 {
		t.Fatalf("travel_deals pages read at offsets %v, want 0 then 1", offsets)
	}
	// Read back the language links by their namespace, as a search engine does.
	var withLanguages struct {
		URLs []struct {
			Loc        string `xml:"loc"`
			Alternates []struct {
				Hreflang string `xml:"hreflang,attr"`
				Href     string `xml:"href,attr"`
			} `xml:"http://www.w3.org/1999/xhtml link"`
		} `xml:"url"`
	}
	if err := xml.Unmarshal(response.Body.Bytes(), &withLanguages); err != nil {
		t.Fatal(err)
	}
	for _, entry := range withLanguages.URLs {
		if !strings.Contains(entry.Loc, "/travel_deals/287-") {
			continue
		}
		var alternates []string
		for _, alternate := range entry.Alternates {
			alternates = append(alternates, alternate.Hreflang+"="+alternate.Href)
		}
		wantAlternates := "en=" + sitemapTestBaseURL + "/travel_deals/287-helsinki-to-vienna?lang=en " +
			"fi=" + sitemapTestBaseURL + "/travel_deals/287-helsingista-wieniin?lang=fi " +
			"x-default=" + sitemapTestBaseURL + "/travel_deals/287-helsinki-to-vienna"
		if strings.Join(alternates, " ") != wantAlternates {
			t.Errorf("%s alternates\n  %s\nwant\n  %s", entry.Loc, strings.Join(alternates, " "), wantAlternates)
		}
	}
	if !strings.Contains(response.Body.String(), `xmlns:xhtml="http://www.w3.org/1999/xhtml"`) ||
		!strings.Contains(response.Body.String(), `<xhtml:link rel="alternate" hreflang="x-default"`) {
		t.Fatalf("sitemap lacks the xhtml alternates:\n%s", response.Body.String())
	}
	stamp := sitemapTestUpdated.Format(time.RFC3339)
	for _, entry := range sitemap.URLs {
		wantStamp := ""
		if strings.HasPrefix(entry.Loc, sitemapTestBaseURL+"/service_catalog?") || entry.Loc == sitemapTestBaseURL+"/service_catalog/396-matrix" {
			wantStamp = stamp
		}
		if entry.LastMod != wantStamp {
			t.Errorf("%s lastmod = %q, want %q (only a row's own readable modification time)", entry.Loc, entry.LastMod, wantStamp)
		}
	}
	if cache := response.Header().Get("Cache-Control"); strings.Contains(cache, "public") || strings.Contains(cache, "max-age") {
		t.Fatalf("Cache-Control = %q; a stored sitemap could outlive a rights change", cache)
	}
}

func TestSitemapAnswersUnavailableInsteadOfAShorterList(t *testing.T) {
	setupSitemapSite(t, false)
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return nil, errors.New("catalogue unavailable")
	}
	if _, response := readSitemap(t); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("catalogue failure: status = %d, want 503", response.Code)
	}
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return []system_table_tools.PublicArticleDataset{{TableUID: 8, Name: "travel_deals", PreferredName: "travel_deals"}}, nil
	}
	publicArticlesListReader = func(context.Context, system_table_tools.PublicArticleDataset, int, int, string) ([]system_table_tools.PublicArticle, bool, error) {
		return nil, false, context.DeadlineExceeded
	}
	if _, response := readSitemap(t); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("article list failure: status = %d, want 503", response.Code)
	}
}

func TestSitemapIsEmptyWhenTheSiteIsNotIndexed(t *testing.T) {
	setupSitemapSite(t, true)
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		t.Fatal("a site behind sign-in read its published datasets for the sitemap")
		return nil, nil
	}
	sitemap, response := readSitemap(t)
	if response.Code != http.StatusOK || len(sitemap.URLs) != 0 {
		t.Fatalf("sign-in-only site sitemap: status %d, %d addresses", response.Code, len(sitemap.URLs))
	}
}

func TestRobotsNamesTheSitemapAbsolutelyAndAllowsOnlyRenderingReads(t *testing.T) {
	setupSitemapSite(t, false)
	t.Setenv("BASE_URL", "")
	request := httptest.NewRequest(http.MethodGet, "http://localhost:8082/robots.txt", nil)
	response := httptest.NewRecorder()
	robotsHandler(response, request)
	body := response.Body.String()
	for _, line := range []string{
		"User-agent: *", "Allow: /", "Disallow: /admin/", "Disallow: /api/",
		"Allow: /api/get-results$", "Allow: /api/get-results?", "Allow: /api/datasets$",
		"Sitemap: http://localhost:8082/sitemap.xml",
	} {
		if !containsLine(body, line) {
			t.Errorf("robots.txt lacks %q:\n%s", line, body)
		}
	}
	// Google's own precedence over the generated rules: what drawing a page needs
	// is allowed, and nothing next to it.
	for path, allowed := range map[string]bool{
		"/":                                   true,
		"/travel_deals/287-helsinki":          true,
		"/storage/7/287/original/7_287_3.jpg": true,
		"/frontend/main.js":                   true,
		"/api/get-results":                    true,
		"/api/get-results?dataset=travel_deals&id=287":                true,
		"/api/view-field-settings/article-section-defaults?dataset=x": true,
		"/api/get-results-vector?dataset=x":                           false,
		"/api/view-field-sets/personal/save":                          false,
		"/api/datasetsx":                                              false,
		"/api/log-client-error":                                       false,
		"/api/admin/settings":                                         false,
		"/admin/permissions":                                          false,
	} {
		if got := googleRobotsAllows(body, path); got != allowed {
			t.Errorf("robots.txt allows %s = %v, want %v", path, got, allowed)
		}
	}
	for _, line := range []string{"Disallow: /storage/", "Disallow: /frontend/", "Sitemap: /sitemap.xml", "Allow: /api/", "Allow: /api/log-client-error", "Allow: /api/generateTranslations"} {
		if containsLine(body, line) {
			t.Errorf("robots.txt still says %q:\n%s", line, body)
		}
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/plain") {
		t.Errorf("Content-Type = %q", contentType)
	}
}

func TestRobotsKeepsEverythingOutWhenTheSiteIsNotIndexed(t *testing.T) {
	setupSitemapSite(t, true)
	response := httptest.NewRecorder()
	robotsHandler(response, httptest.NewRequest(http.MethodGet, "/robots.txt", nil))
	if body := response.Body.String(); body != "User-agent: *\nDisallow: /\n" {
		t.Fatalf("sign-in-only site robots.txt = %q", body)
	}
}

func containsLine(document, line string) bool {
	for _, candidate := range strings.Split(document, "\n") {
		if candidate == line {
			return true
		}
	}
	return false
}

// googleRobotsAllows applies Google's robots.txt rules for "User-agent: *": the
// longest matching Allow or Disallow wins, a tie goes to Allow, "$" ends a path
// and "*" matches any run of characters.
func googleRobotsAllows(document, path string) bool {
	bestLength, allowed := -1, true
	for _, line := range strings.Split(document, "\n") {
		field, value, found := strings.Cut(line, ":")
		value = strings.TrimSpace(value)
		if !found || value == "" {
			continue
		}
		isAllow := strings.EqualFold(field, "Allow")
		if !isAllow && !strings.EqualFold(field, "Disallow") {
			continue
		}
		if robotsPatternMatches(value, path) && (len(value) > bestLength || (len(value) == bestLength && isAllow)) {
			bestLength, allowed = len(value), isAllow
		}
	}
	return allowed
}

func robotsPatternMatches(pattern, path string) bool {
	anchored := strings.HasSuffix(pattern, "$")
	pattern = strings.TrimSuffix(pattern, "$")
	parts := strings.Split(pattern, "*")
	position := 0
	for index, part := range parts {
		found := strings.Index(path[position:], part)
		if found < 0 || (index == 0 && found != 0) {
			return false
		}
		position += found + len(part)
	}
	return !anchored || position == len(path)
}

func TestLargeSitemapIsAnIndexOfBoundedParts(t *testing.T) {
	setupSitemapSite(t, false)
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return []system_table_tools.PublicArticleDataset{
			{TableUID: 8, Name: "travel_deals", PreferredName: "travel_deals"},
			{TableUID: 9, Name: "app_blogs", PreferredName: "blogs"},
		}, nil
	}
	const total = 10050
	publicArticlesListReader = func(_ context.Context, dataset system_table_tools.PublicArticleDataset, offset int, size int, _ string) ([]system_table_tools.PublicArticle, bool, error) {
		if size != sitemapListPageSize {
			t.Fatalf("list page size %d, want the sitemap's bounded %d", size, sitemapListPageSize)
		}
		count := total
		if dataset.Name == "app_blogs" {
			count = 3
		}
		var page []system_table_tools.PublicArticle
		for id := offset; id < count && len(page) < size; id++ {
			page = append(page, system_table_tools.PublicArticle{ID: strconv.Itoa(id + 1), Slugs: map[string]string{"en": "words"}})
		}
		return page, offset+len(page) < count, nil
	}
	response := httptest.NewRecorder()
	sitemapHandler(response, httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil))
	var index sitemapIndex
	if response.Code != http.StatusOK || xml.Unmarshal(response.Body.Bytes(), &index) != nil || len(index.Sitemaps) != 2 ||
		index.Sitemaps[1].Loc != sitemapTestBaseURL+"/sitemap.xml?part=2" {
		t.Fatalf("index: status %d %s", response.Code, response.Body.String())
	}
	// Home and the two dataset pages in both published languages, and every article of both datasets.
	listed := 0
	for part := 1; part <= 2; part++ {
		response := httptest.NewRecorder()
		sitemapHandler(response, httptest.NewRequest(http.MethodGet, "/sitemap.xml?part="+strconv.Itoa(part), nil))
		var set urlSet
		if response.Code != http.StatusOK || xml.Unmarshal(response.Body.Bytes(), &set) != nil || len(set.URLs) > sitemapPartSize {
			t.Fatalf("part %d: status %d, %d addresses", part, response.Code, len(set.URLs))
		}
		listed += len(set.URLs)
	}
	if want := 2 + 2*2 + total + 3; listed != want {
		t.Fatalf("parts list %d addresses, want %d", listed, want)
	}
	for _, bad := range []string{"0", "3", "x"} {
		response := httptest.NewRecorder()
		sitemapHandler(response, httptest.NewRequest(http.MethodGet, "/sitemap.xml?part="+bad, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("part=%s: status %d, want 404", bad, response.Code)
		}
	}
}

func TestSitemapStopsAtItsOverallBudget(t *testing.T) {
	setupSitemapSite(t, false)
	original := sitemapBudget
	sitemapBudget = 50 * time.Millisecond
	t.Cleanup(func() { sitemapBudget = original })
	publicArticlesDatasetsReader = func(context.Context) ([]system_table_tools.PublicArticleDataset, error) {
		return []system_table_tools.PublicArticleDataset{{TableUID: 8, Name: "travel_deals", PreferredName: "travel_deals"}}, nil
	}
	reads := 0
	publicArticlesListReader = func(ctx context.Context, _ system_table_tools.PublicArticleDataset, offset int, size int, _ string) ([]system_table_tools.PublicArticle, bool, error) {
		reads++
		time.Sleep(10 * time.Millisecond) // every page is slow and another always follows
		return []system_table_tools.PublicArticle{{ID: strconv.Itoa(offset + 1)}}, true, nil
	}
	started := time.Now()
	_, response := readSitemap(t)
	if response.Code != http.StatusServiceUnavailable || time.Since(started) > 2*time.Second {
		t.Fatalf("status %d after %v and %d reads, want 503 soon after the budget", response.Code, time.Since(started), reads)
	}
}
