// column_multilingual_test.go
// Verifies multilingual column metadata updates use canonical, dataset-scoped identifiers.
// Bridges the admin API payload with the system_column_details update boundary.
// Exists to prevent legacy id=0 metadata rows from blocking supported API maintenance.
package system_table_tools

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type columnMultilingualResult struct {
	rows int64
	err  error
}

func (result columnMultilingualResult) LastInsertId() (int64, error) { return 0, nil }
func (result columnMultilingualResult) RowsAffected() (int64, error) {
	return result.rows, result.err
}

type columnMultilingualUpdaterStub struct {
	query string
	args  []interface{}
	rows  int64
	err   error
}

func (stub *columnMultilingualUpdaterStub) Exec(query string, args ...interface{}) (sql.Result, error) {
	stub.query = query
	stub.args = append([]interface{}{}, args...)
	if stub.err != nil {
		return nil, stub.err
	}
	return columnMultilingualResult{rows: stub.rows}, nil
}

func TestUpdateColumnMultilingualUsesCanonicalDatasetScopedColumnUID(t *testing.T) {
	stub := &columnMultilingualUpdaterStub{rows: 1}

	if err := updateColumnMultilingual(stub, "travel_deals", 526, true); err != nil {
		t.Fatalf("updateColumnMultilingual() error = %v", err)
	}
	for _, contract := range []string{
		"details.column_uid = $2",
		"tables.schema_name = 'public'",
		"tables.table_name = $3",
	} {
		if !strings.Contains(stub.query, contract) {
			t.Fatalf("update query missing %q", contract)
		}
	}
	if len(stub.args) != 3 || stub.args[0] != true || stub.args[1] != int64(526) || stub.args[2] != "travel_deals" {
		t.Fatalf("update args = %#v, want [true 526 travel_deals]", stub.args)
	}
}

func TestUpdateColumnMultilingualRejectsMissingAndAmbiguousMetadata(t *testing.T) {
	for _, testCase := range []struct {
		name string
		rows int64
		want error
	}{
		{name: "missing", rows: 0, want: errColumnMultilingualMetadataNotFound},
		{name: "ambiguous", rows: 2},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := updateColumnMultilingual(
				&columnMultilingualUpdaterStub{rows: testCase.rows},
				"travel_deals",
				526,
				true,
			)
			if err == nil {
				t.Fatal("expected update error")
			}
			if testCase.want != nil && !errors.Is(err, testCase.want) {
				t.Fatalf("error = %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestUpdateColumnMultilingualHandlerValidatesMethodBodyAndTransaction(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
	}{
		{name: "method", method: http.MethodGet, body: "{}", wantStatus: http.StatusMethodNotAllowed},
		{name: "malformed", method: http.MethodPost, body: "{", wantStatus: http.StatusBadRequest},
		{name: "missing dataset", method: http.MethodPost, body: `{"column_uid":526,"is_multilingual":true}`, wantStatus: http.StatusBadRequest},
		{name: "nonpositive uid", method: http.MethodPost, body: `{"dataset":"travel_deals","column_uid":0,"is_multilingual":true}`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction", method: http.MethodPost, body: `{"dataset":"travel_deals","column_uid":526,"is_multilingual":true}`, wantStatus: http.StatusInternalServerError},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			req := httptest.NewRequest(testCase.method, "/api/admin/column-multilingual", strings.NewReader(testCase.body))
			rec := httptest.NewRecorder()

			UpdateColumnMultilingualHandler(rec, req)

			if rec.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, testCase.wantStatus, rec.Body.String())
			}
		})
	}
}
