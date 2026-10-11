// drop_completion_test.go
// Injects permission failures after transactional dataset removal.
// Exercises the shared completion boundary without a PostgreSQL connection.
// A caller ignoring a completion error must still be unable to commit the drop.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants/granttest"
)

type dropCompletionDriver struct {
	dropped, rolledBack, committed bool
	failure                        string
	injected                       error
}
type dropCompletionConn struct{ state *dropCompletionDriver }
type dropCompletionTx struct{ state *dropCompletionDriver }

func (d *dropCompletionDriver) Connect(context.Context) (driver.Conn, error) {
	return &dropCompletionConn{d}, nil
}
func (d *dropCompletionDriver) Driver() driver.Driver { return d }
func (d *dropCompletionDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (*dropCompletionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*dropCompletionConn) Close() error { return nil }
func (c *dropCompletionConn) Begin() (driver.Tx, error) {
	return &dropCompletionTx{c.state}, nil
}
func (c *dropCompletionConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(query, "DROP TABLE") {
		c.state.dropped = true
	}
	return driver.RowsAffected(1), nil
}
func (c *dropCompletionConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.state.dropped && (c.state.failure == "target lookup" && strings.Contains(query, "SELECT COALESCE(to_regclass(format('%I.%I'") ||
		c.state.failure == "ACL inspection" && strings.Contains(query, "CROSS JOIN LATERAL aclexplode")) {
		return nil, c.state.injected
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	return nil, errors.New("unexpected permission query")
}
func (tx *dropCompletionTx) Commit() error {
	tx.state.committed = true
	return nil
}
func (tx *dropCompletionTx) Rollback() error {
	tx.state.rolledBack = true
	return nil
}

func TestDropCompletionErrorsPreventCommit(t *testing.T) {
	for _, failure := range []string{"target lookup", "canceled after drop", "ACL inspection"} {
		t.Run(failure, func(t *testing.T) {
			granttest.ConfigureRoles(t)
			state := &dropCompletionDriver{failure: failure, injected: errors.New("injected permission failure")}
			db := sql.OpenDB(state)
			defer db.Close()
			// Deliberately keep the transaction's lifetime independent of the
			// completion context: rollback must come from Finish itself.
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			mutation, err := BeginTx(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec("DROP TABLE completion_dataset CASCADE"); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec("DELETE FROM system_db_tables WHERE table_uid=42"); err != nil {
				t.Fatal(err)
			}
			if failure == "canceled after drop" {
				cancel()
			}
			err = mutation.Finish(ctx, 42)
			if err == nil || !state.dropped {
				t.Fatal("failure did not reach completion after the drop", err)
			}
			if failure == "target lookup" && !errors.Is(err, state.injected) ||
				failure == "canceled after drop" && !errors.Is(err, context.Canceled) {
				t.Fatal("completion lost the failure cause", err)
			}
			if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) || state.committed || !state.rolledBack {
				t.Fatalf("failed permission completion left a committable drop: commit=%v state=%+v", err, state)
			}
		})
	}
}
