// auth_generation_test.go
// Verifies signed-session generation parsing, comparison, and identity clearing.
// Bridges deterministic SQL mocks with the stateless-session revocation contract.
// Exists so credential recovery cannot leave pre-recovery sessions authenticated.
package auth_generation

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync/atomic"
	"testing"

	"github.com/gorilla/sessions"
)

var generationDriverCounter int64

type generationDriver struct {
	generation int64
	err        error
}
type generationConnection struct{ driver *generationDriver }
type generationRows struct {
	value int64
	read  bool
}

func (databaseDriver *generationDriver) Open(string) (driver.Conn, error) {
	return &generationConnection{driver: databaseDriver}, nil
}
func (connection *generationConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare unsupported")
}
func (connection *generationConnection) Close() error { return nil }
func (connection *generationConnection) Begin() (driver.Tx, error) {
	return nil, errors.New("begin unsupported")
}
func (connection *generationConnection) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if connection.driver.err != nil {
		return nil, connection.driver.err
	}
	return &generationRows{value: connection.driver.generation}, nil
}
func (rows *generationRows) Columns() []string { return []string{"authentication_generation"} }
func (rows *generationRows) Close() error      { return nil }
func (rows *generationRows) Next(destination []driver.Value) error {
	if rows.read {
		return io.EOF
	}
	rows.read = true
	destination[0] = rows.value
	return nil
}

func openGenerationDatabase(t *testing.T, generation int64, queryErr error) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("auth_generation_%d", atomic.AddInt64(&generationDriverCounter, 1))
	sql.Register(name, &generationDriver{generation: generation, err: queryErr})
	database, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestMatchesRejectsMissingOrStaleGeneration(t *testing.T) {
	session := sessions.NewSession(sessions.NewCookieStore([]byte("test-key-test-key-test-key-test-key")), "session")
	if matches, err := Matches(context.Background(), openGenerationDatabase(t, 4, nil), session, 42); err != nil || matches {
		t.Fatalf("missing generation: matches=%v error=%v", matches, err)
	}
	session.Values[SessionKey] = int64(3)
	if matches, err := Matches(context.Background(), openGenerationDatabase(t, 4, nil), session, 42); err != nil || matches {
		t.Fatalf("stale generation: matches=%v error=%v", matches, err)
	}
	session.Values[SessionKey] = int64(4)
	if matches, err := Matches(context.Background(), openGenerationDatabase(t, 4, nil), session, 42); err != nil || !matches {
		t.Fatalf("current generation: matches=%v error=%v", matches, err)
	}
}

func TestMatchesFailsClosedOnDatabaseError(t *testing.T) {
	session := sessions.NewSession(sessions.NewCookieStore([]byte("test-key-test-key-test-key-test-key")), "session")
	session.Values[SessionKey] = int64(4)
	if matches, err := Matches(context.Background(), openGenerationDatabase(t, 0, errors.New("database unavailable")), session, 42); err == nil || matches {
		t.Fatalf("database error: matches=%v error=%v", matches, err)
	}
}

func TestClearIdentityLeavesUnrelatedSessionValues(t *testing.T) {
	session := sessions.NewSession(sessions.NewCookieStore([]byte("test-key-test-key-test-key-test-key")), "session")
	session.Values["authenticated"] = true
	session.Values["user_id"] = 42
	session.Values["username"] = "admin"
	session.Values["user_role"] = "admin"
	session.Values[SessionKey] = int64(3)
	session.Values["csrf_token"] = "keep"

	ClearIdentity(session)
	for _, key := range []string{"authenticated", "user_id", "username", "user_role", SessionKey} {
		if _, exists := session.Values[key]; exists {
			t.Fatalf("identity key %q was not cleared", key)
		}
	}
	if session.Values["csrf_token"] != "keep" {
		t.Fatal("unrelated CSRF state should remain")
	}
}
