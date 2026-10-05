// row_group_facet_fetcher_postgres_test.go
// Proves multi-selection, counts and unreadable-slug equivalence on disposable PostgreSQL.
// Bridges the real listing builder, shared vector condition and AI authorization with a SELECT-only reader.
// Exists to catch leaks that SQL-string assertions cannot prove, including an RLS read transaction.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

func rowGroupPostgres(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	owner, reader := ownerResolverPostgres(t)
	migration, err := os.ReadFile("../../../../../server_tools/migrations/20260822000001_create_system_row_groups.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Use the released tables, constraints and triggers, leaving unrelated metadata registration out.
	schema, _, found := strings.Cut(string(migration), "WITH desired_tables")
	if !found {
		t.Fatal("row-group schema boundary not found")
	}
	if _, err := owner.Exec(schema); err != nil {
		t.Fatal(err)
	}
	const fixture = `
CREATE TABLE wl103_rows (id integer PRIMARY KEY, title text, status text,
    created_by integer REFERENCES system_users(id), published boolean NOT NULL);
INSERT INTO system_db_tables VALUES (103, 'wl103_rows', 'public', 'created_by');
INSERT INTO system_column_details VALUES (103, 'published', true);
INSERT INTO wl103_rows VALUES
    (1, 'Trip north', 'open', 4, true), (2, 'Trip south', 'open', 12, true),
    (3, 'Trip west', 'closed', 4, true), (4, 'Other east', 'open', 12, true),
    (5, 'Trip private', 'open', 4, false), (6, 'Trip hidden', 'open', 12, false),
    (7, 'Trip both', 'open', 4, true), (8, 'Other zero', 'closed', 4, true);
INSERT INTO system_row_groups (id, slug, title, sort_order, enabled) VALUES
    (1, 'boat', '{"fi":"Laiva"}', 0, true), (2, 'train', '{"fi":"Juna"}', -1, true),
    (3, 'private', '{"en":"Private"}', 0, true), (4, 'hidden', '{"en":"Hidden"}', 0, true),
    (5, 'foreign', '{"en":"Foreign"}', 0, true), (6, 'zero', '{"en":"Zero"}', 999, true),
    (7, 'disabled', '{"en":"Disabled"}', 0, false);
INSERT INTO system_row_group_memberships (group_id, table_uid, row_id) VALUES
    (1,103,1), (1,103,3), (1,103,7), (2,103,2), (2,103,4), (2,103,7),
    (3,103,5), (4,103,6), (5,10,1), (6,103,8), (7,103,1),
    (1,3,1), (2,3,2), (4,3,3);
ALTER TABLE app_service_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY wl103_pilot_read ON app_service_catalog FOR SELECT USING (
    (published AND enabled) OR user_id = NULLIF(current_setting('app.user_id', true), '')::integer
);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;
`
	if _, err := owner.Exec(fixture); err != nil {
		t.Fatal(err)
	}
	// Join metadata is immaterial to these fixtures; the real builder still constructs all SQL.
	setCachedJoinMetadata("wl103_rows", joinMetadataCacheEntry{tableUID: "103"})
	setCachedJoinMetadata(rlsPilotTableName, joinMetadataCacheEntry{tableUID: "3"})
	t.Cleanup(resetJoinMetadataCacheForTests)
	return owner, reader
}

func rowGroupListingContext(t *testing.T, reader dbutils.Querier, table, role string, userID int, params url.Values) QueryBuilderContext {
	t.Helper()
	policy, err := getLegacyMustTrueReadPolicy(reader, table)
	if err != nil {
		t.Fatal(err)
	}
	return QueryBuilderContext{
		DB: reader, TableName: table, UserRole: role, UserID: userID, ReadPolicy: policy,
		QueryParams: params, ResultsPerLoad: 300, ClientRowCount: -1,
		ColumnsMap: map[int]dtt_models.ColumnInfo{
			1: {ColumnName: "id", DataType: "integer"},
			2: {ColumnName: "status", DataType: "text"},
		}, VisibleColUIDs: []int{1}, ColumnDataTypes: map[string]interface{}{"id": "integer", "status": "text"},
	}
}

func rowGroupListing(t *testing.T, ctx QueryBuilderContext) ([]int, int, []RowGroupFacet) {
	t.Helper()
	query, args, count, facets, err := BuildSelectQuery(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ids := rowGroupQueryIDs(t, ctx.DB, query, args)
	return ids, count, facets
}

func rowGroupQueryIDs(t *testing.T, db dbutils.Querier, query string, args []interface{}) []int {
	t.Helper()
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatalf("%v\n%s", err, query)
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Ints(ids)
	return ids
}

func TestRowGroupSelectionCountsAndPaginationPostgres(t *testing.T) {
	_, reader := rowGroupPostgres(t)
	for _, actor := range []struct {
		role         string
		id           int
		privateCount int
	}{{"guest", 1, 0}, {"basic", 4, 1}} {
		params := url.Values{"row_group": {"boat,train,zero"}, "status": {"open"}, "search": {"Trip"}}
		ctx := rowGroupListingContext(t, reader, "wl103_rows", actor.role, actor.id, params)
		ids, count, facets := rowGroupListing(t, ctx)
		if !reflect.DeepEqual(ids, []int{1, 2, 7}) || count != 3 {
			t.Fatalf("OR ids=%v count=%d", ids, count)
		}
		expected := []RowGroupFacet{
			{ID: 2, Slug: "train", Title: map[string]string{"fi": "Juna"}, RowCount: 2, Selected: true},
			{ID: 1, Slug: "boat", Title: map[string]string{"fi": "Laiva"}, RowCount: 2, Selected: true},
		}
		if actor.privateCount > 0 {
			expected = append(expected, RowGroupFacet{ID: 3, Slug: "private", Title: map[string]string{"en": "Private"}, RowCount: 1})
		}
		expected = append(expected, RowGroupFacet{ID: 6, Slug: "zero", Title: map[string]string{"en": "Zero"}, RowCount: 0, Selected: true})
		if !reflect.DeepEqual(facets, expected) {
			t.Fatalf("%s facets=%#v want=%#v", actor.role, facets, expected)
		}
		// Narrow to boat: train's count still describes its alternatives.
		params.Set("row_group", "boat")
		ids, count, facets = rowGroupListing(t, ctx)
		if !reflect.DeepEqual(ids, []int{1, 7}) || count != 2 || facets[0].Slug != "train" || facets[0].RowCount != 2 {
			t.Fatalf("own selection narrowed counts: ids=%v count=%d facets=%#v", ids, count, facets)
		}
		ctx.Offset = 1
		ctx.ResultsPerLoad = 1
		ids, count, facets = rowGroupListing(t, ctx)
		if len(ids) != 1 || count != 2 || len(facets) != 0 {
			t.Fatalf("later page: %v %d %#v", ids, count, facets)
		}
	}
}

func TestRowGroupFacetCapKeepsSelectedAndSortOrderPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	if _, err := owner.Exec(`
INSERT INTO system_row_groups (id,slug,title,sort_order)
SELECT 1000+n, 'value_' || lpad(n::text,3,'0'), '{"en":"Value"}', n FROM generate_series(1,205) n;
INSERT INTO system_row_group_memberships (group_id,table_uid,row_id) SELECT 1000+n,103,1 FROM generate_series(1,205) n;
`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"value_205,zero"}, "status": {"open"}, "search": {"Trip"}})
	_, _, facets := rowGroupListing(t, ctx)
	if len(facets) != 200 {
		t.Fatalf("cap=%d", len(facets))
	}
	selected := []string{}
	for _, facet := range facets {
		if facet.Selected {
			selected = append(selected, facet.Slug)
		}
	}
	if !reflect.DeepEqual(selected, []string{"value_205", "zero"}) || facets[0].Slug != "train" || facets[1].Slug != "boat" || facets[199].RowCount != 0 {
		t.Fatalf("cap lost selection or ordering: selected=%v first=%v last=%v", selected, facets[:2], facets[198:])
	}
}

func TestRowGroupUnreadableSlugsMatchUnknownAcrossReadPathsPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	for _, table := range []string{"wl103_rows", rlsPilotTableName} {
		t.Run(table, func(t *testing.T) {
			// The metadata owner bypasses RLS. Passing it to the resolver would leak 'hidden'.
			tx, err := reader.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err := tx.Exec(`SELECT set_config('app.user_id','1',true)`); err != nil {
				t.Fatal(err)
			}
			ctx := rowGroupListingContext(t, tx, table, "guest", 1, url.Values{})
			var baselineIDs []int
			var baselineFacets []RowGroupFacet
			var baselineCount int
			for _, slug := range []string{"unknown", "foreign", "hidden", "disabled"} {
				ctx.QueryParams.Set("row_group", slug)
				ids, count, facets := rowGroupListing(t, ctx)
				if slug == "unknown" {
					baselineIDs, baselineCount, baselineFacets = ids, count, facets
				}
				if !reflect.DeepEqual(ids, baselineIDs) || count != baselineCount || !reflect.DeepEqual(facets, baselineFacets) {
					t.Fatalf("%s disclosed %s: ids=%v count=%d facets=%#v", table, slug, ids, count, facets)
				}
				authorization, err := resolveIntelligentSearchAuthorization(owner, tx, table, "guest", 1, slug)
				if err != nil {
					t.Fatal(err)
				}
				if len(authorization.rowGroupSelection) != 0 {
					t.Fatalf("%s resolved unreadable %s", table, slug)
				}
				// AI candidates and hydration use this same condition with different aliases.
				for _, alias := range []string{"src", "candidate"} {
					condition, args, err := appendIntelligentSearchAuthorizationCondition(table, alias, authorization, nil)
					if err != nil {
						t.Fatal(err)
					}
					got := rowGroupQueryIDs(t, tx, fmt.Sprintf(`SELECT %s.id FROM %s AS %s WHERE %s`, pq.QuoteIdentifier(alias), pq.QuoteIdentifier(table), pq.QuoteIdentifier(alias), condition), args)
					if !reflect.DeepEqual(got, baselineIDs) {
						t.Fatalf("AI %s/%s ids=%v want=%v", table, slug, got, baselineIDs)
					}
				}
				// The standalone vector endpoint uses these exact policy/resolver/builder calls.
				selection, err := parseRowGroupSelection(slug)
				if err != nil {
					t.Fatal(err)
				}
				selection, err = resolveRowGroupSelection(tx, table, authorization.tableUID, selection, "guest", 1, ctx.ReadPolicy)
				if err != nil {
					t.Fatal(err)
				}
				where, args := appendReadPolicyToWhereClause(table, "guest", 1, ctx.ReadPolicy, "", nil)
				where, args, err = appendRowGroupFilterToWhereClause(selection, table, authorization.tableUID, buildColumnsByName(ctx.ColumnsMap), where, args)
				if err != nil {
					t.Fatal(err)
				}
				got := rowGroupQueryIDs(t, tx, "SELECT id FROM "+pq.QuoteIdentifier(table)+where, args)
				if !reflect.DeepEqual(got, baselineIDs) {
					t.Fatalf("vector %s/%s ids=%v want=%v", table, slug, got, baselineIDs)
				}
			}
			// An unreadable value beside a valid selection also cannot widen it.
			for _, raw := range []string{"boat,unknown", "boat,hidden", "boat,foreign"} {
				ctx.QueryParams.Set("row_group", raw)
				ids, _, _ := rowGroupListing(t, ctx)
				want := []int{1, 3, 7}
				if table == rlsPilotTableName {
					want = []int{1}
				}
				if !reflect.DeepEqual(ids, want) {
					t.Fatalf("mixed %s: %v want %v", raw, ids, want)
				}
			}
		})
	}
}

func TestRowGroupAICandidatesAndSemanticResultsPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	// Semantic ranking is local: no provider or network call is needed.
	if _, err := owner.Exec(`CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE wl103_rows ADD COLUMN embedding_vector vector(3) DEFAULT '[1,0,0]';`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{})
	for _, selection := range []string{"unknown", "hidden", "foreign", "disabled", "boat,train"} {
		ctx.QueryParams.Set("row_group", selection)
		want, _, _ := rowGroupListing(t, ctx)
		authorization, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, selection)
		if err != nil {
			t.Fatal(err)
		}
		hits, err := fetchSimilarRows(reader, "wl103_rows", "", pgvector.NewVector([]float32{1, 0, 0}), authorization, semanticSources{General: true}, 20)
		if err != nil {
			t.Fatal(err)
		}
		ids := []int{}
		for _, hit := range hits {
			ids = append(ids, hit.RowID)
		}
		sort.Ints(ids)
		if !reflect.DeepEqual(ids, want) {
			t.Fatalf("semantic %s: %v want %v", selection, ids, want)
		}
		ctx.QueryParams.Set("search", "Trip")
		want, _, _ = rowGroupListing(t, ctx)
		text, err := fetchFullTextRows(reader, "wl103_rows", "Trip", authorization)
		if err != nil {
			t.Fatal(err)
		}
		ids = []int{}
		for _, hit := range text {
			ids = append(ids, hit.RowID)
		}
		sort.Ints(ids)
		if !reflect.DeepEqual(ids, want) {
			t.Fatalf("text %s: %v want %v", selection, ids, want)
		}
		ctx.QueryParams.Del("search")
	}
}
