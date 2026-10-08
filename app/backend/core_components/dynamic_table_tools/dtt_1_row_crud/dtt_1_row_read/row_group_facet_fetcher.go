// row_group_facet_fetcher.go
// Builds and reads row-group facets for the authorized get-results universe.
// Bridges ordinary dataset filters, row visibility policy, and reusable row groups.
// Exists so facet counts and facet selection reuse the canonical result query boundary.
package dtt_1_row_read

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

const (
	rowGroupFilterQueryKey = "row_group"
	rowGroupModeQueryKey   = "row_group_mode"
	rowGroupFacetLimit     = 200
	rowGroupSelectionLimit = 20
)

var rowGroupFilterSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// RowGroupHeading is the optional multilingual classification above a facet value.
type RowGroupHeading struct {
	ID        int64             `json:"id"`
	Slug      string            `json:"slug"`
	Title     map[string]string `json:"title"`
	IsSingle  bool              `json:"is_single"`
	SortOrder int               `json:"sort_order"`
}

// RowGroupFacet is one enabled group represented inside the current result universe.
type RowGroupFacet struct {
	ID       int64             `json:"id"`
	Slug     string            `json:"slug"`
	Title    map[string]string `json:"title"`
	RowCount int               `json:"row_count"`
	Selected bool              `json:"selected"`
	Mode     string            `json:"mode"`
	ZeroHit  bool              `json:"zero_hit"`
	Heading  *RowGroupHeading  `json:"heading"`
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

// RowGroupSelection carries the complete resolved state even when vocabulary is capped.
// Only ALL preferences are serialized; an absent mode means ANY. Values stay internal.
type RowGroupSelection struct {
	Slugs  []string          `json:"slugs"`
	Modes  map[string]string `json:"modes"`
	values []resolvedRowGroupValue
}

type resolvedRowGroupValue struct {
	id        int64
	headingID int64
	isSingle  bool
}

type rowGroupRequirement struct {
	HeadingID     int64   `json:"heading_id"`
	GroupIDs      []int64 `json:"group_ids"`
	Mode          string  `json:"mode"`
	RequiredCount int     `json:"required_count"`
}

func invalidRowGroupFilters() *httpresponse.Refusal {
	return &httpresponse.Refusal{Status: http.StatusBadRequest, LangKey: "row_group_invalid_filters", Message: "Invalid category filters"}
}

// parseRowGroupSelection bounds decoded bytes and tokens before deduplication.
func parseRowGroupSelection(raw string) ([]string, error) {
	if len(raw) > 2048 {
		return nil, invalidRowGroupFilters()
	}
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	values := strings.Split(raw, ",")
	if len(values) > rowGroupSelectionLimit {
		return nil, invalidRowGroupFilters()
	}
	seen := make(map[string]bool)
	selection := make([]string, 0, len(values))
	for _, value := range values {
		slug := strings.TrimSpace(value)
		if !rowGroupFilterSlugPattern.MatchString(slug) {
			return nil, invalidRowGroupFilters()
		}
		if !seen[slug] {
			selection = append(selection, slug)
			seen[slug] = true
		}
	}
	sort.Strings(selection)
	return selection, nil
}

// parseRowGroupModes shares the browser's canonical safe-integer heading boundary.
// Explicit ANY is accepted but omitted from canonical state. Duplicate IDs still refuse.
func parseRowGroupModes(raw string) (map[string]string, error) {
	modes := make(map[string]string)
	if len(raw) > 512 {
		return nil, invalidRowGroupFilters()
	}
	if strings.TrimSpace(raw) == "" {
		return modes, nil
	}
	tokens := strings.Split(raw, ",")
	if len(tokens) > rowGroupSelectionLimit {
		return nil, invalidRowGroupFilters()
	}
	seen := make(map[string]bool)
	for _, token := range tokens {
		idText, mode, found := strings.Cut(strings.TrimSpace(token), ":")
		id, err := strconv.ParseInt(idText, 10, 64)
		if !found || err != nil || id < 0 || id > 9007199254740991 || strconv.FormatInt(id, 10) != idText || seen[idText] || (mode != "any" && mode != "all") {
			return nil, invalidRowGroupFilters()
		}
		seen[idText] = true
		if mode == "all" {
			modes[idText] = mode
		}
	}
	return modes, nil
}

// parseRowGroupFilters is the identical top-level contract for all three GET routes.
func parseRowGroupFilters(params url.Values) (RowGroupSelection, error) {
	if len(params[rowGroupFilterQueryKey]) > 1 || len(params[rowGroupModeQueryKey]) > 1 {
		return RowGroupSelection{}, invalidRowGroupFilters()
	}
	slugs, err := parseRowGroupSelection(params.Get(rowGroupFilterQueryKey))
	if err != nil {
		return RowGroupSelection{}, err
	}
	modes, err := parseRowGroupModes(params.Get(rowGroupModeQueryKey))
	if err != nil {
		return RowGroupSelection{}, err
	}
	if slugs == nil {
		slugs = []string{}
	}
	return RowGroupSelection{Slugs: slugs, Modes: modes}, nil
}

// resolveRowGroupSelection uses only the caller's limited read querier, including RLS.
// Both selected values and mode-only headings must have readable dataset support;
// text/column narrowing is deliberately absent here. Unknown and denied IDs coincide.
func resolveRowGroupSelection(db dbutils.Querier, tableName string, tableUID int64, selection RowGroupSelection, userRole string, userID int, readPolicy ReadRowPolicy) (RowGroupSelection, error) {
	resolved := RowGroupSelection{Slugs: []string{}, Modes: map[string]string{}}
	if len(selection.Slugs) == 0 && len(selection.Modes) == 0 {
		return resolved, nil
	}
	if tableUID <= 0 {
		return resolved, fmt.Errorf("row_group filter requires a registered dataset")
	}
	modeIDs := make([]int64, 0, len(selection.Modes))
	for key := range selection.Modes {
		id, _ := strconv.ParseInt(key, 10, 64)
		modeIDs = append(modeIDs, id)
	}
	sort.Slice(modeIDs, func(i, j int) bool { return modeIDs[i] < modeIDs[j] })
	table := pq.QuoteIdentifier(tableName)
	// Selected values each need one readable row. A mode-only heading needs just one readable value, so a LATERAL
	// LIMIT 1 per heading stops at the first readable row; listing every value of the heading took 3.2 s per ALL
	// request on 100k rows and 1M memberships, and a plain EXISTS was flattened into a scan of all memberships (1.3 s)
	// (WL103 slice 3a review, 8.10.2026).
	valueWhere, args := appendReadPolicyToWhereClause(tableName, userRole, userID, readPolicy,
		" WHERE row_group.enabled = TRUE AND (row_group.classification_id IS NULL OR heading.enabled = TRUE) AND row_group.slug = ANY($2::text[])",
		[]interface{}{tableUID, pq.Array(selection.Slugs), pq.Array(modeIDs)})
	headingWhere, args := appendReadPolicyToWhereClause(tableName, userRole, userID, readPolicy,
		" WHERE row_group.enabled = TRUE AND (row_group.classification_id = mode_heading.id OR (mode_heading.id = 0 AND row_group.classification_id IS NULL))", args)
	query := fmt.Sprintf(`SELECT slug, id, heading_id, is_single FROM (
        SELECT DISTINCT row_group.slug, row_group.id, COALESCE(row_group.classification_id,0) AS heading_id,
               COALESCE(heading.is_single,FALSE) AS is_single
        FROM %[1]s
        JOIN public.system_row_group_memberships AS row_group_membership
          ON row_group_membership.table_uid = $1 AND row_group_membership.row_id = %[1]s."id"
        JOIN public.system_row_groups AS row_group ON row_group.id = row_group_membership.group_id
        LEFT JOIN public.system_row_group_classifications AS heading ON heading.id = row_group.classification_id
        %[2]s
        UNION ALL
        SELECT NULL::text, NULL::bigint, mode_heading.id, COALESCE(heading.is_single,FALSE)
        FROM unnest($3::bigint[]) AS mode_heading(id)
        LEFT JOIN public.system_row_group_classifications AS heading ON heading.id = NULLIF(mode_heading.id,0)
        CROSS JOIN LATERAL (
            SELECT 1 FROM public.system_row_groups AS row_group
            JOIN public.system_row_group_memberships AS row_group_membership
              ON row_group_membership.table_uid = $1 AND row_group_membership.group_id = row_group.id
            JOIN %[1]s ON %[1]s."id" = row_group_membership.row_id
            %[3]s
            LIMIT 1) AS readable_value
        WHERE mode_heading.id = 0 OR heading.enabled = TRUE
    ) AS resolved ORDER BY slug NULLS LAST, heading_id`, table, valueWhere, headingWhere)
	rows, err := db.Query(query, args...)
	if err != nil {
		return resolved, fmt.Errorf("resolve row group selection: %w", err)
	}
	defer rows.Close()
	selected := make(map[string]bool, len(selection.Slugs))
	for _, slug := range selection.Slugs {
		selected[slug] = true
	}
	for rows.Next() {
		var slug sql.NullString
		var id sql.NullInt64
		var value resolvedRowGroupValue
		if err := rows.Scan(&slug, &id, &value.headingID, &value.isSingle); err != nil {
			return resolved, fmt.Errorf("scan row group selection: %w", err)
		}
		key := strconv.FormatInt(value.headingID, 10)
		if selection.Modes[key] == "all" {
			if value.isSingle {
				return resolved, invalidRowGroupFilters()
			}
			resolved.Modes[key] = "all"
		}
		// A row without a value is a readable mode heading; it never adds a selection.
		if slug.Valid && selected[slug.String] {
			value.id = id.Int64
			resolved.Slugs = append(resolved.Slugs, slug.String)
			resolved.values = append(resolved.values, value)
		}
	}
	if err := rows.Err(); err != nil {
		return resolved, fmt.Errorf("iterate row group selection: %w", err)
	}
	return resolved, nil
}

func (selection RowGroupSelection) requirementsJSON() string {
	requirements := []rowGroupRequirement{}
	indices := map[int64]int{}
	for _, value := range selection.values {
		index, found := indices[value.headingID]
		if !found {
			index = len(requirements)
			indices[value.headingID] = index
			mode := "any"
			if selection.Modes[strconv.FormatInt(value.headingID, 10)] == "all" {
				mode = "all"
			}
			requirements = append(requirements, rowGroupRequirement{HeadingID: value.headingID, Mode: mode, RequiredCount: 1})
		}
		requirements[index].GroupIDs = append(requirements[index].GroupIDs, value.id)
		if requirements[index].Mode == "all" {
			requirements[index].RequiredCount = len(requirements[index].GroupIDs)
		}
	}
	encoded, _ := json.Marshal(requirements)
	return string(encoded)
}

// rowGroupSelectionCondition is the shared listing, vector, candidate and hydration predicate.
func rowGroupSelectionCondition(tableReference string, tableUID int64, selection RowGroupSelection, queryArgs []interface{}) (string, []interface{}, error) {
	if len(selection.values) == 0 {
		return "", queryArgs, nil
	}
	if tableUID <= 0 {
		return "", nil, fmt.Errorf("row_group filter requires a registered dataset")
	}
	predicate, args := rowGroupSelectionConditionExceptHeading(tableReference, tableUID, selection, queryArgs, "")
	return predicate, args, nil
}

func rowGroupSelectionConditionExceptHeading(tableReference string, tableUID int64, selection RowGroupSelection, queryArgs []interface{}, excludedHeading string) (string, []interface{}) {
	if len(selection.values) == 0 {
		return "", queryArgs
	}
	predicate := rowGroupRequiredCondition(tableReference, len(queryArgs)+1, len(queryArgs)+2, excludedHeading, "")
	return predicate, append(queryArgs, tableUID, selection.requirementsJSON())
}

// rowGroupRequiredCondition owns ANY/ALL once. Facets supply the already aggregated
// matches; listing/search count memberships directly. Exclude the candidate heading
// only in ANY: ALL keeps S and the candidate membership requires v, giving S union {v}.
// All SQL references are server-owned; IDs and requirements are bound parameters.
func rowGroupRequiredCondition(tableReference string, tableParam, requirementsParam int, excludedHeading, matchedCount string) string {
	exclusion := ""
	if excludedHeading != "" {
		exclusion = "(required.heading_id <> " + excludedHeading + " OR required.mode = 'all') AND "
	}
	if matchedCount == "" {
		matchedCount = fmt.Sprintf(`(SELECT COUNT(DISTINCT row_group_membership.group_id)
            FROM public.system_row_group_memberships AS row_group_membership
            WHERE row_group_membership.table_uid = $%d
              AND row_group_membership.row_id = %s."id"
              AND row_group_membership.group_id = ANY(required.group_ids))`, tableParam, pq.QuoteIdentifier(tableReference))
	}
	return fmt.Sprintf(`NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset($%d::jsonb) AS required(heading_id bigint,group_ids bigint[],mode text,required_count integer)
        WHERE %s %s < required.required_count
    )`, requirementsParam, exclusion, matchedCount)
}

// appendRowGroupFilterToWhereClause applies the resolved selection to the canonical WHERE clause.
func appendRowGroupFilterToWhereClause(
	selection RowGroupSelection,
	tableName string,
	tableUID int64,
	columnsByName map[string]dtt_models.ColumnInfo,
	whereClause string,
	queryArgs []interface{},
) (string, []interface{}, error) {
	if len(selection.values) == 0 {
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

// rowGroupReadScope keeps authorization-only vocabulary separate from current narrowing.
type rowGroupReadScope struct {
	where string
	args  []interface{}
}

// buildRowGroupFacetQuery caps readable vocabulary before exact counts. Narrowed row
// IDs and selected membership matches are each deduplicated/aggregated once. Selected
// values precede the cap; the displayed order remains heading/value order, never hits.
func buildRowGroupFacetQuery(tableName string, tableUID int64, joinClauses, whereClause string, queryArgs []interface{}, selection RowGroupSelection, readable rowGroupReadScope) (string, []interface{}) {
	// Build authorization with the narrowing args as a prefix, preserving placeholders.
	// The caller supplies authorization-only SQL already using this offset.
	args := append(append([]interface{}{}, queryArgs...), readable.args...)
	tableParam, slugsParam, requirementsParam := len(args)+1, len(args)+2, len(args)+3
	args = append(args, tableUID, pq.Array(selection.Slugs), selection.requirementsJSON())
	// Store the aggregate on each row. A correlated scan of selected_matches for
	// every candidate/row would turn the shared predicate into repeated full scans.
	matchedCount := `COALESCE((matched_rows.heading_matches ->> required.heading_id::text)::bigint,0)`
	condition := rowGroupRequiredCondition("matched_rows", tableParam, requirementsParam, "candidate.heading_id", matchedCount)
	query := fmt.Sprintf(`WITH readable_rows AS (
        SELECT DISTINCT %s.id FROM %s %s
    ), vocabulary AS (
        SELECT row_group.*, COALESCE(row_group.classification_id,0) AS heading_id,
               heading.slug AS heading_slug, heading.title::text AS heading_title,
               heading.is_single, COALESCE(heading.sort_order,0) AS heading_sort_order,
               row_group.slug = ANY($%d::text[]) AS selected
        FROM public.system_row_groups AS row_group
        LEFT JOIN public.system_row_group_classifications AS heading ON heading.id = row_group.classification_id
        WHERE row_group.enabled = TRUE AND (row_group.classification_id IS NULL OR heading.enabled = TRUE)
          AND EXISTS (SELECT 1 FROM public.system_row_group_memberships AS membership
              JOIN readable_rows ON readable_rows.id = membership.row_id
              WHERE membership.table_uid = $%d AND membership.group_id = row_group.id)
    ), capped_facets AS MATERIALIZED (
        SELECT * FROM vocabulary
        ORDER BY selected DESC, heading_sort_order ASC, classification_id ASC NULLS FIRST, sort_order ASC, slug ASC, id ASC
        LIMIT %d
    ), narrowed_rows AS MATERIALIZED (
        SELECT DISTINCT %s.id FROM %s %s %s
    ), required_headings AS (
        SELECT * FROM jsonb_to_recordset($%d::jsonb) AS required(heading_id bigint,group_ids bigint[],mode text,required_count integer)
    ), selected_matches AS MATERIALIZED (
        SELECT membership.row_id,required.heading_id,COUNT(DISTINCT membership.group_id) AS matched_count
        FROM narrowed_rows
        JOIN public.system_row_group_memberships AS membership ON membership.row_id = narrowed_rows.id AND membership.table_uid = $%d
        JOIN required_headings AS required ON membership.group_id = ANY(required.group_ids)
        GROUP BY membership.row_id,required.heading_id
    ), matched_rows AS MATERIALIZED (
        SELECT narrowed_rows.id,
               COALESCE(jsonb_object_agg(selected_matches.heading_id::text, selected_matches.matched_count)
                   FILTER (WHERE selected_matches.heading_id IS NOT NULL), '{}'::jsonb) AS heading_matches
        FROM narrowed_rows
        LEFT JOIN selected_matches ON selected_matches.row_id = narrowed_rows.id
        GROUP BY narrowed_rows.id
    ), facet_counts AS (
        SELECT candidate.id, COUNT(DISTINCT matched_rows.id) AS row_count
        FROM capped_facets AS candidate
        JOIN public.system_row_group_memberships AS membership
          ON membership.table_uid = $%d AND membership.group_id = candidate.id
        JOIN matched_rows ON matched_rows.id = membership.row_id
        WHERE %s
        GROUP BY candidate.id
    )
    SELECT candidate.id,candidate.slug,candidate.title::text,
           COALESCE(facet_counts.row_count,0),candidate.selected,candidate.classification_id,
           candidate.heading_slug,candidate.heading_title,candidate.is_single,candidate.heading_sort_order
    FROM capped_facets AS candidate
    LEFT JOIN facet_counts ON facet_counts.id = candidate.id
    ORDER BY candidate.heading_sort_order ASC,candidate.classification_id ASC NULLS FIRST,candidate.sort_order ASC,candidate.slug ASC,candidate.id ASC`,
		pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(tableName), readable.where, slugsParam, tableParam, rowGroupFacetLimit,
		pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(tableName), joinClauses, whereClause, requirementsParam, tableParam, tableParam, condition)
	return query, args
}

// fetchRowGroupFacets reads permission-scoped vocabulary and its narrowed counts.
// COUNT(DISTINCT dataset.id) prevents foreign-key joins or repeated membership paths from inflating a facet.
func fetchRowGroupFacets(
	db dbutils.Querier,
	tableName string,
	tableUID int64,
	joinClauses string,
	whereClause string,
	queryArgs []interface{},
	selection RowGroupSelection,
	readable rowGroupReadScope,
) ([]RowGroupFacet, error) {
	query, facetArgs := buildRowGroupFacetQuery(
		tableName,
		tableUID,
		joinClauses,
		whereClause,
		queryArgs,
		selection,
		readable,
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
		var headingID sql.NullInt64
		var headingSlug, headingTitle sql.NullString
		var headingSingle sql.NullBool
		var headingOrder int
		if err := rows.Scan(&facet.ID, &facet.Slug, &titleJSON, &facet.RowCount, &facet.Selected,
			&headingID, &headingSlug, &headingTitle, &headingSingle, &headingOrder); err != nil {
			return nil, fmt.Errorf("scan row group facet: %w", err)
		}
		if facet.ID <= 0 || facet.RowCount < 0 || !rowGroupFilterSlugPattern.MatchString(facet.Slug) {
			continue
		}
		facet.Title = decodeRowGroupFacetTitle(titleJSON)
		if headingID.Valid {
			facet.Heading = &RowGroupHeading{ID: headingID.Int64, Slug: headingSlug.String,
				Title: decodeRowGroupFacetTitle(headingTitle.String), IsSingle: headingSingle.Bool, SortOrder: headingOrder}
		}
		facet.Mode = "any"
		headingKey := "0"
		if facet.Heading != nil {
			headingKey = strconv.FormatInt(facet.Heading.ID, 10)
		}
		if selection.Modes[headingKey] == "all" {
			facet.Mode = "all"
		}
		facet.ZeroHit = facet.RowCount == 0
		facets = append(facets, facet)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate row group facets: %w", err)
	}
	return facets, nil
}
