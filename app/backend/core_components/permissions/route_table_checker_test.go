// route_table_checker_test.go
// Verifies canonical route/table permission query construction.
// Bridges permission helper options, route scopes, and generated SQL placeholders.
// Exists so auth, pipeline, and future tool callers share a stable permission contract.
package permissions

import (
	"strings"
	"testing"
)

func TestNormalizeRouteEndpointsTrimsAndDeduplicates(t *testing.T) {
	got := NormalizeRouteEndpoints([]string{" /api/a ", "", "/api/b", "/api/a", "  "})
	want := []string{"/api/a", "/api/b"}

	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("route[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestBuildRouteTablePermissionQueryUsesTableUIDScope(t *testing.T) {
	query, args := buildRouteTablePermissionQuery(
		"/api/get-results",
		42,
		RouteTableScope{TableUID: "777"},
		DisabledFunctionStrictFalse,
		false,
	)

	if !strings.Contains(query, "f.url_route_endpoint = $1") {
		t.Fatalf("query should check single route placeholder: %s", query)
	}
	if !strings.Contains(query, "ug.user_id = $2") {
		t.Fatalf("query should check user placeholder: %s", query)
	}
	if !strings.Contains(query, "gf.target_table_uid = $3") {
		t.Fatalf("query should check table uid placeholder: %s", query)
	}
	if !strings.Contains(query, "f.disabled = false") {
		t.Fatalf("query should include strict disabled-function predicate: %s", query)
	}

	wantArgs := []interface{}{"/api/get-results", 42, "777"}
	if len(args) != len(wantArgs) {
		t.Fatalf("args len = %d, want %d (%v)", len(args), len(wantArgs), args)
	}
	for i := range wantArgs {
		if args[i] != wantArgs[i] {
			t.Fatalf("arg[%d] = %#v, want %#v", i, args[i], wantArgs[i])
		}
	}
}

func TestBuildRouteTablePermissionQueryUsesBatchRouteAndTableNameScope(t *testing.T) {
	query, args := buildRouteTablePermissionQuery(
		"",
		42,
		RouteTableScope{TableName: "dev_agent_tasks"},
		DisabledFunctionIgnored,
		true,
	)

	if !strings.Contains(query, "SELECT DISTINCT f.url_route_endpoint") {
		t.Fatalf("query should return distinct allowed routes: %s", query)
	}
	if !strings.Contains(query, "f.url_route_endpoint = ANY($1)") {
		t.Fatalf("query should check batch routes through ANY($1): %s", query)
	}
	if !strings.Contains(query, "ug.user_id = $2") {
		t.Fatalf("query should keep user placeholder at $2 for prepended route array: %s", query)
	}
	if !strings.Contains(query, "sdt.table_name = $3") {
		t.Fatalf("query should check table name placeholder at $3: %s", query)
	}
	if strings.Contains(query, "f.disabled") {
		t.Fatalf("ignored disabled policy should not add a disabled predicate: %s", query)
	}

	wantArgs := []interface{}{42, "dev_agent_tasks"}
	if len(args) != len(wantArgs) {
		t.Fatalf("args len = %d, want %d (%v)", len(args), len(wantArgs), args)
	}
	for i := range wantArgs {
		if args[i] != wantArgs[i] {
			t.Fatalf("arg[%d] = %#v, want %#v", i, args[i], wantArgs[i])
		}
	}
}

func TestDisabledClauseCanBeConcatenatedAfterPlaceholder(t *testing.T) {
	query := `SELECT 1 FROM system_functions WHERE url_route_endpoint = $1`
	query += disabledClause(DisabledFunctionFalseOrNull)

	if strings.Contains(query, "$1AND") {
		t.Fatalf("disabled clause must not concatenate into a broken placeholder: %s", query)
	}
	if !strings.Contains(query, "$1 AND (f.disabled = false OR f.disabled IS NULL)") {
		t.Fatalf("query should keep whitespace before disabled predicate: %s", query)
	}
}

func TestBuildFunctionSpecificTableRelatedQuerySeparatesDisabledClause(t *testing.T) {
	query := buildFunctionSpecificTableRelatedQuery(DisabledFunctionFalseOrNull)

	if strings.Contains(query, "f.disabled") {
		t.Fatalf("function metadata query has no f alias and must not use it: %s", query)
	}
	if !strings.Contains(query, "$1 AND (disabled = false OR disabled IS NULL)") {
		t.Fatalf("query should separate route placeholder and disabled predicate: %s", query)
	}
}
