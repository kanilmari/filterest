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
	"strings"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

var generationDriverCounter int64

type generationDriver struct {
	generation         int64
	survivingSignInID  driver.Value
	survivorGeneration driver.Value
	queries            int
	err                error
}
type generationConnection struct{ driver *generationDriver }
type generationRows struct {
	state *generationDriver
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
func (connection *generationConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	connection.driver.queries++
	if !strings.Contains(query, "ur.surviving_sign_in_id, ur.surviving_sign_in_generation") ||
		!strings.Contains(query, "u.enabled IS TRUE") {
		return nil, errors.New("generation and survivor must be read together for an enabled account")
	}
	if connection.driver.err != nil {
		return nil, connection.driver.err
	}
	return &generationRows{state: connection.driver}, nil
}
func (rows *generationRows) Columns() []string {
	return []string{"authentication_generation", "surviving_sign_in_id", "surviving_sign_in_generation"}
}
func (rows *generationRows) Close() error { return nil }
func (rows *generationRows) Next(destination []driver.Value) error {
	if rows.read {
		return io.EOF
	}
	rows.read = true
	destination[0] = rows.state.generation
	destination[1] = rows.state.survivingSignInID
	destination[2] = rows.state.survivorGeneration
	return nil
}

func openGenerationDatabase(t *testing.T, generation int64, queryErr error) *sql.DB {
	return openGenerationStateDatabase(t, &generationDriver{generation: generation, err: queryErr})
}

func openGenerationStateDatabase(t *testing.T, state *generationDriver) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("auth_generation_%d", atomic.AddInt64(&generationDriverCounter, 1))
	sql.Register(name, state)
	database, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestMatchesRejectsMissingOrStaleGeneration(t *testing.T) {
	session := sessions.NewSession(sessions.NewCookieStore([]byte("test-key-test-key-test-key-test-key")), "session")
	session.Values[sign_in_revocation.SessionKey] = "acting-sign-in"
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
	session.Values[sign_in_revocation.SessionKey] = "acting-sign-in"
	session.Values[SessionKey] = int64(4)
	if matches, err := Matches(context.Background(), openGenerationDatabase(t, 0, errors.New("database unavailable")), session, 42); err == nil || matches {
		t.Fatalf("database error: matches=%v error=%v", matches, err)
	}
}

func TestMatchesSurvivorOnlyForLatestBump(t *testing.T) {
	for _, test := range []struct {
		name               string
		stored, current    int64
		signInID           string
		survivorID         driver.Value
		survivorGeneration driver.Value
		want               bool
	}{
		{"current generation", 4, 4, "acting", nil, nil, true},
		{"stale survivor", 3, 4, "acting", "acting", int64(4), true},
		{"stale non-survivor", 3, 4, "other", "acting", int64(4), false},
		{"survivor after later bump", 3, 5, "acting", "acting", int64(4), false},
		{"higher generation", 5, 4, "acting", "acting", int64(4), false},
		{"missing sign-in identity", 3, 4, "", "acting", int64(4), false},
		{"current without sign-in identity", 4, 4, "", nil, nil, false},
		{"missing survivor generation", 3, 4, "acting", "acting", nil, false},
		{"missing survivor identity", 3, 4, "acting", nil, int64(4), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &generationDriver{generation: test.current, survivingSignInID: test.survivorID, survivorGeneration: test.survivorGeneration}
			db := openGenerationStateDatabase(t, state)
			session := &sessions.Session{Values: map[interface{}]interface{}{
				SessionKey: test.stored, sign_in_revocation.SessionKey: test.signInID,
			}}
			matches, err := Matches(context.Background(), db, session, 42)
			if err != nil || matches != test.want {
				t.Fatalf("matches=%v want=%v error=%v", matches, test.want, err)
			}
			wantGeneration := test.stored
			if test.want {
				wantGeneration = test.current
			}
			if stored, ok := SessionValue(session); !ok || stored != wantGeneration {
				t.Fatalf("session generation=%d want=%d", stored, wantGeneration)
			}
			wantQueries := 1
			if test.signInID == "" {
				wantQueries = 0
			}
			if state.queries != wantQueries {
				t.Fatalf("round trips=%d want=%d", state.queries, wantQueries)
			}
		})
	}
}

func TestMatchesRefusesDisabledOrMissingAccount(t *testing.T) {
	session := &sessions.Session{Values: map[interface{}]interface{}{
		SessionKey: int64(3), sign_in_revocation.SessionKey: "acting",
	}}
	db := openGenerationDatabase(t, 0, sql.ErrNoRows)
	if matches, err := Matches(context.Background(), db, session, 42); err != nil || matches {
		t.Fatalf("missing enabled credential row: matches=%v error=%v", matches, err)
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
	session.Values[AutomationSessionKey] = true

	ClearIdentity(session)
	for _, key := range []string{"authenticated", "user_id", "username", "user_role", SessionKey, AutomationSessionKey} {
		if _, exists := session.Values[key]; exists {
			t.Fatalf("identity key %q was not cleared", key)
		}
	}
	if session.Values["csrf_token"] != "keep" {
		t.Fatal("unrelated CSRF state should remain")
	}
}
