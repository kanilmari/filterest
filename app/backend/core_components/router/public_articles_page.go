// public_articles_page.go
// Serves the plain article pages (/articles, /articles/{dataset}) and the readable fallback inside the application page.
// Between the visitor reader (system_table_tools) and two templates: public_articles.html and index.html's fallback block.
// Exists so articles can be read and found through ordinary links without the application's JavaScript (WL175, D1, D4).
package router

import (
	"context"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/system_table_tools"
)

// publicArticlesPageSize is the length of one plain list page. It is the
// reader's largest page override (read.WithResultsPageSize).
const publicArticlesPageSize = 20

// publicArticlesIndexPerDataset is how many newest articles the index shows per dataset.
const publicArticlesIndexPerDataset = 10

// publicArticlesTextFallbacks is the English copy a page shows when a language
// key cannot be read, so a plain page never prints a bare key.
var publicArticlesTextFallbacks = map[string]string{
	"public_articles_all":           "All articles",
	"public_articles_newest":        "Newest articles",
	"public_articles_more":          "More articles",
	"public_articles_next_page":     "Next page",
	"public_articles_previous_page": "Previous page",
	"public_articles_page_number":   "Page {page}",
	"public_articles_none":          "There are no articles here yet.",
}

// publicArticlesText reads one interface text in the page language.
var publicArticlesText = func(language, key string) string {
	if text := lang.ReadDisplayTranslation(language, key); text != "" {
		return text
	}
	return publicArticlesTextFallbacks[key]
}

// publicArticleLink is one article in a plain list.
type publicArticleLink struct {
	Title   string
	URL     string
	Excerpt string
}

// publicArticlesSection is one dataset's part of a plain list.
type publicArticlesSection struct {
	Title       string
	Description string
	URL         string // the dataset's own plain list
	Articles    []publicArticleLink
	MoreURL     string
	MoreLabel   string
}

// publicNavigationLink is a plain link at the foot of a fallback or list page.
type publicNavigationLink struct {
	URL   string
	Label string
}

// serverFallbackArticle is the article printed into the application page.
type serverFallbackArticle struct {
	Title      string
	ImageURL   string
	Paragraphs []string
}

// serverFallback is what index.html prints outside the application shell. With
// JavaScript it stays hidden unless the application cannot start; without
// JavaScript it is the page (shell_boot_recovery.css).
type serverFallback struct {
	Article *serverFallbackArticle
	List    *publicArticlesSection
	Links   []publicNavigationLink
}

// publicArticlesPageData fills public_articles.html.
type publicArticlesPageData struct {
	CSPNonce        string
	LangCode        string
	PageTitle       string
	MetaDescription string
	CanonicalURL    string
	RobotsNoIndex   bool
	SiteName        string
	FaviconPath     string
	Heading         string
	Sections        []publicArticlesSection
	EmptyText       string
	PageLabel       string
	PreviousURL     string
	PreviousLabel   string
	NextURL         string
	NextLabel       string
	Links           []publicNavigationLink
}

// The reads the sitemap and the plain pages make, named so tests can answer them without a database.
var (
	publicArticlesDatasetsReader = system_table_tools.PublicArticleDatasets
	publicArticlesListReader     = system_table_tools.ListPublicArticles
	publicArticlesLoginToBrowse  = middlewares.CheckLoginToBrowse
)

// withAddressLanguage keeps an explicit page language on a link to another plain page.
func withAddressLanguage(path, addressLanguage string, extra url.Values) string {
	query := url.Values{}
	for key, values := range extra {
		query[key] = values
	}
	if addressLanguage != "" {
		query.Set("lang", addressLanguage)
	}
	if encoded := query.Encode(); encoded != "" {
		return path + "?" + encoded
	}
	return path
}

func publicArticleLinks(dataset system_table_tools.PublicArticleDataset, articles []system_table_tools.PublicArticle, addressLanguage, defaultLanguage string) []publicArticleLink {
	links := make([]publicArticleLink, 0, len(articles))
	for _, article := range articles {
		title := article.Title
		if title == "" {
			title = "#" + article.ID
		}
		links = append(links, publicArticleLink{
			Title: title, URL: articleAddressFor(url.PathEscape(dataset.PreferredName), article, addressLanguage, defaultLanguage),
			Excerpt: articleExcerpt(article.Description, 200),
		})
	}
	return links
}

// publicArticlesHandler answers /articles and /articles/{dataset}. Every
// article and dataset on these pages is read as the signed-out visitor. A site
// that requires signing in has no public articles, so these addresses do not
// exist there.
func publicArticlesHandler(w http.ResponseWriter, r *http.Request) {
	// A dataset or alias that answers to "articles" keeps its own addresses,
	// including /articles/{id}-{words}: the plain index never takes them over.
	// The name is deliberately not reserved, because a reservation would drop
	// such an existing alias before this check could see it.
	if articlesNameIsOwnedByADataset() {
		rootHandler(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	loginToBrowse, err := publicArticlesLoginToBrowse()
	if err != nil || loginToBrowse {
		http.NotFound(w, r)
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/articles"), "/")
	if strings.Contains(rest, "/") {
		http.NotFound(w, r)
		return
	}
	datasets, err := publicArticlesDatasetsReader(r.Context())
	if err != nil {
		log.Printf("\033[31m[publicArticlesHandler] published datasets unavailable: %v\033[0m", err)
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	languages := pageLanguagesReader(r.Context())
	language := lang.ResolvePageLanguage(r)
	addressLanguage := explicitAddressLanguage(r, languages)
	baseURL := resolveBaseURL(r)
	siteName := resolvePageSiteName(r)
	allLabel := publicArticlesText(language, "public_articles_all")
	data := publicArticlesPageData{
		CSPNonce: middlewares.GetCSPNonce(r), LangCode: language, SiteName: siteName,
		RobotsNoIndex: !isIndexingAllowed(),
		FaviconPath:   frontendassets.NewSiteFaviconData(localFrontendDir, siteName, configuredFaviconReader(r.Context(), backend.Db)).FaviconPath,
	}

	if rest == "" {
		data.Heading = allLabel
		data.PageTitle = composeBrowserTabTitle("", allLabel, siteName)
		data.CanonicalURL = baseURL + withAddressLanguage("/articles", addressLanguage, nil)
		for _, dataset := range datasets {
			articles, more, err := publicArticlesListReader(r.Context(), dataset, 0, publicArticlesIndexPerDataset, language)
			if err != nil {
				log.Printf("\033[31m[publicArticlesHandler] articles of %s unavailable: %v\033[0m", dataset.Name, err)
				http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
				return
			}
			section := publicArticlesSectionFor(dataset, language, addressLanguage)
			section.Articles = publicArticleLinks(dataset, articles, addressLanguage, languages.Default)
			if more {
				section.MoreURL, section.MoreLabel = section.URL, publicArticlesText(language, "public_articles_more")
			}
			data.Sections = append(data.Sections, section)
		}
		data.MetaDescription = allLabel + " — " + siteName
	} else {
		dataset, found := publishedDatasetNamed(datasets, rest)
		if !found {
			http.NotFound(w, r)
			return
		}
		if rest != dataset.PreferredName {
			// Other accepted names of the dataset lead to its preferred address.
			http.Redirect(w, r, withAddressLanguage("/articles/"+url.PathEscape(dataset.PreferredName), "", r.URL.Query()), http.StatusMovedPermanently)
			return
		}
		page := 1
		if raw := r.URL.Query().Get("page"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 100000 {
				http.NotFound(w, r)
				return
			}
			page = parsed
		}
		articles, more, err := publicArticlesListReader(r.Context(), dataset, (page-1)*publicArticlesPageSize, publicArticlesPageSize, language)
		if err != nil {
			log.Printf("\033[31m[publicArticlesHandler] articles of %s unavailable: %v\033[0m", dataset.Name, err)
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		if page > 1 && len(articles) == 0 {
			http.NotFound(w, r)
			return
		}
		section := publicArticlesSectionFor(dataset, language, addressLanguage)
		section.Articles = publicArticleLinks(dataset, articles, addressLanguage, languages.Default)
		data.Heading = section.Title
		data.MetaDescription = section.Description
		if data.MetaDescription == "" {
			data.MetaDescription = section.Title + " — " + siteName
		}
		section.Title, section.Description = "", ""
		data.Sections = []publicArticlesSection{section}
		data.PageTitle = composeBrowserTabTitle("", data.Heading, siteName)
		pagePath := "/articles/" + url.PathEscape(dataset.PreferredName)
		if page > 1 {
			data.CanonicalURL = baseURL + withAddressLanguage(pagePath, addressLanguage, url.Values{"page": {strconv.Itoa(page)}})
			data.PageLabel = strings.ReplaceAll(publicArticlesText(language, "public_articles_page_number"), "{page}", strconv.Itoa(page))
			data.PageTitle = composeBrowserTabTitle(data.PageLabel, data.Heading, siteName)
			previous := url.Values{}
			if page > 2 {
				previous.Set("page", strconv.Itoa(page-1))
			}
			data.PreviousURL = withAddressLanguage(pagePath, addressLanguage, previous)
			data.PreviousLabel = publicArticlesText(language, "public_articles_previous_page")
		} else {
			data.CanonicalURL = baseURL + withAddressLanguage(pagePath, addressLanguage, nil)
		}
		if more {
			data.NextURL = withAddressLanguage(pagePath, addressLanguage, url.Values{"page": {strconv.Itoa(page + 1)}})
			data.NextLabel = publicArticlesText(language, "public_articles_next_page")
		}
		data.Links = []publicNavigationLink{{URL: withAddressLanguage("/articles", addressLanguage, nil), Label: allLabel}}
	}
	empty := true
	for _, section := range data.Sections {
		empty = empty && len(section.Articles) == 0
	}
	if empty {
		data.EmptyText = publicArticlesText(language, "public_articles_none")
	}
	data.Links = append(data.Links, publicNavigationLink{URL: withAddressLanguage("/", addressLanguage, nil), Label: siteName})

	tpl, err := template.ParseFiles(filepath.Join(localFrontendDir, "public_articles.html"))
	if err != nil {
		log.Printf("\033[31m[publicArticlesHandler] template: %v\033[0m", err)
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tpl.Execute(w, data); err != nil {
		log.Printf("\033[31m[publicArticlesHandler] render: %v\033[0m", err)
	}
}

// articlesNameIsOwnedByADataset reports whether a dataset or alias already
// answers to "articles". It is a variable so tests can answer it.
var articlesNameIsOwnedByADataset = func() bool {
	_, owned := resolveDocumentDataset("articles")
	return owned
}

// publicArticlesSectionFor names a dataset the way its application tab does.
func publicArticlesSectionFor(dataset system_table_tools.PublicArticleDataset, language, addressLanguage string) publicArticlesSection {
	title := resolveDatasetTabTitle(dataset.Name, dataset.TableUID, language)
	description := fetchTranslation("search_slogan_"+dataset.Name, language)
	if description == "" {
		description = fetchDatasetDescription(dataset.TableUID)
	}
	return publicArticlesSection{
		Title: title, Description: description,
		URL: withAddressLanguage("/articles/"+url.PathEscape(dataset.PreferredName), addressLanguage, nil),
	}
}

// publishedDatasetNamed finds a published dataset by any name its addresses accept.
func publishedDatasetNamed(datasets []system_table_tools.PublicArticleDataset, name string) (system_table_tools.PublicArticleDataset, bool) {
	for _, dataset := range datasets {
		if dataset.PreferredName == name {
			return dataset, true
		}
	}
	pool, accepted := resolveDocumentDataset(name)
	if !accepted {
		return system_table_tools.PublicArticleDataset{}, false
	}
	for _, dataset := range datasets {
		if dataset.TableUID == pool.TableUID {
			return dataset, true
		}
	}
	return system_table_tools.PublicArticleDataset{}, false
}

// buildServerFallback prepares the readable fallback for an application page.
// Home and dataset pages get a link to the plain index; a dataset page also its
// newest articles; an article page the article itself. Nothing is printed on a
// site that requires signing in.
// datasetTitle and allArticlesLabel come from what the page head already read,
// so the fallback adds no translation query of its own.
func buildServerFallback(ctx context.Context, r *http.Request, dataset *dataset_routes.DatasetNamePool, datasetTitle string,
	document articleDocument, loginToBrowse bool, language string, allArticlesLabel string) *serverFallback {
	if loginToBrowse || isAuthShellEntryRequest(r) {
		return nil
	}
	languages := pageLanguagesReader(ctx)
	addressLanguage := explicitAddressLanguage(r, languages)
	fallback := &serverFallback{}
	if dataset != nil {
		published := system_table_tools.PublicArticleDataset{TableUID: dataset.TableUID, Name: dataset.DatasetName, PreferredName: dataset.PreferredName}
		switch document.outcome {
		case articleDocumentFound:
			article := document.article
			fallback.Article = &serverFallbackArticle{Title: article.Title, ImageURL: article.ImagePath, Paragraphs: article.Paragraphs}
			fallback.Links = append(fallback.Links, publicNavigationLink{
				URL: withAddressLanguage("/"+url.PathEscape(dataset.PreferredName), addressLanguage, nil), Label: datasetTitle})
		case articleDocumentNone:
			if !strings.Contains(strings.Trim(r.URL.Path, "/"), "/") {
				articles, _, err := publicArticlesListReader(ctx, published, 0, publicArticlesPageSize, language)
				if err == nil && len(articles) > 0 {
					fallback.List = &publicArticlesSection{
						Title:    datasetTitle,
						URL:      withAddressLanguage("/articles/"+url.PathEscape(dataset.PreferredName), addressLanguage, nil),
						Articles: publicArticleLinks(published, articles, addressLanguage, languages.Default),
					}
				}
			}
		}
	}
	fallback.Links = append(fallback.Links, publicNavigationLink{
		URL: withAddressLanguage("/articles", addressLanguage, nil), Label: allArticlesLabel})
	return fallback
}
