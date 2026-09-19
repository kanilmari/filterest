// get_results_text_search.go
// Turns a dataset's free-text search into an ordinary condition of its listing.
// Bridges the browser's search field with the same paged read that serves
// filtering, sorting, counting and endless scrolling.
// Exists so searching a dataset stays browsing it: with the search as a
// condition, the row count is the real number of matches and further batches
// load exactly as they do without a search, instead of a separate top-N answer.
package dtt_1_row_read

import (
	"fmt"
	"net/url"
	"strings"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

// datasetSearchQueryKey is the query parameter the browser sends for the
// dataset's own free-text search.
const datasetSearchQueryKey = "search"

// appendDatasetTextSearchToWhereClause adds the free-text condition when the
// request carries a search. Without one the listing is unchanged.
//
// A dataset that has a stored search vector uses it, so the existing index
// serves the condition. Rows whose vector has not been built yet still match
// through the same on-the-fly expression the search has always used, and a
// search that is a plain number also matches that row's identifier.
func appendDatasetTextSearchToWhereClause(
	db dbutils.Querier,
	queryParams url.Values,
	tableName string,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}, error) {
	rawSearch := strings.TrimSpace(queryParams.Get(datasetSearchQueryKey))
	if rawSearch == "" {
		return whereClause, queryArgs, nil
	}

	tsQuery := buildOrPrefixTsQuery(rawSearch)
	if tsQuery == "" {
		return whereClause, queryArgs, nil
	}

	searchVectorExpr, err := datasetSearchVectorExpression(db, tableName)
	if err != nil {
		return "", nil, err
	}

	queryPlaceholder := len(queryArgs) + 1
	predicate := fmt.Sprintf("(%s) @@ to_tsquery('simple', $%d)", searchVectorExpr, queryPlaceholder)
	queryArgs = append(queryArgs, tsQuery)

	if numericID, hasNumericID := parseNumericIDSearch(rawSearch); hasNumericID {
		idPlaceholder := len(queryArgs) + 1
		predicate = fmt.Sprintf("(%s OR %s.%s = $%d)",
			predicate,
			pq.QuoteIdentifier(tableName),
			pq.QuoteIdentifier("id"),
			idPlaceholder,
		)
		queryArgs = append(queryArgs, numericID)
	}

	if strings.TrimSpace(whereClause) == "" {
		whereClause = " WHERE " + predicate
	} else {
		whereClause += " AND " + predicate
	}
	return whereClause, queryArgs, nil
}

// datasetSearchVectorExpression prefers the dataset's stored search vector and
// falls back to building one from the row, so a dataset whose vectors are not
// built yet is still searchable.
func datasetSearchVectorExpression(db dbutils.Querier, tableName string) (string, error) {
	quotedTable := pq.QuoteIdentifier(tableName)

	columns, err := dbutils.GetQueryableColumns(tableName, db, false)
	if err != nil {
		return "", err
	}
	fallbackExpr := buildSimpleSearchVectorExpression(tableName, columns)

	hasVector, err := tableHasColumn(db, tableName, "search_vector_simple")
	if err != nil {
		return "", err
	}
	switch {
	case hasVector && fallbackExpr != "":
		return fmt.Sprintf("COALESCE(%s.search_vector_simple, %s)", quotedTable, fallbackExpr), nil
	case hasVector:
		return fmt.Sprintf("%s.search_vector_simple", quotedTable), nil
	case fallbackExpr != "":
		return fallbackExpr, nil
	default:
		return "", fmt.Errorf("dataset %q has no searchable columns", tableName)
	}
}
