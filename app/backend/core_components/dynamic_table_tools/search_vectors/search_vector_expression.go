// search_vector_expression.go
// Builds the SQL expression that turns one row's columns into its search vector.
// Bridges per-row refreshes and whole-table rebuilds with one shared definition.
// Exists so route addresses, file names and identifiers are also findable word by word.
package dtt_search_vectors

import (
	"fmt"
	"strings"

	"github.com/lib/pq"
)

// searchVectorSeparators are the characters that join words inside paths,
// identifiers and file names. PostgreSQL's parser keeps "/api/update-row" as a
// single token, so the vector also stores the same text with these characters
// replaced by spaces; "api" and "update" then find that row.
const searchVectorSeparators = `/\_.-:@`

// searchVectorExpression returns the tsvector expression for the given columns.
func searchVectorExpression(columns []string) string {
	values := make([]string, 0, len(columns))
	for _, column := range columns {
		values = append(values, fmt.Sprintf("coalesce(%s::text,'')", pq.QuoteIdentifier(column)))
	}
	return SearchVectorExpressionForValues(values)
}

// SearchVectorExpressionForValues builds the same tsvector from ready-made value
// expressions, for example alias-qualified columns in a search query.
// Between: stored search vectors and the search fallback for rows without one.
// Why: both must split paths and identifiers the same way, or a word found in
// one place stays missing in the other.
func SearchVectorExpressionForValues(values []string) string {
	if len(values) == 0 {
		return ""
	}
	joined := strings.Join(values, " || ' ' || ")
	spaces := strings.Repeat(" ", len([]rune(searchVectorSeparators)))
	return fmt.Sprintf(
		"to_tsvector('simple', (%s) || ' ' || translate((%s), %s, %s))",
		joined, joined, pq.QuoteLiteral(searchVectorSeparators), pq.QuoteLiteral(spaces),
	)
}
