// row_group_facet_fetcher.go
// Builds and reads row-group facets for the authorized get-results universe.
// Bridges ordinary dataset filters, row visibility policy, and reusable row groups.
// Exists so facet counts and facet selection reuse the canonical result query boundary.
package dtt_1_row_read

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

const (
	rowGroupFilterQueryKey = "row_group"
	rowGroupFacetLimit     = 200
	rowGroupSelectionLimit = 20
)

var rowGroupFilterSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// RowGroupFacet is one enabled group represented inside the current result universe.
type RowGroupFacet struct {
	ID       int64             `json:"id"`
	Slug     string            `json:"slug"`
	Title    map[string]string `json:"title"`
	RowCount int               `json:"row_count"`
	Selected bool              `json:"selected"`
}

// decodeRowGroupFacetTitle keeps facet metadata fail-soft. The database owns a
// JSON object, but generic administration or older imports may have left a
// non-string value inside it. One malformed translation must not turn an
// otherwise authorized first-page result request into a server error.
func decodeRowGroupFacetTitle(raw string) map[string]string {
	encodedValues := make(map[string]json.RawMessage)
	if err := json.Unmarshal([]byte(raw), &encodedValues); err != nil {
		return map[string]string{}
	}

	title := make(map[string]string, len(encodedValues))
	for languageCode, encodedValue := range encodedValues {
		var value string
		if err := json.Unmarshal(encodedValue, &value); err != nil {
			continue
		}
		if strings.TrimSpace(value) != "" {
			title[languageCode] = value
		}
	}
	return title
}

// parseRowGroupSelection keeps the URL contract bounded and canonical before any database access.
func parseRowGroupSelection(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	values := strings.Split(raw, ",")
	if len(values) > rowGroupSelectionLimit {
		return nil, fmt.Errorf("row_group must contain at most %d slugs", rowGroupSelectionLimit)
	}
	seen := make(map[string]bool)
	selection := make([]string, 0, len(values))
	for _, value := range values {
		slug := strings.TrimSpace(value)
		if !rowGroupFilterSlugPattern.MatchString(slug) {
			return nil, fmt.Errorf("row_group must contain safe 1-64 character group slugs")
		}
		if !seen[slug] {
			selection = append(selection, slug)
			seen[slug] = true
		}
	}
	sort.Strings(selection)
	return selection, nil
}

// resolveRowGroupSelection drops unknown, disabled and unreadable memberships alike.
// Resolve against readable dataset rows, before text/column filters: a legitimate
// selection may then have zero matches. The caller must pass its read querier,
// including the RLS transaction, rather than a privileged metadata connection.
func resolveRowGroupSelection(
	db dbutils.Querier,
	tableName string,
	tableUID int64,
	selection []string,
	userRole string,
	userID int,
	readPolicy ReadRowPolicy,
) ([]string, error) {
	if len(selection) == 0 {
		return nil, nil
	}
	if tableUID <= 0 {
		return nil, fmt.Errorf("row_group filter requires a registered dataset")
	}
	whereClause, args := appendReadPolicyToWhereClause(tableName, userRole, userID, readPolicy,
		" WHERE row_group.enabled = TRUE AND row_group.slug = ANY($2::text[])",
		[]interface{}{tableUID, pq.Array(selection)})
	query := fmt.Sprintf(`SELECT DISTINCT row_group.slug
		FROM %s
		JOIN public.system_row_group_memberships AS row_group_membership
		  ON row_group_membership.table_uid = $1 AND row_group_membership.row_id = %s."id"
		JOIN public.system_row_groups AS row_group ON row_group.id = row_group_membership.group_id
		%s ORDER BY row_group.slug`, pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(tableName), whereClause)
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("resolve row group selection: %w", err)
	}
	defer rows.Close()
	resolved := make([]string, 0)
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, fmt.Errorf("scan row group selection: %w", err)
		}
		resolved = append(resolved, slug)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate row group selection: %w", err)
	}
	return resolved, nil
}

// rowGroupSelectionCondition is the shared listing, vector and AI membership predicate.
// S1 has one heading: any resolved selected value matches. Slugs are data, never SQL identifiers.
func rowGroupSelectionCondition(tableReference string, tableUID int64, selection []string, queryArgs []interface{}) (string, []interface{}, error) {
	if len(selection) == 0 {
		return "", queryArgs, nil
	}
	if tableUID <= 0 {
		return "", nil, fmt.Errorf("row_group filter requires a registered dataset")
	}
	predicate := fmt.Sprintf(`EXISTS (
		SELECT 1
		FROM public.system_row_group_memberships AS row_group_membership
		JOIN public.system_row_groups AS row_group
		  ON row_group.id = row_group_membership.group_id
		 AND row_group.enabled = TRUE
		WHERE row_group_membership.table_uid = $%d
		  AND row_group_membership.row_id = %s.%s
		  AND row_group.slug = ANY($%d::text[])
	)`, len(queryArgs)+1, pq.QuoteIdentifier(tableReference), pq.QuoteIdentifier("id"), len(queryArgs)+2)
	return predicate, append(queryArgs, tableUID, pq.Array(selection)), nil
}

// appendRowGroupFilterToWhereClause applies the resolved selection to the canonical WHERE clause.
func appendRowGroupFilterToWhereClause(
	selection []string,
	tableName string,
	tableUID int64,
	columnsByName map[string]dtt_models.ColumnInfo,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}, error) {
	if len(selection) == 0 {
		return whereClause, queryArgs, nil
	}
	if _, hasIDColumn := columnsByName["id"]; !hasIDColumn {
		return "", nil, fmt.Errorf("row_group filter requires an id column")
	}
	predicate, args, err := rowGroupSelectionCondition(tableName, tableUID, selection, queryArgs)
	if err != nil {
		return "", nil, err
	}
	if strings.TrimSpace(whereClause) == "" {
		whereClause = " WHERE " + predicate
	} else {
		whereClause += " AND " + predicate
	}
	return whereClause, args, nil
}

// buildRowGroupFacetQuery counts the authorized, filtered universe before this
// heading's selection. Selected values survive zero counts and the cap; the
// final presentation order remains sort_order, then slug.
func buildRowGroupFacetQuery(
	tableName string,
	tableUID int64,
	joinClauses string,
	whereClause string,
	queryArgs []interface{},
	selection []string,
) (string, []interface{}) {
	query := fmt.Sprintf(`
		WITH facet_counts AS (
			SELECT row_group.id, COUNT(DISTINCT %s."id") AS row_count
			FROM %s
			%s
			JOIN public.system_row_group_memberships AS row_group_membership
			  ON row_group_membership.table_uid = $%d
			 AND row_group_membership.row_id = %s."id"
			JOIN public.system_row_groups AS row_group
			  ON row_group.id = row_group_membership.group_id AND row_group.enabled = TRUE
			%s
			GROUP BY row_group.id
		), capped_facets AS (
			SELECT row_group.id, row_group.slug, row_group.title::text,
			       COALESCE(facet_counts.row_count, 0) AS row_count,
			       row_group.slug = ANY($%d::text[]) AS selected, row_group.sort_order
			FROM public.system_row_groups AS row_group
			LEFT JOIN facet_counts ON facet_counts.id = row_group.id
			WHERE row_group.enabled = TRUE
			  AND (facet_counts.row_count > 0 OR row_group.slug = ANY($%d::text[]))
			ORDER BY selected DESC, row_group.sort_order ASC, row_group.slug ASC
			LIMIT %d
		)
		SELECT id, slug, title, row_count, selected FROM capped_facets
		ORDER BY sort_order ASC, slug ASC`,
		pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(tableName), joinClauses,
		len(queryArgs)+1, pq.QuoteIdentifier(tableName), whereClause,
		len(queryArgs)+2, len(queryArgs)+2, rowGroupFacetLimit)
	facetArgs := append([]interface{}{}, queryArgs...)
	// An empty PostgreSQL array (rather than NULL) keeps selected a boolean.
	facetArgs = append(facetArgs, tableUID, pq.Array(append([]string{}, selection...)))
	return query, facetArgs
}

// fetchRowGroupFacets reads only groups attached to rows already inside the canonical authorized result query.
// COUNT(DISTINCT dataset.id) prevents foreign-key joins or repeated membership paths from inflating a facet.
func fetchRowGroupFacets(
	db dbutils.Querier,
	tableName string,
	tableUID int64,
	joinClauses string,
	whereClause string,
	queryArgs []interface{},
	selection []string,
) ([]RowGroupFacet, error) {
	query, facetArgs := buildRowGroupFacetQuery(
		tableName,
		tableUID,
		joinClauses,
		whereClause,
		queryArgs,
		selection,
	)
	rows, err := db.Query(query, facetArgs...)
	if err != nil {
		return nil, fmt.Errorf("query row group facets: %w", err)
	}
	defer rows.Close()

	facets := make([]RowGroupFacet, 0)
	for rows.Next() {
		var facet RowGroupFacet
		var titleJSON string
		if err := rows.Scan(&facet.ID, &facet.Slug, &titleJSON, &facet.RowCount, &facet.Selected); err != nil {
			return nil, fmt.Errorf("scan row group facet: %w", err)
		}
		if facet.ID <= 0 || (facet.RowCount < 0 || (facet.RowCount == 0 && !facet.Selected)) || !rowGroupFilterSlugPattern.MatchString(facet.Slug) {
			continue
		}
		facet.Title = decodeRowGroupFacetTitle(titleJSON)
		facets = append(facets, facet)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate row group facets: %w", err)
	}
	return facets, nil
}
