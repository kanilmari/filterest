// text_search_condition.go
// Turns a person's free-text search into the condition and order a searchable list uses.
// Bridges dataset listings, the assisted search and other lists, such as the workline observatory.
// Exists so one search finds the same rows wherever it runs: word beginnings, any of the
// words, and a plain number that also means the row with that identifier, listed first.
package dtt_search_vectors

import (
	"fmt"
	"strconv"
	"strings"
)

// TextSearch is a free-text search ready to join a list's query.
type TextSearch struct {
	// Predicate matches the rows the search finds. Its placeholders start at the
	// number given to TextSearchCondition.
	Predicate string
	// Args holds the values for those placeholders, in order.
	Args []interface{}
	// OrderBy lists the best match first: the row a plain number names, then the
	// rank of the words, then the identifier. A list applies it only when the
	// person has not chosen an order of their own; a sort they chose stays in force.
	OrderBy string
}

// TextSearchCondition builds the search over vectorExpr, the row's tsvector as
// SearchVectorExpressionForValues returns it, with idExpr the row's identifier.
// It reports false when the search holds no words, so the list stays unfiltered.
func TextSearchCondition(rawSearch, vectorExpr, idExpr string, firstPlaceholder int) (TextSearch, bool) {
	tsQuery := OrPrefixTsQuery(rawSearch)
	if tsQuery == "" {
		return TextSearch{}, false
	}

	predicate := fmt.Sprintf("(%s) @@ to_tsquery('simple', $%d)", vectorExpr, firstPlaceholder)
	args := []interface{}{tsQuery}
	// The ranking reuses the condition's placeholder. A second one would be a
	// second copy of the words to keep in step, and would shift every argument
	// the caller adds afterwards.
	rankExpr := fmt.Sprintf("ts_rank(%s, to_tsquery('simple', $%d))", vectorExpr, firstPlaceholder)

	idOrderExpr := ""
	if numericID, ok := NumericIDSearch(rawSearch); ok {
		idPlaceholder := firstPlaceholder + 1
		predicate = fmt.Sprintf("(%s OR %s = $%d)", predicate, idExpr, idPlaceholder)
		args = append(args, numericID)
		// Searching a number means that row above everything else, which is
		// how the assisted search has always treated an exact identifier.
		idOrderExpr = fmt.Sprintf("(%s = $%d) DESC, ", idExpr, idPlaceholder)
	}

	// The identifier last makes the order total. Without it two rows of equal
	// rank may come back in either order, and a list read in windows can show
	// the same row twice while another is never seen at all.
	orderBy := fmt.Sprintf(" ORDER BY %s%s DESC, %s DESC", idOrderExpr, rankExpr, idExpr)
	return TextSearch{Predicate: predicate, Args: args, OrderBy: orderBy}, true
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

// NumericIDSearch reports whether a search is a plain number, which then also
// means the row with that identifier. Mixed text never does, so a search with
// words is not widened by an identifier it happens to contain.
func NumericIDSearch(input string) (int, bool) {
	if input == "" {
		return 0, false
	}
	for _, r := range input {
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
