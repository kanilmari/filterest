// column_insertable_test.go
// Verifies add-row insertability updates use canonical, dataset-scoped column identities.
// Bridges the admin API payload with atomic system_column_details readback.
// Exists to prevent legacy id=0 metadata rows from hiding or changing unrelated fields.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type columnInsertableRowStub struct {
	columnName     string
	insertable     bool
	isMultilingual bool
	hideEverywhere bool
	err            error
}

func (row columnInsertableRowStub) Scan(dest ...interface{}) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != 4 {
		return errors.New("unexpected insertable readback destination count")
	}
	*(dest[0].(*string)) = row.columnName
	*(dest[1].(*bool)) = row.insertable
	*(dest[2].(*bool)) = row.isMultilingual
	*(dest[3].(*bool)) = row.hideEverywhere
	return nil
}

type columnInsertableQueryerStub struct {
	query string
	args  []interface{}
	row   columnInsertableRowStub
}

func (stub *columnInsertableQueryerStub) QueryRowContext(
	_ context.Context,
	query string,
	args ...interface{},
) columnInsertableRow {
	stub.query = query
	stub.args = append([]interface{}{}, args...)
	return stub.row
}

func TestUpdateColumnInsertableUsesCanonicalDatasetScopedColumnUID(t *testing.T) {
	stub := &columnInsertableQueryerStub{row: columnInsertableRowStub{
		columnName:     "description",
		insertable:     true,
		isMultilingual: true,
	}}

	metadata, err := updateColumnInsertable(
		context.Background(),
		stub,
		"travel_deals",
		473,
		true,
	)
	if err != nil {
		t.Fatalf("updateColumnInsertable() error = %v", err)
	}
	for _, contract := range []string{
		"details.column_uid = $2",
		"tables.table_uid = details.table_uid",
		"tables.schema_name = 'public'",
		"tables.table_name = $3",
		"RETURNING",
	} {
		if !strings.Contains(stub.query, contract) {
			t.Fatalf("update query missing %q", contract)
		}
	}
	if strings.Contains(stub.query, "details.id") {
		t.Fatal("insertability update must never use the legacy metadata id")
	}
	for _, untouchedSetting := range []string{"is_multilingual =", "hide_everywhere ="} {
		if strings.Contains(stub.query, untouchedSetting) {
			t.Fatalf("insertability update must not change %s", untouchedSetting)
		}
	}
	if len(stub.args) != 3 || stub.args[0] != true || stub.args[1] != int64(473) || stub.args[2] != "travel_deals" {
		t.Fatalf("update args = %#v, want [true 473 travel_deals]", stub.args)
	}
	if metadata.ColumnName != "description" || !metadata.Insertable || !metadata.IsMultilingual || metadata.HideEverywhere {
		t.Fatalf("metadata readback = %#v, want visible multilingual description", metadata)
	}
}

func TestUpdateColumnInsertableRejectsMissingAndMismatchedReadback(t *testing.T) {
	tests := []struct {
		name string
		row  columnInsertableRowStub
		want error
	}{
		{name: "missing", row: columnInsertableRowStub{err: sql.ErrNoRows}, want: errColumnInsertableMetadataNotFound},
		{name: "mismatched", row: columnInsertableRowStub{columnName: "description", insertable: false}},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := updateColumnInsertable(
				context.Background(),
				&columnInsertableQueryerStub{row: testCase.row},
				"travel_deals",
				473,
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

func TestUpdateColumnInsertableHandlerValidatesMethodBodyAndTransaction(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		body       string
		wantStatus int
	}{
		{name: "method", method: http.MethodGet, body: "{}", wantStatus: http.StatusMethodNotAllowed},
		{name: "malformed", method: http.MethodPost, body: "{", wantStatus: http.StatusBadRequest},
		{name: "missing dataset", method: http.MethodPost, body: `{"column_uid":473,"insertable":true}`, wantStatus: http.StatusBadRequest},
		{name: "nonpositive uid", method: http.MethodPost, body: `{"dataset":"travel_deals","column_uid":0,"insertable":true}`, wantStatus: http.StatusBadRequest},
		{name: "missing value", method: http.MethodPost, body: `{"dataset":"travel_deals","column_uid":473}`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction", method: http.MethodPost, body: `{"dataset":"travel_deals","column_uid":473,"insertable":true}`, wantStatus: http.StatusInternalServerError},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			req := httptest.NewRequest(testCase.method, "/api/admin/column-insertable", strings.NewReader(testCase.body))
			rec := httptest.NewRecorder()

			UpdateColumnInsertableHandler(rec, req)

			if rec.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, testCase.wantStatus, rec.Body.String())
			}
		})
	}
}
