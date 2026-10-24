// get_results_limit_test.go
// Proves preview row bounds before the handler touches sessions or the database.
// Connects parsing failures to HTTP refusals and valid values to a capped SQL page.
// Existing callers without a limit retain their configured results-per-load.
package dtt_1_row_read

import (
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestResultsLimitIsAControlAndQualifiedLimitRemainsAField(t *testing.T) {
	columns := map[string]dtt_models.ColumnInfo{"limit": {ColumnName: "limit", DataType: "integer"}}
	types := map[string]interface{}{"limit": map[string]interface{}{"data_type": "integer"}}
	for _, tc := range []struct{ parameter, want string }{
		{"limit", ""}, {"app_example_limit", ` WHERE ("app_example"."limit" = $1)`},
	} {
		where, args, err := buildWhereClause(url.Values{tc.parameter: {"3"}}, "app_example", columns, nil, types)
		if err != nil || where != tc.want || (tc.want == "" && len(args) != 0) {
			t.Fatalf("%s: got %q, %v, %v; want %q", tc.parameter, where, args, err, tc.want)
		}
	}
}

func TestParseResultsLimit(t *testing.T) {
	for _, tc := range []struct {
		query   string
		want    int
		invalid bool
	}{
		{"", 0, false}, {"limit=3", 3, false}, {"limit=1", 1, false},
		{"limit=10", 10, false}, {"limit=11", 10, false}, {"limit=999999", 10, false},
		{"limit=", 0, true}, {"limit=0", 0, true}, {"limit=-1", 0, true},
		{"limit=1.5", 0, true}, {"limit=abc", 0, true}, {"limit=%203", 0, true},
		{"limit=%2B3", 0, true}, {"limit=3&limit=4", 0, true},
		{"limit=99999999999999999999999999", 0, true},
	} {
		t.Run(tc.query, func(t *testing.T) {
			params, _ := url.ParseQuery(tc.query)
			got, err := parseResultsLimit(params)
			if got != tc.want || (err != nil) != tc.invalid {
				t.Fatalf("got (%d, %v), want (%d, invalid=%v)", got, err, tc.want, tc.invalid)
			}
		})
	}
}

func TestGetResultsRejectsInvalidLimitBeforeDatabaseRead(t *testing.T) {
	response := httptest.NewRecorder()
	GetResultsHandlerWrapper(response, httptest.NewRequest(http.MethodGet, "/api/get-results?dataset=app_example&limit=0", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", response.Code, response.Body.String())
	}
}
