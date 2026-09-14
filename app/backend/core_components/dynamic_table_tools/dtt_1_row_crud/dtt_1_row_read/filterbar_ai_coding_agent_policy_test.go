// filterbar_ai_coding_agent_policy_test.go
// Verifies restrictive defaults and current administrator feature policy.
// Bridges deterministic configuration rows with real policy/handler decisions.
// Prevents production permission from being confused with runner readiness.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"testing"
)

type codingPolicyDriver struct {
	value         driver.Value
	present, fail bool
}
type codingPolicyConn struct{ codingPolicyDriver }
type codingPolicyRows struct {
	value driver.Value
	done  bool
}

func (d codingPolicyDriver) Open(string) (driver.Conn, error)  { return codingPolicyConn{d}, nil }
func (c codingPolicyConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c codingPolicyConn) Close() error                        { return nil }
func (c codingPolicyConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (c codingPolicyConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if c.fail {
		return nil, errors.New("failed")
	}
	if len(args) != 1 || args[0].Value != codingAgentDevOnlyKey {
		return nil, errors.New("wrong key")
	}
	return &codingPolicyRows{value: c.value, done: !c.present}, nil
}
func (r *codingPolicyRows) Columns() []string { return []string{"boolean_value"} }
func (r *codingPolicyRows) Close() error      { return nil }
func (r *codingPolicyRows) Next(v []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	v[0] = r.value
	return nil
}

var codingPolicyCounter int64

func TestCodingAgentBooleanDefaultsAndMalformedValues(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		value                        driver.Value
		present, fail, want, wantErr bool
	}{
		{"missing", nil, false, false, true, false}, {"true", true, true, false, true, false}, {"false", false, true, false, false, false}, {"null", nil, true, false, true, true}, {"database error", nil, false, true, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := fmt.Sprintf("coding_policy_%d", atomic.AddInt64(&codingPolicyCounter, 1))
			sql.Register(name, codingPolicyDriver{tc.value, tc.present, tc.fail})
			db, _ := sql.Open(name, "")
			old := backend.Db
			backend.Db = db
			defer func() { backend.Db = old; db.Close() }()
			got, err := readCodingAgentDevOnly(context.Background())
			if got != tc.want || (err != nil) != tc.wantErr {
				t.Fatalf("got=%v err=%v", got, err)
			}
		})
	}
}
