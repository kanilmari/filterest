// intelligent_search_filters_test.go
// Verifies server-authorized filters and error handling shared by both search attempts.
// Exercises existing WHERE semantics with selectable metadata and prefixed request values.
// Protects pre-LIMIT filtering from forbidden-column inference and filter bypass.
package dtt_1_row_read

import (
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSearchFilterRequestRejectsInvalidShapesBeforeAuthentication(t *testing.T) {
	for _, raw := range []string{"[]", "null", "{\"id\":1}", "{\"id\":{\"column\":\"secret\"}}", strings.Repeat("x", 16385)} {
		request := httptest.NewRequest(http.MethodGet, "/?dataset=fixture&query=word&stream=1&filters="+url.QueryEscape(raw), nil)
		response := httptest.NewRecorder()
		GetIntelligentResultsHandlerWrapper(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status=%d, want400", response.Code)
		}
	}
}

func TestSearchFiltersRequireBothSelectableAndDeliveredColumnMetadata(t *testing.T) {
	types := map[string]interface{}{
		"status": map[string]interface{}{"data_type": "text"},
		"secret": map[string]interface{}{"data_type": "text"},
	}
	for _, key := range []string{"secret", "server_only", "status\" OR TRUE --", "user_role", "metadata"} {
		_, _, err := prepareIntelligentSearchFilters("fixture", "en", map[string]string{key: "value"}, []string{"status", "server_only"}, types)
		if !errors.Is(err, errInvalidIntelligentSearchFilters) {
			t.Fatalf("key %q must fail closed", key)
		}
	}
	values, columns, err := prepareIntelligentSearchFilters("fixture", "fi", map[string]string{"fixture_status": "x' OR TRUE --"}, []string{"status"}, types)
	if err != nil {
		t.Fatal(err)
	}
	condition, args, err := buildWhereClause(values, "src", columns, nil, types, 3)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(condition, "OR TRUE") || !strings.Contains(condition, "$4") || len(args) == 0 {
		t.Fatalf("value must remain bound parameter: %s %#v", condition, args)
	}
}

func TestSearchFilterScopePreservesFilterDuringHydration(t *testing.T) {
	auth := intelligentSearchAuthorization{
		userRole: "basic", userID: 42,
		userFilters:   url.Values{"status": {"closed"}},
		filterColumns: map[string]dtt_models.ColumnInfo{"status": {ColumnName: "status", DataType: "text"}},
		filterTypes:   map[string]interface{}{"status": map[string]interface{}{"data_type": "text"}},
	}
	for _, ref := range []string{"src", "fixture"} {
		clause, args, err := appendIntelligentSearchAuthorizationCondition("fixture", ref, auth, []interface{}{"text-query", 42})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(clause, "\""+ref+"\".\"status\"") || !strings.Contains(clause, "$5") || len(args) != 5 || !strings.Contains(clause, "resolve_effective_row_access") {
			t.Fatalf("candidate/hydration filter missing: %s %#v", clause, args)
		}
	}
}

func TestSearchFiltersShareExactColumnAndRangeResolutionWithOrdinaryWhere(t *testing.T) {
	allowed := []string{"valid_from", "valid_to", "ship_to", "status_exclude", "age"}
	types := map[string]interface{}{}
	for _, name := range allowed {
		types[name] = map[string]interface{}{"data_type": "text"}
	}
	for _, tc := range []struct {
		key, column, operator string
	}{
		{"fixture_valid_from", "valid_from", "ILIKE"},
		{"ship_to", "ship_to", "ILIKE"},
		{"status_exclude", "status_exclude", "ILIKE"},
		{"valid_from_from", "valid_from", ">="},
		{"valid_to_from", "valid_to", ">="},
		{"ship_to_to", "ship_to", "<="},
		{"valid_from_exclude", "valid_from", "<>"},
		{"status_exclude_exclude", "status_exclude", "<>"},
		{"age_from", "age", ">="},
		{"age_to", "age", "<="},
	} {
		t.Run(tc.key, func(t *testing.T) {
			values, columns, err := prepareIntelligentSearchFilters("fixture", "en", map[string]string{tc.key: "sample"}, allowed, types)
			if err != nil {
				t.Fatal(err)
			}
			where, args, err := buildWhereClause(values, "src", columns, nil, types, 3)
			target := "\"src\".\"" + tc.column + "\""
			if err != nil || len(args) != 1 || !strings.Contains(where, target) || !strings.Contains(where, tc.operator) || !strings.Contains(where, "$4") {
				t.Fatalf("approved filter was dropped or retargeted: %s %#v %v", where, args, err)
			}
		})
	}
}

func TestSearchFiltersRejectForbiddenExactFieldInsteadOfSuffixFallback(t *testing.T) {
	for _, suffix := range []string{"_from", "_to", "_exclude"} {
		types := map[string]interface{}{
			"secret":          map[string]interface{}{"data_type": "text"},
			"secret" + suffix: map[string]interface{}{"data_type": "text"},
		}
		for _, key := range []string{"secret" + suffix, "fixture_secret" + suffix, "secret" + suffix + "_from", "secret" + suffix + "_exclude"} {
			_, _, err := prepareIntelligentSearchFilters("fixture", "en", map[string]string{key: "hidden"}, []string{"secret"}, types)
			if !errors.Is(err, errInvalidIntelligentSearchFilters) {
				t.Fatalf("forbidden exact metadata key %q must not become an allowed operator", key)
			}
		}
	}
}

func TestSearchFiltersStillRejectDuplicateCanonicalKeys(t *testing.T) {
	types := map[string]interface{}{"valid_from": map[string]interface{}{"data_type": "text"}}
	_, _, err := prepareIntelligentSearchFilters("fixture", "en", map[string]string{"valid_from": "one", "fixture_valid_from": "two"}, []string{"valid_from"}, types)
	if !errors.Is(err, errInvalidIntelligentSearchFilters) {
		t.Fatal("prefixed filter must not override the existing exact field filter")
	}
}
