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
//
// It also returns how those matches should be ordered by relevance. The caller
// uses that only when the person has not chosen a sort of their own. Building
// it here is what keeps the ranking honest: it reuses the very expression and
// the very placeholder the condition matched with, instead of a second copy
// that has to be kept in step by hand.
func appendDatasetTextSearchToWhereClause(
	db dbutils.Querier,
	queryParams url.Values,
	tableName string,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}, string, error) {
	rawSearch := strings.TrimSpace(queryParams.Get(datasetSearchQueryKey))
	if rawSearch == "" {
		return whereClause, queryArgs, "", nil
	}

	tsQuery := buildOrPrefixTsQuery(rawSearch)
	if tsQuery == "" {
		return whereClause, queryArgs, "", nil
	}

	searchVectorExpr, err := datasetSearchVectorExpression(db, tableName)
	if err != nil {
		return "", nil, "", err
	}

	queryPlaceholder := len(queryArgs) + 1
	predicate := fmt.Sprintf("(%s) @@ to_tsquery('simple', $%d)", searchVectorExpr, queryPlaceholder)
	queryArgs = append(queryArgs, tsQuery)

	quotedTable := pq.QuoteIdentifier(tableName)
	quotedID := pq.QuoteIdentifier("id")
	rankExpr := fmt.Sprintf("ts_rank(%s, to_tsquery('simple', $%d))", searchVectorExpr, queryPlaceholder)
	idOrderExpr := ""

	if numericID, hasNumericID := parseNumericIDSearch(rawSearch); hasNumericID {
		idPlaceholder := len(queryArgs) + 1
		predicate = fmt.Sprintf("(%s OR %s.%s = $%d)",
			predicate,
			quotedTable,
			quotedID,
			idPlaceholder,
		)
		queryArgs = append(queryArgs, numericID)
		// Searching a number means that row above everything else, which is
		// how the assisted search has always treated an exact identifier.
		idOrderExpr = fmt.Sprintf("(%s.%s = $%d) DESC, ", quotedTable, quotedID, idPlaceholder)
	}

	if strings.TrimSpace(whereClause) == "" {
		whereClause = " WHERE " + predicate
	} else {
		whereClause += " AND " + predicate
	}

	// The identifier last makes the order total. Without it two rows of equal
	// rank may come back in either order, and endless scrolling reads the
	// result in windows: the same row can arrive twice while another is never
	// seen at all.
	relevanceOrderBy := fmt.Sprintf(" ORDER BY %s%s DESC, %s.%s DESC",
		idOrderExpr, rankExpr, quotedTable, quotedID)

	return whereClause, queryArgs, relevanceOrderBy, nil
}

// rowsOutsideDatasetTextSearch keeps, in their given order, only the rows the
// dataset's listing would not return for the same search.
//
// The AI group holds only what the text search did not return, so a row it
// suggests is never met again further down the listing while the reader
// scrolls. The test is the listing's own condition, built by the same function,
// rather than the handful of rows a separate top-N text answer happened to hold.
// A search that adds no condition leaves the listing showing every row, so then
// no row remains for the AI group either.
func rowsOutsideDatasetTextSearch(
	db dbutils.Querier,
	tableName string,
	search string,
	rowIDs []int,
) ([]int, error) {
	if len(rowIDs) == 0 {
		return rowIDs, nil
	}

	quotedTable := pq.QuoteIdentifier(tableName)
	quotedID := pq.QuoteIdentifier("id")
	candidates := make(pq.Int64Array, len(rowIDs))
	for index, rowID := range rowIDs {
		candidates[index] = int64(rowID)
	}

	whereClause, args, _, err := appendDatasetTextSearchToWhereClause(
		db,
		url.Values{datasetSearchQueryKey: {search}},
		tableName,
		fmt.Sprintf(" WHERE %s.%s = ANY($1)", quotedTable, quotedID),
		[]interface{}{candidates},
	)
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(
		fmt.Sprintf("SELECT %s.%s FROM %s%s", quotedTable, quotedID, quotedTable, whereClause),
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("rows the search lists: %w", err)
	}
	defer func() { _ = rows.Close() }()

	listed := make(map[int]bool, len(rowIDs))
	for rows.Next() {
		var rowID int
		if err := rows.Scan(&rowID); err != nil {
			return nil, err
		}
		listed[rowID] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	outside := make([]int, 0, len(rowIDs))
	for _, rowID := range rowIDs {
		if !listed[rowID] {
			outside = append(outside, rowID)
		}
	}
	return outside, nil
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
