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

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestNormalizeRowGroupFilterSlug(t *testing.T) {
	t.Parallel()

	validCases := map[string]string{
		"":                 "",
		"  travel_safety ": "travel_safety",
		"news-2026":        "news-2026",
	}
	for raw, want := range validCases {
		got, err := normalizeRowGroupFilterSlug(raw)
		if err != nil {
			t.Fatalf("normalizeRowGroupFilterSlug(%q): %v", raw, err)
		}
		if got != want {
			t.Fatalf("normalizeRowGroupFilterSlug(%q) = %q, want %q", raw, got, want)
		}
	}

	for _, raw := range []string{"Safety", "two words", "../admin", "group!", strings.Repeat("a", 65)} {
		if _, err := normalizeRowGroupFilterSlug(raw); err == nil {
			t.Fatalf("normalizeRowGroupFilterSlug(%q) unexpectedly succeeded", raw)
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
		url.Values{rowGroupFilterQueryKey: {"security"}},
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
		"row_group.slug = $3",
	} {
		if !strings.Contains(whereClause, fragment) {
			t.Fatalf("where clause lacks %q: %s", fragment, whereClause)
		}
	}
	if !reflect.DeepEqual(args, []interface{}{true, int64(104), "security"}) {
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
	)

	for _, fragment := range []string{
		`COUNT(DISTINCT "travel_info"."id") AS row_count`,
		`LEFT JOIN "authors" AS "author_join" ON TRUE`,
		`row_group_membership.table_uid = $3`,
		`row_group_membership.row_id = "travel_info"."id"`,
		`row_group.enabled = TRUE`,
		`WHERE "travel_info"."published" = $1 AND "travel_info"."owner_id" = $2`,
		"LIMIT 12",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("facet query lacks %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, " OFFSET ") {
		t.Fatalf("facet query unexpectedly paginates the result universe: %s", query)
	}
	if !reflect.DeepEqual(args, []interface{}{true, int64(8), int64(104)}) {
		t.Fatalf("unexpected facet args: %#v", args)
	}
}

type rowGroupFacetMockState struct {
	query string
	args  []driver.NamedValue
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
	return &buildJoinsMockRows{
		cols: []string{"id", "slug", "title", "row_count"},
		rows: [][]driver.Value{
			{int64(4), "security", `{"fi":"Turvallisuus","en":"Security"}`, int64(3)},
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
	)
	if err != nil {
		t.Fatalf("fetchRowGroupFacets returned error: %v", err)
	}
	if len(facets) != 1 {
		t.Fatalf("facet count = %d, want 1", len(facets))
	}
	if facets[0].ID != 4 || facets[0].Slug != "security" || facets[0].RowCount != 3 {
		t.Fatalf("unexpected facet: %#v", facets[0])
	}
	if facets[0].Title["fi"] != "Turvallisuus" || facets[0].Title["en"] != "Security" {
		t.Fatalf("unexpected title metadata: %#v", facets[0].Title)
	}
	if !strings.Contains(state.query, `COUNT(DISTINCT "travel_info"."id")`) {
		t.Fatalf("executed query lacks distinct row count: %s", state.query)
	}
	if len(state.args) != 2 || state.args[0].Value != true || state.args[1].Value != int64(104) {
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
