// update_row_test.go
// Unit tests for the dtt_1_row_update package.
// Covers the pure convertValue function exhaustively, the queryer-based helpers via a database/sql driver double, and the handler guard branches via httptest.
package dtt_1_row_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

// ── driver double ──────────────────────────────────────────────────────

type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

type updRowState struct {
	mu      sync.Mutex
	queries []queuedQuery
}

type updRowDriver struct{ state *updRowState }
type updRowConn struct{ state *updRowState }
type updRowTx struct{}
type updRowRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var updRowDriverRegisterMu sync.Mutex

func (d *updRowDriver) Open(string) (driver.Conn, error) {
	return &updRowConn{state: d.state}, nil
}

func (c *updRowConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (c *updRowConn) Close() error              { return nil }
func (c *updRowConn) Begin() (driver.Tx, error) { return &updRowTx{}, nil }
func (c *updRowConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &updRowTx{}, nil
}

func (*updRowTx) Commit() error   { return nil }
func (*updRowTx) Rollback() error { return nil }

func (c *updRowConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "system_db_table_aliases") {
		return nil, &pq.Error{Code: "42P01"}
	}

	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	if len(c.state.queries) == 0 {
		return nil, errors.New("unexpected query")
	}

	next := c.state.queries[0]
	c.state.queries = c.state.queries[1:]
	if next.err != nil {
		return nil, next.err
	}
	rows := make([][]driver.Value, len(next.rows))
	for i, row := range next.rows {
		rows[i] = append([]driver.Value(nil), row...)
	}
	return &updRowRows{
		cols: append([]string(nil), next.cols...),
		rows: rows,
	}, nil
}

func (r *updRowRows) Columns() []string { return r.cols }
func (r *updRowRows) Close() error      { return nil }

func (r *updRowRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}

func openUpdRowTx(t *testing.T, queries []queuedQuery) *sql.Tx {
	t.Helper()
	updRowDriverRegisterMu.Lock()
	defer updRowDriverRegisterMu.Unlock()

	state := &updRowState{queries: append([]queuedQuery(nil), queries...)}
	driverName := fmt.Sprintf("upd_row_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &updRowDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	tx, err := db.Begin()
	if err != nil {
		_ = db.Close()
		t.Fatalf("db.Begin: %v", err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback()
		_ = db.Close()
	})
	return tx
}

// ── convertValue tests ─────────────────────────────────────────────────

func TestConvertValueIntegerFromFloat(t *testing.T) {
	v, err := convertValue(42.0, "integer")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != int64(42) {
		t.Fatalf("v = %v, want 42", v)
	}
}

func TestConvertValueIntegerFromString(t *testing.T) {
	v, err := convertValue("123", "bigint")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != int64(123) {
		t.Fatalf("v = %v, want 123", v)
	}
}

func TestConvertValueIntegerFromEmptyString(t *testing.T) {
	v, err := convertValue("  ", "smallint")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != int64(0) {
		t.Fatalf("v = %v, want 0", v)
	}
}

func TestConvertValueIntegerFromBadString(t *testing.T) {
	_, err := convertValue("abc", "integer")
	if err == nil {
		t.Fatal("expected error for invalid integer string")
	}
}

func TestConvertValueIntegerFromInvalidType(t *testing.T) {
	_, err := convertValue(true, "integer")
	if err == nil {
		t.Fatal("expected error for bool → integer")
	}
}

func TestConvertValueBooleanTrue(t *testing.T) {
	v, err := convertValue(true, "boolean")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != true {
		t.Fatalf("v = %v, want true", v)
	}
}

func TestConvertValueBooleanInvalid(t *testing.T) {
	_, err := convertValue("yes", "boolean")
	if err == nil {
		t.Fatal("expected error for string → boolean")
	}
}

func TestConvertValueText(t *testing.T) {
	v, err := convertValue("hello", "character varying")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "hello" {
		t.Fatalf("v = %v, want hello", v)
	}
}

func TestConvertValueTextType(t *testing.T) {
	v, err := convertValue("world", "text")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "world" {
		t.Fatalf("v = %v, want world", v)
	}
}

func TestConvertValueTextInvalid(t *testing.T) {
	_, err := convertValue(42, "text")
	if err == nil {
		t.Fatal("expected error for int → text")
	}
}

func TestConvertValueTimestampDateOnly(t *testing.T) {
	v, err := convertValue("2026-03-22", "timestamp without time zone")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "2026-03-22 00:00:00" {
		t.Fatalf("v = %v, want wall-clock midnight", v)
	}
}

func TestConvertValueTimestampWithTime(t *testing.T) {
	v, err := convertValue("2026-03-22 14:30:00", "timestamp")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "2026-03-22 14:30:00" {
		t.Fatalf("v = %v, want wall-clock 14:30", v)
	}
}

func TestConvertValueTimestampWithSlashes(t *testing.T) {
	v, err := convertValue("2026/03/22", "date")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "2026-03-22" {
		t.Fatalf("v = %v, want 2026-03-22", v)
	}
}

func TestConvertValueTimestampTFormat(t *testing.T) {
	v, err := convertValue("2026-03-22T14:30", "timestamp")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "2026-03-22 14:30:00" {
		t.Fatalf("v = %v, want wall-clock 14:30", v)
	}
}

func TestConvertValueDateRejectsTimestamp(t *testing.T) {
	_, err := convertValue("2026-03-22 14:30:00", "date")
	if err == nil {
		t.Fatal("expected DATE to reject a timestamp value")
	}
}

func TestConvertValueTimestampWithoutTimeZoneRejectsExplicitOffset(t *testing.T) {
	_, err := convertValue("2026-03-22T14:30:00Z", "timestamp without time zone")
	if err == nil {
		t.Fatal("expected naive timestamp to reject an explicit timezone")
	}
}

func TestConvertValueTimestampWithTimeZonePreservesInstant(t *testing.T) {
	v, err := convertValue("2026-06-14T09:30:00+08:00", "timestamp with time zone")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	instant, ok := v.(time.Time)
	if !ok {
		t.Fatalf("v type = %T, want time.Time", v)
	}
	if got := instant.Format(time.RFC3339); got != "2026-06-14T01:30:00Z" {
		t.Fatalf("instant = %s, want 2026-06-14T01:30:00Z", got)
	}
}

func TestConvertValueTimestampWithTimeZoneRequiresExplicitOffset(t *testing.T) {
	_, err := convertValue("2026-06-14T09:30:00", "timestamp with time zone")
	if err == nil {
		t.Fatal("expected TIMESTAMPTZ to require an explicit offset")
	}
}

func TestConvertValueTimestampInvalid(t *testing.T) {
	_, err := convertValue("not-a-date", "date")
	if err == nil {
		t.Fatal("expected error for invalid date")
	}
}

func TestConvertValueTimestampWrongType(t *testing.T) {
	_, err := convertValue(42, "timestamp")
	if err == nil {
		t.Fatal("expected error for int → timestamp")
	}
}

func TestConvertValueNumericFromFloat(t *testing.T) {
	v, err := convertValue(3.14, "numeric")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != 3.14 {
		t.Fatalf("v = %v, want 3.14", v)
	}
}

func TestConvertValueNumericFromString(t *testing.T) {
	v, err := convertValue("2.718", "decimal")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != 2.718 {
		t.Fatalf("v = %v, want 2.718", v)
	}
}

func TestConvertValueNumericFromBadString(t *testing.T) {
	_, err := convertValue("abc", "numeric")
	if err == nil {
		t.Fatal("expected error for invalid numeric string")
	}
}

func TestConvertValueNumericFromInvalidType(t *testing.T) {
	_, err := convertValue(true, "decimal")
	if err == nil {
		t.Fatal("expected error for bool → numeric")
	}
}

func TestConvertValueDefaultPassthrough(t *testing.T) {
	v, err := convertValue("anything", "jsonb")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if v != "anything" {
		t.Fatalf("v = %v, want anything", v)
	}
}

func TestNormalizeUpdateOperationsSupportsLegacySingleColumnPayload(t *testing.T) {
	updates, err := normalizeUpdateOperations(updateRowRequest{
		ID:     7,
		Column: "title",
		Value:  "Customer contract",
	})
	if err != nil {
		t.Fatalf("normalizeUpdateOperations returned error: %v", err)
	}
	if len(updates) != 1 {
		t.Fatalf("len(updates) = %d, want 1", len(updates))
	}
	if updates[0].Column != "title" || updates[0].Value != "Customer contract" {
		t.Fatalf("updates[0] = %#v, want title/customer contract", updates[0])
	}
}

func TestNormalizeUpdateOperationsSupportsBatchPayload(t *testing.T) {
	updates, err := normalizeUpdateOperations(updateRowRequest{
		ID: 7,
		Updates: []updateRowFieldUpdate{
			{Column: "title", Value: "Customer contract"},
			{Column: "description", Value: "Final signed PDF"},
		},
	})
	if err != nil {
		t.Fatalf("normalizeUpdateOperations returned error: %v", err)
	}
	if len(updates) != 2 {
		t.Fatalf("len(updates) = %d, want 2", len(updates))
	}
	if updates[0].Column != "title" || updates[1].Column != "description" {
		t.Fatalf("updates = %#v, want title + description batch", updates)
	}
}

func TestNormalizeUpdateOperationsRejectsMissingColumns(t *testing.T) {
	_, err := normalizeUpdateOperations(updateRowRequest{
		ID: 7,
		Updates: []updateRowFieldUpdate{
			{Column: "   ", Value: "bad"},
		},
	})
	if err == nil {
		t.Fatal("expected error for blank update column")
	}
}

// ── queryer helper tests ───────────────────────────────────────────────

func TestGetTableUIDHappyPath(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}},
	})

	uid, err := getTableUID("users", tx)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if uid != 42 {
		t.Fatalf("uid = %d, want 42", uid)
	}
}

func TestGetTableUIDError(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{err: errors.New("no such table")},
	})

	_, err := getTableUID("missing", tx)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestIsColumnEditableTrue(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{true}}},
	})

	editable, err := isColumnEditable(1, "name", tx)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !editable {
		t.Fatal("editable = false, want true")
	}
}

func TestIsColumnEditableFalse(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{false}}},
	})

	editable, err := isColumnEditable(1, "id", tx)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if editable {
		t.Fatal("editable = true, want false")
	}
}

func TestIsColumnEditableError(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{err: errors.New("boom")},
	})

	_, err := isColumnEditable(1, "col", tx)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestGetColumnDataTypeHappyPath(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"data_type"}, rows: [][]driver.Value{{"integer"}}},
	})

	dt, err := getColumnDataType("users", "age", tx)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if dt != "integer" {
		t.Fatalf("dt = %q, want integer", dt)
	}
}

func TestGetColumnDataTypeError(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{err: errors.New("no column")},
	})

	_, err := getColumnDataType("users", "missing", tx)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestTableHasLangEmbeddingsTrue(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"multi_lang_embeddings"}, rows: [][]driver.Value{{true}}},
	})

	if !tableHasLangEmbeddings("users", tx) {
		t.Fatal("expected true")
	}
}

func TestTableHasLangEmbeddingsFalse(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"multi_lang_embeddings"}, rows: [][]driver.Value{{false}}},
	})

	if tableHasLangEmbeddings("users", tx) {
		t.Fatal("expected false")
	}
}

func TestTableHasLangEmbeddingsErrorReturnsFalse(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{err: errors.New("boom")},
	})

	if tableHasLangEmbeddings("missing", tx) {
		t.Fatal("expected false on error")
	}
}

// ── handler guard tests (httptest) ─────────────────────────────────────

// ensureTestSessionStore initializes a minimal session store for handler tests.
func ensureTestSessionStore(t *testing.T) {
	t.Helper()
	if e_sessions.Store == nil {
		e_sessions.Store = sessions.NewCookieStore([]byte("test-secret-key-32-bytes-long!!"))
	}
}

func TestWrapperMissingDataset(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/update-row", nil)
	rec := httptest.NewRecorder()
	UpdateRowHandlerWrapper(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandlerWrongMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	UpdateRowHandler(rec, req, "users")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestHandlerUnauthorizedNoSession(t *testing.T) {
	ensureTestSessionStore(t)
	body := `{"id": 1, "column": "name", "value": "test"}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	UpdateRowHandler(rec, req, "users")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandlerRejectsPilotNonOwnerBeforeColumnOrUpdateWork(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"id"}, rows: nil},
	})
	req := buildUpdateRowSessionRequestForActor(
		t,
		http.MethodPost,
		"/api/update-row?dataset=app_service_catalog",
		`{"id":41,"column":"header","value":"blocked"}`,
		7,
		"basic",
	)
	req = req.WithContext(dbutils.SetTx(req.Context(), tx))
	rec := httptest.NewRecorder()

	UpdateRowHandler(rec, req, updateRLSPilotTableName)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandlerRejectsDatasetRouteConflictForSystemTableRename(t *testing.T) {
	tx := openUpdRowTx(t, []queuedQuery{
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(5)}}},
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(99)}}},
		{cols: []string{"editable_in_ui"}, rows: [][]driver.Value{{true}}},
		{cols: []string{"data_type"}, rows: [][]driver.Value{{"text"}}},
		{cols: []string{"table_name"}, rows: [][]driver.Value{{"app_demo"}}},
		{cols: []string{"table_uid", "table_name"}, rows: [][]driver.Value{{int64(99), "app_demo"}}},
	})

	req := buildUpdateRowSessionRequest(
		t,
		http.MethodPost,
		"/api/update-row?dataset=system_db_tables",
		`{"id":5,"column":"table_name","value":"service_catalog"}`,
	)
	req = req.WithContext(dbutils.SetTx(req.Context(), tx))
	rec := httptest.NewRecorder()

	UpdateRowHandler(rec, req, "system_db_tables")

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `dataset route segment \"service_catalog\" is already in use`) {
		t.Fatalf("body = %q, want route-conflict message", rec.Body.String())
	}
}

func buildUpdateRowSessionRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	return buildUpdateRowSessionRequestForActor(t, method, target, body, 2, "admin")
}

func buildUpdateRowSessionRequestForActor(t *testing.T, method, target, body string, userID int, userRole string) *http.Request {
	t.Helper()

	origStore := e_sessions.Store
	origName := e_sessions.SessionName
	store := sessions.NewCookieStore([]byte("test-secret-key-32-bytes-long!!"))
	store.Options = &sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true, Secure: false}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origName
	})

	req := httptest.NewRequest(method, target, strings.NewReader(body))
	cookieReq := httptest.NewRequest(method, target, nil)
	cookieRec := httptest.NewRecorder()
	sess, err := store.Get(cookieReq, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	sess.Values["user_id"] = userID
	sess.Values["user_role"] = userRole
	sess.Values["username"] = "editorial_staff"
	if err := sess.Save(cookieReq, cookieRec); err != nil {
		t.Fatalf("sess.Save: %v", err)
	}
	for _, cookie := range cookieRec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	return req
}
