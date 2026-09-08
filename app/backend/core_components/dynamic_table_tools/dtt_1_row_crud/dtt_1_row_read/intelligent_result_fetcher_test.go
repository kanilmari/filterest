package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	pgvector "github.com/pgvector/pgvector-go"
)

type intelligentFetcherTestState struct {
	headerExists              bool
	vectorExists              bool
	queryableColumns          []string
	finalRows                 [][]driver.Value
	finalQuery                string
	finalArgs                 []driver.NamedValue
	requireNullVectorFallback bool
}

type intelligentFetcherTestDriver struct {
	state *intelligentFetcherTestState
}

type intelligentFetcherTestConn struct {
	state *intelligentFetcherTestState
}

type intelligentFetcherTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var intelligentFetcherMockCounter int64

func TestFetchFullTextRowsUsesComputedFallbackWhenStoredVectorIsMissingPerRow(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:              true,
		vectorExists:              true,
		queryableColumns:          []string{"header", "description"},
		finalRows:                 [][]driver.Value{{int64(161), "Firefox", float64(0.42)}},
		requireNullVectorFallback: true,
	})
	defer db.Close()

	results, err := fetchFullTextRows(db, "app_service_catalog", "Firefox", intelligentSearchAuthorization{})
	if err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1", len(results))
	}
	if results[0].RowID != 161 || results[0].RowName != "Firefox" {
		t.Fatalf("unexpected result = %+v", results[0])
	}
	if !strings.Contains(state.finalQuery, "COALESCE(") {
		t.Fatalf("final query = %q, want COALESCE-based vector fallback", state.finalQuery)
	}
	if !strings.Contains(state.finalQuery, "to_tsvector('simple'") {
		t.Fatalf("final query = %q, want on-the-fly simple tsvector fallback", state.finalQuery)
	}
	if len(state.finalArgs) != 3 || state.finalArgs[0].Value != "firefox:*" || state.finalArgs[1].Value != "app_service_catalog" || fmt.Sprint(state.finalArgs[2].Value) != "1" {
		t.Fatalf("final args = %#v, want tsquery firefox:*", state.finalArgs)
	}
}

func TestFetchFullTextRowsKeepsILikeFallbackWhenVectorColumnIsMissing(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:     true,
		vectorExists:     false,
		queryableColumns: []string{"header", "description"},
		finalRows:        [][]driver.Value{{int64(161), "Firefox", float64(1)}},
	})
	defer db.Close()

	results, err := fetchFullTextRows(db, "app_service_catalog", "Firefox", intelligentSearchAuthorization{})
	if err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1", len(results))
	}
	if !strings.Contains(state.finalQuery, "ILIKE $1") {
		t.Fatalf("final query = %q, want legacy ILIKE fallback", state.finalQuery)
	}
	if strings.Contains(state.finalQuery, "to_tsvector('simple'") {
		t.Fatalf("final query = %q, did not expect tsvector fallback in no-vector path", state.finalQuery)
	}
	if len(state.finalArgs) != 3 || state.finalArgs[0].Value != "%Firefox%" || state.finalArgs[1].Value != "app_service_catalog" || fmt.Sprint(state.finalArgs[2].Value) != "1" {
		t.Fatalf("final args = %#v, want ILIKE %%Firefox%%", state.finalArgs)
	}
}

func TestFetchFullTextRowsSearchesIDWhenNumericQueryUsesStoredVector(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:     true,
		vectorExists:     true,
		queryableColumns: []string{"header", "description"},
		finalRows:        [][]driver.Value{{int64(161), "Firefox", float64(1)}},
	})
	defer db.Close()

	results, err := fetchFullTextRows(db, "app_service_catalog", "161", intelligentSearchAuthorization{})
	if err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}
	if len(results) != 1 || results[0].RowID != 161 {
		t.Fatalf("results = %+v, want id 161", results)
	}
	if !strings.Contains(state.finalQuery, `"src"."id" = $2`) {
		t.Fatalf("final query = %q, want exact id predicate", state.finalQuery)
	}
	if !strings.Contains(state.finalQuery, `ORDER BY ("src"."id" = $2) DESC`) {
		t.Fatalf("final query = %q, want exact id result first", state.finalQuery)
	}
	if len(state.finalArgs) != 4 || state.finalArgs[0].Value != "161:*" || fmt.Sprint(state.finalArgs[1].Value) != "161" || state.finalArgs[2].Value != "app_service_catalog" || fmt.Sprint(state.finalArgs[3].Value) != "1" {
		t.Fatalf("final args = %#v, want tsquery + numeric id", state.finalArgs)
	}
}

func TestFetchFullTextRowsSearchesIDWhenNumericQueryUsesILikeFallback(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:     true,
		vectorExists:     false,
		queryableColumns: []string{"header", "description"},
		finalRows:        [][]driver.Value{{int64(161), "Firefox", float64(1)}},
	})
	defer db.Close()

	results, err := fetchFullTextRows(db, "app_service_catalog", "161", intelligentSearchAuthorization{})
	if err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}
	if len(results) != 1 || results[0].RowID != 161 {
		t.Fatalf("results = %+v, want id 161", results)
	}
	if !strings.Contains(state.finalQuery, `"app_service_catalog"."id" = $2`) {
		t.Fatalf("final query = %q, want exact id predicate", state.finalQuery)
	}
	if !strings.Contains(state.finalQuery, `ORDER BY ("app_service_catalog"."id" = $2) DESC`) {
		t.Fatalf("final query = %q, want exact id result first", state.finalQuery)
	}
	if len(state.finalArgs) != 4 || state.finalArgs[0].Value != "%161%" || fmt.Sprint(state.finalArgs[1].Value) != "161" || state.finalArgs[2].Value != "app_service_catalog" || fmt.Sprint(state.finalArgs[3].Value) != "1" {
		t.Fatalf("final args = %#v, want ILIKE + numeric id", state.finalArgs)
	}
}

func TestFetchFullTextRowsSearchesIDWhenNumericQueryHasNoQueryableColumns(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:     true,
		vectorExists:     false,
		queryableColumns: nil,
		finalRows:        [][]driver.Value{{int64(161), "Firefox", float64(1)}},
	})
	defer db.Close()

	results, err := fetchFullTextRows(db, "app_service_catalog", "161", intelligentSearchAuthorization{})
	if err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}
	if len(results) != 1 || results[0].RowID != 161 {
		t.Fatalf("results = %+v, want id 161", results)
	}
	if strings.Contains(state.finalQuery, "ILIKE $1") {
		t.Fatalf("final query = %q, did not expect text predicate", state.finalQuery)
	}
	if !strings.Contains(state.finalQuery, `"app_service_catalog"."id" = $1`) {
		t.Fatalf("final query = %q, want exact id predicate", state.finalQuery)
	}
	if len(state.finalArgs) != 3 || fmt.Sprint(state.finalArgs[0].Value) != "161" || state.finalArgs[1].Value != "app_service_catalog" || fmt.Sprint(state.finalArgs[2].Value) != "1" {
		t.Fatalf("final args = %#v, want one used numeric-id placeholder", state.finalArgs)
	}
}

func TestFetchFullTextRowsAppliesRowPolicyAndGroupBeforeStoredVectorLimit(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists:     true,
		vectorExists:     true,
		queryableColumns: []string{"header", "published"},
		finalRows:        [][]driver.Value{{int64(161), "Firefox", float64(0.42)}},
	})
	defer db.Close()

	authorization := intelligentSearchAuthorization{
		userRole: "basic",
		userID:   8,
		readPolicy: ReadRowPolicy{
			Name:        rowPolicyAllFlagsTrueUnlessOwner,
			FlagColumns: []string{"published"},
			OwnerColumn: "user_id",
		},
		tableUID:     104,
		rowGroupSlug: "security",
	}
	if _, err := fetchFullTextRows(db, "travel_info", "Firefox", authorization); err != nil {
		t.Fatalf("fetchFullTextRows returned error: %v", err)
	}

	for _, fragment := range []string{
		`("src"."published" = TRUE OR "src"."user_id" = $2)`,
		`public.resolve_effective_row_access($3, "src"."id", $4, 'read'`,
		`search_row_group_membership.table_uid = $5`,
		`search_row_group_membership.row_id = "src"."id"`,
		`search_row_group.slug = $6`,
		`search_row_group.enabled = TRUE`,
	} {
		if !strings.Contains(state.finalQuery, fragment) {
			t.Fatalf("candidate query lacks %q: %s", fragment, state.finalQuery)
		}
	}
	if strings.Index(state.finalQuery, "search_row_group.slug") > strings.Index(state.finalQuery, "LIMIT 10") {
		t.Fatalf("row-group predicate occurs after LIMIT: %s", state.finalQuery)
	}
	if len(state.finalArgs) != 6 ||
		state.finalArgs[0].Value != "firefox:*" ||
		fmt.Sprint(state.finalArgs[1].Value) != "8" ||
		state.finalArgs[2].Value != "travel_info" ||
		fmt.Sprint(state.finalArgs[3].Value) != "8" ||
		fmt.Sprint(state.finalArgs[4].Value) != "104" ||
		state.finalArgs[5].Value != "security" {
		t.Fatalf("unexpected authorized candidate args: %#v", state.finalArgs)
	}
}

func TestFetchSimilarRowsAppliesAuthorizationBeforeVectorLimit(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists: true,
		finalRows:    [][]driver.Value{{int64(161), "Firefox", float64(0.12)}},
	})
	defer db.Close()

	authorization := intelligentSearchAuthorization{
		userRole: "guest",
		userID:   1,
		readPolicy: ReadRowPolicy{
			Name:        rowPolicyAllFlagsTrueUnlessOwner,
			FlagColumns: []string{"published"},
		},
		tableUID:     104,
		rowGroupSlug: "security",
	}
	if _, err := fetchSimilarRows(db, "travel_info", "", pgvector.NewVector([]float32{0.1}), authorization); err != nil {
		t.Fatalf("fetchSimilarRows returned error: %v", err)
	}

	for _, fragment := range []string{
		`"travel_info"."published" = TRUE`,
		`public.resolve_effective_row_access($2, "travel_info"."id", $3, 'read'`,
		`search_row_group_membership.table_uid = $4`,
		`search_row_group_membership.row_id = "travel_info"."id"`,
		`search_row_group.slug = $5`,
	} {
		if !strings.Contains(state.finalQuery, fragment) {
			t.Fatalf("vector candidate query lacks %q: %s", fragment, state.finalQuery)
		}
	}
	if strings.Index(state.finalQuery, "search_row_group.slug") > strings.Index(state.finalQuery, "LIMIT 10") {
		t.Fatalf("row-group predicate occurs after LIMIT: %s", state.finalQuery)
	}
	if len(state.finalArgs) != 5 || state.finalArgs[1].Value != "travel_info" || fmt.Sprint(state.finalArgs[2].Value) != "1" || fmt.Sprint(state.finalArgs[3].Value) != "104" || state.finalArgs[4].Value != "security" {
		t.Fatalf("unexpected vector candidate args: %#v", state.finalArgs)
	}
}

func TestPrioritizeNumericIDResultFirst(t *testing.T) {
	got := prioritizeNumericIDResultFirst([]int{133, 169, 161, 186}, 161, true)
	want := []int{161, 133, 169, 186}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("prioritizeNumericIDResultFirst() = %v, want %v", got, want)
	}
}

func TestPrioritizeNumericIDResultFirstKeepsNonNumericOrder(t *testing.T) {
	got := prioritizeNumericIDResultFirst([]int{133, 169, 161, 186}, 161, false)
	want := []int{133, 169, 161, 186}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("prioritizeNumericIDResultFirst() = %v, want %v", got, want)
	}
}

func TestQuoteDerivedTableNameKeepsWholeDerivedNameQuoted(t *testing.T) {
	got := quoteDerivedTableName("app_service_catalog", "_lang_embeddings")
	if got != `"app_service_catalog_lang_embeddings"` {
		t.Fatalf("quoteDerivedTableName() = %q, want whole derived name quoted", got)
	}
}

func openIntelligentFetcherTestDB(t *testing.T, state intelligentFetcherTestState) (*sql.DB, *intelligentFetcherTestState) {
	t.Helper()

	driverState := &intelligentFetcherTestState{
		headerExists:              state.headerExists,
		vectorExists:              state.vectorExists,
		queryableColumns:          append([]string(nil), state.queryableColumns...),
		finalRows:                 cloneIntelligentFetcherRows(state.finalRows),
		requireNullVectorFallback: state.requireNullVectorFallback,
	}

	driverName := fmt.Sprintf("intelligent_fetcher_test_%d", atomic.AddInt64(&intelligentFetcherMockCounter, 1))
	sql.Register(driverName, intelligentFetcherTestDriver{state: driverState})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, driverState
}

func (d intelligentFetcherTestDriver) Open(string) (driver.Conn, error) {
	return &intelligentFetcherTestConn{state: d.state}, nil
}

func (*intelligentFetcherTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*intelligentFetcherTestConn) Close() error {
	return nil
}

func (*intelligentFetcherTestConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (c *intelligentFetcherTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM information_schema.columns") && strings.Contains(query, "column_name = $2"):
		columnName, _ := args[1].Value.(string)
		switch columnName {
		case "header":
			if c.state.headerExists {
				return newIntelligentFetcherRows([]string{"exists"}, [][]driver.Value{{int64(1)}}), nil
			}
		case "search_vector_simple":
			if c.state.vectorExists {
				return newIntelligentFetcherRows([]string{"exists"}, [][]driver.Value{{int64(1)}}), nil
			}
		}
		return newIntelligentFetcherRows([]string{"exists"}, nil), nil

	case strings.Contains(query, "SELECT column_name") && strings.Contains(query, "FROM information_schema.columns"):
		rows := make([][]driver.Value, 0, len(c.state.queryableColumns))
		for _, col := range c.state.queryableColumns {
			rows = append(rows, []driver.Value{col})
		}
		return newIntelligentFetcherRows([]string{"column_name"}, rows), nil

	default:
		c.state.finalQuery = query
		c.state.finalArgs = append([]driver.NamedValue(nil), args...)
		if c.state.requireNullVectorFallback &&
			(!strings.Contains(query, "COALESCE(") || !strings.Contains(query, "to_tsvector('simple'")) {
			return newIntelligentFetcherRows([]string{"id", "row_name", "rank"}, nil), nil
		}
		return newIntelligentFetcherRows([]string{"id", "row_name", "rank"}, c.state.finalRows), nil
	}
}

func newIntelligentFetcherRows(columns []string, rows [][]driver.Value) *intelligentFetcherTestRows {
	return &intelligentFetcherTestRows{
		columns: append([]string(nil), columns...),
		rows:    cloneIntelligentFetcherRows(rows),
	}
}

func cloneIntelligentFetcherRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func (r *intelligentFetcherTestRows) Columns() []string {
	return append([]string(nil), r.columns...)
}

func (*intelligentFetcherTestRows) Close() error {
	return nil
}

func (r *intelligentFetcherTestRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func TestFullTextSearchFiltersBeforeLimitSoRankElevenCanBeReturned(t *testing.T) {
	db, state := openIntelligentFetcherTestDB(t, intelligentFetcherTestState{
		headerExists: true, vectorExists: true,
		queryableColumns: []string{"header", "status"},
		finalRows:        [][]driver.Value{{int64(11), "Matching item outside unfiltered first ten", float64(0.1)}},
	})
	defer db.Close()
	authorization := intelligentSearchAuthorization{
		userFilters:   url.Values{"status": {"closed"}},
		filterColumns: map[string]dtt_models.ColumnInfo{"status": {ColumnName: "status", DataType: "text"}},
		filterTypes:   map[string]interface{}{"status": map[string]interface{}{"data_type": "text"}},
	}
	rows, err := fetchFullTextRows(db, "search_fixture", "shared", authorization)
	if err != nil {
		t.Fatal(err)
	}
	filterAt := strings.Index(state.finalQuery, "\"src\".\"status\"")
	limitAt := strings.Index(state.finalQuery, "LIMIT 10")
	if filterAt < 0 || limitAt < filterAt || !strings.Contains(state.finalQuery, "$2") {
		t.Fatalf("optional filter must be in candidate WHERE before LIMIT: %s", state.finalQuery)
	}
	if len(rows) != 1 || rows[0].RowID != 11 {
		t.Fatalf("filtered candidate11 lost: %#v", rows)
	}
	if len(state.finalArgs) != 4 || state.finalArgs[3].Value != "%closed%" {
		t.Fatalf("filter value not bound independently: %#v", state.finalArgs)
	}
}
