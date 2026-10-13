// front_page_article_buttons_read.go
// Resolves Home article targets through the viewer's canonical article projection.
// Connects private stable identities, route rights and accepted dataset URL names.
// Emits only href and label, with no target diagnostics or private configuration.
package system_table_tools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/permissions"
	config "easelect/backend/core_components/system_config_checks"
)

var frontPageArticleButtonsReader = readFrontPageArticleButtons
var frontPageArticleTargetReader = readFrontPageArticleTarget
var frontPageArticleViewAllowed = func(userID int, dataset string) bool {
	return frontPageArticleRouteGranted(userID, dataset, "/ui/view/article_view")
}
var frontPageArticleReadGranted = func(userID int, dataset string) bool {
	return frontPageArticleRouteGranted(userID, dataset, "/api/get-results")
}
var frontPageArticlePathReader = frontPageArticlePath

// Buttons require real grants even when a developer has enabled administrator
// permission recovery. The canonical permission checker owns dataset scoping.
func frontPageArticleRouteGranted(userID int, dataset, route string) bool {
	related, err := permissions.FunctionSpecificTableRelated(backend.Db, route, permissions.DisabledFunctionFalseOrNull)
	if err != nil {
		return false
	}
	scope := permissions.RouteTableScope{}
	if related {
		scope.TableName = dataset
	}
	allowed, err := permissions.CheckRouteTablePermission(backend.Db, route, userID, scope, permissions.AccessControlRouteTableOptions(false))
	return err == nil && allowed
}

type frontPageArticleButton struct {
	Href  string `json:"href"`
	Label string `json:"label"`
}

type frontPageArticleResult struct {
	Columns []string                     `json:"columns"`
	Types   map[string]json.RawMessage   `json:"types"`
	Data    []map[string]json.RawMessage `json:"data"`
}

func readFrontPageArticleTarget(r *http.Request, tableUID int) (string, error) {
	var dataset string
	err := backend.Db.QueryRowContext(r.Context(), `SELECT registry.table_name FROM public.system_db_tables registry
		WHERE registry.table_uid=$1 AND COALESCE(NULLIF(registry.schema_name,''),'public')='public'
		AND EXISTS(SELECT 1 FROM information_schema.tables object
			WHERE object.table_schema='public' AND object.table_name=registry.table_name)`, tableUID).Scan(&dataset)
	return dataset, err
}

func frontPageArticlePath(r *http.Request, tableUID int, dataset, rowID string) (string, bool) {
	pools, err := dataset_routes.LoadDatasetNamePools(backend.Db)
	if err != nil {
		return "", false
	}
	for _, pool := range pools {
		if pool.TableUID == tableUID && pool.DatasetName == dataset && pool.SchemaName == "public" {
			accepted, err := dataset_routes.ResolveDatasetNamePool(pools, pool.PreferredName)
			if err == nil && accepted.TableUID == tableUID {
				return "/" + url.PathEscape(pool.PreferredName) + "/" + rowID + "?view=article_view", true
			}
		}
	}
	return "", false
}

// delegateFrontPageArticle retains the exact caller session and transaction.
// Only the configured numeric ID and article projection enter the row query.
func delegateFrontPageArticle(original *http.Request, dataset, rowID string) (frontPageArticleResult, bool) {
	request := original.Clone(original.Context())
	request.Method, request.Body = http.MethodGet, http.NoBody
	delegateURL := *request.URL
	delegateURL.Path, delegateURL.RawPath = "/api/get-results", ""
	query := url.Values{"dataset": {dataset}, "id": {rowID}, "row_count": {"0"}, "view_key": {"article_view"}}
	if language := original.URL.Query().Get("lang"); language != "" {
		query.Set("lang", language)
	}
	delegateURL.RawQuery = query.Encode()
	request.URL, request.RequestURI = &delegateURL, delegateURL.RequestURI()
	response := httptest.NewRecorder()
	frontPageResultsHandler(response, request)
	var result frontPageArticleResult
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
		return result, false
	}
	// Match the article opener's exact-ID check; never reuse an arbitrary row.
	for _, row := range result.Data {
		id := string(row["id"])
		if len(id) > 0 && id[0] == '"' {
			id, _ = strconv.Unquote(id)
		}
		if id == rowID {
			result.Data = []map[string]json.RawMessage{row}
			return result, true
		}
	}
	return result, false
}

// resolveFrontPageArticleButtons budgets optional article work independently,
// including its setting read. Legacy synchronous delegates share the elapsed
// budget; a late result is discarded and no later target is attempted.
func resolveFrontPageArticleButtons(r *http.Request, userID int) ([]frontPageArticleButton, config.FrontPageArticleButtons) {
	const budget = 3 * time.Second
	start := frontPageNow()
	ctx, cancel := context.WithTimeout(r.Context(), budget)
	defer cancel()
	original := r
	r = r.WithContext(ctx)
	expired := func() bool { return ctx.Err() != nil || frontPageNow().Sub(start) >= budget }
	value, _, err := frontPageArticleButtonsReader(ctx, backend.Db)
	if err != nil {
		// Malformed or unavailable private configuration must never expose targets.
		value = config.EmptyFrontPageArticleButtons()
	}
	buttons := []frontPageArticleButton{}
	for _, item := range value.Items {
		if expired() {
			break
		}
		if !item.Enabled {
			continue
		}
		dataset, err := frontPageArticleTargetReader(r, item.TableUID)
		if err != nil || !frontPageArticleViewAllowed(userID, dataset) || !frontPageArticleReadGranted(userID, dataset) || !frontPageCanRead(userID, dataset) {
			continue
		}
		if expired() {
			break
		}
		// A child deadline must not own a lazily opened shared transaction:
		// cancelling it would roll back the caller's transaction at return.
		// Preserve the canonical delegate's context and discard late results.
		result, ok := delegateFrontPageArticle(original, dataset, item.RowID)
		if expired() {
			break
		}
		if !ok {
			continue
		}
		label := frontPageArticleTitle(r, userID, result)
		if expired() {
			break
		}
		if label == "" {
			continue
		}
		href, ok := frontPageArticlePathReader(r, item.TableUID, dataset, item.RowID)
		if expired() {
			break
		}
		if ok {
			buttons = append(buttons, frontPageArticleButton{Href: href, Label: label})
		}
	}
	return buttons, value
}
