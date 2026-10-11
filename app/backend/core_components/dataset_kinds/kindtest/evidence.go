// evidence.go
// Supplies a warm evidence-query probe for application mutation regression tests.
// Connects offline SQL drivers to the public reader without exposing cache internals.
// Makes missing post-commit invalidation observable across mutation packages.
package kindtest

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dataset_kinds"
)

type probe struct{ calls atomic.Int64 }
type conn struct{ p *probe }
type rows struct{ done bool }

func (p *probe) Connect(context.Context) (driver.Conn, error) { return &conn{p}, nil }
func (p *probe) Driver() driver.Driver                        { return p }
func (p *probe) Open(string) (driver.Conn, error)             { return p.Connect(context.Background()) }
func (*conn) Prepare(string) (driver.Stmt, error)             { return nil, errors.New("unexpected prepare") }
func (*conn) Close() error                                    { return nil }
func (*conn) Begin() (driver.Tx, error)                       { return nil, errors.New("evidence probe is read-only") }
func (c *conn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	c.p.calls.Add(1)
	return &rows{}, nil
}
func (*rows) Columns() []string { return []string{"snapshot"} }
func (*rows) Close() error      { return nil }
func (r *rows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = []byte(`{"registrations":[{"table_uid":42,"name":"public.kind_probe","table_kind":"ordinary"}],"shapes":[{"name":"public.kind_probe"}]}`)
	return nil
}

// WarmProbe returns an assertion that performs a read and checks query count.
// Call it before and after the actual app change to prove cache lifecycle.
func WarmProbe(t *testing.T) func(int64) {
	t.Helper()
	dataset_kinds.InvalidateAll()
	t.Cleanup(dataset_kinds.InvalidateAll)
	p := &probe{}
	db := sql.OpenDB(p)
	t.Cleanup(func() { db.Close() })
	return func(want int64) {
		t.Helper()
		if _, err := dataset_kinds.ReadForName(context.Background(), db, "kind_probe"); err != nil {
			t.Fatal(err)
		}
		if got := p.calls.Load(); got != want {
			t.Fatalf("warm evidence queries = %d, want %d", got, want)
		}
	}
}
