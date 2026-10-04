// user_display_name_test.go
// Proves the one rule for naming who acted: the guest account and an unreadable or empty name fall
// back, and a signed-in account gets its current display name, trimmed.
// Between UserDisplayName / UserDisplayNameOr and a stand-in database driver.
// Exists because logs, provenance and the site assistant all name actors through these two functions.
package backend

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"testing"
)

type displayNameDriver struct {
	mu      sync.Mutex
	lookups int
	names   map[int64]string
	failing map[int64]bool
}

type displayNameConn struct{ driver *displayNameDriver }

type displayNameRows struct {
	values [][]driver.Value
	index  int
}

var displayNameDriverCounter int64

func (d *displayNameDriver) Open(string) (driver.Conn, error) {
	return &displayNameConn{driver: d}, nil
}

func (c *displayNameConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not used")
}
func (c *displayNameConn) Close() error { return nil }
func (c *displayNameConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not used")
}

func (c *displayNameConn) QueryContext(_ context.Context, _ string, args []driver.NamedValue) (driver.Rows, error) {
	c.driver.mu.Lock()
	c.driver.lookups++
	c.driver.mu.Unlock()
	userID, _ := args[0].Value.(int64)
	if c.driver.failing[userID] {
		return nil, errors.New("the user table cannot be read")
	}
	rows := &displayNameRows{}
	if name, known := c.driver.names[userID]; known {
		rows.values = [][]driver.Value{{name}}
	}
	return rows, nil
}

func (r *displayNameRows) Columns() []string { return []string{"username"} }
func (r *displayNameRows) Close() error      { return nil }
func (r *displayNameRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func openDisplayNameDB(t *testing.T, stand *displayNameDriver) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("display-name-%d", atomic.AddInt64(&displayNameDriverCounter, 1))
	sql.Register(name, stand)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open stand-in database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestUserDisplayNameOrNamesSignedInAccountsAndFallsBackOtherwise(t *testing.T) {
	stand := &displayNameDriver{
		names:   map[int64]string{42: "  alice  ", 43: "   "},
		failing: map[int64]bool{44: true},
	}
	db := openDisplayNameDB(t, stand)
	ctx := context.Background()

	if got := UserDisplayNameOr(ctx, db, 42, "unknown"); got != "alice" {
		t.Fatalf("signed-in account = %q, want the trimmed display name", got)
	}
	for _, testCase := range []struct {
		name   string
		userID int
	}{
		{"guest account", 1},
		{"no account", 0},
		{"empty name", 43},
		{"unreadable name", 44},
		{"missing account", 45},
	} {
		if got := UserDisplayNameOr(ctx, db, testCase.userID, "unknown"); got != "unknown" {
			t.Fatalf("%s = %q, want the fallback", testCase.name, got)
		}
	}
	stand.mu.Lock()
	lookups := stand.lookups
	stand.mu.Unlock()
	if lookups != 4 {
		t.Fatalf("name reads = %d, want none for the guest account or id 0", lookups)
	}
	if got := UserDisplayNameOr(ctx, nil, 42, "unknown"); got != "unknown" {
		t.Fatalf("without a database = %q, want the fallback", got)
	}
	if _, err := UserDisplayName(ctx, nil, 42); err == nil {
		t.Fatal("UserDisplayName without a database must return an error")
	}
}
