// row_group_facet_fetcher_test.go
// Verifies row-group filter validation, parameterisation, and authorized-universe facet SQL.
// Bridges get-results query construction with the shared row-group schema and response metadata.
// Exists to prevent group counts from bypassing row filters, row policy, or distinct-row semantics.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

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
		url.Values{rowGroupFilterQueryKey: {"security"}, rowGroupModeQueryKey: {"1:all"}},
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

func testRowGroupSelection(slugs ...string) RowGroupSelection {
	selection := RowGroupSelection{Slugs: slugs, Modes: map[string]string{}}
	for i := range slugs {
		selection.values = append(selection.values, resolvedRowGroupValue{id: int64(i + 1)})
	}
	return selection
}

func TestSharedRowGroupPredicateBindsResolvedIDsAndRequiredCounts(t *testing.T) {
	selection := testRowGroupSelection("boat", "train")
	selection.Modes["0"] = "all"
	condition, args, err := rowGroupSelectionCondition(`odd"alias`, 104, selection, []interface{}{"vector", "fi"})
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{`jsonb_to_recordset($4::jsonb)`, `row_group_membership.table_uid = $3`, `row_group_membership.row_id = "odd""alias"."id"`, `COUNT(DISTINCT row_group_membership.group_id)`, `< required.required_count`} {
		if !strings.Contains(condition, fragment) {
			t.Fatalf("missing %s: %s", fragment, condition)
		}
	}
	var required []rowGroupRequirement
	if err := json.Unmarshal([]byte(args[3].(string)), &required); err != nil {
		t.Fatal(err)
	}
	if len(required) != 1 || required[0].RequiredCount != 2 || required[0].Mode != "all" || !reflect.DeepEqual(required[0].GroupIDs, []int64{1, 2}) {
		t.Fatalf("requirements=%+v", required)
	}
	selection.values = nil
	if condition, args, err := rowGroupSelectionCondition("rows", 0, selection, []interface{}{"prefix"}); condition != "" || err != nil || len(args) != 1 {
		t.Fatalf("mode-only condition=%s args=%v err=%v", condition, args, err)
	}
	selection.values = []resolvedRowGroupValue{{id: 1}}
	if _, _, err := rowGroupSelectionCondition("rows", 0, selection, nil); err == nil {
		t.Fatal("unregistered dataset accepted")
	}
}

func TestBuildRowGroupFacetQueryScopesVocabularyBeforeNarrowedCounts(t *testing.T) {
	selection := testRowGroupSelection("boat")
	query, args := buildRowGroupFacetQuery("travel_info", 104, ` LEFT JOIN "authors" AS "author_join" ON TRUE`,
		` WHERE "travel_info"."status" = $1`, []interface{}{"open"}, selection,
		rowGroupReadScope{where: ` WHERE "travel_info"."published" = $2`, args: []interface{}{true}})
	readable, narrowed, found := strings.Cut(query, "), vocabulary AS")
	if !found || strings.Contains(readable, "status") || !strings.Contains(readable, `"published" = $2`) {
		t.Fatalf("vocabulary leaked narrowing: %s", query)
	}
	for _, fragment := range []string{`SELECT DISTINCT "travel_info".id`, `LEFT JOIN "authors" AS "author_join" ON TRUE`, `WHERE "travel_info"."status" = $1`, `LIMIT 200`, `ORDER BY selected DESC`, `COUNT(DISTINCT matched_rows.id)`, `COUNT(DISTINCT membership.group_id)`, `required.mode = 'all'`, `candidate.heading_id`, `LEFT JOIN facet_counts`} {
		if !strings.Contains(narrowed, fragment) {
			t.Fatalf("missing %s: %s", fragment, query)
		}
	}
	if len(args) != 5 || args[0] != "open" || args[1] != true || args[2] != int64(104) || args[4] != selection.requirementsJSON() {
		t.Fatalf("args=%v", args)
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
		return &buildJoinsMockRows{cols: []string{"slug", "id", "heading_id", "is_single"}, rows: c.state.selectionRows}, nil
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
		testRowGroupSelection("selected_empty"),
		rowGroupReadScope{},
	)
	if err != nil {
		t.Fatalf("fetchRowGroupFacets returned error: %v", err)
	}
	if len(facets) != 3 {
		t.Fatalf("facet count = %d, want 3", len(facets))
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
	if !strings.Contains(state.query, `COUNT(DISTINCT matched_rows.id)`) {
		t.Fatalf("executed query lacks distinct row count: %s", state.query)
	}
	if len(state.args) != 4 || state.args[0].Value != true || state.args[1].Value != int64(104) {
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
	state := &rowGroupFacetMockState{selectionRows: [][]driver.Value{{"boat", int64(1), int64(2), false}}}
	name := fmt.Sprintf("row_group_selection_%d", time.Now().UnixNano())
	sql.Register(name, &rowGroupFacetMockDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	policy := legacyMustTrueReadPolicy([]string{"published"}, "created_by")
	got, err := resolveRowGroupSelection(db, "travel_info", 104, RowGroupSelection{Slugs: []string{"boat", "hidden", "unknown"}}, "basic", 8, policy)
	if err != nil || !reflect.DeepEqual(got.Slugs, []string{"boat"}) {
		t.Fatalf("resolved=%v err=%v", got, err)
	}
	for _, fragment := range []string{
		`FROM "travel_info"`, `row_group_membership.table_uid = $1`,
		`row_group_membership.row_id = "travel_info"."id"`, `row_group.enabled = TRUE`,
		`row_group.slug = ANY($2::text[])`, `"travel_info"."created_by" = $4`,
		`public.resolve_effective_row_access($5, "travel_info"."id", $6, 'read'`,
		// A mode-only heading is resolved by the same read rule, stopping at its first readable value.
		`FROM unnest($3::bigint[]) AS mode_heading(id)`, `CROSS JOIN LATERAL (`, `LIMIT 1) AS readable_value`,
		`"travel_info"."created_by" = $7`, `public.resolve_effective_row_access($8, "travel_info"."id", $9, 'read'`,
	} {
		if !strings.Contains(state.query, fragment) {
			t.Fatalf("resolver lacks %s: %s", fragment, state.query)
		}
	}
	values := []interface{}{}
	for _, arg := range state.args {
		values = append(values, arg.Value)
	}
	if want := []interface{}{int64(104), `{"boat","hidden","unknown"}`, `{}`, int64(8), "travel_info", int64(8),
		int64(8), "travel_info", int64(8)}; !reflect.DeepEqual(values, want) {
		t.Fatalf("resolver args=%#v want=%#v", values, want)
	}
	if got, err := resolveRowGroupSelection(nil, "anything", 0, RowGroupSelection{}, "guest", 1, ReadRowPolicy{}); err != nil || len(got.Slugs) != 0 {
		t.Fatalf("empty selection must not query: %v %v", got, err)
	}
}

func TestRowGroupModesSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../../testing/shared_contracts/row_group_mode_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Raw       string `json:"raw"`
		Valid     bool   `json:"valid"`
		Canonical string `json:"canonical"`
	}
	if err := json.Unmarshal(data, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		modes, err := parseRowGroupModes(example.Raw)
		if (err == nil) != example.Valid {
			t.Fatalf("%q: %v", example.Raw, err)
		}
		if example.Valid {
			ids := []int64{}
			for key := range modes {
				id, _ := strconv.ParseInt(key, 10, 64)
				ids = append(ids, id)
			}
			sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
			tokens := []string{}
			for _, id := range ids {
				tokens = append(tokens, fmt.Sprintf("%d:all", id))
			}
			if strings.Join(tokens, ",") != example.Canonical {
				t.Fatalf("%q canonical=%v", example.Raw, tokens)
			}
		}
	}
	tokens := []string{}
	for i := 0; i < 20; i++ {
		tokens = append(tokens, fmt.Sprintf("%d:all", i))
	}
	if _, err := parseRowGroupModes(strings.Join(tokens, ",")); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{strings.Join(append(tokens, "20:all"), ","), strings.Repeat(" ", 513)} {
		if _, err := parseRowGroupModes(raw); err == nil {
			t.Fatal("bounds accepted")
		}
	}
	if _, err := parseRowGroupSelection(strings.Repeat(" ", 2049)); err == nil {
		t.Fatal("decoded slug byte limit accepted")
	}
	if _, err := parseRowGroupSelection(strings.Repeat("boat,", 20) + "boat"); err == nil {
		t.Fatal("entry bound applied after deduplication")
	}
}

func TestRowGroupTyped400AcrossEndpointsBeforeStream(t *testing.T) {
	for _, query := range []string{"row_group=boat&row_group=train", "row_group_mode=1:all&row_group_mode=2:all", "row_group_mode=01:all", "row_group_mode=1:some", "row_group_mode=1:any,1:all", "row_group_mode=1:all,,2:all"} {
		for _, handler := range []http.HandlerFunc{GetResults, GetResultsVector, GetIntelligentResultsHandlerWrapper} {
			w := httptest.NewRecorder()
			handler(w, httptest.NewRequest("GET", "/api/test?dataset=tasks&query=trip&stream=1&"+query, nil))
			var body httpresponse.ErrorBody
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 400 || body.Code != 400 || body.Error != "Invalid category filters" || body.ErrorLangKey != "row_group_invalid_filters" {
				t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
			}
		}
	}
}

func TestResolvedSingleHeadingRefusesALLButDeniedHeadingDoesNot(t *testing.T) {
	state := &rowGroupFacetMockState{selectionRows: [][]driver.Value{{"boat", int64(1), int64(2), true}}}
	name := fmt.Sprintf("row_group_modes_%d", time.Now().UnixNano())
	sql.Register(name, &rowGroupFacetMockDriver{state: state})
	db, _ := sql.Open(name, "")
	defer db.Close()
	for _, slugs := range [][]string{nil, {"boat"}} {
		_, err := resolveRowGroupSelection(db, "travel_info", 104, RowGroupSelection{Slugs: slugs, Modes: map[string]string{"2": "all"}}, "guest", 1, ReadRowPolicy{})
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.LangKey != "row_group_invalid_filters" {
			t.Fatalf("single ALL=%v", err)
		}
		w := httptest.NewRecorder()
		respondIntelligentSearchError(w, fmt.Errorf("wrapped: %w", err))
		if w.Code != 400 {
			t.Fatal("wrapped refusal became 500")
		}
	}
	state.selectionRows = nil
	resolved, err := resolveRowGroupSelection(db, "travel_info", 104, RowGroupSelection{Modes: map[string]string{"2": "all"}}, "guest", 1, ReadRowPolicy{})
	if err != nil || len(resolved.Modes) != 0 {
		t.Fatalf("denied modes=%+v %v", resolved, err)
	}
}
