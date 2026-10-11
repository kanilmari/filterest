// kind_evidence_invalidation_test.go
// Proves the shared mutation completion clears warm evidence only after commit.
// Connects registry/DDL/import completion and repair to a scripted schema reader.
// Protects rollback, failed commit and transaction-only ownership boundaries.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"

	"easelect/backend/core_components/dataset_kinds"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type kindMutationDriver struct {
	calls             int
	commitFailure     bool
	staged, committed bool
}
type kindMutationConn struct{ state *kindMutationDriver }
type kindMutationTx struct{ state *kindMutationDriver }
type kindMutationRows struct {
	raw  string
	done bool
}

func (d *kindMutationDriver) Connect(context.Context) (driver.Conn, error) {
	return &kindMutationConn{d}, nil
}
func (d *kindMutationDriver) Driver() driver.Driver { return d }
func (d *kindMutationDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (*kindMutationConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*kindMutationConn) Close() error                { return nil }
func (c *kindMutationConn) Begin() (driver.Tx, error) { return &kindMutationTx{c.state}, nil }
func (tx *kindMutationTx) Commit() error {
	if tx.state.commitFailure {
		return errors.New("commit refused")
	}
	tx.state.committed = tx.state.staged
	return nil
}
func (*kindMutationTx) Rollback() error { return nil }
func (c *kindMutationConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	c.state.staged = true
	return driver.RowsAffected(1), nil
}
func (c *kindMutationConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "WITH registrations AS (") {
		c.state.calls++
		if c.state.committed {
			return &kindMutationRows{raw: `{"registrations":[{"table_uid":42,"name":"public.kind_commit","table_kind":"ordinary"}],"shapes":[{"name":"public.kind_commit","columns":[{"name":"position","type":"geometry","sql_type":"postgis.geometry(Point,4326)"}]}]}`}, nil
		}
		return &kindMutationRows{raw: `{"registrations":[{"table_uid":42,"name":"public.kind_commit","table_kind":"ordinary"}],"shapes":[{"name":"public.kind_commit"}]}`}, nil
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	return nil, errors.New("unexpected query")
}
func (*kindMutationRows) Columns() []string { return []string{"snapshot"} }
func (*kindMutationRows) Close() error      { return nil }
func (r *kindMutationRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = []byte(r.raw)
	return nil
}

func TestKindEvidenceMutationCompletionInvalidatesOnlyAfterCommit(t *testing.T) {
	for _, repair := range []bool{false, true} {
		for _, end := range []string{"commit", "rollback", "failed commit", "direct transaction rollback"} {
			t.Run(end+map[bool]string{false: "/normal", true: "/repair"}[repair], func(t *testing.T) {
				granttest.ConfigureRoles(t)
				dataset_kinds.InvalidateAll()
				t.Cleanup(dataset_kinds.InvalidateAll)
				state := &kindMutationDriver{commitFailure: end == "failed commit"}
				db := sql.OpenDB(state)
				defer db.Close()
				read := func(want int) {
					t.Helper()
					capabilities, err := dataset_kinds.ReadForName(context.Background(), db, "kind_commit")
					if err != nil {
						t.Fatal(err)
					}
					if capabilities.Map != state.committed {
						t.Fatalf("committed location shape stayed stale: map=%v committed=%v", capabilities.Map, state.committed)
					}
					if state.calls != want {
						t.Fatalf("evidence queries = %d, want %d after %s", state.calls, want, end)
					}
				}
				read(1)
				lt := dbutils.NewLazyTx(db)
				ctx := dbutils.SetLazyTx(context.Background(), lt)
				tx, err := dbutils.RequireTxWithError(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer lt.Rollback()
				if end == "direct transaction rollback" {
					ctx = context.Background()
				}
				mutation, err := BeginTx(ctx, tx)
				if err != nil {
					t.Fatal(err)
				}
				// Scripted DDL changes the shape only when this transaction commits.
				// Actual application schema/registry mutations use this same Finish.
				if _, err := tx.Exec("ALTER TABLE kind_commit ADD COLUMN position geometry(Point,4326)"); err != nil {
					t.Fatal(err)
				}
				// Every app DDL/registry path in the audit reaches Finish or FinishRepair.
				if repair {
					err = mutation.FinishRepair(ctx)
				} else {
					err = mutation.Finish(ctx)
				}
				if err != nil {
					t.Fatal(err)
				}
				read(1) // Completion is still inside the uncommitted transaction.
				want := 1
				if end == "commit" || end == "failed commit" {
					err = lt.Commit()
					if (err != nil) != state.commitFailure {
						t.Fatal(err)
					}
					if end == "commit" {
						want = 2
					}
				} else if err := lt.Rollback(); err != nil {
					t.Fatal(err)
				}
				read(want)
			})
		}
	}
}
