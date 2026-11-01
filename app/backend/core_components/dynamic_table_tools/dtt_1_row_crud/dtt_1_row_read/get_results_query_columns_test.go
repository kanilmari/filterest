// get_results_query_columns_test.go
// Proves sort/filter eligibility is the intersection of metadata and SELECT grants.
// Exercises URL filters, canonical FK aliases and the full builder without PostgreSQL.
// Protects silent fallback, parameter offsets and unchanged result projection.
package dtt_1_row_read

import (
	"net/url"
	"reflect"
	"strings"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestQueryColumnsUnreadableFiltersAreIgnored(t *testing.T) {
	columns := testColumnsByName()
	allowed := map[string]bool{"id": true, "created": true}
	for _, key := range []string{"status", "status_from", "status_to", "status_exclude", "status_from_exclude", "status_to_exclude"} {
		for _, prefix := range []string{"", "tasks_"} {
			for _, value := range []string{"Done", "Done,Archived", "!Done"} {
				t.Run(prefix+key+"/"+value, func(t *testing.T) {
					where, args, err := buildWhereClause(url.Values{prefix + key: {value}}, "tasks", columns, nil, testColumnDataTypes(), allowed)
					if err != nil || where != "" || len(args) != 0 {
						t.Fatalf("unreadable filter survived: %s %#v %v", where, args, err)
					}
				})
			}
		}
	}
	// Ignoring forbidden filters must not consume bind indexes for permitted filters.
	where, args, err := buildWhereClause(url.Values{"status": {"Done"}, "id_from": {"3"}}, "tasks", columns, nil, testColumnDataTypes(), allowed, 2)
	if err != nil || where != ` WHERE "tasks"."id" >= $3` || !reflect.DeepEqual(args, []interface{}{"3"}) {
		t.Fatalf("readable range or bind offset changed: %s %#v %v", where, args, err)
	}
}

func TestQueryColumnsUnreadableExactSuffixNamesAreNotRetargeted(t *testing.T) {
	for _, suffix := range []string{"_from", "_to", "_exclude"} {
		columns := map[string]dtt_models.ColumnInfo{"status": {ColumnName: "status"}, "status" + suffix: {ColumnName: "status" + suffix}}
		for _, ending := range []string{"", "_from", "_to", "_exclude"} {
			key := "status" + suffix + ending
			where, args, err := buildWhereClause(url.Values{key: {"sample"}}, "tasks", columns, nil, nil, map[string]bool{"status": true})
			if err != nil || where != "" || len(args) != 0 {
				t.Fatalf("unreadable exact %s was retargeted: %s %#v %v", key, where, args, err)
			}
		}
	}
}

func TestQueryColumnsReadableSortAndFiltersRemainEligible(t *testing.T) {
	columns := testColumnsByName()
	allowed := testReadableColumns(columns)
	for _, tc := range []struct{ key, value, predicate string }{
		{"status", "Done", `"tasks"."status"::text ILIKE $1`},
		{"status_exclude", "Done", `"tasks"."status" <> $1`},
		{"status", "Done,Archived", `"tasks"."status" IN ($1, $2)`},
		{"status_exclude", "Done,Archived", `"tasks"."status" NOT IN ($1, $2)`},
		{"id_from", "2", `"tasks"."id" >= $1`},
		{"id_to", "3", `"tasks"."id" <= $1`},
	} {
		where, args, err := buildWhereClause(url.Values{tc.key: {tc.value}}, "tasks", columns, nil, testColumnDataTypes(), allowed)
		if err != nil || len(args) == 0 || !strings.Contains(where, tc.predicate) {
			t.Fatalf("readable %s lost: %s %#v %v", tc.key, where, args, err)
		}
	}
	order, err := buildOrderByClause(url.Values{"sort_column": {"status"}, "sort_order": {"ASC"}}, "tasks", columns, nil, allowed)
	if err != nil || order != ` ORDER BY "tasks"."status" ASC, "tasks"."id" ASC` {
		t.Fatalf("readable sort lost: %s %v", order, err)
	}
}

func TestQueryColumnsUnreadableSortUsesNewest(t *testing.T) {
	columns := testColumnsByName()
	for _, direction := range []string{"ASC", "DESC", "invalid"} {
		params := url.Values{"sort_column": {"status"}, "sort_order": {direction}}
		allowed := map[string]bool{"id": true, "created": true}
		order, err := buildOrderByClause(params, "tasks", columns, nil, allowed)
		params.Set("sort_column", "unknown")
		fallback, _ := buildOrderByClause(params, "tasks", columns, nil, allowed)
		if err != nil || order != fallback || !strings.Contains(order, `"created"`) {
			t.Fatalf("unreadable sort differs from unknown: %s / %s %v", order, fallback, err)
		}
	}
	// Internal sort modes must not reintroduce denied default/image columns.
	columns["picture"] = dtt_models.ColumnInfo{ColumnName: "picture", CardElement: "image"}
	for _, mode := range []string{"status", semanticNewestSortColumn, imageFirstSortColumn} {
		order, err := buildOrderByClause(url.Values{"sort_column": {mode}}, "tasks", columns, nil, map[string]bool{"id": true})
		if err != nil || !strings.Contains(order, `"id"`) || strings.Contains(order, `"created"`) || strings.Contains(order, `"picture"`) {
			t.Fatalf("default references unreadable columns: %s %v", order, err)
		}
	}
}

func TestQueryColumnsExpressionsRequireReadableSource(t *testing.T) {
	for _, source := range []string{"target_id", "table_uid", "reference"} {
		columns := testColumnsByName()
		columns[source] = dtt_models.ColumnInfo{ColumnName: source}
		alias := generatedForeignNameAlias(source)
		expressions := map[string]string{alias: `"target_alias1"."title"`}
		for _, readable := range []bool{false, true} {
			allowed := map[string]bool{"id": true, "created": true, source: readable, alias: true}
			params := url.Values{"sort_column": {alias}, "sort_order": {"ASC"}, alias: {"Label"}}
			order, err := buildOrderByClause(params, "tasks", columns, expressions, allowed)
			if err != nil || strings.Contains(order, expressions[alias]) != readable || (!readable && !strings.Contains(order, `"created" ASC NULLS LAST`)) {
				t.Fatalf("expression sort source=%s readable=%t: %s %v", source, readable, order, err)
			}
			for _, ending := range []string{"", "_exclude"} {
				where, args, err := buildWhereClause(url.Values{alias + ending: {"Label"}}, "tasks", columns, expressions, nil, allowed)
				if err != nil || strings.Contains(where, expressions[alias]) != readable || (len(args) != 0) != readable {
					t.Fatalf("expression filter source=%s readable=%t: %s %#v %v", source, readable, where, args, err)
				}
			}
		}
	}
}

func TestQueryColumnsMissingReadSetPermitsNoColumnReferences(t *testing.T) {
	columns := testColumnsByName()
	params := url.Values{"sort_column": {"status"}, "status": {"Done"}, "id_from": {"1"}}
	where, args, err := buildWhereClause(params, "tasks", columns, nil, testColumnDataTypes(), nil)
	if err != nil || where != "" || len(args) != 0 {
		t.Fatalf("missing grants allowed a filter: %s %#v %v", where, args, err)
	}
	order, err := buildOrderByClause(params, "tasks", columns, nil, nil)
	if err != nil || order != "" {
		t.Fatalf("missing grants allowed a sort: %s %v", order, err)
	}
}

func TestQueryColumnsContextRestrictsClausesWithoutChangingProjection(t *testing.T) {
	db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
	resetJoinMetadataCacheForTests()
	t.Cleanup(resetJoinMetadataCacheForTests)
	setCachedJoinMetadata("tasks", joinMetadataCacheEntry{tableUID: "42"})
	columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "id"}, 2: {ColumnName: "status"}, 3: {ColumnName: "created"}}
	ctx := QueryBuilderContext{DB: db, TableName: "tasks", ColumnsMap: columns, VisibleColUIDs: []int{1, 2},
		AllowedColumns: map[string]bool{"id": true, "created": true},
		QueryParams:    url.Values{"sort_column": {"status"}, "status": {"Done"}},
		UserRole:       "admin", UserID: 2, ClientRowCount: 2, Offset: 1, ResultsPerLoad: 10}
	query, args, _, _, _, err := BuildSelectQuery(ctx)
	if err != nil || len(args) != 0 || !strings.Contains(query, `"tasks"."status" AS "status"`) ||
		strings.Contains(query, " WHERE ") || !strings.Contains(query, ` ORDER BY "tasks"."created" DESC NULLS LAST`) {
		t.Fatalf("context eligibility changed projection or retained narrowing: %s %#v %v", query, args, err)
	}
}
