// dbutils_test.go
// Regression tests for dbutils transaction-context helpers and column-filter query building.
// Covers the public helper layer between HTTP/request context, database/sql transactions, and metadata column reads so critical CRUD callers keep their shared DB contract stable without changing production code.
package dbutils

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

const dbutilsTestDriverName = "easelect-dbutils-test-driver"

var registerDBUtilsTestDriverOnce sync.Once

type dbutilsDriverState struct {
	beginErr      error
	commitErr     error
	queryErr      error
	execErr       error
	columns       []string
	rows          [][]driver.Value
	lastQuery     string
	lastArgs      []driver.NamedValue
	lastExecQuery string
	lastExecArgs  []driver.NamedValue
	execCalls     int
}

var (
	dbutilsStateMu sync.Mutex
	dbutilsState   dbutilsDriverState
)

type dbutilsTestDriver struct{}

type dbutilsTestConn struct{}

type dbutilsTestTx struct{}

type dbutilsTestRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

func (dbutilsTestDriver) Open(string) (driver.Conn, error) {
	return &dbutilsTestConn{}, nil
}

func (*dbutilsTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("Prepare not implemented in dbutils test driver")
}

func (*dbutilsTestConn) Close() error {
	return nil
}

func (c *dbutilsTestConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (*dbutilsTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	state := snapshotDBUtilsState()
	if state.beginErr != nil {
		return nil, state.beginErr
	}
	return &dbutilsTestTx{}, nil
}

func (*dbutilsTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	dbutilsStateMu.Lock()
	dbutilsState.lastQuery = query
	dbutilsState.lastArgs = append([]driver.NamedValue(nil), args...)
	state := dbutilsState
	dbutilsStateMu.Unlock()

	if state.queryErr != nil {
		return nil, state.queryErr
	}

	return &dbutilsTestRows{
		columns: append([]string(nil), state.columns...),
		rows:    cloneDriverRows(state.rows),
	}, nil
}

func (*dbutilsTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	dbutilsStateMu.Lock()
	dbutilsState.lastExecQuery = query
	dbutilsState.lastExecArgs = append([]driver.NamedValue(nil), args...)
	dbutilsState.execCalls++
	state := dbutilsState
	dbutilsStateMu.Unlock()

	if state.execErr != nil {
		return nil, state.execErr
	}
	return driver.RowsAffected(1), nil
}

func (*dbutilsTestTx) Commit() error {
	return snapshotDBUtilsState().commitErr
}

func (*dbutilsTestTx) Rollback() error {
	return nil
}

func (r *dbutilsTestRows) Columns() []string {
	return append([]string(nil), r.columns...)
}

func (*dbutilsTestRows) Close() error {
	return nil
}

func (r *dbutilsTestRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func registerDBUtilsTestDriver() {
	registerDBUtilsTestDriverOnce.Do(func() {
		sql.Register(dbutilsTestDriverName, dbutilsTestDriver{})
	})
}

func resetDBUtilsState() {
	dbutilsStateMu.Lock()
	defer dbutilsStateMu.Unlock()
	dbutilsState = dbutilsDriverState{}
}

func snapshotDBUtilsState() dbutilsDriverState {
	dbutilsStateMu.Lock()
	defer dbutilsStateMu.Unlock()
	return dbutilsDriverState{
		beginErr:      dbutilsState.beginErr,
		commitErr:     dbutilsState.commitErr,
		queryErr:      dbutilsState.queryErr,
		execErr:       dbutilsState.execErr,
		columns:       append([]string(nil), dbutilsState.columns...),
		rows:          cloneDriverRows(dbutilsState.rows),
		lastQuery:     dbutilsState.lastQuery,
		lastArgs:      append([]driver.NamedValue(nil), dbutilsState.lastArgs...),
		lastExecQuery: dbutilsState.lastExecQuery,
		lastExecArgs:  append([]driver.NamedValue(nil), dbutilsState.lastExecArgs...),
		execCalls:     dbutilsState.execCalls,
	}
}

func configureDBUtilsQuery(columns []string, rows [][]driver.Value, queryErr error) {
	dbutilsStateMu.Lock()
	defer dbutilsStateMu.Unlock()
	dbutilsState.columns = append([]string(nil), columns...)
	dbutilsState.rows = cloneDriverRows(rows)
	dbutilsState.queryErr = queryErr
	dbutilsState.lastQuery = ""
	dbutilsState.lastArgs = nil
	dbutilsState.lastExecQuery = ""
	dbutilsState.lastExecArgs = nil
	dbutilsState.execCalls = 0
}

func openDBUtilsTestDB(t *testing.T, beginErr error) *sql.DB {
	t.Helper()
	registerDBUtilsTestDriver()
	resetDBUtilsState()

	dbutilsStateMu.Lock()
	dbutilsState.beginErr = beginErr
	dbutilsStateMu.Unlock()

	db, err := sql.Open(dbutilsTestDriverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		resetDBUtilsState()
	})
	return db
}

func cloneDriverRows(rows [][]driver.Value) [][]driver.Value {
	cloned := make([][]driver.Value, len(rows))
	for i, row := range rows {
		cloned[i] = append([]driver.Value(nil), row...)
	}
	return cloned
}

func lastDriverArgValues() []driver.Value {
	state := snapshotDBUtilsState()
	values := make([]driver.Value, len(state.lastArgs))
	for i, arg := range state.lastArgs {
		values[i] = arg.Value
	}
	return values
}

func lastDriverExecArgValues() []driver.Value {
	state := snapshotDBUtilsState()
	values := make([]driver.Value, len(state.lastExecArgs))
	for i, arg := range state.lastExecArgs {
		values[i] = arg.Value
	}
	return values
}

func TestGetQueryableColumnsRejectsEmptyTableName(t *testing.T) {
	cols, err := GetQueryableColumns("   ", nil, true)
	if err == nil || !strings.Contains(err.Error(), "empty table name") {
		t.Fatalf("GetQueryableColumns() error = %v, want empty table name error", err)
	}
	if cols != nil {
		t.Fatalf("GetQueryableColumns() cols = %v, want nil on empty table", cols)
	}
}

func TestGetQueryableColumnsTextOnlyUsesPublicSchema(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	configureDBUtilsQuery(
		[]string{"column_name"},
		[][]driver.Value{{"title"}, {"body"}},
		nil,
	)

	cols, err := GetQueryableColumns("articles", db, true)
	if err != nil {
		t.Fatalf("GetQueryableColumns() returned error: %v", err)
	}
	if !reflect.DeepEqual(cols, []string{"title", "body"}) {
		t.Fatalf("GetQueryableColumns() cols = %v, want [title body]", cols)
	}

	state := snapshotDBUtilsState()
	if !strings.Contains(state.lastQuery, "data_type IN ('text','character varying')") {
		t.Fatalf("lastQuery = %q, want text-only query", state.lastQuery)
	}
	if got := lastDriverArgValues(); !reflect.DeepEqual(got, []driver.Value{"articles", "public"}) {
		t.Fatalf("query args = %#v, want table/schema args", got)
	}
}

func TestGetQueryableColumnsUsesQualifiedSchemaAndExclusionQuery(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	configureDBUtilsQuery(
		[]string{"column_name"},
		[][]driver.Value{{"title"}, {"summary"}},
		nil,
	)

	cols, err := GetQueryableColumns("restricted.docs", db, false)
	if err != nil {
		t.Fatalf("GetQueryableColumns() returned error: %v", err)
	}
	if !reflect.DeepEqual(cols, []string{"title", "summary"}) {
		t.Fatalf("GetQueryableColumns() cols = %v, want [title summary]", cols)
	}

	state := snapshotDBUtilsState()
	if !strings.Contains(state.lastQuery, "udt_name <> ALL($3)") {
		t.Fatalf("lastQuery = %q, want exclusion query", state.lastQuery)
	}
	if !strings.Contains(state.lastQuery, "column_name NOT IN ('embedding_vector', 'position')") {
		t.Fatalf("lastQuery = %q, want embedding/position exclusion", state.lastQuery)
	}

	gotArgs := lastDriverArgValues()
	if len(gotArgs) != 3 {
		t.Fatalf("query args len = %d, want 3", len(gotArgs))
	}
	if gotArgs[0] != "docs" || gotArgs[1] != "restricted" {
		t.Fatalf("query args = %#v, want split table/schema", gotArgs)
	}
	if gotArgs[2] == nil {
		t.Fatalf("query args = %#v, want exclusion-array arg in position 3", gotArgs)
	}
}

func TestGetQueryableColumnsPropagatesQueryError(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	configureDBUtilsQuery(nil, nil, errors.New("query failed"))

	cols, err := GetQueryableColumns("articles", db, false)
	if err == nil || !strings.Contains(err.Error(), "query failed") {
		t.Fatalf("GetQueryableColumns() error = %v, want query failure", err)
	}
	if cols != nil {
		t.Fatalf("GetQueryableColumns() cols = %v, want nil on query error", cols)
	}
}

func TestLazyTxCommitAndRollbackAreNoOpsBeforeBegin(t *testing.T) {
	lt := NewLazyTx(nil)

	if lt.WasStarted() {
		t.Fatal("WasStarted() = true before Begin, want false")
	}
	if err := lt.Commit(); err != nil {
		t.Fatalf("Commit() before Begin returned error: %v", err)
	}
	if err := lt.Rollback(); err != nil {
		t.Fatalf("Rollback() before Begin returned error: %v", err)
	}
	if lt.WasStarted() {
		t.Fatal("WasStarted() = true after no-op Commit/Rollback, want false")
	}
}

func TestLazyTxAfterCommitHooksRunOnlyOnSuccessfulCommit(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)

	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}

	callOrder := []string{}
	lt.AddAfterCommitHook(func() {
		callOrder = append(callOrder, "first")
	})
	lt.AddAfterCommitHook(func() {
		callOrder = append(callOrder, "second")
	})

	if err := lt.Commit(); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}

	if !reflect.DeepEqual(callOrder, []string{"first", "second"}) {
		t.Fatalf("after commit hook call order = %#v, want [first second]", callOrder)
	}
}

func TestLazyTxAfterCommitHooksClearedOnRollback(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)

	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}

	called := false
	lt.AddAfterCommitHook(func() {
		called = true
	})
	if err := lt.Rollback(); err != nil {
		t.Fatalf("Rollback() returned error: %v", err)
	}
	if called {
		t.Fatal("after commit hook ran on rollback, want not called")
	}
}

func TestLazyTxAfterRollbackHooksRunOnlyOnRollback(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)

	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}

	called := false
	lt.AddAfterRollbackHook(func() { called = true })
	if err := lt.Rollback(); err != nil {
		t.Fatalf("Rollback() returned error: %v", err)
	}
	if !called {
		t.Fatal("after rollback hook did not run")
	}
}

func TestLazyTxAfterRollbackHooksClearedOnSuccessfulCommit(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)

	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}

	called := false
	lt.AddAfterRollbackHook(func() { called = true })
	if err := lt.Commit(); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}
	if called {
		t.Fatal("after rollback hook ran on successful commit")
	}
}

func TestLazyTxAfterRollbackHooksRunAfterCommitFailure(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	dbutilsStateMu.Lock()
	dbutilsState.commitErr = errors.New("commit failed")
	dbutilsStateMu.Unlock()
	lt := NewLazyTx(db)

	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}

	called := false
	lt.AddAfterRollbackHook(func() { called = true })
	if err := lt.Commit(); err == nil {
		t.Fatal("Commit() error = nil, want simulated failure")
	}
	_ = lt.Rollback()
	if !called {
		t.Fatal("after rollback hook did not run after commit failure")
	}
}

func TestLazyTxBeginStartsOnceAndReusesTransaction(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)

	tx1, err := lt.Begin()
	if err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}
	tx2, err := lt.Begin()
	if err != nil {
		t.Fatalf("second Begin() returned error: %v", err)
	}
	if tx1 != tx2 {
		t.Fatal("Begin() did not reuse the same transaction pointer")
	}
	if !lt.WasStarted() {
		t.Fatal("WasStarted() = false after Begin, want true")
	}
	if err := lt.Rollback(); err != nil {
		t.Fatalf("Rollback() after Begin returned error: %v", err)
	}
}

func TestRequireTxAndGetTxHandleMissingAndFailingLazyTransactions(t *testing.T) {
	if tx, ok := RequireTx(context.Background()); ok || tx != nil {
		t.Fatalf("RequireTx(background) = (%v, %v), want (nil, false)", tx, ok)
	}
	if tx, ok := GetTx(context.Background()); ok || tx != nil {
		t.Fatalf("GetTx(background) = (%v, %v), want (nil, false)", tx, ok)
	}

	db := openDBUtilsTestDB(t, errors.New("begin failed"))
	lt := NewLazyTx(db)
	ctx := SetLazyTx(context.Background(), lt)

	if tx, ok := RequireTx(ctx); ok || tx != nil {
		t.Fatalf("RequireTx(failing lazy tx) = (%v, %v), want (nil, false)", tx, ok)
	}
	if tx, ok := GetTx(ctx); ok || tx != nil {
		t.Fatalf("GetTx(failing lazy tx) = (%v, %v), want (nil, false)", tx, ok)
	}
	if lt.WasStarted() {
		t.Fatal("WasStarted() = true after failed Begin, want false")
	}
}

func TestSetTxAndLazyTxContextHelpersReturnStoredTransaction(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)

	directTx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin() returned error: %v", err)
	}
	directCtx := SetTx(context.Background(), directTx)
	gotDirect, ok := GetTx(directCtx)
	if !ok || gotDirect != directTx {
		t.Fatalf("GetTx(SetTx(...)) = (%v, %v), want direct transaction", gotDirect, ok)
	}
	if err := directTx.Rollback(); err != nil {
		t.Fatalf("directTx.Rollback() returned error: %v", err)
	}

	lt := NewLazyTx(db)
	lazyCtx := SetLazyTx(context.Background(), lt)
	gotLazy, ok := GetTx(lazyCtx)
	if !ok || gotLazy == nil {
		t.Fatalf("GetTx(SetLazyTx(...)) = (%v, %v), want opened lazy transaction", gotLazy, ok)
	}
	gotRequire, ok := RequireTx(lazyCtx)
	if !ok || gotRequire != gotLazy {
		t.Fatalf("RequireTx(SetLazyTx(...)) = (%v, %v), want same transaction pointer", gotRequire, ok)
	}
	if err := lt.Rollback(); err != nil {
		t.Fatalf("lt.Rollback() returned error: %v", err)
	}
}

func TestRequestActorContextDefaultsAndContextHelpers(t *testing.T) {
	guest := NewRequestActorContext(0, "")
	if guest.UserID != 1 || guest.UserRole != "guest" || guest.IsAdmin {
		t.Fatalf("guest actor = %#v, want normalized guest defaults", guest)
	}

	admin := NewRequestActorContext(42, "admin")
	ctx := SetRequestActorContext(context.Background(), admin)
	got, ok := GetRequestActorContext(ctx)
	if !ok || !reflect.DeepEqual(got, admin) {
		t.Fatalf("GetRequestActorContext(...) = (%#v, %v), want (%#v, true)", got, ok, admin)
	}
}

func TestRequestActorContextFromRequestUsesContextOverrideAndBasicFallback(t *testing.T) {
	override := NewRequestActorContext(77, "admin")
	overrideReq := httptest.NewRequest(http.MethodGet, "/api/test", nil).
		WithContext(SetRequestActorContext(context.Background(), override))
	if got := RequestActorContextFromRequest(overrideReq); !reflect.DeepEqual(got, override) {
		t.Fatalf("RequestActorContextFromRequest(overrideReq) = %#v, want %#v", got, override)
	}

	origStore := e_sessions.Store
	origName := e_sessions.SessionName
	testStore := gorillaSessions.NewCookieStore([]byte("dbutils-request-actor-test-secret-32b"))
	testStore.Options = &gorillaSessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		Secure:   false,
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origName
	})

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	sess, err := testStore.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("store.Get() returned error: %v", err)
	}
	sess.Values["user_id"] = 42
	if err := sess.Save(cookieR, cookieW); err != nil {
		t.Fatalf("sess.Save() returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	for _, cookie := range cookieW.Result().Cookies() {
		req.AddCookie(cookie)
	}

	got := RequestActorContextFromRequest(req)
	want := NewRequestActorContext(42, "")
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RequestActorContextFromRequest(req) = %#v, want %#v", got, want)
	}
}

func TestLazyTxBeginHookRunsOnceAndSetsRequestActorConfig(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	actor := NewRequestActorContext(42, "admin")
	lt := NewLazyTxWithBeginHook(db, func(tx *sql.Tx) error {
		return ApplyRequestActorToTx(tx, actor)
	})

	tx1, err := lt.Begin()
	if err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}
	tx2, err := lt.Begin()
	if err != nil {
		t.Fatalf("second Begin() returned error: %v", err)
	}
	if tx1 != tx2 {
		t.Fatal("Begin() did not reuse the same transaction pointer")
	}

	state := snapshotDBUtilsState()
	if state.execCalls != 1 {
		t.Fatalf("execCalls = %d, want 1 begin-hook exec", state.execCalls)
	}
	if !strings.Contains(state.lastExecQuery, "set_config('app.user_id'") {
		t.Fatalf("lastExecQuery = %q, want set_config hook", state.lastExecQuery)
	}

	gotArgs := lastDriverExecArgValues()
	wantArgs := []driver.Value{"42", "admin", "true"}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("lastExecArgs = %#v, want %#v", gotArgs, wantArgs)
	}

	if err := lt.Rollback(); err != nil {
		t.Fatalf("lt.Rollback() returned error: %v", err)
	}
}

func TestRequireTxWithErrorSupportsMissingDirectAndLazyTransactions(t *testing.T) {
	if tx, err := RequireTxWithError(context.Background()); err == nil || tx != nil {
		t.Fatalf("RequireTxWithError(background) = (%v, %v), want missing-context error", tx, err)
	}

	db := openDBUtilsTestDB(t, nil)

	directTx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin() returned error: %v", err)
	}
	directCtx := SetTx(context.Background(), directTx)
	gotDirect, err := RequireTxWithError(directCtx)
	if err != nil || gotDirect != directTx {
		t.Fatalf("RequireTxWithError(SetTx(...)) = (%v, %v), want direct transaction", gotDirect, err)
	}
	if err := directTx.Rollback(); err != nil {
		t.Fatalf("directTx.Rollback() returned error: %v", err)
	}

	lt := NewLazyTx(db)
	lazyCtx := SetLazyTx(context.Background(), lt)
	gotLazy, err := RequireTxWithError(lazyCtx)
	if err != nil || gotLazy == nil {
		t.Fatalf("RequireTxWithError(SetLazyTx(...)) = (%v, %v), want opened lazy transaction", gotLazy, err)
	}
	if err := lt.Rollback(); err != nil {
		t.Fatalf("lt.Rollback() returned error: %v", err)
	}
}

func TestRegisterAfterCommitHookContextHelper(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)
	ctx := SetLazyTx(context.Background(), lt)

	called := false
	if ok := RegisterAfterCommitHook(ctx, func() { called = true }); !ok {
		t.Fatal("RegisterAfterCommitHook() returned false, want true")
	}
	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}
	if err := lt.Commit(); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}
	if !called {
		t.Fatal("after commit hook did not run")
	}

	if ok := RegisterAfterCommitHook(context.Background(), func() {}); ok {
		t.Fatal("RegisterAfterCommitHook(background) = true, want false")
	}
}

func TestRegisterAfterRollbackHookContextHelper(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	lt := NewLazyTx(db)
	ctx := SetLazyTx(context.Background(), lt)

	called := false
	if ok := RegisterAfterRollbackHook(ctx, func() { called = true }); !ok {
		t.Fatal("RegisterAfterRollbackHook() returned false, want true")
	}
	if _, err := lt.Begin(); err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}
	if err := lt.Rollback(); err != nil {
		t.Fatalf("Rollback() returned error: %v", err)
	}
	if !called {
		t.Fatal("after rollback hook did not run")
	}

	if ok := RegisterAfterRollbackHook(context.Background(), func() {}); ok {
		t.Fatal("RegisterAfterRollbackHook(background) = true, want false")
	}
}
