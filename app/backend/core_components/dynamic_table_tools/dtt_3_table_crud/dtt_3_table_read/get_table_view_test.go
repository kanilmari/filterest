// get_table_view_test.go
// Unit tests for GetTableViewHandlerWrapper and GetMetadata.
// Uses the package-local mock driver (mock_db_test.go) to exercise query-only branches without touching production code.
package dtt_3_table_read

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	backend "easelect/backend/core_components"
)

// helper: build GET request with optional dataset query param.
func newReq(t *testing.T, dataset string) *http.Request {
	t.Helper()
	url := "/get-table-view"
	if dataset != "" {
		url += "?dataset=" + dataset
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	return req
}

// ── GetTableViewHandlerWrapper tests ─────────────────────────────────────────

func TestWrapper_MissingDataset_Returns400(t *testing.T) {
	rec := httptest.NewRecorder()
	GetTableViewHandlerWrapper(rec, newReq(t, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if msg, _ := body["error"].(string); msg != "table name is missing" {
		t.Fatalf("unexpected error message: %s", msg)
	}
}

func TestWrapper_DelegatesToGetMetadata(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{
		cols: []string{"name", "default_view_name"},
		rows: [][]driver.Value{
			{"test_table", "default_view"},
		},
	})

	rec := httptest.NewRecorder()
	GetTableViewHandlerWrapper(rec, newReq(t, "test_table"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := body["columns"]; !ok {
		t.Fatal("response missing 'columns' key")
	}
	if _, ok := body["data"]; !ok {
		t.Fatal("response missing 'data' key")
	}
}

// ── GetMetadata tests ────────────────────────────────────────────────────────

func TestGetMetadata_MissingDataset_Returns400(t *testing.T) {
	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestGetMetadata_QueryError_Returns500(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{err: errors.New("connection refused")})

	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, "some_table"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if msg, _ := body["error"].(string); msg != "error fetching table metadata" {
		t.Fatalf("unexpected error message: %q", msg)
	}
}

func TestGetMetadata_HappyPath_JSONEnvelope(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{
		cols: []string{"id", "name", "default_view_name"},
		rows: [][]driver.Value{
			{int64(1), "users", "grid_view"},
		},
	})

	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, "users"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %q", ct)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	cols, ok := body["columns"].([]interface{})
	if !ok {
		t.Fatal("columns is not an array")
	}
	if len(cols) != 3 {
		t.Fatalf("expected 3 columns, got %d", len(cols))
	}

	data, ok := body["data"].([]interface{})
	if !ok {
		t.Fatal("data is not an array")
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 row, got %d", len(data))
	}

	row := data[0].(map[string]interface{})
	if row["name"] != "users" {
		t.Fatalf("expected name=users, got %v", row["name"])
	}
}

func TestGetMetadata_ByteSliceConvertedToString(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{
		cols: []string{"description"},
		rows: [][]driver.Value{
			{[]byte("binary-data-as-string")},
		},
	})

	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, "t"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var body map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &body)
	data := body["data"].([]interface{})
	row := data[0].(map[string]interface{})
	if row["description"] != "binary-data-as-string" {
		t.Fatalf("[]byte not converted to string: got %v (%T)", row["description"], row["description"])
	}
}

func TestGetMetadata_EmptyResult(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{
		cols: []string{"id", "name"},
		rows: [][]driver.Value{}, // no rows
	})

	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, "nonexistent"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &body)
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Fatalf("expected empty data array, got %d rows", len(data))
	}
}

func TestGetMetadata_NilValuePassthrough(t *testing.T) {
	resetQueues()
	t.Cleanup(resetQueues)

	saved := backend.Db
	backend.Db = newTestDB(t)
	t.Cleanup(func() { backend.Db = saved })

	pushQuery(queuedQuery{
		cols: []string{"nullable_col"},
		rows: [][]driver.Value{
			{nil},
		},
	})

	rec := httptest.NewRecorder()
	GetMetadata(rec, newReq(t, "t"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &body)
	data := body["data"].([]interface{})
	row := data[0].(map[string]interface{})
	if row["nullable_col"] != nil {
		t.Fatalf("expected nil for null column, got %v", row["nullable_col"])
	}
}
