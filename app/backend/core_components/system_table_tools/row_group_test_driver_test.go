// row_group_test_driver_test.go
// Provides a statement-ordered database fixture for row-group regressions.
// Bridges real database/sql transactions with checked queries and bounded readback.
// Exists to prove validation happens before mutation without a live database.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type rowGroupSQLStep struct {
	contains []string
	excludes []string
	rows     [][]driver.Value
	check    func([]driver.NamedValue)
}
type rowGroupSQLDriver struct {
	t     *testing.T
	steps []rowGroupSQLStep
}
type rowGroupSQLConn struct{ fixture *rowGroupSQLDriver }
type rowGroupSQLRows struct {
	rows    [][]driver.Value
	index   int
	columns int
}
type rowGroupSQLTx struct{}

var rowGroupDriverSerial atomic.Int64

func (d *rowGroupSQLDriver) Open(string) (driver.Conn, error) { return &rowGroupSQLConn{d}, nil }
func (c *rowGroupSQLConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (c *rowGroupSQLConn) Close() error              { return nil }
func (c *rowGroupSQLConn) Begin() (driver.Tx, error) { return rowGroupSQLTx{}, nil }
func (rowGroupSQLTx) Commit() error                  { return nil }
func (rowGroupSQLTx) Rollback() error                { return nil }
func (c *rowGroupSQLConn) take(query string, args []driver.NamedValue) rowGroupSQLStep {
	c.fixture.t.Helper()
	if len(c.fixture.steps) == 0 {
		c.fixture.t.Fatalf("unexpected query: %s", query)
	}
	step := c.fixture.steps[0]
	c.fixture.steps = c.fixture.steps[1:]
	for _, want := range step.contains {
		if !strings.Contains(query, want) {
			c.fixture.t.Fatalf("query missing %q: %s", want, query)
		}
	}
	for _, forbidden := range step.excludes {
		if strings.Contains(query, forbidden) {
			c.fixture.t.Fatalf("query includes %q: %s", forbidden, query)
		}
	}
	if step.check != nil {
		step.check(args)
	}
	return step
}
func (c *rowGroupSQLConn) ExecContext(_ context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	c.take(q, args)
	return driver.RowsAffected(1), nil
}
func (c *rowGroupSQLConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	s := c.take(q, args)
	columns := 1
	if len(s.rows) > 0 {
		columns = len(s.rows[0])
	}
	return &rowGroupSQLRows{rows: s.rows, columns: columns}, nil
}
func (r *rowGroupSQLRows) Columns() []string {
	columns := make([]string, r.columns)
	for i := range columns {
		columns[i] = fmt.Sprint(i)
	}
	return columns
}
func (r *rowGroupSQLRows) Close() error { return nil }
func (r *rowGroupSQLRows) Next(out []driver.Value) error {
	if r.index == len(r.rows) {
		return io.EOF
	}
	copy(out, r.rows[r.index])
	r.index++
	return nil
}
func rowGroupMockLazyTx(t *testing.T, steps ...rowGroupSQLStep) *dbutils.LazyTx {
	t.Helper()
	fixture := &rowGroupSQLDriver{t: t, steps: steps}
	name := fmt.Sprintf("wl103-groups-%d", rowGroupDriverSerial.Add(1))
	sql.Register(name, fixture)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	tx := dbutils.NewLazyTx(db)
	t.Cleanup(func() {
		tx.Rollback()
		db.Close()
		if len(fixture.steps) > 0 {
			t.Errorf("%d expected SQL statements not executed", len(fixture.steps))
		}
	})
	return tx
}
func rowGroupLanguageStep() rowGroupSQLStep {
	return rowGroupSQLStep{contains: []string{"FROM public.system_languages"}, rows: [][]driver.Value{{"en", false}, {"fi", true}}}
}
func rowGroupAssignmentSteps(single, enabled bool) []rowGroupSQLStep {
	return []rowGroupSQLStep{
		{contains: []string{"pg_advisory_xact_lock", "hashtextextended", "classification_id"}, excludes: []string{"DELETE", "INSERT"}, rows: [][]driver.Value{{nil}}},
		{contains: []string{"g.enabled AND COALESCE(c.enabled,true)"}, rows: [][]driver.Value{{int64(1), single, enabled}}},
		{contains: []string{"FROM public.system_db_tables"}, rows: [][]driver.Value{{int64(103), "public"}}},
	}
}

func rowGroupMockTx(t *testing.T, steps ...rowGroupSQLStep) *sql.Tx {
	t.Helper()
	tx, err := rowGroupMockLazyTx(t, steps...).Begin()
	if err != nil {
		t.Fatal(err)
	}
	return tx
}
