// dataset_lifecycle_test.go
// Checks optional automation metadata, bound endpoint names and fatal write errors.
// Connects the shared lifecycle helpers with a small database/sql driver fixture.
// Complements PostgreSQL route proofs without accessing a database.
package automation_metadata

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

type lifecycleState struct {
	present           bool
	queryErr, execErr error
	queries           int
	query             string
	args              []driver.NamedValue
}
type lifecycleDriver struct{ state *lifecycleState }
type lifecycleConn struct{ state *lifecycleState }
type lifecycleTx struct{}
type lifecycleRows struct{ value *bool }

var lifecycleCounter atomic.Int64

func (d lifecycleDriver) Open(string) (driver.Conn, error) { return &lifecycleConn{d.state}, nil }
func (c *lifecycleConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*lifecycleConn) Close() error              { return nil }
func (*lifecycleConn) Begin() (driver.Tx, error) { return lifecycleTx{}, nil }
func (lifecycleTx) Commit() error                { return nil }
func (lifecycleTx) Rollback() error              { return nil }
func (*lifecycleRows) Columns() []string         { return []string{"present"} }
func (*lifecycleRows) Close() error              { return nil }
func (r *lifecycleRows) Next(dest []driver.Value) error {
	if r.value == nil {
		return io.EOF
	}
	dest[0] = *r.value
	r.value = nil
	return nil
}
func (c *lifecycleConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.state.queries++
	if strings.HasPrefix(query, "SELECT r.id,r.target_insert_specs,COALESCE(") {
		return &lifecycleRows{}, nil
	}
	if query != "SELECT to_regclass('public.system_triggers') IS NOT NULL" {
		return nil, fmt.Errorf("unexpected guard: %s", query)
	}
	if c.state.queryErr != nil {
		return nil, c.state.queryErr
	}
	return &lifecycleRows{value: &c.state.present}, nil
}
func (c *lifecycleConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.query, c.state.args = query, args
	return driver.RowsAffected(1), c.state.execErr
}
func lifecycleTestTx(t *testing.T, state *lifecycleState) *sql.Tx {
	t.Helper()
	name := fmt.Sprintf("automation_lifecycle_%d", lifecycleCounter.Add(1))
	sql.Register(name, lifecycleDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback() })
	return tx
}

func TestDatasetAutomationLifecycle(t *testing.T) {
	for _, rename := range []bool{false, true} {
		for _, mode := range []string{"present", "absent", "guard error", "write error"} {
			t.Run(fmt.Sprintf("rename=%t/%s", rename, mode), func(t *testing.T) {
				failure := errors.New("metadata unavailable")
				state := &lifecycleState{present: mode != "absent"}
				if mode == "guard error" {
					state.queryErr = failure
				}
				if mode == "write error" {
					state.execErr = failure
				}
				tx := lifecycleTestTx(t, state)
				var err error
				if rename {
					err = RenameDataset(tx, `old "source"`, `new "source"`)
				} else {
					err = DeleteDataset(tx, 42)
				}
				if strings.HasSuffix(mode, "error") {
					if !errors.Is(err, failure) {
						t.Fatal("metadata error was lost", err)
					}
				} else if err != nil {
					t.Fatal(err)
				}
				if mode == "absent" || mode == "guard error" {
					if state.query != "" {
						t.Fatal("mutated unavailable legacy table")
					}
					return
				}
				if !strings.Contains(state.query, "source_table") || !strings.Contains(state.query, "target_table") {
					t.Fatal("missed automation endpoint", state.query)
				}
				if rename {
					if len(state.args) != 2 || state.args[0].Value != `old "source"` || state.args[1].Value != `new "source"` || strings.Contains(state.query, `old "source"`) {
						t.Fatal("rename names were not bound", state.args)
					}
					if strings.Count(state.query, "CASE WHEN") != 2 || !strings.Contains(state.query, "WHERE source_table = $1 OR target_table = $1") {
						t.Fatal("rename would change unrelated endpoints", state.query)
					}
				} else if len(state.args) != 1 || state.args[0].Value != int64(42) || strings.Count(state.query, "WHERE table_uid = $1") != 2 {
					t.Fatal("delete missed registry identity", state.query, state.args)
				}
			})
		}
	}
}

func TestUnchangedDatasetNameSkipsAutomationMetadata(t *testing.T) {
	state := &lifecycleState{queryErr: errors.New("must not query")}
	if err := RenameDataset(lifecycleTestTx(t, state), "same", "same"); err != nil || state.queries != 0 {
		t.Fatal("unchanged name queried metadata", err)
	}
}
