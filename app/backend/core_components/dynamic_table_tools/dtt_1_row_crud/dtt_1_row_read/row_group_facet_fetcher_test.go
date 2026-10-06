// row_group_facet_fetcher_test.go
// Verifies row-group filter validation, parameterisation, and authorized-universe facet SQL.
// Bridges get-results query construction with the shared row-group schema and response metadata.
// Exists to prevent group counts from bypassing row filters, row policy, or distinct-row semantics.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestParseRowGroupSelection(t *testing.T) {
	t.Parallel()
	for raw, want := range map[string][]string{
		"": nil, "  ": nil, " travel_safety ": {"travel_safety"},
		"news-2026": {"news-2026"}, "train,boat": {"boat", "train"},
		"train, boat,train": {"boat", "train"},
	} {
		got, err := parseRowGroupSelection(raw)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("parseRowGroupSelection(%q) = %v, %v; want %v", raw, got, err, want)
		}
	}
	values := make([]string, 21)
	for i := range values {
		values[i] = fmt.Sprintf("group_%02d", i)
	}
	if got, err := parseRowGroupSelection(strings.Join(values[:20], ",")); err != nil || len(got) != 20 {
		t.Fatalf("20 values = %v, %v", got, err)
	}
	for _, raw := range []string{"Safety", "two words", "../admin", "group!", strings.Repeat("a", 65), "boat,", ",boat", "boat,,train", strings.Join(values, ",")} {
		if _, err := parseRowGroupSelection(raw); err == nil {
			t.Fatalf("parseRowGroupSelection(%q) unexpectedly succeeded", raw)
		}
	}
}

func TestRowGroupEndpointsRejectTooManyValuesBeforeDatabaseAccess(t *testing.T) {
	values := make([]string, 21)
	for i := range values {
		values[i] = fmt.Sprintf("group_%d", i)
	}
	for _, handler := range []http.HandlerFunc{GetResults, GetResultsVector, GetIntelligentResultsHandlerWrapper} {
		request := httptest.NewRequest(http.MethodGet, "/api/test?dataset=tasks&row_group="+url.QueryEscape(strings.Join(values, ",")), nil)
		response := httptest.NewRecorder()
		handler(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", response.Code)
		}
	}
}

func TestGetResultsRejectsUnsafeRowGroupBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/api/get-results?dataset=tasks&row_group=Safety%20news", nil)
	response := httptest.NewRecorder()

	GetResults(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}

func TestIntelligentSearchEndpointsRejectUnsafeRowGroupBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()

	for _, endpoint := range []struct {
		name    string
		handler http.HandlerFunc
		path    string
	}{
		{
			name:    "streamed intelligent search",
			handler: GetIntelligentResultsHandlerWrapper,
			path:    "/api/get-intelligent-results?dataset=tasks&query=safety&stream=1&row_group=Safety%20news",
		},
		{
			name:    "vector search",
			handler: GetResultsVector,
			path:    "/api/get-results-vector?dataset=tasks&vector_query=safety&row_group=Safety%20news",
		},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, endpoint.path, nil)
			response := httptest.NewRecorder()
			endpoint.handler(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}
}

func TestBuildWhereClauseReservesRowGroupMetaFilter(t *testing.T) {
	t.Parallel()

	columns := testColumnsByName()
	columns["row_group"] = dtt_models.ColumnInfo{ColumnName: "row_group", DataType: "text"}
	whereClause, args, err := buildWhereClause(
		url.Values{rowGroupFilterQueryKey: {"security"}},
		"tasks",
		columns,
		map[string]string{},
		testColumnDataTypes(),
	)
	if err != nil {
		t.Fatalf("buildWhereClause returned error: %v", err)
	}
	if whereClause != "" || len(args) != 0 {
		t.Fatalf("row_group was treated as a dataset column filter: where=%q args=%#v", whereClause, args)
	}
}

func TestAppendRowGroupFilterUsesParameterizedEnabledMembershipPredicate(t *testing.T) {
	t.Parallel()

	whereClause, args, err := appendRowGroupFilterToWhereClause(
		[]string{"security", "travel"},
		"travel_info",
		104,
		testColumnsByName(),
		` WHERE "travel_info"."published" = $1`,
		[]interface{}{true},
	)
	if err != nil {
		t.Fatalf("appendRowGroupFilterToWhereClause returned error: %v", err)
	}

	for _, fragment := range []string{
		"row_group.enabled = TRUE",
		"row_group_membership.table_uid = $2",
		`row_group_membership.row_id = "travel_info"."id"`,
		"row_group.slug = ANY($3::text[])",
	} {
		if !strings.Contains(whereClause, fragment) {
			t.Fatalf("where clause lacks %q: %s", fragment, whereClause)
		}
	}
	if !reflect.DeepEqual(args, []interface{}{true, int64(104), pq.Array([]string{"security", "travel"})}) {
		t.Fatalf("unexpected filter args: %#v", args)
	}
}

func TestBuildRowGroupFacetQueryReusesFilteredUniverseAndDistinctRows(t *testing.T) {
	t.Parallel()

	query, args := buildRowGroupFacetQuery(
		"travel_info",
		104,
		` LEFT JOIN "authors" AS "author_join" ON TRUE`,
		` WHERE "travel_info"."published" = $1 AND "travel_info"."owner_id" = $2`,
		[]interface{}{true, int64(8)},
		[]string{"security"},
	)

	for _, fragment := range []string{
		`COUNT(DISTINCT "travel_info"."id") AS row_count`,
		`LEFT JOIN "authors" AS "author_join" ON TRUE`,
		`row_group_membership.table_uid = $3`,
		`row_group_membership.row_id = "travel_info"."id"`,
		`row_group.enabled = TRUE`,
		`WHERE "travel_info"."published" = $1 AND "travel_info"."owner_id" = $2`,
		"LIMIT 200",
		"row_group.slug = ANY($4::text[]) AS selected",
		"ORDER BY selected DESC, heading_sort_order ASC, row_group.classification_id ASC NULLS FIRST",
		"ORDER BY heading_sort_order ASC, classification_id ASC NULLS FIRST, sort_order ASC, slug ASC",
		"selected_group.classification_id IS DISTINCT FROM row_group.classification_id",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("facet query lacks %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, " OFFSET ") {
		t.Fatalf("facet query unexpectedly paginates the result universe: %s", query)
	}
	if !reflect.DeepEqual(args, []interface{}{true, int64(8), int64(104), pq.Array([]string{"security"})}) {
		t.Fatalf("unexpected facet args: %#v", args)
	}
}

type rowGroupFacetMockState struct {
	selectionRows [][]driver.Value
	query         string
	args          []driver.NamedValue
}

type rowGroupFacetMockDriver struct {
	state *rowGroupFacetMockState
}

type rowGroupFacetMockConn struct {
	state *rowGroupFacetMockState
}

func (d *rowGroupFacetMockDriver) Open(_ string) (driver.Conn, error) {
	return &rowGroupFacetMockConn{state: d.state}, nil
}

func (*rowGroupFacetMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (*rowGroupFacetMockConn) Close() error { return nil }

func (*rowGroupFacetMockConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not supported")
}

func (c *rowGroupFacetMockConn) QueryContext(
	_ context.Context,
	query string,
	args []driver.NamedValue,
) (driver.Rows, error) {
	c.state.query = query
	c.state.args = append([]driver.NamedValue{}, args...)
	if strings.Contains(query, "SELECT DISTINCT row_group.slug") {
		return &buildJoinsMockRows{cols: []string{"slug"}, rows: c.state.selectionRows}, nil
	}
	return &buildJoinsMockRows{
		cols: []string{"id", "slug", "title", "row_count", "selected", "classification_id", "heading_slug", "heading_title", "is_single", "heading_sort_order"},
		rows: [][]driver.Value{
			{int64(4), "security", `{"fi":"Turvallisuus","en":"Security"}`, int64(3), false, int64(10), "transport", `{"fi":"Kulkumuoto","en":"Transport"}`, true, int64(-1)},
			{int64(5), "selected_empty", `{"en":"Empty"}`, int64(0), true, nil, nil, nil, nil, int64(0)},
			{int64(6), "unselected_empty", `{}`, int64(0), false, nil, nil, nil, nil, int64(0)},
		},
	}, nil
}

func TestFetchRowGroupFacetsDecodesMultilingualMetadata(t *testing.T) {
	t.Parallel()

	state := &rowGroupFacetMockState{}
	driverName := fmt.Sprintf("row_group_facets_%d", time.Now().UnixNano())
	sql.Register(driverName, &rowGroupFacetMockDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	facets, err := fetchRowGroupFacets(
		database,
		"travel_info",
		104,
		"",
		` WHERE "travel_info"."published" = $1`,
		[]interface{}{true},
		[]string{"selected_empty"},
	)
	if err != nil {
		t.Fatalf("fetchRowGroupFacets returned error: %v", err)
	}
	if len(facets) != 2 {
		t.Fatalf("facet count = %d, want 2", len(facets))
	}
	if !facets[1].Selected || facets[1].RowCount != 0 {
		t.Fatalf("selected zero count lost: %#v", facets)
	}
	if facets[0].ID != 4 || facets[0].Slug != "security" || facets[0].RowCount != 3 {
		t.Fatalf("unexpected facet: %#v", facets[0])
	}
	if facets[0].Heading == nil || facets[0].Heading.Title["en"] != "Transport" || !facets[0].Heading.IsSingle || facets[0].Heading.SortOrder != -1 || facets[1].Heading != nil {
		t.Fatalf("heading metadata = %#v / %#v", facets[0].Heading, facets[1].Heading)
	}
	if facets[0].Title["fi"] != "Turvallisuus" || facets[0].Title["en"] != "Security" {
		t.Fatalf("unexpected title metadata: %#v", facets[0].Title)
	}
	if !strings.Contains(state.query, `COUNT(DISTINCT "travel_info"."id")`) {
		t.Fatalf("executed query lacks distinct row count: %s", state.query)
	}
	if len(state.args) != 3 || state.args[0].Value != true || state.args[1].Value != int64(104) {
		t.Fatalf("unexpected executed args: %#v", state.args)
	}
}

func TestDecodeRowGroupFacetTitleIgnoresMalformedTranslations(t *testing.T) {
	t.Parallel()

	title := decodeRowGroupFacetTitle(`{"en":"Security","fi":{"unexpected":true},"sv":7,"de":"  "}`)
	if !reflect.DeepEqual(title, map[string]string{"en": "Security"}) {
		t.Fatalf("decoded title = %#v, want only valid string translation", title)
	}
	if title := decodeRowGroupFacetTitle(`not-json`); len(title) != 0 {
		t.Fatalf("malformed JSON title = %#v, want fail-soft empty map", title)
	}
}

func TestResolveRowGroupSelectionUsesReadableDatasetUniverse(t *testing.T) {
	state := &rowGroupFacetMockState{selectionRows: [][]driver.Value{{"boat"}}}
	name := fmt.Sprintf("row_group_selection_%d", time.Now().UnixNano())
	sql.Register(name, &rowGroupFacetMockDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	policy := legacyMustTrueReadPolicy([]string{"published"}, "created_by")
	got, err := resolveRowGroupSelection(db, "travel_info", 104, []string{"boat", "hidden", "unknown"}, "basic", 8, policy)
	if err != nil || !reflect.DeepEqual(got, []string{"boat"}) {
		t.Fatalf("resolved=%v err=%v", got, err)
	}
	for _, fragment := range []string{
		`FROM "travel_info"`, `row_group_membership.table_uid = $1`,
		`row_group_membership.row_id = "travel_info"."id"`, `row_group.enabled = TRUE`,
		`row_group.slug = ANY($2::text[])`, `"travel_info"."created_by" = $3`,
		`public.resolve_effective_row_access($4, "travel_info"."id", $5, 'read'`,
	} {
		if !strings.Contains(state.query, fragment) {
			t.Fatalf("resolver lacks %s: %s", fragment, state.query)
		}
	}
	values := []interface{}{}
	for _, arg := range state.args {
		values = append(values, arg.Value)
	}
	if want := []interface{}{int64(104), `{"boat","hidden","unknown"}`, int64(8), "travel_info", int64(8)}; !reflect.DeepEqual(values, want) {
		t.Fatalf("resolver args=%#v want=%#v", values, want)
	}
	if got, err := resolveRowGroupSelection(nil, "anything", 0, nil, "guest", 1, ReadRowPolicy{}); err != nil || len(got) != 0 {
		t.Fatalf("empty selection must not query: %v %v", got, err)
	}
}

func TestRowGroupSelectionConditionQuotesReferenceAndKeepsEmptySelectionUnrestricted(t *testing.T) {
	prefix := []interface{}{"vector", "fi"}
	condition, args, err := rowGroupSelectionCondition(`odd"alias`, 104, []string{"boat", "train"}, prefix)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(condition, `row_group_membership.row_id = "odd""alias"."id"`) || !strings.Contains(condition, `table_uid = $3`) || !strings.Contains(condition, `ANY($4::text[])`) {
		t.Fatalf("condition=%s", condition)
	}
	if want := []interface{}{"vector", "fi", int64(104), pq.Array([]string{"boat", "train"})}; !reflect.DeepEqual(args, want) {
		t.Fatalf("args=%#v", args)
	}
	condition, args, err = rowGroupSelectionCondition("rows", 0, nil, prefix)
	if err != nil || condition != "" || !reflect.DeepEqual(args, prefix) {
		t.Fatalf("empty selection restricted rows: %q %#v %v", condition, args, err)
	}
	if _, _, err := rowGroupSelectionCondition("rows", 0, []string{"boat"}, nil); err == nil {
		t.Fatal("unregistered dataset accepted")
	}
}
