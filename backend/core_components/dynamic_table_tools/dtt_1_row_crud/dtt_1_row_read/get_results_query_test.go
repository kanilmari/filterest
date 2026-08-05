// get_results_query_test.go
// Verifies buildWhereClause creates the expected SQL for dataset filter params.
// Bridges URL-style query params and the SQL builder with regression coverage for include/exclude filters.
// Exists to lock down the new _exclude behavior without changing existing include handling accidentally.
package dtt_1_row_read

import (
	"net/url"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestBuildWhereClauseBuildsInClauseForCommaSeparatedValues(t *testing.T) {
	queryParams := url.Values{
		"status": {"Done,Archived"},
	}

	where, args, err := buildWhereClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
		testColumnDataTypes(),
	)
	if err != nil {
		t.Fatalf("buildWhereClause returned error: %v", err)
	}

	if where != ` WHERE "tasks"."status" IN ($1, $2)` {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 2 || args[0] != "Done" || args[1] != "Archived" {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestBuildWhereClauseBuildsNotInClauseForExcludeCommaSeparatedValues(t *testing.T) {
	queryParams := url.Values{
		"tasks_status_exclude": {"Done,Archived"},
	}

	where, args, err := buildWhereClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
		testColumnDataTypes(),
	)
	if err != nil {
		t.Fatalf("buildWhereClause returned error: %v", err)
	}

	if where != ` WHERE "tasks"."status" NOT IN ($1, $2)` {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 2 || args[0] != "Done" || args[1] != "Archived" {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestBuildWhereClauseBuildsNotEqualClauseForSingleExcludeValue(t *testing.T) {
	queryParams := url.Values{
		"status_exclude": {"Done"},
	}

	where, args, err := buildWhereClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
		testColumnDataTypes(),
	)
	if err != nil {
		t.Fatalf("buildWhereClause returned error: %v", err)
	}

	if where != ` WHERE "tasks"."status" <> $1` {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 1 || args[0] != "Done" {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestBuildWhereClauseBuildsTypedNotInClauseForIntegerExcludeValues(t *testing.T) {
	queryParams := url.Values{
		"id_exclude": {"1,2"},
	}

	where, args, err := buildWhereClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
		testColumnDataTypes(),
	)
	if err != nil {
		t.Fatalf("buildWhereClause returned error: %v", err)
	}

	if where != ` WHERE "tasks"."id" NOT IN ($1, $2)` {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 2 || args[0] != 1 || args[1] != 2 {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestBuildOrderByClauseAddsIDTieBreakerForNonIDSorts(t *testing.T) {
	queryParams := url.Values{
		"sort_column": {"created"},
		"sort_order":  {"DESC"},
	}

	orderByClause, err := buildOrderByClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
	)
	if err != nil {
		t.Fatalf("buildOrderByClause returned error: %v", err)
	}

	expected := ` ORDER BY "tasks"."created" DESC, "tasks"."id" DESC`
	if orderByClause != expected {
		t.Fatalf("unexpected order by clause: %s", orderByClause)
	}
}

func TestBuildOrderByClauseDoesNotDuplicateIDSort(t *testing.T) {
	queryParams := url.Values{
		"sort_column": {"id"},
		"sort_order":  {"ASC"},
	}

	orderByClause, err := buildOrderByClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
	)
	if err != nil {
		t.Fatalf("buildOrderByClause returned error: %v", err)
	}

	expected := ` ORDER BY "tasks"."id" ASC`
	if orderByClause != expected {
		t.Fatalf("unexpected order by clause: %s", orderByClause)
	}
}

func TestBuildOrderByClauseIgnoresUnknownSortColumn(t *testing.T) {
	queryParams := url.Values{
		"sort_column": {"missing_column"},
		"sort_order":  {"ASC"},
	}

	orderByClause, err := buildOrderByClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
	)
	if err != nil {
		t.Fatalf("buildOrderByClause returned error: %v", err)
	}
	if orderByClause != "" {
		t.Fatalf("expected empty order by clause for unknown sort column, got: %s", orderByClause)
	}
}

func TestBuildOrderByClausePutsRowsWithImagesFirst(t *testing.T) {
	queryParams := url.Values{
		"sort_column": {imageFirstSortColumn},
		"sort_order":  {"DESC"},
	}
	columns := testColumnsByName()
	columns["cached_image"] = dtt_models.ColumnInfo{
		ColumnName:  "cached_image",
		DataType:    "text",
		CardElement: "image",
		CoNumber:    3,
	}

	orderByClause, err := buildOrderByClause(queryParams, "tasks", columns, map[string]string{})
	if err != nil {
		t.Fatalf("buildOrderByClause returned error: %v", err)
	}

	expected := ` ORDER BY CASE WHEN NULLIF(BTRIM("tasks"."cached_image"::text), '') IS NOT NULL THEN 0 ELSE 1 END ASC, "tasks"."id" DESC`
	if orderByClause != expected {
		t.Fatalf("unexpected image-first order by clause: %s", orderByClause)
	}
}

func TestBuildOrderByClauseUsesNewestIDWhenDatasetHasNoImageColumn(t *testing.T) {
	queryParams := url.Values{
		"sort_column": {imageFirstSortColumn},
		"sort_order":  {"DESC"},
	}

	orderByClause, err := buildOrderByClause(
		queryParams,
		"tasks",
		testColumnsByName(),
		map[string]string{},
	)
	if err != nil {
		t.Fatalf("buildOrderByClause returned error: %v", err)
	}
	if orderByClause != ` ORDER BY "tasks"."id" DESC` {
		t.Fatalf("unexpected image-free order by clause: %s", orderByClause)
	}
}

func testColumnsByName() map[string]dtt_models.ColumnInfo {
	return map[string]dtt_models.ColumnInfo{
		"id": {
			ColumnName: "id",
			DataType:   "integer",
		},
		"created": {
			ColumnName: "created",
			DataType:   "timestamp",
		},
		"status": {
			ColumnName: "status",
			DataType:   "text",
		},
	}
}

func testColumnDataTypes() map[string]interface{} {
	return map[string]interface{}{
		"id": map[string]interface{}{
			"data_type": "integer",
		},
		"created": map[string]interface{}{
			"data_type": "timestamp",
		},
		"status": map[string]interface{}{
			"data_type": "text",
		},
	}
}
