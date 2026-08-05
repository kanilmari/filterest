// site_name_test.go
// Verifies the persisted site identity reader used by public browser-facing pages.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"testing"
)

var siteNameDriverCounter int64

type siteNameTestDriver struct{ value string }
type siteNameTestConn struct{ value string }
type siteNameTestRows struct {
	value string
	done  bool
}

func (driverInstance *siteNameTestDriver) Open(string) (driver.Conn, error) {
	return &siteNameTestConn{value: driverInstance.value}, nil
}

func (connection *siteNameTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}
func (connection *siteNameTestConn) Close() error { return nil }
func (connection *siteNameTestConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not supported")
}
func (connection *siteNameTestConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &siteNameTestRows{value: connection.value}, nil
}

func (rows *siteNameTestRows) Columns() []string { return []string{"site_name"} }
func (rows *siteNameTestRows) Close() error      { return nil }
func (rows *siteNameTestRows) Next(destination []driver.Value) error {
	if rows.done {
		return io.EOF
	}
	rows.done = true
	destination[0] = rows.value
	return nil
}

func TestConfiguredSiteNameReturnsTrimmedSavedIdentity(t *testing.T) {
	driverName := fmt.Sprintf("site_name_%d", atomic.AddInt64(&siteNameDriverCounter, 1))
	sql.Register(driverName, &siteNameTestDriver{value: "  Customer Workspace  "})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if got := ConfiguredSiteName(context.Background(), db); got != "Customer Workspace" {
		t.Fatalf("ConfiguredSiteName() = %q, want %q", got, "Customer Workspace")
	}
}

func TestConfiguredSiteNameReturnsEmptyWithoutDatabase(t *testing.T) {
	if got := ConfiguredSiteName(context.Background(), nil); got != "" {
		t.Fatalf("ConfiguredSiteName(nil) = %q, want empty", got)
	}
}
