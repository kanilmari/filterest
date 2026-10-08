// row_group_headings_postgres_test.go
// Proves per-heading AND/OR and except-own-heading counts in the readable universe.
// Reuses S1's disposable PostgreSQL fixture and shared listing, vector and AI predicates.
// Covers disabled headings, legacy NULL values and zero-count selected values.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func rowGroupHeadingPostgres(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	owner, reader := rowGroupPostgres(t)
	if _, err := owner.Exec(`
INSERT INTO system_row_group_classifications(id,slug,title,sort_order,enabled) VALUES
    (3,'accommodation','{"fi":"Majoitus","en":"Accommodation"}',5,true),
    (4,'disabled_heading','{"en":"Disabled heading"}',6,false);
INSERT INTO system_row_groups(id,slug,title,sort_order,classification_id) VALUES
    (10,'hotel','{"en":"Hotel"}',0,3), (11,'camp','{"en":"Camp"}',1,3),
    (12,'legacy','{"en":"Legacy"}',0,NULL), (13,'heading_disabled','{"en":"Hidden"}',0,4);
INSERT INTO system_row_group_memberships(group_id,table_uid,row_id) VALUES
    (10,103,1),(10,103,2),(11,103,3),(11,103,7),(12,103,1),(12,103,7),(13,103,1);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;
`); err != nil {
		t.Fatal(err)
	}
	return owner, reader
}

func TestRowGroupHeadingsANDORAndExceptOwnCountsPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"boat,train,hotel"}})
	ids, count, facets := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1, 2}) || count != 2 {
		t.Fatalf("AND/OR ids=%v count=%d", ids, count)
	}
	counts := map[string]int{}
	for _, facet := range facets {
		counts[facet.Slug] = facet.RowCount
	}
	if !reflect.DeepEqual(counts, map[string]int{"boat": 1, "train": 1, "hotel": 2, "camp": 2, "legacy": 1, "zero": 0}) {
		t.Fatalf("except-own-heading counts=%v", counts)
	}
	if facets[0].Slug != "train" || facets[1].Slug != "boat" || facets[0].Heading == nil || facets[0].Heading.SortOrder != -1 {
		t.Fatalf("heading order=%#v", facets)
	}
	// Vector and AI candidate/hydration builders retain exactly the listing scope.
	auth, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"boat,train,hotel"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, alias := range []string{"src", "candidate"} {
		condition, args, err := appendIntelligentSearchAuthorizationCondition("wl103_rows", alias, auth, nil)
		if err != nil {
			t.Fatal(err)
		}
		got := rowGroupQueryIDs(t, reader, "SELECT "+alias+".id FROM wl103_rows AS "+alias+" WHERE "+condition, args)
		if !reflect.DeepEqual(got, ids) {
			t.Fatalf("AI %s ids=%v want=%v", alias, got, ids)
		}
	}
	where, args := appendReadPolicyToWhereClause("wl103_rows", "guest", 1, ctx.ReadPolicy, "", nil)
	where, args, err = appendRowGroupFilterToWhereClause(auth.rowGroupSelection, "wl103_rows", 103, buildColumnsByName(ctx.ColumnsMap), where, args)
	if err != nil {
		t.Fatal(err)
	}
	if got := rowGroupQueryIDs(t, reader, "SELECT id FROM wl103_rows"+where, args); !reflect.DeepEqual(got, ids) {
		t.Fatalf("vector ids=%v", got)
	}

	ctx.QueryParams.Set("row_group", "boat,hotel,camp")
	ids, count, facets = rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1, 3, 7}) || count != 3 {
		t.Fatalf("OR within second heading=%v %d", ids, count)
	}
	// A value under NULL is an independent heading; its counts still keep both named headings.
	ctx.QueryParams.Set("row_group", "boat,hotel,legacy")
	ids, count, facets = rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1}) || count != 1 {
		t.Fatalf("NULL group ids=%v count=%d", ids, count)
	}
	for _, facet := range facets {
		if facet.Slug == "legacy" && (facet.Heading != nil || facet.RowCount != 1 || !facet.Selected) {
			t.Fatalf("NULL facet=%#v", facet)
		}
	}
	ctx.QueryParams.Set("row_group", "boat,hotel")
	ctx.QueryParams.Set("status", "closed")
	ids, count, facets = rowGroupListing(t, ctx)
	if len(ids) != 0 || count != 0 {
		t.Fatalf("zero selection=%v %d", ids, count)
	}
	counts = map[string]int{}
	for _, facet := range facets {
		counts[facet.Slug] = facet.RowCount
	}
	if !reflect.DeepEqual(counts, map[string]int{"boat": 0, "train": 0, "hotel": 0, "camp": 1, "legacy": 0, "zero": 0}) {
		t.Fatalf("zero facets=%#v", facets)
	}
}

func TestRowGroupDisabledHeadingHidesValuesAndDropsSelectionPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"unknown"}})
	baseline, count, facets := rowGroupListing(t, ctx)
	ctx.QueryParams.Set("row_group", "heading_disabled")
	got, gotCount, gotFacets := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(got, baseline) || gotCount != count || !reflect.DeepEqual(gotFacets, facets) {
		t.Fatal("disabled heading changed results or disclosed metadata")
	}
	assertDisabledHeadingReadPaths(t, owner, reader, "heading_disabled", baseline, nil)
	if _, err := owner.Exec("UPDATE system_row_group_classifications SET enabled=false WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	ctx.QueryParams.Set("row_group", "boat,train,hotel")
	got, gotCount, gotFacets = rowGroupListing(t, ctx)
	if !reflect.DeepEqual(got, []int{1, 2}) || gotCount != 2 {
		t.Fatalf("disabled selections retained: %v %d", got, gotCount)
	}
	for _, facet := range gotFacets {
		if facet.Slug == "boat" || facet.Slug == "train" || facet.Slug == "zero" || facet.Slug == "heading_disabled" {
			t.Fatalf("disabled heading value=%#v", facet)
		}
	}
	assertDisabledHeadingReadPaths(t, owner, reader, "boat,train,hotel", got, []string{"hotel"})
}

// Exercise AI candidate/hydration aliases and the standalone vector resolver,
// so a disabled heading cannot silently survive in a different search path.
func assertDisabledHeadingReadPaths(t *testing.T, owner, reader *sql.DB, raw string, want []int, wantSelection []string) {
	t.Helper()
	authorization, err := resolveIntelligentSearchAuthorization(owner, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {raw}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(authorization.rowGroupSelection.Slugs, ",") != strings.Join(wantSelection, ",") {
		t.Fatalf("disabled heading AI resolved %v want=%v", authorization.rowGroupSelection, wantSelection)
	}
	for _, alias := range []string{"src", "candidate"} {
		condition, args, err := appendIntelligentSearchAuthorizationCondition("wl103_rows", alias, authorization, nil)
		if err != nil {
			t.Fatal(err)
		}
		got := rowGroupQueryIDs(t, reader, "SELECT "+alias+".id FROM wl103_rows AS "+alias+" WHERE "+condition, args)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("disabled heading AI %s/%s ids=%v want=%v", raw, alias, got, want)
		}
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{})
	selection, err := parseRowGroupFilters(url.Values{"row_group": {raw}})
	if err != nil {
		t.Fatal(err)
	}
	selection, err = resolveRowGroupSelection(reader, "wl103_rows", 103, selection, "guest", 1, ctx.ReadPolicy)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(selection.Slugs, ",") != strings.Join(wantSelection, ",") {
		t.Fatalf("disabled heading vector resolved %v want=%v", selection, wantSelection)
	}
	where, args := appendReadPolicyToWhereClause("wl103_rows", "guest", 1, ctx.ReadPolicy, "", nil)
	where, args, err = appendRowGroupFilterToWhereClause(selection, "wl103_rows", 103, buildColumnsByName(ctx.ColumnsMap), where, args)
	if err != nil {
		t.Fatal(err)
	}
	if got := rowGroupQueryIDs(t, reader, "SELECT id FROM wl103_rows"+where, args); !reflect.DeepEqual(got, want) {
		t.Fatalf("disabled heading vector %s ids=%v want=%v", raw, got, want)
	}
}

func TestRowGroupNULLValuesShareOneHeadingPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	if _, err := owner.Exec(`
INSERT INTO system_row_groups(id,slug,title) VALUES (14,'legacy_two','{"en":"Legacy two"}');
INSERT INTO system_row_group_memberships(group_id,table_uid,row_id) VALUES (14,103,3);
`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {"boat,hotel,camp,legacy,legacy_two"}})
	ids, count, facets := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1, 3, 7}) || count != 3 {
		t.Fatalf("NULL alternatives did not share a heading: %v %d", ids, count)
	}
	counts := map[string]int{}
	for _, facet := range facets {
		if facet.Heading == nil {
			counts[facet.Slug] = facet.RowCount
		}
	}
	if !reflect.DeepEqual(counts, map[string]int{"legacy": 2, "legacy_two": 1}) {
		t.Fatalf("NULL counts retained own selection: %v", counts)
	}
}

func TestRowGroupHeadingFacetCapKeepsTwentySelectedValuesPostgres(t *testing.T) {
	owner, reader := rowGroupHeadingPostgres(t)
	if _, err := owner.Exec(`
INSERT INTO system_row_groups(id,slug,title,sort_order,classification_id)
SELECT 1000+n,'value_'||lpad(n::text,3,'0'),'{"en":"Value"}',n,3 FROM generate_series(1,205) n;
INSERT INTO system_row_group_memberships(group_id,table_uid,row_id)
SELECT 1000+n,103,1 FROM generate_series(1,205) n;
`); err != nil {
		t.Fatal(err)
	}
	slugs := []string{"boat", "train"}
	for n := 188; n <= 205; n++ {
		slugs = append(slugs, fmt.Sprintf("value_%03d", n))
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{"row_group": {strings.Join(slugs, ",")}})
	ids, count, facets := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, []int{1}) || count != 1 || len(facets) != 200 {
		t.Fatalf("cap ids=%v count=%d facets=%d", ids, count, len(facets))
	}
	selected := []string{}
	for _, facet := range facets {
		if facet.Selected {
			selected = append(selected, facet.Slug)
		}
	}
	sort.Strings(selected)
	sort.Strings(slugs)
	if !reflect.DeepEqual(selected, slugs) {
		t.Fatalf("cap lost selections: %v want %v", selected, slugs)
	}
	if facets[0].Slug != "train" || facets[0].RowCount != 0 || !facets[0].Selected || facets[0].Heading.ID != 1 || facets[len(facets)-1].Slug != "value_205" {
		t.Fatalf("heading presentation order or selected zero lost: first=%#v last=%#v", facets[0], facets[len(facets)-1])
	}
}
