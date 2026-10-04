// audit_actor_names_test.go
// Proves that naming audit events by account id never costs an event: a slow name read leaves the
// insert its own deadline, and each account is read once per batch.
// Between the audit batch writer and a stand-in database driver.
// Exists because the session no longer carries a name, so the batch writer reads names itself.
package audit

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
	"time"

	backend "easelect/backend/core_components"
)

type auditNamesDriverState struct {
	mu        sync.Mutex
	lookups   int
	inserts   int
	insertErr error
	usernames []interface{}
}

type auditNamesDriver struct {
	state        *auditNamesDriverState
	names        map[int64]string
	blockLookups bool
}

type auditNamesConn struct{ driver *auditNamesDriver }

type auditNamesRows struct {
	values [][]driver.Value
	index  int
}

var auditNamesDriverCounter int64

func (d *auditNamesDriver) Open(string) (driver.Conn, error) { return &auditNamesConn{driver: d}, nil }

func (c *auditNamesConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not used by the audit writer")
}
func (c *auditNamesConn) Close() error { return nil }
func (c *auditNamesConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not used by the audit writer")
}

func (c *auditNamesConn) QueryContext(ctx context.Context, _ string, args []driver.NamedValue) (driver.Rows, error) {
	c.driver.state.mu.Lock()
	c.driver.state.lookups++
	c.driver.state.mu.Unlock()
	if c.driver.blockLookups {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	rows := &auditNamesRows{}
	if len(args) == 1 {
		if userID, ok := args[0].Value.(int64); ok {
			if name, known := c.driver.names[userID]; known {
				rows.values = [][]driver.Value{{name}}
			}
		}
	}
	return rows, nil
}

func (c *auditNamesConn) ExecContext(ctx context.Context, _ string, args []driver.NamedValue) (driver.Result, error) {
	state := c.driver.state
	state.mu.Lock()
	defer state.mu.Unlock()
	state.inserts++
	state.insertErr = ctx.Err()
	// Each row has eleven columns, the third being the username.
	for index := 2; index < len(args); index += 11 {
		state.usernames = append(state.usernames, args[index].Value)
	}
	return driver.RowsAffected(1), nil
}

func (r *auditNamesRows) Columns() []string { return []string{"username"} }
func (r *auditNamesRows) Close() error      { return nil }
func (r *auditNamesRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func useAuditNamesDB(t *testing.T, names map[int64]string, blockLookups bool) *auditNamesDriverState {
	t.Helper()
	state := &auditNamesDriverState{}
	name := fmt.Sprintf("audit-names-%d", atomic.AddInt64(&auditNamesDriverCounter, 1))
	sql.Register(name, &auditNamesDriver{state: state, names: names, blockLookups: blockLookups})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open stand-in database: %v", err)
	}
	original := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = original
		_ = db.Close()
	})
	return state
}

func auditEventFor(userID *int, username string) AuditEvent {
	return AuditEvent{CreatedAt: time.Now(), UserID: userID, Username: username, HandlerName: "test.Handler", HTTPMethod: "POST", URLPath: "/api/test"}
}

func TestASlowNameReadLeavesTheInsertItsOwnDeadline(t *testing.T) {
	originalTimeout := auditNameLookupTimeout
	auditNameLookupTimeout = 50 * time.Millisecond
	t.Cleanup(func() { auditNameLookupTimeout = originalTimeout })
	state := useAuditNamesDB(t, nil, true)

	signedIn := 42
	started := time.Now()
	flushBatch([]AuditEvent{auditEventFor(&signedIn, ""), auditEventFor(nil, "")})
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("the batch took %s; the name reads were not bounded", elapsed)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.inserts != 1 || state.insertErr != nil {
		t.Fatalf("inserts = %d, insert context error = %v; the events must still be written", state.inserts, state.insertErr)
	}
	if len(state.usernames) != 2 || state.usernames[0] != nil || state.usernames[1] != nil {
		t.Fatalf("usernames = %#v, want the events written without names", state.usernames)
	}
}

func TestAuditNamesAreReadOncePerAccount(t *testing.T) {
	state := useAuditNamesDB(t, map[int64]string{42: "alice", 7: "bob"}, false)

	alice, bob, guest, named := 42, 7, 1, 9
	flushBatch([]AuditEvent{
		auditEventFor(&alice, ""),
		auditEventFor(&alice, ""),
		auditEventFor(&bob, ""),
		auditEventFor(&guest, ""),
		auditEventFor(nil, ""),
		auditEventFor(&named, "kept"),
	})

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.lookups != 2 {
		t.Fatalf("name reads = %d, want one for each of the two signed-in accounts", state.lookups)
	}
	want := []interface{}{"alice", "alice", "bob", nil, nil, "kept"}
	if fmt.Sprint(state.usernames) != fmt.Sprint(want) {
		t.Fatalf("usernames = %#v, want %#v", state.usernames, want)
	}
}
