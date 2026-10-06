// database_phase_connector.go
// Admits SQL work lazily, including legacy pooled reads without request contexts.
// Rows release on close; transactions release after commit/rollback, never mid-write.
// Startup enables this connector only after its exclusive required work finishes.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"reflect"
)

type phaseConnector struct {
	driver.Connector
	lifecycle func() *sql.DB
	enabled   func() bool
}

// DatabasePhaseConnector wraps work pools, never the dedicated lifecycle pool.
// The disabled startup path avoids reacquiring behind our own exclusive lock.
func DatabasePhaseConnector(c driver.Connector, lifecycle func() *sql.DB, enabled func() bool) driver.Connector {
	return &phaseConnector{c, lifecycle, enabled}
}
func (c *phaseConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &phaseConn{Conn: conn, config: c}, nil
}

type phaseConn struct {
	driver.Conn
	config        *phaseConnector
	inTx          bool
	lifecycleHeld bool
}

func (c *phaseConn) admit(ctx context.Context) (func() error, error) {
	if c.inTx || !c.config.enabled() {
		return func() error { return nil }, nil
	}
	_, release, err := AcquireRequestBarrier(ctx, c.config.lifecycle())
	return release, err
}
func (c *phaseConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (result driver.Result, err error) {
	// Transactions already admitted by this connector must not acquire a
	// second lifecycle lock behind a writer waiting for their first lease.
	if c.inTx && c.lifecycleHeld && query == `SELECT pg_advisory_xact_lock_shared(hashtext($1))` && len(args) == 1 && args[0].Value == lifecycleLock {
		return driver.RowsAffected(1), nil
	}
	q, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	release, err := c.admit(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if e := release(); err == nil {
			err = e
		}
	}()
	return q.ExecContext(ctx, query, args)
}
func (c *phaseConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	q, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	release, err := c.admit(ctx)
	if err != nil {
		return nil, err
	}
	transferred := false
	defer func() {
		if !transferred {
			_ = release()
		}
	}()
	rows, err := q.QueryContext(ctx, query, args)
	if err != nil {
		return nil, err
	}
	transferred = true
	return &phaseRows{Rows: rows, release: release}, nil
}
func (c *phaseConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}
func (c *phaseConn) PrepareContext(ctx context.Context, query string) (stmt driver.Stmt, err error) {
	release, err := c.admit(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if e := release(); err == nil {
			err = e
		}
	}()
	if p, ok := c.Conn.(driver.ConnPrepareContext); ok {
		stmt, err = p.PrepareContext(ctx, query)
	} else {
		stmt, err = c.Conn.Prepare(query)
	}
	if err != nil {
		return nil, err
	}
	return &phaseStmt{Stmt: stmt, conn: c}, nil
}
func (c *phaseConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}
func (c *phaseConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	release, err := c.admit(ctx)
	if err != nil {
		return nil, err
	}
	transferred := false
	defer func() {
		if !transferred {
			_ = release()
		}
	}()
	var tx driver.Tx
	if b, ok := c.Conn.(driver.ConnBeginTx); ok {
		tx, err = b.BeginTx(ctx, opts)
	} else if opts.ReadOnly || opts.Isolation != 0 {
		err = fmt.Errorf("database driver does not support transaction options")
	} else {
		tx, err = c.Conn.Begin()
	}
	if err != nil {
		return nil, err
	}
	c.inTx = true
	c.lifecycleHeld = c.config.enabled() || requestBarrierHeld(ctx)
	transferred = true
	return &phaseTx{Tx: tx, conn: c, release: release}, nil
}
func (c *phaseConn) Ping(ctx context.Context) error {
	if p, ok := c.Conn.(driver.Pinger); ok {
		return p.Ping(ctx)
	}
	return nil
}
func (c *phaseConn) ResetSession(ctx context.Context) error {
	if r, ok := c.Conn.(driver.SessionResetter); ok {
		return r.ResetSession(ctx)
	}
	return nil
}
func (c *phaseConn) IsValid() bool {
	if v, ok := c.Conn.(driver.Validator); ok {
		return v.IsValid()
	}
	return true
}

type phaseTx struct {
	driver.Tx
	conn    *phaseConn
	release func() error
}

func (t *phaseTx) finish(work func() error) (err error) {
	defer func() {
		t.conn.inTx = false
		t.conn.lifecycleHeld = false
		if e := t.release(); err == nil {
			err = e
		}
	}()
	return work()
}
func (t *phaseTx) Commit() error   { return t.finish(t.Tx.Commit) }
func (t *phaseTx) Rollback() error { return t.finish(t.Tx.Rollback) }

type phaseStmt struct {
	driver.Stmt
	conn *phaseConn
}

func namedValues(args []driver.Value) []driver.NamedValue {
	values := make([]driver.NamedValue, len(args))
	for i, v := range args {
		values[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return values
}
func (s *phaseStmt) Exec(args []driver.Value) (driver.Result, error) {
	return s.ExecContext(context.Background(), namedValues(args))
}
func (s *phaseStmt) Query(args []driver.Value) (driver.Rows, error) {
	return s.QueryContext(context.Background(), namedValues(args))
}
func (s *phaseStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (result driver.Result, err error) {
	release, err := s.conn.admit(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if e := release(); err == nil {
			err = e
		}
	}()
	if e, ok := s.Stmt.(driver.StmtExecContext); ok {
		return e.ExecContext(ctx, args)
	}
	values := make([]driver.Value, len(args))
	for i, v := range args {
		values[i] = v.Value
	}
	return s.Stmt.Exec(values)
}
func (s *phaseStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	release, err := s.conn.admit(ctx)
	if err != nil {
		return nil, err
	}
	transferred := false
	defer func() {
		if !transferred {
			_ = release()
		}
	}()
	var rows driver.Rows
	if q, ok := s.Stmt.(driver.StmtQueryContext); ok {
		rows, err = q.QueryContext(ctx, args)
	} else {
		values := make([]driver.Value, len(args))
		for i, v := range args {
			values[i] = v.Value
		}
		rows, err = s.Stmt.Query(values)
	}
	if err != nil {
		return nil, err
	}
	transferred = true
	return &phaseRows{Rows: rows, release: release}, nil
}

// Forward optional row interfaces: metadata readers need types and queries may
// have several result sets. SQL closes the final set on EOF/cancellation.
type phaseRows struct {
	driver.Rows
	release func() error
}

func (r *phaseRows) Close() (err error) {
	defer func() {
		if r.release != nil {
			if e := r.release(); err == nil {
				err = e
			}
			r.release = nil
		}
	}()
	return r.Rows.Close()
}
func (r *phaseRows) HasNextResultSet() bool {
	q, ok := r.Rows.(driver.RowsNextResultSet)
	return ok && q.HasNextResultSet()
}
func (r *phaseRows) NextResultSet() error {
	if next, ok := r.Rows.(driver.RowsNextResultSet); ok {
		return next.NextResultSet()
	}
	return io.EOF
}
func (r *phaseRows) ColumnTypeScanType(i int) reflect.Type {
	if q, ok := r.Rows.(driver.RowsColumnTypeScanType); ok {
		return q.ColumnTypeScanType(i)
	}
	return reflect.TypeOf(new(any)).Elem()
}
func (r *phaseRows) ColumnTypeDatabaseTypeName(i int) string {
	if q, ok := r.Rows.(driver.RowsColumnTypeDatabaseTypeName); ok {
		return q.ColumnTypeDatabaseTypeName(i)
	}
	return ""
}
func (r *phaseRows) ColumnTypeLength(i int) (int64, bool) {
	if q, ok := r.Rows.(driver.RowsColumnTypeLength); ok {
		return q.ColumnTypeLength(i)
	}
	return 0, false
}
func (r *phaseRows) ColumnTypeNullable(i int) (bool, bool) {
	if q, ok := r.Rows.(driver.RowsColumnTypeNullable); ok {
		return q.ColumnTypeNullable(i)
	}
	return false, false
}
func (r *phaseRows) ColumnTypePrecisionScale(i int) (int64, int64, bool) {
	if q, ok := r.Rows.(driver.RowsColumnTypePrecisionScale); ok {
		return q.ColumnTypePrecisionScale(i)
	}
	return 0, 0, false
}
