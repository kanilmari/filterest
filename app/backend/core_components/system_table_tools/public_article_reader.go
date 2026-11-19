// public_article_reader.go
// Reads the articles a site publishes, always as the signed-out visitor, for server-rendered pages.
// Between the router's page heads, sitemap and plain article pages and the canonical /api/get-results reader.
// Exists so search engines and visitors without the app see exactly what a signed-out visitor may read (WL175, after WL140).
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/dataset_visibility"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/access_control"
)

// publicArticleVisitorUserID is the identity a signed-out visitor browses as:
// rootHandler gives a visitor's session this user id when the site can be
// browsed without signing in.
const publicArticleVisitorUserID = 1

// PublicArticleReadBudget bounds one public document's reads, including the
// permission checks before them. A read that runs out answers "unavailable",
// and the page falls back to what it printed before articles were read.
const PublicArticleReadBudget = 3 * time.Second

// publicArticleListBudget bounds one list page. The sitemap reads several.
const publicArticleListBudget = 5 * time.Second

// PublicArticleDataset is one dataset whose rows the site publishes as articles.
type PublicArticleDataset struct {
	TableUID      int
	Name          string // the physical dataset name the row reader takes
	PreferredName string // the name the dataset's addresses use
}

// PublicArticleStatus says what a single-article read found.
type PublicArticleStatus int

const (
	// PublicArticleUnavailable means the read failed or ran out of time; nothing is known.
	PublicArticleUnavailable PublicArticleStatus = iota
	// PublicArticleFound means the visitor may read the row and it was read.
	PublicArticleFound
	// PublicArticleNotFound means there is no row the visitor may read under that id.
	// A refused row and a missing row are deliberately the same answer.
	PublicArticleNotFound
)

// PublicArticle is one row as the signed-out visitor reads it through the
// Article presentation. Every value comes from the canonical reader's response,
// so it is already limited to the visitor's columns, rows and media.
type PublicArticle struct {
	ID             string
	Title          string            // in the requested language where the row has it
	TitleLanguage  string            // the language Title is in; "" when the value is not multilingual
	TitleLanguages []string          // the languages the title exists in; empty when not multilingual
	Slugs          map[string]string // the title's address words in each enabled language
	Description    string            // plain text of the first description field
	Paragraphs     []string          // the description as plain-text paragraphs
	ImagePath      string            // site path or absolute URL of the first image; "" for none
	Updated        time.Time         // the row's own modification time when the visitor may read it
}

// PublicArticleDatasets answers which datasets a site publishes as articles:
// those a signed-out visitor sees in the main menu (owner decision D2, WL175).
// The menu is the one definition buildGroupedTablesQuery gives the application
// (top level in the current project, and About), narrowed by the same checks
// the catalogue and rootHandler apply to the visitor. A dataset that stores
// another dataset's uploaded pictures is never an article dataset, even if it is
// placed in the menu by mistake.
func PublicArticleDatasets(ctx context.Context) ([]PublicArticleDataset, error) {
	if backend.Db == nil {
		return nil, errors.New("database unavailable")
	}
	budget, cancel := detachedReadBudget(ctx, PublicArticleReadBudget)
	defer cancel()
	q, finish, err := dbutils.BeginReadBudget(dbutils.WithReadBudget(budget, budget), backend.Db)
	if err != nil {
		return nil, err
	}
	defer finish()

	readable, err := access_control.GetTablesReadableByUser(q, publicArticleVisitorUserID)
	if err != nil {
		return nil, err
	}
	pools, err := dataset_routes.LoadDatasetNamePools(q)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(`SELECT grouped.table_uid, grouped.table_name
		FROM (` + buildGroupedTablesQuery("NULL::varchar AS icon_key") + `) grouped
		WHERE (grouped.is_top_level_in_current_project OR grouped.table_name = 'system_about')
		  AND grouped.table_name <> 'system_users'
		  AND NOT EXISTS (
		      SELECT 1 FROM public.system_foreign_key_relations_1_m upload
		      WHERE upload.source_table_uid = grouped.table_uid
		        AND upload.target_insert_specs->'file_upload' IS NOT NULL)
		ORDER BY grouped.table_name`)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		uid  int
		name string
	}
	var candidates []candidate
	for rows.Next() {
		var found candidate
		if err := rows.Scan(&found.uid, &found.name); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, found)
	}
	iterationErr := rows.Err()
	// Closed before the per-dataset checks, which use the same bounded querier.
	rows.Close()
	if iterationErr != nil {
		return nil, iterationErr
	}

	datasets := make([]PublicArticleDataset, 0, len(candidates))
	for _, found := range candidates {
		pool, accepted := pools[found.uid]
		if !readable[found.uid] || !accepted || pool.SchemaName != "public" || pool.DatasetName != found.name ||
			!backend.ShouldExposeCloudManagementDatasetName(found.name) {
			continue
		}
		allowed, err := permissions.CheckRouteTablePermission(q, "/api/get-results", publicArticleVisitorUserID,
			permissions.RouteTableScope{TableUID: strconv.Itoa(found.uid)}, permissions.AccessControlRouteTableOptions(false))
		if err != nil {
			return nil, err
		}
		if !allowed {
			continue
		}
		hidden, err := dataset_visibility.HiddenForUser(q, found.name, publicArticleVisitorUserID)
		if err != nil {
			return nil, err
		}
		if !hidden {
			datasets = append(datasets, PublicArticleDataset{TableUID: found.uid, Name: found.name, PreferredName: pool.PreferredName})
		}
	}
	return datasets, nil
}

// ReadPublicArticle reads one row of any dataset as the signed-out visitor,
// through the Article presentation (or the Page presentation when that is the
// only one the visitor may open), with the title in language where the row has
// it. The caller's request, session and transaction are never used, so a
// signed-in caller cannot widen what a public page prints (the WL140 lesson).
func ReadPublicArticle(ctx context.Context, dataset PublicArticleDataset, rowID string, language string) (PublicArticle, PublicArticleStatus) {
	if _, _, ok := dataset_routes.ParseArticleRowSegment(rowID); !ok || strings.Contains(rowID, "-") {
		return PublicArticle{}, PublicArticleNotFound
	}
	budget, cancel := detachedReadBudget(ctx, PublicArticleReadBudget)
	defer cancel()
	operation := dbutils.WithReadBudget(budget, budget)
	projection, status := publicArticleProjection(operation, dataset.Name)
	if status != PublicArticleFound {
		return PublicArticle{}, status
	}
	request, finishVisitor, err := newPublicVisitorRequest(operation, language)
	if err != nil {
		return PublicArticle{}, PublicArticleUnavailable
	}
	defer finishVisitor()
	result, code := delegatePublicArticleRead(request, url.Values{
		"dataset": {dataset.Name}, "id": {rowID}, "row_count": {"0"}, "view_key": {projection},
	})
	if budget.Err() != nil {
		return PublicArticle{}, PublicArticleUnavailable
	}
	switch {
	case code == http.StatusForbidden && projection == "image_first_page_view":
		// The reader repeats the Page grant check this read has just passed, on
		// its own unbounded connection, and answers 403 when that query fails.
		// After a passed check a 403 means "could not ask", never "refused".
		return PublicArticle{}, PublicArticleUnavailable
	case code == http.StatusForbidden || code == http.StatusNotFound:
		return PublicArticle{}, PublicArticleNotFound
	case code != http.StatusOK:
		return PublicArticle{}, PublicArticleUnavailable
	}
	for _, row := range result.Data {
		if articleRowID(row) == rowID {
			result.Data = []map[string]json.RawMessage{row}
			translations := newBoundedArticleTranslations(budget)
			article := projectPublicArticle(result.frontPageArticleResult, language, publicArticleLanguagesReader(budget), translations.translate)
			if translations.err != nil {
				return PublicArticle{}, PublicArticleUnavailable
			}
			return article, PublicArticleFound
		}
	}
	return PublicArticle{}, PublicArticleNotFound
}

// ListPublicArticles reads one page of a published dataset's rows, newest
// first, as the signed-out visitor. It uses the same Article presentation as a
// single article, so a list builds the same titles and address words the
// article page announces. pageSize 1–20 sets the page length; 0 keeps the
// site's own results_load_amount. more reports whether another page follows.
func ListPublicArticles(ctx context.Context, dataset PublicArticleDataset, offset int, pageSize int, language string) (articles []PublicArticle, more bool, err error) {
	if offset < 0 {
		offset = 0
	}
	budget, cancel := detachedReadBudget(ctx, publicArticleListBudget)
	defer cancel()
	operation := dbutils.WithReadBudget(budget, budget)
	if pageSize > 0 {
		operation = read.WithResultsPageSize(operation, pageSize)
	}
	projection, status := publicArticleProjection(operation, dataset.Name)
	switch status {
	case PublicArticleNotFound:
		return nil, false, nil
	case PublicArticleUnavailable:
		return nil, false, errors.New("public article permissions unavailable")
	}
	request, finishVisitor, err := newPublicVisitorRequest(operation, language)
	if err != nil {
		return nil, false, err
	}
	defer finishVisitor()
	result, code := delegatePublicArticleRead(request, url.Values{
		"dataset": {dataset.Name}, "row_count": {"0"}, "view_key": {projection},
		"sort_column": {"__newest"}, "sort_order": {"DESC"}, "offset": {strconv.Itoa(offset)},
	})
	if budget.Err() != nil {
		return nil, false, context.DeadlineExceeded
	}
	switch {
	case code == http.StatusForbidden && projection == "image_first_page_view":
		// As in ReadPublicArticle: after a passed Page check, a 403 is a failed query.
		return nil, false, errors.New("public article list unavailable: repeated Page check failed")
	case code == http.StatusForbidden || code == http.StatusNotFound:
		return nil, false, nil
	case code != http.StatusOK:
		return nil, false, errors.New("public article list unavailable: status " + strconv.Itoa(code))
	}
	languages := publicArticleLanguagesReader(budget)
	translations := newBoundedArticleTranslations(budget)
	articles = make([]PublicArticle, 0, len(result.Data))
	for _, row := range result.Data {
		single := result.frontPageArticleResult
		single.Data = []map[string]json.RawMessage{row}
		if article := projectPublicArticle(single, language, languages, translations.translate); article.ID != "" {
			articles = append(articles, article)
		}
	}
	if translations.err != nil {
		return nil, false, translations.err
	}
	return articles, result.ResultsPerLoad > 0 && len(result.Data) >= result.ResultsPerLoad, nil
}

// detachedReadBudget starts a deadline that carries no value of the caller's
// context: the caller's context holds its session registry, signed-in actor and
// transaction, none of which may reach a visitor read. Only the caller's
// cancellation is followed, so an abandoned page stops its reads.
func detachedReadBudget(parent context.Context, limit time.Duration) (context.Context, context.CancelFunc) {
	budget, cancel := context.WithTimeout(context.Background(), limit)
	if parent == nil {
		return budget, cancel
	}
	stop := context.AfterFunc(parent, cancel)
	return budget, func() {
		stop()
		cancel()
	}
}

// publicArticleTranslationReader reads one language key within the read's budget.
var publicArticleTranslationReader = lang.ReadDisplayTranslationContext

// boundedArticleTranslations answers language-key titles inside one read's
// budget, one key and language at a time, remembering each answer for the rest
// of the read. The first failure is kept: the read then counts as unavailable
// rather than printing a page or a sitemap without the title.
type boundedArticleTranslations struct {
	ctx   context.Context
	cache map[string]string
	err   error
}

func newBoundedArticleTranslations(ctx context.Context) *boundedArticleTranslations {
	return &boundedArticleTranslations{ctx: ctx, cache: map[string]string{}}
}

func (translations *boundedArticleTranslations) translate(language, key string) string {
	if translations.err != nil {
		return ""
	}
	cacheKey := language + "\x00" + key
	if value, known := translations.cache[cacheKey]; known {
		return value
	}
	value, err := publicArticleTranslationReader(translations.ctx, language, key)
	if err != nil {
		translations.err = err
		return ""
	}
	translations.cache[cacheKey] = value
	return value
}

// publicArticleLanguagesReader answers the site's enabled languages, in which the
// projection builds a title's address words.
var publicArticleLanguagesReader = func(ctx context.Context) []string {
	return lang.ReadPageLanguages(ctx).Enabled
}

// publicArticleProjection makes the checks the route pipeline makes before
// /api/get-results, because this read calls the reader directly: the visitor's
// read right on the dataset, a presentation it may open, and dataset
// visibility. Article comes first; Page serves a site whose visitors have only
// Page, as for the Home article buttons.
func publicArticleProjection(operation context.Context, dataset string) (string, PublicArticleStatus) {
	q, finish, err := dbutils.BeginReadBudget(operation, backend.Db)
	if err != nil {
		return "", PublicArticleUnavailable
	}
	defer finish()
	if !backend.ShouldExposeCloudManagementDatasetName(dataset) {
		return "", PublicArticleNotFound
	}
	granted := func(route string) (bool, error) {
		return permissions.CheckDatasetRoutePermission(q, route, publicArticleVisitorUserID, dataset)
	}
	readAllowed, err := granted("/api/get-results")
	if err != nil {
		return "", PublicArticleUnavailable
	}
	if !readAllowed {
		return "", PublicArticleNotFound
	}
	hidden, err := dataset_visibility.HiddenForUser(q, dataset, publicArticleVisitorUserID)
	if err != nil {
		return "", PublicArticleUnavailable
	}
	if hidden {
		return "", PublicArticleNotFound
	}
	for _, candidate := range []struct{ view, route string }{
		{"article_view", "/ui/view/article_view"},
		{"image_first_page_view", "/ui/view/image_first_page_view"},
	} {
		// A presentation whose function is missing or disabled finds no function
		// row, which counts as not granted, as for the Home article buttons and the
		// reader's own Page gate. Any other failure leaves the answer unknown.
		allowed, err := granted(candidate.route)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			continue
		case err != nil:
			return "", PublicArticleUnavailable
		case allowed:
			return candidate.view, PublicArticleFound
		}
	}
	return "", PublicArticleNotFound
}

// newPublicVisitorRequest builds a fresh internal request whose only identity is
// the signed-out visitor, as the Home settings preview does for its guest
// preview (front_page_box_diagnostics.go). It carries no cookie, header or
// context value of any caller. Its own transaction opens only if the reader
// needs one (the row-security pilot dataset does), on the visitor's database
// role with the visitor applied as the actor, and is always rolled back by the
// returned finish function: these reads never write.
func newPublicVisitorRequest(operation context.Context, language string) (*http.Request, func(), error) {
	actor := dbutils.NewRequestActorContext(publicArticleVisitorUserID, "guest")
	ctx := dbutils.SetRequestActorContext(operation, actor)
	finish := func() {}
	if visitorDB := auth.GetDBForRole("guest"); visitorDB != nil {
		lazy := dbutils.NewLazyTxWithBeginHook(visitorDB, func(tx *sql.Tx) error {
			return dbutils.ApplyRequestActorToTx(tx, actor)
		})
		ctx = dbutils.SetLazyTx(ctx, lazy)
		finish = func() { _ = lazy.Rollback() }
	}
	address := url.URL{Path: "/api/get-results"}
	if language != "" {
		address.RawQuery = url.Values{"lang": {language}}.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address.String(), http.NoBody)
	if err != nil {
		finish()
		return nil, func() {}, err
	}
	session, err := e_sessions.Load(request)
	if err != nil || session == nil {
		finish()
		return nil, func() {}, errors.New("visitor session unavailable")
	}
	session.Values["user_id"] = publicArticleVisitorUserID
	session.Values["user_role"] = "guest"
	return request, finish, nil
}

// publicArticleReadResult is the part of the reader's response public pages use.
type publicArticleReadResult struct {
	frontPageArticleResult
	ResultsPerLoad int `json:"resultsPerLoad"`
}

var publicArticleResultsHandler http.HandlerFunc = read.GetResultsHandlerWrapper

// delegatePublicArticleRead runs the canonical reader on the visitor request
// with only the given query, keeping the visitor's language.
func delegatePublicArticleRead(visitor *http.Request, query url.Values) (publicArticleReadResult, int) {
	request := visitor.Clone(visitor.Context())
	if language := visitor.URL.Query().Get("lang"); language != "" {
		query.Set("lang", language)
	}
	request.URL.RawQuery = query.Encode()
	request.RequestURI = request.URL.RequestURI()
	response := httptest.NewRecorder()
	publicArticleResultsHandler(response, request)
	var result publicArticleReadResult
	if response.Code != http.StatusOK {
		return result, response.Code
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		return result, http.StatusInternalServerError
	}
	return result, http.StatusOK
}

// articleRowID reads a row's id as the article opener does, whether the
// response carries it as a number or as a string.
func articleRowID(row map[string]json.RawMessage) string {
	id := string(row["id"])
	if len(id) > 0 && id[0] == '"' {
		id, _ = strconv.Unquote(id)
	}
	return id
}
