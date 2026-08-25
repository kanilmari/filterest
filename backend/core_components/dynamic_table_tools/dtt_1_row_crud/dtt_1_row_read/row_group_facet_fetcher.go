// row_group_facet_fetcher.go
// Builds and reads row-group facets for the authorized get-results universe.
// Bridges ordinary dataset filters, row visibility policy, and reusable row groups.
// Exists so facet counts and facet selection reuse the canonical result query boundary.
package dtt_1_row_read

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

const (
	rowGroupFilterQueryKey = "row_group"
	rowGroupFacetLimit     = 12
)

var rowGroupFilterSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// RowGroupFacet is one enabled group represented inside the current result universe.
type RowGroupFacet struct {
	ID       int64             `json:"id"`
	Slug     string            `json:"slug"`
	Title    map[string]string `json:"title"`
	RowCount int               `json:"row_count"`
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

func normalizeRowGroupFilterSlug(raw string) (string, error) {
	slug := strings.TrimSpace(raw)
	if slug == "" {
		return "", nil
	}
	if !rowGroupFilterSlugPattern.MatchString(slug) {
		return "", fmt.Errorf("row_group must be a safe 1-64 character group slug")
	}
	return slug, nil
}

// appendRowGroupFilterToWhereClause adds one parameterized EXISTS predicate to the canonical result WHERE clause.
// It keeps the group filter inside the same query and row-policy universe used by ordinary dataset filters.
func appendRowGroupFilterToWhereClause(
	queryParams url.Values,
	tableName string,
	tableUID int64,
	columnsByName map[string]dtt_models.ColumnInfo,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}, error) {
	slug, err := normalizeRowGroupFilterSlug(queryParams.Get(rowGroupFilterQueryKey))
	if err != nil {
		return "", nil, err
	}
	if slug == "" {
		return whereClause, queryArgs, nil
	}
	if tableUID <= 0 {
		return "", nil, fmt.Errorf("row_group filter requires a registered dataset")
	}
	if _, hasIDColumn := columnsByName["id"]; !hasIDColumn {
		return "", nil, fmt.Errorf("row_group filter requires an id column")
	}

	tableUIDPlaceholder := len(queryArgs) + 1
	slugPlaceholder := tableUIDPlaceholder + 1
	predicate := fmt.Sprintf(`EXISTS (
		SELECT 1
		FROM public.system_row_group_memberships AS row_group_membership
		JOIN public.system_row_groups AS row_group
		  ON row_group.id = row_group_membership.group_id
		 AND row_group.enabled = TRUE
		WHERE row_group_membership.table_uid = $%d
		  AND row_group_membership.row_id = %s.%s
		  AND row_group.slug = $%d
	)`,
		tableUIDPlaceholder,
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
		slugPlaceholder,
	)

	if strings.TrimSpace(whereClause) == "" {
		whereClause = " WHERE " + predicate
	} else {
		whereClause += " AND " + predicate
	}
	queryArgs = append(queryArgs, tableUID, slug)
	return whereClause, queryArgs, nil
}

func buildRowGroupFacetQuery(
	tableName string,
	tableUID int64,
	joinClauses string,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}) {
	tableUIDPlaceholder := len(queryArgs) + 1
	query := fmt.Sprintf(`
		SELECT row_group.id,
		       row_group.slug,
		       row_group.title::text,
		       COUNT(DISTINCT %s.%s) AS row_count
		FROM %s
		%s
		JOIN public.system_row_group_memberships AS row_group_membership
		  ON row_group_membership.table_uid = $%d
		 AND row_group_membership.row_id = %s.%s
		JOIN public.system_row_groups AS row_group
		  ON row_group.id = row_group_membership.group_id
		 AND row_group.enabled = TRUE
		%s
		GROUP BY row_group.id, row_group.slug, row_group.title, row_group.sort_order
		ORDER BY row_count DESC, row_group.sort_order ASC, row_group.slug ASC, row_group.id ASC
		LIMIT %d`,
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
		pq.QuoteIdentifier(tableName),
		joinClauses,
		tableUIDPlaceholder,
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
		whereClause,
		rowGroupFacetLimit,
	)

	facetArgs := append([]interface{}{}, queryArgs...)
	facetArgs = append(facetArgs, tableUID)
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
) ([]RowGroupFacet, error) {
	query, facetArgs := buildRowGroupFacetQuery(
		tableName,
		tableUID,
		joinClauses,
		whereClause,
		queryArgs,
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
		if err := rows.Scan(&facet.ID, &facet.Slug, &titleJSON, &facet.RowCount); err != nil {
			return nil, fmt.Errorf("scan row group facet: %w", err)
		}
		if facet.ID <= 0 || facet.RowCount <= 0 || !rowGroupFilterSlugPattern.MatchString(facet.Slug) {
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
