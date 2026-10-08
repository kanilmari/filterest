// row_group_modes_postgres_test.go
// Proves ANY/ALL, scoped zero hits and search/hydration parity on disposable PostgreSQL.
// Connects the released row-group schema to real query builders and limited readers/RLS.
// Keeps denied-only vocabulary, duplicate joins and capped selections inside the same boundary.
package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

func rowGroupFacetCounts(facets []RowGroupFacet) map[string]int {
	counts := map[string]int{}
	for _, facet := range facets {
		counts[facet.Slug] = facet.RowCount
	}
	return counts
}

func assertRowGroupModeParity(t *testing.T, metadata *sql.DB, reader dbutils.Querier, ctx QueryBuilderContext, want []int) {
	t.Helper()
	authorization, err := resolveIntelligentSearchAuthorization(metadata, reader, ctx.TableName, ctx.UserRole, ctx.UserID, ctx.QueryParams)
	if err != nil {
		t.Fatal(err)
	}
	where, args := appendReadPolicyToWhereClause(ctx.TableName, ctx.UserRole, ctx.UserID, ctx.ReadPolicy, "", nil)
	where, args, err = appendRowGroupFilterToWhereClause(authorization.rowGroupSelection, ctx.TableName, authorization.tableUID, buildColumnsByName(ctx.ColumnsMap), where, args)
	if err != nil {
		t.Fatal(err)
	}
	if got := rowGroupQueryIDs(t, reader, "SELECT id FROM "+pq.QuoteIdentifier(ctx.TableName)+where, args); !reflect.DeepEqual(got, want) {
		t.Fatalf("vector scope=%v want=%v", got, want)
	}
	// Ranking candidates and final hydration use different aliases. Include every
	// row ID in hydration so a denied/nonmatching candidate cannot reappear.
	for _, alias := range []string{"src", "candidate"} {
		condition, args, err := appendIntelligentSearchAuthorizationCondition(ctx.TableName, alias, authorization, nil)
		if err != nil {
			t.Fatal(err)
		}
		query := fmt.Sprintf(`SELECT %s.id FROM %s AS %s WHERE %s ORDER BY %s.id LIMIT 100`, pq.QuoteIdentifier(alias), pq.QuoteIdentifier(ctx.TableName), pq.QuoteIdentifier(alias), condition, pq.QuoteIdentifier(alias))
		if got := rowGroupQueryIDs(t, reader, query, args); !reflect.DeepEqual(got, want) {
			t.Fatalf("AI %s=%v want=%v", alias, got, want)
		}
	}
}

func TestRowGroupModesRowsCountsAndOtherHeadingsPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"boat,train"}})
	for _, mode := range []string{"any", "all"} {
		ctx.QueryParams.Set("row_group_mode", "1:"+mode)
		ids, count, facets := rowGroupListing(t, ctx)
		want := []int{1, 2, 3, 4, 7}
		counts := map[string]int{"boat": 3, "train": 3, "zero": 1, "hotel": 2, "camp": 2, "legacy": 2}
		if mode == "all" {
			want = []int{7}
			counts = map[string]int{"boat": 1, "train": 1, "zero": 0, "hotel": 0, "camp": 1, "legacy": 1}
		}
		if !reflect.DeepEqual(ids, want) || count != len(want) || !reflect.DeepEqual(rowGroupFacetCounts(facets), counts) {
			t.Fatalf("%s ids=%v count=%d facets=%v", mode, ids, count, rowGroupFacetCounts(facets))
		}
		for _, facet := range facets {
			if facet.ZeroHit != (facet.RowCount == 0) {
				t.Fatalf("zero_hit=%+v", facet)
			}
			wantMode := "any"
			if facet.Heading != nil && facet.Heading.ID == 1 {
				wantMode = mode
			}
			if facet.Mode != wantMode {
				t.Fatalf("mode=%+v", facet)
			}
		}
		assertRowGroupModeParity(t, owner, reader, ctx, want)
	}
	// ALL on the transport heading stays applied when counting another heading,
	// and adding an already selected transport value does not increase S.
	ctx.QueryParams.Set("row_group", "boat,train,hotel")
	ids, count, facets := rowGroupListing(t, ctx)
	if len(ids) != 0 || count != 0 || rowGroupFacetCounts(facets)["camp"] != 1 || rowGroupFacetCounts(facets)["boat"] != 0 {
		t.Fatalf("other heading ids=%v count=%d facets=%v", ids, count, rowGroupFacetCounts(facets))
	}
	// Mode-only readable headings retain preference without filtering any rows.
	ctx.QueryParams.Del("row_group")
	_, _, _, _, resolved, err := BuildSelectQuery(ctx)
	if err != nil || !reflect.DeepEqual(resolved.Modes, map[string]string{"1": "all"}) {
		t.Fatalf("mode-only=%+v %v", resolved, err)
	}
	ids, _, _ = rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1, 2, 3, 4, 7, 8}) {
		t.Fatalf("mode-only narrowed rows=%v", ids)
	}
}

func TestRowGroupModesTextSemanticAndActualHydrationPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	if _, err := owner.Exec(`CREATE EXTENSION IF NOT EXISTS vector;
        ALTER TABLE wl103_rows ADD COLUMN header text GENERATED ALWAYS AS (title) STORED;
        ALTER TABLE wl103_rows ADD COLUMN embedding_vector vector(3) DEFAULT '[1,0,0]';
        ALTER TABLE system_column_details ADD COLUMN hide_everywhere boolean;
        ALTER TABLE system_column_details ADD COLUMN client_delivery_mode text;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;`); err != nil {
		t.Fatal(err)
	}
	originalDB := backend.Db
	backend.Db = owner
	t.Cleanup(func() { backend.Db = originalDB })
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"boat,train"}, "search": {"Trip"}})
	for _, mode := range []string{"any", "all"} {
		ctx.QueryParams.Set("row_group_mode", "1:"+mode)
		want, _, _ := rowGroupListing(t, ctx)
		authorization, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, ctx.QueryParams)
		if err != nil {
			t.Fatal(err)
		}
		text, err := fetchFullTextRows(reader, "wl103_rows", "Trip", authorization)
		if err != nil {
			t.Fatal(err)
		}
		ids := []int{}
		for _, hit := range text {
			ids = append(ids, hit.RowID)
		}
		sort.Ints(ids)
		if !reflect.DeepEqual(ids, want) {
			t.Fatalf("text %s=%v want=%v", mode, ids, want)
		}
		data, _, err := fetchRowsInOrder(reader, "wl103_rows", []int{1, 2, 3, 4, 5, 6, 7, 8}, authorization)
		if err != nil {
			t.Fatal(err)
		}
		// Hydration reapplies categories and permission; its ordinary scope has no text query.
		ctx.QueryParams.Del("search")
		allWant, _, _ := rowGroupListing(t, ctx)
		ids = []int{}
		for _, row := range data {
			ids = append(ids, int(row["id"].(int64)))
		}
		sort.Ints(ids)
		if !reflect.DeepEqual(ids, allWant) {
			t.Fatalf("hydration %s=%v want=%v", mode, ids, allWant)
		}
		semantic, err := fetchSimilarRows(reader, "wl103_rows", "", pgvector.NewVector([]float32{1, 0, 0}), authorization, semanticSources{General: true}, 20)
		if err != nil {
			t.Fatal(err)
		}
		ids = []int{}
		for _, hit := range semantic {
			ids = append(ids, hit.RowID)
		}
		sort.Ints(ids)
		if !reflect.DeepEqual(ids, allWant) {
			t.Fatalf("semantic %s=%v want=%v", mode, ids, allWant)
		}
		ctx.QueryParams.Set("search", "Trip")
	}
	// A membership disappearing after candidate ranking must be refused during hydration.
	authorization, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, ctx.QueryParams)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(`DELETE FROM system_row_group_memberships WHERE table_uid=103 AND row_id=7 AND group_id=2`); err != nil {
		t.Fatal(err)
	}
	data, _, err := fetchRowsInOrder(reader, "wl103_rows", []int{7}, authorization)
	if err != nil || len(data) != 0 {
		t.Fatalf("changed membership hydration=%v %v", data, err)
	}
}

func TestRowGroupZeroHitVocabularyOwnerDenyAndRLSPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	if _, err := owner.Exec(`INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(103,1,5,4,'deny');
        INSERT INTO system_row_groups(id,slug,title) VALUES(20,'denied_only','{"en":"Denied only"}'),(21,'orphan_only','{"en":"Orphan only"}');
        INSERT INTO system_row_group_memberships(group_id,table_uid,row_id) VALUES(20,103,5),(21,103,99999);`); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []struct {
		role    string
		id      int
		private bool
	}{{"guest", 1, false}, {"basic", 4, false}, {"admin", 4, true}} {
		ctx := rowGroupListingContext(t, reader, "wl103_rows", actor.role, actor.id, url.Values{"search": {"no-current-matches"}})
		ids, count, facets := rowGroupListing(t, ctx)
		if len(ids) != 0 || count != 0 {
			t.Fatal("text query should have no matches")
		}
		counts := rowGroupFacetCounts(facets)
		if _, found := counts["denied_only"]; found != actor.private {
			t.Fatalf("%s denied vocabulary=%v", actor.role, counts)
		}
		for _, slug := range []string{"foreign", "orphan_only", "disabled", "heading_disabled"} {
			if _, found := counts[slug]; found {
				t.Fatalf("%s leaked %s", actor.role, slug)
			}
		}
		if len(facets) == 0 {
			t.Fatal("zero-hit readable vocabulary lost")
		}
		for _, facet := range facets {
			if !facet.ZeroHit || facet.RowCount != 0 {
				t.Fatalf("zero hits=%+v", facet)
			}
		}
		// The invisible heading's mode is indistinguishable from unknown, even without selections.
		ctx.QueryParams.Set("row_group_mode", "2:all")
		_, _, _, _, resolved, err := BuildSelectQuery(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if (resolved.Modes["2"] == "all") != actor.private {
			t.Fatalf("%s modes=%v", actor.role, resolved.Modes)
		}
	}
	// Restore the owner exception after removing the explicit deny.
	if _, err := owner.Exec(`DELETE FROM system_row_access_rules WHERE table_uid=103`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "basic", 4, url.Values{"row_group": {"private"}})
	ids, _, facets := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{5}) || rowGroupFacetCounts(facets)["private"] != 1 {
		t.Fatalf("owner exception=%v %v", ids, facets)
	}
	for _, actor := range []struct {
		id      int
		visible bool
	}{{1, false}, {12, true}} {
		tx, err := reader.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(`SELECT set_config('app.user_id',$1,true)`, fmt.Sprint(actor.id)); err != nil {
			t.Fatal(err)
		}
		ctx := rowGroupListingContext(t, tx, rlsPilotTableName, "basic", actor.id, url.Values{"search": {"no-current-matches"}, "row_group_mode": {"2:all"}})
		_, _, facets := rowGroupListing(t, ctx)
		_, found := rowGroupFacetCounts(facets)["hidden"]
		if found != actor.visible {
			t.Fatalf("RLS owner %d vocabulary=%v", actor.id, facets)
		}
		baselineCtx := ctx
		baselineCtx.QueryParams = url.Values{"row_group_mode": {"2:all"}}
		want, _, _ := rowGroupListing(t, baselineCtx)
		assertRowGroupModeParity(t, owner, tx, baselineCtx, want)
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRowGroupALLSingleAndLegacyContractPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	if _, err := owner.Exec(`UPDATE system_row_group_classifications SET is_single=true WHERE id=3`); err != nil {
		t.Fatal(err)
	}
	for _, params := range []url.Values{{"row_group_mode": {"3:all"}}, {"row_group": {"hotel"}, "row_group_mode": {"3:all"}}} {
		ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, params)
		_, _, _, _, _, err := BuildSelectQuery(ctx)
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 400 {
			t.Fatalf("single ALL=%v", err)
		}
		if _, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, params); !errors.As(err, &refusal) {
			t.Fatalf("intelligent single ALL=%v", err)
		}
	}
	// Explicit ANY remains valid for a class; legacy heading 0 supports ALL.
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"hotel,legacy"}, "row_group_mode": {"3:any,0:all"}})
	ids, _, _ := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1}) {
		t.Fatalf("legacy ALL=%v", ids)
	}
}

func TestRowGroupDistinctJoinCountsAndPinnedALLSelectionsPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	selection, err := parseRowGroupFilters(url.Values{"row_group": {"boat,train"}, "row_group_mode": {"1:all"}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{})
	selection, err = resolveRowGroupSelection(reader, "wl103_rows", 103, selection, "guest", 1, ctx.ReadPolicy)
	if err != nil {
		t.Fatal(err)
	}
	where, args := appendReadPolicyToWhereClause("wl103_rows", "guest", 1, ctx.ReadPolicy, "", nil)
	readableWhere, readableArgs := appendReadPolicyToWhereClause("wl103_rows", "guest", 1, ctx.ReadPolicy, "", append([]interface{}{}, args...))
	facets, err := fetchRowGroupFacets(reader, "wl103_rows", 103, ` CROSS JOIN generate_series(1,3) AS repeated_join`, where, args, selection, rowGroupReadScope{where: readableWhere, args: readableArgs[len(args):]})
	if err != nil || rowGroupFacetCounts(facets)["boat"] != 1 || rowGroupFacetCounts(facets)["train"] != 1 {
		t.Fatalf("duplicate counts=%v err=%v", facets, err)
	}
	if _, err := owner.Exec(`INSERT INTO system_row_groups(id,slug,title,sort_order,classification_id)
        SELECT 1000+n,'value_'||lpad(n::text,3,'0'),jsonb_build_object('en','Value '||n),n,1 FROM generate_series(1,205) n;
        INSERT INTO system_row_group_memberships(group_id,table_uid,row_id) SELECT 1000+n,103,7 FROM generate_series(1,205) n;`); err != nil {
		t.Fatal(err)
	}
	ctx.QueryParams = url.Values{"row_group": {"value_205,boat,train"}, "row_group_mode": {"1:all"}, "status": {"closed"}}
	_, _, _, facets, resolved, err := BuildSelectQuery(ctx)
	if err != nil || len(facets) != 200 || len(resolved.Slugs) != 3 || resolved.Modes["1"] != "all" {
		t.Fatalf("cap=%d resolved=%+v err=%v", len(facets), resolved, err)
	}
	selected := []string{}
	for _, facet := range facets {
		if facet.Selected {
			selected = append(selected, facet.Slug)
			if !facet.ZeroHit {
				t.Fatalf("pinned zero=%+v", facet)
			}
		}
	}
	sort.Strings(selected)
	if !reflect.DeepEqual(selected, []string{"boat", "train", "value_205"}) {
		t.Fatalf("pinned=%v", selected)
	}
}
