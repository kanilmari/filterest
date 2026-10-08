// front_page_presentation_test.go
// Proves the real layout reader distinguishes missing, valid and malformed rows.
// Connects a narrow in-memory SQL driver to the revision and shared validator.
// Requires no database, network or installation credentials.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"testing"

	presentation "easelect/frontend/shared/front_page_presentation"
)

type homeLayoutDriver struct{ values []driver.Value }
type homeLayoutConn struct{ values []driver.Value }
type homeLayoutRows struct {
	values []driver.Value
	done   bool
}

var homeLayoutDriverID atomic.Int64

func (d homeLayoutDriver) Open(string) (driver.Conn, error) { return homeLayoutConn{d.values}, nil }
func (c homeLayoutConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c homeLayoutConn) Close() error              { return nil }
func (c homeLayoutConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (c homeLayoutConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &homeLayoutRows{values: c.values}, nil
}
func (r *homeLayoutRows) Columns() []string { return []string{"json_value", "updated", "value_type"} }
func (r *homeLayoutRows) Close() error      { return nil }
func (r *homeLayoutRows) Next(values []driver.Value) error {
	if r.done || r.values == nil {
		return io.EOF
	}
	r.done = true
	copy(values, r.values)
	return nil
}
func TestReadHomePresentationMissingValidInvalidAndRevision(t *testing.T) {
	raw, _ := json.Marshal(presentation.Rules().Default)
	for _, tc := range []struct {
		values  []driver.Value
		invalid bool
		missing bool
	}{
		{nil, false, true}, {[]driver.Value{raw, "revision-1", int64(5)}, false, false},
		{[]driver.Value{[]byte(`null`), "revision-1", int64(5)}, true, false},
		{[]driver.Value{[]byte(`{}`), "revision-1", int64(5)}, true, false},
		{[]driver.Value{raw, "revision-1", int64(2)}, true, false},
	} {
		name := fmt.Sprintf("home_layout_%d", homeLayoutDriverID.Add(1))
		sql.Register(name, homeLayoutDriver{tc.values})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		value, revision, err := ReadFrontPagePresentation(context.Background(), db)
		if (err != nil) != tc.invalid {
			t.Fatal(value, revision, err, tc)
		}
		if tc.missing && (value != nil || revision != "none") {
			t.Fatal(value, revision)
		}
		if !tc.invalid && !tc.missing && (*value != presentation.Rules().Default || revision != FrontPagePresentationRevision(raw, "revision-1")) {
			t.Fatal(value, revision)
		}
	}
	if _, _, err := ReadFrontPagePresentation(context.Background(), nil); err == nil {
		t.Fatal("nil database accepted")
	}
	if FrontPagePresentationRevision(raw, "revision-1") == FrontPagePresentationRevision(raw, "revision-2") {
		t.Fatal("revision did not advance")
	}
}
