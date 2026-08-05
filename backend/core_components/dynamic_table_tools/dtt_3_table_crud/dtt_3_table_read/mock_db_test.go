// mock_db_test.go
// Minimal database/sql mock driver for unit tests.
// Uses a global FIFO queue so tests can preload query responses without an actual database connection.
// Adapted from dtt_1_row_create/mock_db_test.go.
package dtt_3_table_read

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
)

// ── Driver registration ──────────────────────────────────────────────────────

func init() {
	sql.Register("table-read-test", &queueDriver{})
}

// newTestDB opens a *sql.DB backed by the queue driver.
func newTestDB(t interface{ Fatal(...interface{}) }) *sql.DB {
	db, err := sql.Open("table-read-test", "")
	if err != nil {
		t.Fatal("newTestDB:", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

// ── Queue state ──────────────────────────────────────────────────────────────

var qMu sync.Mutex

type queuedQuery struct {
	cols []string
	rows [][]driver.Value
	err  error
}

var queryQueue []queuedQuery

func pushQuery(q queuedQuery) {
	qMu.Lock()
	queryQueue = append(queryQueue, q)
	qMu.Unlock()
}

func resetQueues() {
	qMu.Lock()
	queryQueue = nil
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

type queueTx struct{}

func (t *queueTx) Commit() error   { return nil }
func (t *queueTx) Rollback() error { return nil }

type queueStmt struct{}

func (s *queueStmt) Close() error  { return nil }
func (s *queueStmt) NumInput() int { return -1 }

func (s *queueStmt) Exec(args []driver.Value) (driver.Result, error) {
	return nil, errors.New("mock: exec not supported in this test package")
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
