// mock_db_test.go
// Minimal database/sql mock driver for unit tests.
// Uses a global FIFO queue so tests can preload query and exec responses without an actual database connection.
package dtt_1_row_create

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
)

// ── Driver registration ──────────────────────────────────────────────────────

func init() {
	sql.Register("easelect-test", &queueDriver{})
}

// newTestDB opens a *sql.DB backed by the queue driver.
// The returned DB satisfies rowQueryer and queryExecer.
func newTestDB(t interface{ Fatal(...interface{}) }) *sql.DB {
	db, err := sql.Open("easelect-test", "")
	if err != nil {
		t.Fatal("newTestDB:", err)
	}
	// Force exactly one connection so queue ordering is deterministic.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

// ── Queue state ──────────────────────────────────────────────────────────────

var qMu sync.Mutex

// queuedQuery holds a canned QueryRow / Query response.
type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error // returned as query-level error (rare); use empty rows for no-rows
}

// queuedExec holds a canned Exec response.
type queuedExec struct {
	err          error
	rowsAffected int64
}

var (
	queryQueue []queuedQuery
	execQueue  []queuedExec
)

// pushQuery enqueues one query response (FIFO).
func pushQuery(q queuedQuery) {
	qMu.Lock()
	queryQueue = append(queryQueue, q)
	qMu.Unlock()
}

// pushExec enqueues one exec response (FIFO).
func pushExec(e queuedExec) {
	qMu.Lock()
	execQueue = append(execQueue, e)
	qMu.Unlock()
}

// resetQueues empties both queues (call in t.Cleanup or test start).
func resetQueues() {
	qMu.Lock()
	queryQueue = nil
	execQueue = nil
	qMu.Unlock()
}

func popQuery() (queuedQuery, bool) {
	qMu.Lock()
	defer qMu.Unlock()
	if len(queryQueue) == 0 {
		return queuedQuery{}, false
	}
	q := queryQueue[0]
	queryQueue = queryQueue[1:]
	return q, true
}

func popExec() (queuedExec, bool) {
	qMu.Lock()
	defer qMu.Unlock()
	if len(execQueue) == 0 {
		return queuedExec{}, false
	}
	e := execQueue[0]
	execQueue = execQueue[1:]
	return e, true
}

// ── Driver implementation ────────────────────────────────────────────────────

type queueDriver struct{}

func (d *queueDriver) Open(name string) (driver.Conn, error) {
	return &queueConn{}, nil
}

type queueConn struct{}

func (c *queueConn) Prepare(query string) (driver.Stmt, error) {
	return &queueStmt{}, nil
}

func (c *queueConn) Close() error { return nil }

func (c *queueConn) Begin() (driver.Tx, error) {
	return &queueTx{}, nil
}

// queueTx is a no-op transaction for the mock driver.
type queueTx struct{}

func (t *queueTx) Commit() error   { return nil }
func (t *queueTx) Rollback() error { return nil }

// queueStmt dispatches to the queue on Query vs Exec.
type queueStmt struct{}

func (s *queueStmt) Close() error    { return nil }
func (s *queueStmt) NumInput() int   { return -1 }

func (s *queueStmt) Exec(args []driver.Value) (driver.Result, error) {
	e, ok := popExec()
	if !ok {
		return nil, errors.New("mock: unexpected Exec call (exec queue empty)")
	}
	if e.err != nil {
		return nil, e.err
	}
	return &queueResult{rowsAffected: e.rowsAffected}, nil
}

func (s *queueStmt) Query(args []driver.Value) (driver.Rows, error) {
	q, ok := popQuery()
	if !ok {
		return nil, errors.New("mock: unexpected Query call (query queue empty)")
	}
	if q.err != nil {
		return nil, q.err
	}
	return &queueRows{cols: q.cols, data: q.rows}, nil
}

// queueRows implements driver.Rows.
type queueRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

func (r *queueRows) Columns() []string { return r.cols }
func (r *queueRows) Close() error      { return nil }

func (r *queueRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.idx])
	r.idx++
	return nil
}

// queueResult implements driver.Result.
type queueResult struct {
	rowsAffected int64
}

func (r *queueResult) LastInsertId() (int64, error) { return 0, nil }
func (r *queueResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }
