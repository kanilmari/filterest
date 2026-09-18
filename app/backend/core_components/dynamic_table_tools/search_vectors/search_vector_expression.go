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
	if len(columns) == 0 {
		return ""
	}
	parts := make([]string, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, fmt.Sprintf("coalesce(%s::text,'')", pq.QuoteIdentifier(column)))
	}
	joined := strings.Join(parts, " || ' ' || ")
	spaces := strings.Repeat(" ", len([]rune(searchVectorSeparators)))
	return fmt.Sprintf(
		"to_tsvector('simple', (%s) || ' ' || translate((%s), %s, %s))",
		joined, joined, pq.QuoteLiteral(searchVectorSeparators), pq.QuoteLiteral(spaces),
	)
}
