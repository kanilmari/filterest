// embedding_drain_test.go
// Proves the background claim joins lifecycle admission before modifying its queue.
// Stub pools distinguish admission sessions from work queries without PostgreSQL.
// Empty-queue polling must release admission before its next pass.
package ai_features

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

type drainDriver struct {
	lifecycle *sql.DB
	t         *testing.T
	claimed   bool
}
type drainConn struct{ state *drainDriver }
type drainRows struct {
	columns  int
	released bool
	done     bool
}

func (d *drainDriver) Connect(context.Context) (driver.Conn, error) { return drainConn{d}, nil }
func (d *drainDriver) Driver() driver.Driver                        { return d }
func (d *drainDriver) Open(string) (driver.Conn, error)             { return d.Connect(context.Background()) }
func (drainConn) Prepare(string) (driver.Stmt, error)               { return nil, errors.New("unexpected prepare") }
func (drainConn) Close() error                                      { return nil }
func (drainConn) Begin() (driver.Tx, error)                         { return nil, errors.New("unexpected transaction") }
func (drainConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (c drainConn) QueryContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "pg_advisory_unlock_shared") {
		return &drainRows{columns: 1, released: true}, nil
	}
	c.state.claimed = true
	if c.state.lifecycle.Stats().InUse != 1 {
		c.state.t.Error("embedding claim ran outside startup drain")
	}
	if _, bounded := ctx.Deadline(); !bounded {
		c.state.t.Error("embedding claim omitted its phase deadline")
	}
	return &drainRows{columns: 7}, nil
}
func (r *drainRows) Columns() []string { return make([]string, r.columns) }
func (*drainRows) Close() error        { return nil }
func (r *drainRows) Next(dest []driver.Value) error {
	if r.done || !r.released {
		return io.EOF
	}
	r.done = true
	dest[0] = true
	return nil
}

func TestEmbeddingClaimParticipatesInStartupDrain(t *testing.T) {
	lifecycle := sql.OpenDB(&drainDriver{})
	defer lifecycle.Close()
	lifecycle.SetMaxOpenConns(2)
	state := &drainDriver{lifecycle: lifecycle, t: t}
	work := sql.OpenDB(state)
	defer work.Close()
	old := backend.DbLifecycle
	backend.DbLifecycle = lifecycle
	defer func() { backend.DbLifecycle = old }()
	runEmbeddingRefreshPass(work, func(context.Context, string) ([]float32, error) {
		t.Error("empty queue called provider")
		return nil, nil
	})
	if !state.claimed {
		t.Fatal("worker never polled its queue")
	}
	if lifecycle.Stats().InUse != 0 {
		t.Fatal("empty worker pass retained admission")
	}
}
