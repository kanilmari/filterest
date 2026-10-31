// front_page_read.go
// Serves current, readable front page blocks through the canonical results handler.
// Connects session-owned scope selection with dataset, field and row authorization.
// Omits hidden and failed datasets completely, forwarding only authorized appearance with the rows.
package system_table_tools

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grants"
	e_sessions "easelect/backend/core_components/sessions"
)

var frontPagePresentationReader = backend.ReadFrontPagePresentation
var frontPageSettingsReader = backend.ReadFrontPageSettings
var frontPageBackgroundReader = backend.ReadFrontPageBackground
var frontPageHeroReader = readFrontPageHero
var frontPageBlocksResolver = resolveFrontPageBlocks
var frontPageCanRead = frontPageDatasetReadable
var frontPageBoxCanRead = func(ctx context.Context, userID int, dataset string) bool {
	q, finish, err := dbutils.BeginReadBudget(ctx, backend.Db)
	if err != nil {
		return false
	}
	defer finish()
	return frontPageDatasetReadableWithQuerier(q, userID, dataset)
}
var frontPageResultsHandler http.HandlerFunc = read.GetResultsHandlerWrapper
var frontPageNow = time.Now

type frontPageResultBlock struct {
	ID            int64             `json:"box_id,omitempty"`
	Title         json.RawMessage   `json:"title"`
	Query         json.RawMessage   `json:"query"`
	CategoryLinks int               `json:"category_links"`
	Dataset       string            `json:"dataset"`
	ResultLimit   int               `json:"result_limit"`
	Columns       json.RawMessage   `json:"columns"`
	Types         json.RawMessage   `json:"types"`
	Data          []json.RawMessage `json:"data"`
	Appearance    json.RawMessage   `json:"dataset_appearance,omitempty"`
}

// GetFrontPageHandler returns viewer_id, site_name, hero (fi/en), background, show_blocks, blocks, partial,
// article_buttons [{href,label}] and article_buttons_placement (below_text or top_row).
// GET /api/front-page. Disabled sites return 404. LoginOnlyProfile establishes the
// viewer; each block separately requires /api/get-results rights and delegates
// with saved categories/sort (default __newest DESC), row_count=0 and a trusted SQL
// page size, preserving the request actor. These text
// summaries request card support under the caller's column and gallery rights. Boxes off
// skips box resolution, returning an empty blocks array. Article buttons resolve independently
// through the viewer's article grant, dataset visibility and canonical article row/column read.
func GetFrontPageHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	settings, err := frontPageSettingsReader(r.Context(), backend.Db)
	if err != nil || !settings.SeparateFrontPage {
		if err != nil {
			log.Printf("[GetFrontPageHandler] settings unavailable: %v", err)
		}
		httpresponse.RespondWithError(w, http.StatusNotFound, "front page unavailable")
		return
	}
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID < 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "viewer required")
		return
	}
	start := frontPageNow()
	boxContext, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	boxContext = runtime_grants.WithRequestBarrierBudget(boxContext)
	expired := func() bool { return boxContext.Err() != nil || frontPageNow().Sub(start) >= 3*time.Second }
	var blocks []frontPageBlock
	if settings.FrontPageShowBlocks {
		blocks, _, err = frontPageBlocksResolver(backend.Db, userID)
		if err != nil {
			log.Printf("[GetFrontPageHandler] blocks unavailable: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "front page unavailable")
			return
		}
	}
	hero, err := frontPageHeroReader(backend.Db)
	if err != nil {
		log.Printf("[GetFrontPageHandler] hero unavailable: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "front page unavailable")
		return
	}
	layout, layoutVersion, err := frontPagePresentationReader(r.Context(), backend.Db)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Home layout unavailable")
		return
	}
	background, err := frontPageBackgroundReader(r.Context(), backend.Db)
	if err != nil {
		log.Printf("[GetFrontPageHandler] background unavailable: %v", err)
	}
	results := []frontPageResultBlock{}
	partial := false
	for index, block := range blocks {
		if index == 20 {
			break
		}
		if !block.Enabled {
			continue
		}
		if expired() {
			partial = true
			break
		}
		readable := frontPageBoxCanRead(dbutils.WithReadBudget(r.Context(), boxContext), userID, block.Dataset)
		if expired() {
			partial = true
			break
		}
		if !readable {
			continue
		}
		// Carry the remaining operation budget as a value: a lazy transaction
		// still inherits the original request lifetime. The canonical reader
		// enforces this deadline at each database-operation boundary.
		remaining := 3*time.Second - frontPageNow().Sub(start)
		operation, finishOperation := context.WithTimeout(boxContext, remaining)
		boxRequest := r.WithContext(dbutils.WithReadBudget(r.Context(), operation))
		result, ok := delegateFrontPageBlock(boxRequest, block)
		operationExpired := dbutils.ReadBudgetExpired(boxRequest.Context())
		finishOperation()
		if expired() || operationExpired {
			partial = true
			break
		}
		if ok {
			results = append(results, result)
		}
	}
	// Finish boxes under their original budget before optional article work.
	// Neither a slow omitted target nor its timeout can change blocks or partial.
	articleButtons, articleSettings := resolveFrontPageArticleButtons(r, userID)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"viewer_id": userID, "site_name": backend.ConfiguredSiteName(r.Context(), backend.Db), "background": background,
		"hero": hero, "presentation": layout, "presentation_version": layoutVersion, "show_blocks": settings.FrontPageShowBlocks, "blocks": results, "partial": partial,
		"article_buttons": articleButtons, "article_buttons_placement": articleSettings.Placement,
	})
}

func delegateFrontPageBlock(original *http.Request, block frontPageBlock) (frontPageResultBlock, bool) {
	result, reason := delegateFrontPageBox(original, block)
	return result, reason == ""
}

func delegateFrontPageBox(original *http.Request, block frontPageBlock) (frontPageResultBlock, string) {
	var result frontPageResultBlock
	q, finish, err := dbutils.BeginReadBudget(original.Context(), backend.Db)
	if err != nil {
		return result, "front_page_blocks_invalid"
	}
	defer finish()
	if err := validateFrontPageBoxReferences(q, block); err != nil {
		if errors.Is(err, errFrontPageCategories) {
			return result, "row_group_invalid_filters"
		}
		return result, "front_page_blocks_invalid"
	}
	definition, _ := decodeFrontPageBoxQuery(block.Query)
	if !frontPageSortReadable(original, block.Dataset, definition.SortColumn) {
		return result, "front_page_blocks_invalid"
	}
	request := original.Clone(read.WithResultsPageSize(original.Context(), block.ResultLimit))
	request.Method, request.Body = http.MethodGet, http.NoBody
	delegateURL := *request.URL
	delegateURL.Path, delegateURL.RawPath = "/api/get-results", ""
	query := url.Values{"dataset": {block.Dataset}, "sort_column": {"__newest"}, "sort_order": {"DESC"},
		"row_count": {"0"}, "view_key": {"card"}}
	if len(definition.RowGroup) > 0 {
		query.Set("row_group", strings.Join(definition.RowGroup, ","))
	}
	if definition.SortColumn != "" {
		query.Set("sort_column", definition.SortColumn)
	}
	if definition.SortOrder != "" {
		query.Set("sort_order", definition.SortOrder)
	}
	if language := original.URL.Query().Get("lang"); language != "" {
		query.Set("lang", language)
	}
	delegateURL.RawQuery = query.Encode()
	request.URL, request.RequestURI = &delegateURL, delegateURL.RequestURI()
	response := httptest.NewRecorder()
	frontPageResultsHandler(response, request)
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Columns) == 0 || len(result.Types) == 0 {
		log.Printf("[GetFrontPageHandler] omitted dataset %q: delegate status %d", block.Dataset, response.Code)
		return frontPageResultBlock{}, "front_page_blocks_invalid"
	}
	var resolved struct {
		Selection struct {
			Slugs []string `json:"slugs"`
		} `json:"row_group_selection"`
	}
	if json.Unmarshal(response.Body.Bytes(), &resolved) != nil || !frontPageSameSlugs(definition.RowGroup, resolved.Selection.Slugs) {
		return frontPageResultBlock{}, "row_group_invalid_filters"
	}
	result.ID, result.Title, result.Query, result.CategoryLinks = block.ID, block.Title, block.Query, block.CategoryLinks
	if len(result.Query) == 0 {
		result.Query = json.RawMessage(`{}`)
	}
	result.Dataset, result.ResultLimit = block.Dataset, block.ResultLimit
	if len(result.Data) > block.ResultLimit {
		result.Data = result.Data[:block.ResultLimit]
	}
	if result.Data == nil {
		result.Data = []json.RawMessage{}
	}
	// Raw rows retain id even when it was not selected as a presented column.
	return result, ""
}

func frontPageSameSlugs(saved, resolved []string) bool {
	if len(saved) != len(resolved) {
		return false
	}
	seen := map[string]bool{}
	for _, slug := range saved {
		seen[slug] = true
	}
	for _, slug := range resolved {
		if !seen[slug] {
			return false
		}
		delete(seen, slug)
	}
	return len(seen) == 0
}

// buildOrderByClause uses schema metadata without testing viewer SELECT grants.
// Check the caller's actual pool before sorting, including when a field is not presented.
func frontPageSortReadable(request *http.Request, dataset, column string) bool {
	if column == "" || column == "__newest" {
		return true
	}
	actor := dbutils.RequestActorContextFromRequest(request)
	q := auth.GetDBForRole(actor.UserRole)
	if q == nil {
		return false
	}
	var readable bool
	err := q.QueryRowContext(dbutils.ReadBudgetContext(request.Context()), `SELECT EXISTS (SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema='public' AND col.table_name=$1 AND col.column_name=$2
          AND has_column_privilege(format('%I.%I',col.table_schema,col.table_name),col.column_name,'SELECT'))`, dataset, column).Scan(&readable)
	return err == nil && readable
}
