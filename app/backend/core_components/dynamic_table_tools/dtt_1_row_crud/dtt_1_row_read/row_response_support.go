// row_response_support.go
// Owns support requirements for a row projection, with additive legacy flags.
// Connects listing and every intelligent-search response to existing enrichment.
// Keeps support separate from presented fields and picture authorization unconditional.
package dtt_1_row_read

import (
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
	"easelect/backend/pipeline/access_control"
)

var resultsViewKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func normalizeResultsViewKey(raw string) string {
	viewKey := strings.ToLower(strings.TrimSpace(raw))
	switch viewKey {
	case "article", "big_card", "row_article":
		viewKey = "article_view"
	}
	if resultsViewKeyPattern.MatchString(viewKey) {
		return viewKey
	}
	return "table"
}

type rowSupportRequest struct {
	viewKey            string
	includeCardSupport bool
	includeMapSupport  bool
}

// resolveRowSupportRequest describes transport needs, not the dataset's shown view.
// A missing view keeps the compact legacy response. Explicit flags add support;
// they never subtract what the requested projection needs or grant read permission.
func resolveRowSupportRequest(params url.Values) rowSupportRequest {
	support := rowSupportRequest{viewKey: normalizeResultsViewKey(params.Get("view_key"))}
	switch support.viewKey {
	case "card", "article_view", "product_card", "image_first_page_view":
		support.includeCardSupport = true
	case "map":
		support.includeMapSupport = true
	}
	support.includeCardSupport = support.includeCardSupport || params.Get("include_card_support") == "1"
	support.includeMapSupport = support.includeMapSupport || params.Get("include_map_support") == "1"
	return support
}

// prepareRowsForResponse enriches already-authorized rows without adding presented
// columns. Parent pictures and geometry are intersected with reader SELECT rights.
// Existing cached gallery pictures are authorized even when enrichment is omitted.
func prepareRowsForResponse(
	q dbutils.Querier,
	table string,
	rows []map[string]interface{},
	columns map[int]dtt_models.ColumnInfo,
	visible []string,
	actor dbutils.RequestActorContext,
	support rowSupportRequest,
	permittedGeometry []string,
) error {
	if err := prepareRowsForCardResponse(q, table, rows, columns, visible, actor, support.includeCardSupport); err != nil {
		return err
	}
	if support.includeMapSupport {
		logMapSupportEnrichmentWarning(table, enrichRowsWithMapSupportColumns(q, table, rows, permittedGeometry))
	}
	return nil
}

// resolveSearchMapSupportColumns reads geometry metadata once for both streamed
// stages. Metadata/read failures omit optional geometry; the owner connection
// never retries a denied reader query. Listing already has the same metadata.
func resolveSearchMapSupportColumns(db *sql.DB, table string, support rowSupportRequest) []string {
	if !support.includeMapSupport {
		return nil
	}
	geometry, err := getGeometryColumns(db, table)
	if err != nil {
		logMapSupportEnrichmentWarning(table, err)
		return nil
	}
	allowed, err := fetchUserSelectableColumns(db, table)
	if err != nil {
		logMapSupportEnrichmentWarning(table, err)
		return nil
	}
	allowedColumns := make(map[string]bool, len(allowed))
	for _, column := range allowed {
		allowedColumns[column] = true
	}
	return filterAllowedGeometryColumns(geometry, allowedColumns)
}

// selectableColumnSet never infers grants from owner-loaded presentation metadata.
func selectableColumnSet(columns []string) map[string]bool {
	allowed := make(map[string]bool, len(columns))
	for _, column := range columns {
		allowed[column] = true
	}
	return allowed
}

// filterReadableColumnMetadata protects owner-loaded listing/search metadata before
// joins are built, including picture and geometry columns advertised in metadata.
func filterReadableColumnMetadata(columns map[int]dtt_models.ColumnInfo, allowed map[string]bool) map[int]dtt_models.ColumnInfo {
	readable := make(map[int]dtt_models.ColumnInfo, len(columns))
	for uid, column := range columns {
		if allowed[column.ColumnName] {
			readable[uid] = column
		}
	}
	return readable
}

// filterAllowedSupportColumns intersects optional image/geometry names with caller grants.
func filterAllowedSupportColumns(supportColumns []string, allowedColumns map[string]bool) []string {
	if len(supportColumns) == 0 || len(allowedColumns) == 0 {
		return nil
	}

	filteredColumns := make([]string, 0, len(supportColumns))
	seen := make(map[string]bool, len(supportColumns))
	for _, columnName := range supportColumns {
		trimmedColumn := strings.TrimSpace(columnName)
		if trimmedColumn == "" || seen[trimmedColumn] || !allowedColumns[trimmedColumn] {
			continue
		}
		seen[trimmedColumn] = true
		filteredColumns = append(filteredColumns, trimmedColumn)
	}
	return filteredColumns
}

// allowResultsPresentationRead runs before projection, row queries and row logs.
// Page's presentation right uses its catalogue's own scope through the shared rule
// (a tableless entry counts a global grant, a dataset-specific one only that dataset),
// the same rule as Home button visibility. The dataset boundary stays get_results'
// own /api/get-results check. All older view keys retain their original route boundary.
func allowResultsPresentationRead(w http.ResponseWriter, dataset string, userID int, viewKey string) bool {
	if viewKey != "image_first_page_view" {
		return true
	}
	const route = "/ui/view/image_first_page_view"
	// A missing or disabled function is an error here, so recovery never revives it,
	// as in the route pipeline.
	allowed, err := permissions.CheckDatasetRoutePermission(backend.Db, route, userID, dataset)
	if err == nil && (allowed || access_control.AdministratorPermissionRecoveryAllowed(userID, route)) {
		return true
	}
	httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (single table)")
	return false
}
