// update_capability_checker_test.go
// Exercises effective capability changes across rights and membership mutations.
// Connects request actor snapshots with the shared policy mutation completion guard.
// Refuses self-grants while retaining operator provisioning and existing authority.
package update_capability

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"io"
	"testing"
)

type grantAnswers struct{ values []bool }
type grantConnection struct{ state *grantAnswers }
type grantTransaction struct{}
type grantRow struct {
	value bool
	done  bool
}

func (s *grantAnswers) Connect(context.Context) (driver.Conn, error) { return &grantConnection{s}, nil }
func (s *grantAnswers) Driver() driver.Driver                        { return s }
func (s *grantAnswers) Open(string) (driver.Conn, error)             { return s.Connect(context.Background()) }
func (*grantConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*grantConnection) Close() error              { return nil }
func (*grantConnection) Begin() (driver.Tx, error) { return grantTransaction{}, nil }
func (grantTransaction) Commit() error             { return nil }
func (grantTransaction) Rollback() error           { return nil }
func (c *grantConnection) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if len(c.state.values) == 0 {
		return nil, errors.New("unexpected grant query")
	}
	value := c.state.values[0]
	c.state.values = c.state.values[1:]
	return &grantRow{value: value}, nil
}
func (*grantRow) Columns() []string { return []string{"granted"} }
func (*grantRow) Close() error      { return nil }
func (r *grantRow) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.value
	return nil
}

func TestWriteGuardRefusesNewOwnGrantAndAllowsOtherChanges(t *testing.T) {
	for _, test := range []struct{ before, after, wantRefusal bool }{{false, true, true}, {false, false, false}, {true, true, false}} {
		state := &grantAnswers{values: []bool{test.before}}
		if !test.before {
			state.values = append(state.values, test.after)
		}
		db := sql.OpenDB(state)
		defer db.Close()
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		ctx := dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(42, "admin"))
		guard, err := Capture(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		err = guard.Check(ctx, tx)
		var refusal *httpresponse.Refusal
		if test.wantRefusal {
			if !errors.As(err, &refusal) || refusal.Status != 403 || refusal.LangKey != "error_application_update_self_grant" {
				t.Fatal(err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
		if len(state.values) != 0 {
			t.Fatal("write guard did not recheck current effective grant")
		}
	}
}

func TestExplicitRoutesAndOperatorBoundary(t *testing.T) {
	for _, route := range []string{Route, "/api/admin/application-update", "/api/admin/application-update/requests", "/api/admin/application-update/jobs/{id}/decisions"} {
		if !RequiresExplicitGrant(route) {
			t.Fatal(route)
		}
	}
	if RequiresExplicitGrant("/api/admin/version-info") {
		t.Fatal("unrelated admin route made explicit-only")
	}
	if guard, err := Capture(context.Background(), nil); err != nil || guard != nil {
		t.Fatal("operator-only provisioning requires a browser actor", guard, err)
	}
}
