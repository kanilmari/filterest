// search_id_first_postgres_test.go
// Proves ID priority, old match order, authorization, counts and offset pages.
// Connects the production listing and assisted compilers to disposable PostgreSQL.
// Uses existing opt-in cluster fixtures; never reads an installation database.
package dtt_1_row_read

import (
	"fmt"
	"net/url"
	"reflect"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
)

// orderedIDPage deliberately preserves SQL order (rowGroupQueryIDs sorts IDs).
func orderedIDPage(t *testing.T, ctx QueryBuilderContext) ([]int, int) {
	t.Helper()
	query, args, count, _, _, err := BuildSelectQuery(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := ctx.DB.Query(query, args...)
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
	return ids, count
}

func TestIDSearchOrderCountAndPagingPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	if _, err := owner.Exec(`
		INSERT INTO wl103_rows VALUES
		 (843, 'unrelated matter', 'open', 4, true),
		 (9, '843 843', 'open', 4, true), (10, '843 843 843', 'open', 4, true),
		 (11, '843', 'closed', 4, true),
		 (20, '999', 'open', 4, true), (21, '999 999', 'open', 4, true);
		ALTER TABLE wl103_rows ADD COLUMN search_vector_simple tsvector;
		UPDATE wl103_rows SET search_vector_simple = to_tsvector('simple', title);
		GRANT SELECT ON wl103_rows TO wl58_reader;
	`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, url.Values{})
	want := []int{843, 10, 9, 11}
	for _, raw := range []string{"843", "#843", " 843 "} {
		t.Run(raw, func(t *testing.T) {
			ctx.QueryParams.Set("search", raw)
			ids, count := orderedIDPage(t, ctx)
			if !reflect.DeepEqual(ids, want) || count != 4 {
				t.Fatalf("search %q ids=%v count=%d, want %v / 4", raw, ids, count, want)
			}
			// Compare every other match against the former text-only ordering.
			text, _ := dtt_search_vectors.TextSearchCondition("843", `"wl103_rows".search_vector_simple`,
				`"wl103_rows".id`, 1, dtt_search_vectors.IDSearch{})
			old := rowGroupQueryIDs(t, reader, "SELECT id FROM wl103_rows WHERE "+text.Predicate, text.Args)
			if len(old) != 3 {
				t.Fatalf("the ID-only row must not be an ordinary text match: %v", old)
			}
			orderedRows, err := reader.Query("SELECT id FROM wl103_rows WHERE "+text.Predicate+text.OrderBy, text.Args...)
			if err != nil {
				t.Fatal(err)
			}
			oldOrder := []int{}
			for orderedRows.Next() {
				var id int
				if err := orderedRows.Scan(&id); err != nil {
					t.Fatal(err)
				}
				oldOrder = append(oldOrder, id)
			}
			if err := orderedRows.Err(); err != nil {
				t.Fatal(err)
			}
			_ = orderedRows.Close()
			if !reflect.DeepEqual(ids[1:], oldOrder) {
				t.Fatalf("other matches changed order: %v, formerly %v", ids[1:], oldOrder)
			}
			authorization := intelligentSearchAuthorization{userRole: "guest", userID: 1, readPolicy: ctx.ReadPolicy}
			hits, err := fetchFullTextRows(reader, "wl103_rows", raw, authorization)
			if err != nil {
				t.Fatal(err)
			}
			assistedIDs := []int{}
			for _, hit := range hits {
				assistedIDs = append(assistedIDs, hit.RowID)
			}
			if !reflect.DeepEqual(assistedIDs, want) {
				t.Fatalf("assisted ID priority or other match order: %v", assistedIDs)
			}
			pageCtx := ctx
			pageCtx.ResultsPerLoad = 2
			paged := []int{}
			for _, offset := range []int{0, 2, 4} {
				pageCtx.Offset = offset
				page, pageCount := orderedIDPage(t, pageCtx)
				if pageCount != 4 {
					t.Fatalf("offset %d count=%d", offset, pageCount)
				}
				paged = append(paged, page...)
			}
			if !reflect.DeepEqual(paged, want) {
				t.Fatalf("offset pages duplicate or skip rows: %v", paged)
			}
		})
	}
	for _, tc := range []struct {
		term string
		want []int
	}{
		{"999", []int{21, 20}},      // Integer with no corresponding row.
		{"Trip", []int{7, 3, 2, 1}}, // Non-integer text and existing read policy.
		{"#00843", []int{843}},      // ID normalizes zeros; word matching retains them.
	} {
		ctx.QueryParams.Set("search", tc.term)
		ids, count := orderedIDPage(t, ctx)
		if !reflect.DeepEqual(ids, tc.want) || count != len(tc.want) {
			t.Fatalf("%q ids=%v count=%d, want %v", tc.term, ids, count, tc.want)
		}
	}
	ctx.QueryParams = url.Values{"search": {"843"}, "sort_column": {"id"}, "sort_order": {"ASC"}}
	ids, count := orderedIDPage(t, ctx)
	if !reflect.DeepEqual(ids, []int{843, 9, 10, 11}) || count != 4 {
		t.Fatalf("ID priority ahead of explicit user order: %v count=%d", ids, count)
	}
	for _, params := range []url.Values{
		{"search": {"#843"}, "status": {"closed"}},
		{"search": {"#843"}, "status_exclude": {"open"}},
	} {
		ctx.QueryParams = params
		ids, count := orderedIDPage(t, ctx)
		if !reflect.DeepEqual(ids, []int{11}) || count != 1 {
			t.Fatalf("ID bypassed column filters: %v count=%d", ids, count)
		}
	}
	ctx.QueryParams = url.Values{"search": {"#843"}, "row_group": {"boat"}}
	if ids, count := orderedIDPage(t, ctx); len(ids) != 0 || count != 0 {
		t.Fatalf("ID bypassed row-group filter: %v count=%d", ids, count)
	}

	if _, err := owner.Exec(`INSERT INTO system_row_access_rules
		(table_uid,action_id,row_id,user_id,effect) VALUES (103,1,843,1,'deny')`); err != nil {
		t.Fatal(err)
	}
	ctx.QueryParams = url.Values{"search": {"#843"}}
	ids, count = orderedIDPage(t, ctx)
	if !reflect.DeepEqual(ids, []int{10, 9, 11}) || count != 3 {
		t.Fatalf("denied ID surfaced or changed count: %v count=%d", ids, count)
	}
	authorization := intelligentSearchAuthorization{userRole: "guest", userID: 1, readPolicy: ctx.ReadPolicy}
	hits, err := fetchFullTextRows(reader, "wl103_rows", "#843", authorization)
	if err != nil || len(hits) != 3 {
		t.Fatalf("assisted denied ID candidates=%v error=%v", hits, err)
	}
	for _, hit := range hits {
		if hit.RowID == 843 {
			t.Fatal("assisted search surfaced the denied ID")
		}
	}
}

// assertIDSearchSortedPages checks each page against the complete active order,
// including the terminal empty page, rather than sorting IDs after retrieval.
func assertIDSearchSortedPages(t *testing.T, ctx QueryBuilderContext, want []int) {
	t.Helper()
	ids, count := orderedIDPage(t, ctx)
	if !reflect.DeepEqual(ids, want) || count != len(want) {
		t.Fatalf("ids=%v count=%d, want %v / %d", ids, count, want, len(want))
	}
	ctx.ResultsPerLoad = 2
	paged := []int{}
	for offset := 0; offset <= len(want)+1; offset += ctx.ResultsPerLoad {
		ctx.Offset = offset
		page, pageCount := orderedIDPage(t, ctx)
		start, end := min(offset, len(want)), min(offset+ctx.ResultsPerLoad, len(want))
		if pageCount != len(want) || !reflect.DeepEqual(page, want[start:end]) {
			t.Fatalf("offset=%d ids=%v count=%d, want %v / %d", offset, page, pageCount, want[start:end], len(want))
		}
		paged = append(paged, page...)
	}
	if !reflect.DeepEqual(paged, want) {
		t.Fatalf("pages duplicated or skipped rows: %v, want %v", paged, want)
	}
}

func TestIDSearchUnderActiveSortCountAndPagingPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	if _, err := owner.Exec(`
		ALTER TABLE wl103_rows ADD COLUMN created timestamptz;
		ALTER TABLE wl103_rows ADD COLUMN search_vector_simple tsvector;
		INSERT INTO wl103_rows (id,title,status,created_by,published,created) VALUES
		 (843,'unrelated matter','open',4,true,'2026-01-01'),
		 (845,'843','open',4,true,'2026-01-03'),
		 (9,'843 843','open',4,true,'2026-01-02'),
		 (10,'843 843 843','open',4,true,'2026-01-04'),
		 (11,'843','closed',4,true,'2026-01-03');
		UPDATE wl103_rows SET search_vector_simple = to_tsvector('simple',title);
	`); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, reader, "wl103_rows", "guest", 1, nil)
	ctx.ColumnsMap[3] = dtt_models.ColumnInfo{ColumnName: "created", DataType: "timestamp with time zone"}
	ctx.ColumnDataTypes["created"] = "timestamp with time zone"
	sorts := []struct {
		name, column, direction string
		want, textOnly          []int
	}{
		{"relevance", "", "", []int{843, 10, 9, 845, 11}, []int{10, 9, 845, 11}},
		{"created_desc", "created", "DESC", []int{843, 10, 845, 11, 9}, []int{10, 845, 11, 9}},
		{"id_desc", "id", "DESC", []int{843, 845, 11, 10, 9}, []int{845, 11, 10, 9}},
		{"id_asc", "id", "ASC", []int{843, 9, 10, 11, 845}, []int{9, 10, 11, 845}},
		{"default_newest", semanticNewestSortColumn, "DESC", []int{843, 10, 845, 11, 9}, []int{10, 845, 11, 9}},
	}
	for _, tc := range sorts {
		t.Run(tc.name, func(t *testing.T) {
			ctx.QueryParams = url.Values{"sort_column": {tc.column}, "sort_order": {tc.direction}}
			for _, term := range []string{"843", "#843", " 843 "} {
				ctx.QueryParams.Set("search", term)
				assertIDSearchSortedPages(t, ctx, tc.want)
			}
			// A multiword term is text only: no ID inclusion or priority.
			ctx.QueryParams.Set("search", "843 843")
			assertIDSearchSortedPages(t, ctx, tc.textOnly)
			ctx.QueryParams.Set("search", "843")
			ctx.QueryParams.Set("status", "closed")
			assertIDSearchSortedPages(t, ctx, []int{11})
		})
	}
	if _, err := owner.Exec(`INSERT INTO system_row_access_rules
		(table_uid,action_id,row_id,user_id,effect) VALUES (103,1,843,1,'deny')`); err != nil {
		t.Fatal(err)
	}
	for _, tc := range sorts {
		t.Run(tc.name+"_denied", func(t *testing.T) {
			ctx.QueryParams = url.Values{"search": {"#843"}, "sort_column": {tc.column}, "sort_order": {tc.direction}}
			assertIDSearchSortedPages(t, ctx, tc.textOnly)
		})
	}
}

func TestIDSearchPilotHiddenRowDoesNotChangeCountPostgres(t *testing.T) {
	owner, reader := rowGroupPostgres(t)
	if _, err := owner.Exec(`UPDATE app_service_catalog SET title='1 3' WHERE id=169`); err != nil {
		t.Fatal(err)
	}
	tx, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	if err := dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(8, "basic")); err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, tx, rlsPilotTableName, "basic", 8, url.Values{"search": {"#3"}})
	ids, count := orderedIDPage(t, ctx)
	if !reflect.DeepEqual(ids, []int{169}) || count != 1 {
		t.Fatalf("RLS/policy-hidden ID surfaced: %v count=%d", ids, count)
	}
	authorization := intelligentSearchAuthorization{userRole: "basic", userID: 8, readPolicy: ctx.ReadPolicy}
	hits, err := fetchFullTextRows(tx, rlsPilotTableName, "#3", authorization)
	if err != nil || len(hits) != 1 || hits[0].RowID != 169 {
		t.Fatalf("assisted RLS/policy-hidden ID surfaced: %v error=%v", hits, err)
	}
}

func TestIDSearchRequiresAnIntegerPrimaryKeyPostgres(t *testing.T) {
	db := relevanceDB(t)
	if _, err := db.Exec(`
		CREATE TABLE small_ids (id smallint PRIMARY KEY, title text);
		CREATE TABLE big_ids (id bigint PRIMARY KEY, title text);
		CREATE TABLE text_ids (id text PRIMARY KEY, title text);
		CREATE TABLE uuid_ids (id uuid PRIMARY KEY, title text);
		CREATE TABLE decimal_ids (id numeric PRIMARY KEY, title text);
		CREATE TABLE non_key_ids (id integer UNIQUE, title text);
		CREATE TABLE composite_ids (id integer, title text, PRIMARY KEY(id,title));
		CREATE TABLE no_ids (title text);
		INSERT INTO small_ids VALUES (1,'9223372036854775807');
	`); err != nil {
		t.Fatal(err)
	}
	for table, eligible := range map[string]bool{
		"tasks": true, "small_ids": true, "big_ids": true, "text_ids": false,
		"uuid_ids": false, "decimal_ids": false, "non_key_ids": false, "composite_ids": false, "no_ids": false,
	} {
		id, err := dtt_search_vectors.DatasetIDSearch(db, table, "#843")
		if err != nil || id.Enabled != eligible || id.ID != 843 {
			t.Fatalf("%s ID capability=%+v err=%v", table, id, err)
		}
		where, args, search, err := appendDatasetTextSearchToWhereClause(db,
			url.Values{"search": {"843"}}, table, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		rows, err := db.Query(fmt.Sprintf("SELECT title FROM %s%s%s", table, where, search.OrderBy), args...)
		if err != nil {
			t.Fatalf("%s numeric search failed: %v", table, err)
		}
		_ = rows.Close()
	}
	// A valid bigint outside a smallint key's range remains a text search.
	where, args, search, err := appendDatasetTextSearchToWhereClause(db,
		url.Values{"search": {"9223372036854775807"}}, "small_ids", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query("SELECT id FROM small_ids"+where+search.OrderBy, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatal("out-of-range ID lost its ordinary text match")
	}
}
