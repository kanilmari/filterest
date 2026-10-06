// front_page_read.go
// Serves current, readable front page blocks through the canonical results handler.
// Connects session-owned scope selection with dataset, field and row authorization.
// Omits hidden and failed datasets completely and budgets sequential delegates.
package system_table_tools

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"time"

	backend "easelect/backend/core_components"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

var frontPageSettingsReader = backend.ReadFrontPageSettings
var frontPageBackgroundReader = backend.ReadFrontPageBackground
var frontPageBlocksResolver = resolveFrontPageBlocks
var frontPageCanRead = frontPageDatasetReadable
var frontPageResultsHandler http.HandlerFunc = read.GetResultsHandlerWrapper
var frontPageNow = time.Now

type frontPageResultBlock struct {
	Dataset     string            `json:"dataset"`
	ResultLimit int               `json:"result_limit"`
	Columns     json.RawMessage   `json:"columns"`
	Types       json.RawMessage   `json:"types"`
	Data        []json.RawMessage `json:"data"`
}

// GetFrontPageHandler returns viewer_id, site_name, background, blocks and partial.
// GET /api/front-page. Disabled sites return 404. LoginOnlyProfile establishes the
// viewer; each block separately requires /api/get-results rights and delegates
// with __newest DESC and row_count=0, preserving the request actor. These text
// summaries never opt into the separate image/card enrichment path.
func GetFrontPageHandler(w http.ResponseWriter, r *http.Request) {
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
	blocks, _, err := frontPageBlocksResolver(backend.Db, userID)
	if err != nil {
		log.Printf("[GetFrontPageHandler] blocks unavailable: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "front page unavailable")
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
		if r.Context().Err() != nil || frontPageNow().Sub(start) >= 3*time.Second {
			partial = true
			break
		}
		if !frontPageCanRead(userID, block.Dataset) {
			continue
		}
		if r.Context().Err() != nil || frontPageNow().Sub(start) >= 3*time.Second {
			partial = true
			break
		}
		result, ok := delegateFrontPageBlock(r, block)
		if ok {
			results = append(results, result)
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie")
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]any{
		"viewer_id": userID, "site_name": backend.ConfiguredSiteName(r.Context(), backend.Db), "background": background,
		"blocks": results, "partial": partial,
	})
}

func delegateFrontPageBlock(original *http.Request, block frontPageBlock) (frontPageResultBlock, bool) {
	request := original.Clone(original.Context())
	request.Method, request.Body = http.MethodGet, http.NoBody
	delegateURL := *request.URL
	delegateURL.Path, delegateURL.RawPath = "/api/get-results", ""
	query := url.Values{"dataset": {block.Dataset}, "sort_column": {"__newest"}, "sort_order": {"DESC"},
		"row_count": {"0"}, "view_key": {"card"}}
	if language := original.URL.Query().Get("lang"); language != "" {
		query.Set("lang", language)
	}
	delegateURL.RawQuery = query.Encode()
	request.URL, request.RequestURI = &delegateURL, delegateURL.RequestURI()
	response := httptest.NewRecorder()
	frontPageResultsHandler(response, request)
	var result frontPageResultBlock
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Columns) == 0 || len(result.Types) == 0 {
		log.Printf("[GetFrontPageHandler] omitted dataset %q: delegate status %d", block.Dataset, response.Code)
		return result, false
	}
	result.Dataset, result.ResultLimit = block.Dataset, block.ResultLimit
	if len(result.Data) > block.ResultLimit {
		result.Data = result.Data[:block.ResultLimit]
	}
	if result.Data == nil {
		result.Data = []json.RawMessage{}
	}
	// Raw rows retain id even when it was not selected as a presented column.
	return result, true
}
