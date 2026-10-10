// application_update_guard_test.go
// Proves policy mutation completion rolls back a self-granted update capability.
// Connects both normal and repair completion to the effective-right write guard.
// Prevents transaction-only callers from committing after ignoring a refusal.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/update_capability"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

type policyGrantConnection struct{ queryCount int }
type policyGrantTransaction struct{}
type policyGrantRow struct {
	granted bool
	done    bool
}

func (c *policyGrantConnection) Connect(context.Context) (driver.Conn, error) { return c, nil }
func (c *policyGrantConnection) Driver() driver.Driver                        { return c }
func (c *policyGrantConnection) Open(string) (driver.Conn, error)             { return c, nil }
func (*policyGrantConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected policy statement")
}
func (*policyGrantConnection) Close() error              { return nil }
func (*policyGrantConnection) Begin() (driver.Tx, error) { return policyGrantTransaction{}, nil }
func (policyGrantTransaction) Commit() error             { return nil }
func (policyGrantTransaction) Rollback() error           { return nil }
func (c *policyGrantConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if c.queryCount >= 2 || !strings.Contains(query, "f.name=$1") {
		return nil, errors.New("self-grant reached reconciliation")
	}
	c.queryCount++
	return &policyGrantRow{granted: c.queryCount == 2}, nil
}
func (*policyGrantRow) Columns() []string { return []string{"granted"} }
func (*policyGrantRow) Close() error      { return nil }
func (r *policyGrantRow) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.granted
	return nil
}

func TestApplicationUpdateSelfGrantRollsBackNormalAndRepairCompletion(t *testing.T) {
	for _, repair := range []bool{false, true} {
		db := sql.OpenDB(&policyGrantConnection{})
		t.Cleanup(func() { db.Close() })
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		ctx := dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(42, "admin"))
		guard, err := update_capability.Capture(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		mutation := &Mutation{Tx: tx, updateGuard: guard}
		if repair {
			err = mutation.FinishRepair(ctx)
		} else {
			err = mutation.Finish(ctx)
		}
		var refusal *httpresponse.Refusal
		if !errors.As(err, &refusal) || refusal.Status != 403 {
			t.Fatal("self-grant was not refused", repair, err)
		}
		if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
			t.Fatal("ignored refusal could still commit", repair, err)
		}
		response := httptest.NewRecorder()
		RespondError(response, refusal)
		if response.Code != 403 || !strings.Contains(response.Body.String(), "error_application_update_self_grant") {
			t.Fatal("write guard lost its translated refusal", response.Code, response.Body.String())
		}
	}
}
