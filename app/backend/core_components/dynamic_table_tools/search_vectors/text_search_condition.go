// text_search_condition.go
// Turns a person's free-text search into the condition and order a searchable list uses.
// Bridges dataset listings, the assisted search and other lists, such as the workline observatory.
// Exists so one search finds the same rows wherever it runs: word beginnings, any of the
// words, and an integer term that also means the row with that identifier, listed first.
package dtt_search_vectors

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

// TextSearch is a free-text search ready to join a list's query.
type TextSearch struct {
	// Predicate matches the rows the search finds. Its placeholders start at the
	// number given to TextSearchCondition.
	Predicate string
	// Args holds the values for those placeholders, in order.
	Args []interface{}
	// OrderBy lists the best match first: the row an integer term names, then the
	// rank of the words, then the identifier. OrderByWithSort keeps ID priority
	// ahead of an active sort while preserving that sort for all other matches.
	OrderBy string
	// IDPredicate is also used by assisted search's existing exact-hit score.
	IDPredicate string
}

// IDSearch enables identifier matching only for a verified integer primary key.
// It owns both SQL ranking and the stable lift after assisted candidates merge.
type IDSearch struct {
	ID      int
	Enabled bool
}

// DatasetIDSearch checks the actual key, rather than assuming every id is an
// integer. No row is fetched here: visibility remains in the caller's WHERE/RLS.
func DatasetIDSearch(db interface {
	QueryRow(string, ...interface{}) *sql.Row
}, tableName, rawSearch string) (IDSearch, error) {
	id, ok := NumericIDSearch(rawSearch)
	if !ok {
		return IDSearch{}, nil
	}
	var eligible bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM pg_catalog.pg_index AS key
			JOIN pg_catalog.pg_attribute AS column_info
			  ON column_info.attrelid = key.indrelid
			 AND column_info.attnum = key.indkey[0]
			WHERE key.indrelid = pg_catalog.to_regclass($1)
			  AND key.indisprimary AND key.indnkeyatts = 1
			  AND column_info.attname = 'id'
			  AND column_info.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
		)`, pq.QuoteIdentifier(tableName)).Scan(&eligible)
	if err != nil {
		return IDSearch{}, fmt.Errorf("check integer search key: %w", err)
	}
	return IDSearch{ID: id, Enabled: eligible}, nil
}

// TextTerm removes the optional identifier marker only for eligible searches.
// All ordinary matching still uses the person's digits (including leading zeros).
func (id IDSearch) TextTerm(raw string) string {
	if id.Enabled {
		return strings.TrimPrefix(strings.TrimSpace(raw), "#")
	}
	return raw
}

// Apply includes the identifier inside the text predicate and prepends its rank.
// Callers must AND the resulting predicate with every filter and authorization
// condition, then count and page that same query, never inject a separate row.
func (id IDSearch) Apply(search TextSearch, idExpr string, placeholder int) TextSearch {
	if !id.Enabled {
		return search
	}
	// Explicit bigint typing also accepts a valid int64 outside an int2/int4
	// key's range: it cannot match that key, but must not fail the text search.
	search.IDPredicate = fmt.Sprintf("%s = $%d::bigint", idExpr, placeholder)
	if search.Predicate == "" {
		search.Predicate = search.IDPredicate
	} else {
		search.Predicate = fmt.Sprintf("(%s OR %s)", search.Predicate, search.IDPredicate)
	}
	search.Args = append(search.Args, id.ID)
	search.OrderBy = search.orderWithIDFirst(search.OrderBy)
	return search
}

// OrderByWithSort composes a picked, saved or default order with ID priority.
// Without an active sort it retains relevance; without an eligible ID match
// it retains the active sort exactly. Callers apply this before LIMIT/OFFSET.
func (search TextSearch) OrderByWithSort(activeOrderBy string) string {
	if activeOrderBy == "" {
		return search.OrderBy
	}
	return search.orderWithIDFirst(activeOrderBy)
}

func (search TextSearch) orderWithIDFirst(orderBy string) string {
	if search.IDPredicate == "" {
		return orderBy
	}
	return " ORDER BY (" + search.IDPredicate + ") DESC" +
		strings.Replace(orderBy, " ORDER BY ", ", ", 1)
}

// Prioritize lifts only an existing authorized candidate and preserves all
// other candidates' order. The merge already removes duplicate candidates.
func (id IDSearch) Prioritize(rows []int) []int {
	if !id.Enabled {
		return rows
	}
	for position, rowID := range rows {
		if rowID == id.ID {
			copy(rows[1:position+1], rows[:position])
			rows[0] = rowID
			break
		}
	}
	return rows
}

// TextSearchCondition builds the search over vectorExpr, the row's tsvector as
// SearchVectorExpressionForValues returns it, with idExpr the row's identifier.
// id comes from DatasetIDSearch, or a fixed relation's known integer key.
// An empty idExpr omits the identifier tie-break for a dataset without id.
// It reports false when the search holds no words, so the list stays unfiltered.
func TextSearchCondition(rawSearch, vectorExpr, idExpr string, firstPlaceholder int, id IDSearch) (TextSearch, bool) {
	tsQuery := OrPrefixTsQuery(id.TextTerm(rawSearch))
	if tsQuery == "" {
		return TextSearch{}, false
	}

	predicate := fmt.Sprintf("(%s) @@ to_tsquery('simple', $%d)", vectorExpr, firstPlaceholder)
	args := []interface{}{tsQuery}
	// The ranking reuses the condition's placeholder. A second one would be a
	// second copy of the words to keep in step, and would shift every argument
	// the caller adds afterwards.
	rankExpr := fmt.Sprintf("ts_rank(%s, to_tsquery('simple', $%d))", vectorExpr, firstPlaceholder)

	// The identifier last makes the order total. Without it two rows of equal
	// rank may come back in either order, and a list read in windows can show
	// the same row twice while another is never seen at all.
	orderBy := fmt.Sprintf(" ORDER BY %s DESC", rankExpr)
	if idExpr != "" {
		orderBy += ", " + idExpr + " DESC"
	}
	return id.Apply(TextSearch{Predicate: predicate, Args: args, OrderBy: orderBy}, idExpr, firstPlaceholder+1), true
}

// OrPrefixTsQuery turns the words of a search into a query that matches any of
// them at the beginning of a word, for example
//
//	"kahvila kaninkolo" → "kahvila:* | kaninkolo:*"
func OrPrefixTsQuery(input string) string {
	words := strings.Fields(strings.ToLower(input))
	if len(words) == 0 {
		return ""
	}
	for i, w := range words {
		words[i] = w + ":*"
	}
	return strings.Join(words, " | ")
}

// NumericIDSearch accepts a whole signed decimal integer, after trimming and
// removing at most one leading '#'. Overflow and mixed text never enable ID
// matching. Supported 64-bit runtimes cover PostgreSQL's entire bigint range.
func NumericIDSearch(input string) (int, bool) {
	input = strings.TrimPrefix(strings.TrimSpace(input), "#")
	if input == "" {
		return 0, false
	}
	digits := input
	if digits[0] == '+' || digits[0] == '-' {
		digits = digits[1:]
	}
	if digits == "" {
		return 0, false
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	id, err := strconv.Atoi(input)
	if err != nil {
		return 0, false
	}
	return id, true
}
