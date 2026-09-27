// sign_in_revocation_test.go
// Pins what the server remembers about a sign-out and for how long.
// Between the sign-out that writes one record and the authentication boundary
// that reads it on every request of a signed-in person.
// Exists because the whole repair rests on three promises: a signed-out sign-in
// is refused, only that one sign-in is, and the records go away by themselves.
// The statements here are also run against real PostgreSQL by
// app/testing/python/test_revoked_sign_in_store.py, which reads them from the
// source file next to this one; these tests own the behaviour, that one owns the SQL.
package sign_in_revocation

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/sessions"
)

// revocationStore is the table, in memory: what each recorded sign-out says and
// when it stops saying it. The fake clock lets a test walk past a record's own
// lifetime without waiting seven days for it.
type revocationStore struct {
	expiryBySignInID map[string]time.Time
	now              time.Time
	readFailure      error
	writeFailure     error
	reads            int
	writes           int
}

type revocationDriver struct{ store *revocationStore }
type revocationConn struct{ store *revocationStore }
type revocationRows struct {
	names  []string
	values []driver.Value
	done   bool
}

func (d revocationDriver) Open(string) (driver.Conn, error)   { return &revocationConn{d.store}, nil }
func (c *revocationConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *revocationConn) Close() error                        { return nil }
func (c *revocationConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (r *revocationRows) Columns() []string                   { return r.names }
func (r *revocationRows) Close() error                        { return nil }
func (r *revocationRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(values, r.values)
	r.done = true
	return nil
}

func (c *revocationConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "public.system_revoked_sign_ins") {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	c.store.reads++
	if c.store.readFailure != nil {
		return nil, c.store.readFailure
	}
	signInID, _ := args[0].Value.(string)
	expiry, recorded := c.store.expiryBySignInID[signInID]
	// The query compares expires_at > now(); a record that has run out answers no.
	stillRefusing := recorded && expiry.After(c.store.now)
	return &revocationRows{names: []string{"exists"}, values: []driver.Value{stillRefusing}}, nil
}

func (c *revocationConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO public.system_revoked_sign_ins") {
		return nil, fmt.Errorf("unexpected statement: %s", query)
	}
	c.store.writes++
	if c.store.writeFailure != nil {
		return nil, c.store.writeFailure
	}
	// The same statement first removes every record that has run out.
	for signInID, expiry := range c.store.expiryBySignInID {
		if !expiry.After(c.store.now) {
			delete(c.store.expiryBySignInID, signInID)
		}
	}
	signInID, _ := args[0].Value.(string)
	seconds, _ := args[1].Value.(float64)
	if _, already := c.store.expiryBySignInID[signInID]; !already {
		c.store.expiryBySignInID[signInID] = c.store.now.Add(time.Duration(seconds) * time.Second)
	}
	return driver.RowsAffected(1), nil
}

var revocationTestCounter int64

func openRevocationStore(t *testing.T, store *revocationStore) *sql.DB {
	t.Helper()
	if store.expiryBySignInID == nil {
		store.expiryBySignInID = map[string]time.Time{}
	}
	if store.now.IsZero() {
		store.now = time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	}
	name := fmt.Sprintf("sign_in_revocation_%d", atomic.AddInt64(&revocationTestCounter, 1))
	sql.Register(name, revocationDriver{store})
	database, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open the revocation store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func sessionWithSignInID(signInID string) *sessions.Session {
	session := &sessions.Session{Values: map[interface{}]interface{}{}}
	if signInID != "" {
		session.Values[SessionKey] = signInID
	}
	return session
}

const testSignInLifetime = 7 * 24 * time.Hour

// Every sign-in gets its own identity, and nobody holding nothing can guess it.
func TestEachSignInGetsItsOwnUnguessableIdentity(t *testing.T) {
	seen := map[string]bool{}
	for attempt := 0; attempt < 64; attempt++ {
		session := &sessions.Session{Values: map[interface{}]interface{}{}}
		if err := Set(session); err != nil {
			t.Fatalf("mint a sign-in identity: %v", err)
		}
		signInID, present := SessionValue(session)
		if !present {
			t.Fatal("a session that was just signed in carries no sign-in identity")
		}
		if decoded, err := hex.DecodeString(signInID); err != nil || len(decoded) != signInIDRandomBytes {
			t.Fatalf("the identity %q is not %d random bytes: %v", signInID, signInIDRandomBytes, err)
		}
		if seen[signInID] {
			t.Fatalf("two sign-ins were given the same identity %q", signInID)
		}
		seen[signInID] = true
	}
}

// The promise the repair rests on: what has been signed out stays signed out.
func TestASignedOutSignInIsRefusedForAsLongAsItsCookiesCouldLive(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedOutAt := store.now

	if err := Record(context.Background(), database, "the-signed-out-sign-in", testSignInLifetime); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	for _, moment := range []time.Duration{0, time.Second, 24 * time.Hour, testSignInLifetime - time.Second} {
		store.now = signedOutAt.Add(moment)
		revoked, err := Revoked(context.Background(), database, "the-signed-out-sign-in")
		if err != nil {
			t.Fatalf("read the record %v after the sign-out: %v", moment, err)
		}
		if !revoked {
			t.Fatalf("%v after the sign-out the sign-in was accepted again", moment)
		}
	}
}

// The record only has to outlive the sign-in it refuses. Once the cookies could
// no longer be read anyway, it stops answering and may be thrown away.
func TestTheRecordStopsRefusingOnceTheSignInCouldNoLongerBeRead(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedOutAt := store.now

	if err := Record(context.Background(), database, "the-signed-out-sign-in", testSignInLifetime); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	store.now = signedOutAt.Add(testSignInLifetime + time.Second)
	revoked, err := Revoked(context.Background(), database, "the-signed-out-sign-in")
	if err != nil {
		t.Fatalf("read the record after it ran out: %v", err)
	}
	if revoked {
		t.Fatal("a record that has run out is still refusing, so the table would only ever grow")
	}
}

// Housekeeping is paid for by the act that creates the work: one sign-out clears
// the records of every earlier sign-out that has run out.
func TestASignOutClearsTheRecordsThatHaveRunOut(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	firstSignOutAt := store.now

	for _, signInID := range []string{"old-one", "old-two", "old-three"} {
		if err := Record(context.Background(), database, signInID, testSignInLifetime); err != nil {
			t.Fatalf("record the sign-out of %s: %v", signInID, err)
		}
	}
	if len(store.expiryBySignInID) != 3 {
		t.Fatalf("the store holds %d records, want 3", len(store.expiryBySignInID))
	}

	store.now = firstSignOutAt.Add(testSignInLifetime + time.Hour)
	if err := Record(context.Background(), database, "a-later-sign-out", testSignInLifetime); err != nil {
		t.Fatalf("record the later sign-out: %v", err)
	}

	if len(store.expiryBySignInID) != 1 {
		t.Fatalf("after a later sign-out the store holds %d records, want only the new one", len(store.expiryBySignInID))
	}
	if _, kept := store.expiryBySignInID["a-later-sign-out"]; !kept {
		t.Fatal("the later sign-out was not recorded")
	}
}

// Signing out on one browser must not sign the same person out of another.
func TestOnlyTheBrowserThatSignedOutIsRefused(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)

	if err := Record(context.Background(), database, "the-phone", testSignInLifetime); err != nil {
		t.Fatalf("record the phone's sign-out: %v", err)
	}

	revoked, err := Revoked(context.Background(), database, "the-desktop")
	if err != nil {
		t.Fatalf("read the desktop's record: %v", err)
	}
	if revoked {
		t.Fatal("signing out on one browser signed the same person out of the other")
	}
}

// Signing out the same browser twice records one sign-out, so a browser cannot
// be used to fill the table.
func TestSigningTheSameBrowserOutTwiceRecordsItOnce(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)

	for attempt := 0; attempt < 5; attempt++ {
		if err := Record(context.Background(), database, "one-browser", testSignInLifetime); err != nil {
			t.Fatalf("record sign-out %d: %v", attempt, err)
		}
	}
	if len(store.expiryBySignInID) != 1 {
		t.Fatalf("five sign-outs of one browser left %d records, want 1", len(store.expiryBySignInID))
	}
}

// A visitor who never signed in, and a sign-in made before this contract existed,
// carry no identity. Neither costs a question of the database.
func TestASessionWithNoSignInIdentityAsksTheDatabaseNothing(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)

	for _, session := range []*sessions.Session{nil, sessionWithSignInID(""), {Values: map[interface{}]interface{}{"user_id": 42}}} {
		revoked, err := SessionRevoked(context.Background(), database, session)
		if err != nil || revoked {
			t.Fatalf("a session with no sign-in identity was answered revoked=%v, err=%v", revoked, err)
		}
	}
	if store.reads != 0 {
		t.Fatalf("the database was asked %d times about sessions that have nothing to ask about", store.reads)
	}
}

// A session that does carry an identity is compared against the store.
func TestASessionCarryingAnIdentityIsCompared(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	if err := Record(context.Background(), database, "the-signed-out-sign-in", testSignInLifetime); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	revoked, err := SessionRevoked(context.Background(), database, sessionWithSignInID("the-signed-out-sign-in"))
	if err != nil {
		t.Fatalf("compare the session: %v", err)
	}
	if !revoked {
		t.Fatal("a session whose sign-in was signed out was not refused")
	}
}

// A store that cannot be reached is not an answer. The callers turn this into
// "try again", never into a pass, and a visitor who never signed in never
// reaches it, so public browsing is unaffected by the outage.
func TestAnUnreachableStoreIsNeverReadAsAPass(t *testing.T) {
	store := &revocationStore{readFailure: errors.New("the database is unreachable")}
	database := openRevocationStore(t, store)

	revoked, err := SessionRevoked(context.Background(), database, sessionWithSignInID("any-sign-in"))
	if err == nil {
		t.Fatal("an unreachable store answered without an error")
	}
	if revoked {
		t.Fatal("an unreachable store must not claim a sign-in is revoked either")
	}

	if _, err := Revoked(context.Background(), nil, "any-sign-in"); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("with no store at all: got %v, want %v", err, ErrStoreUnavailable)
	}
	var missingDatabase *sql.DB
	if _, err := Revoked(context.Background(), missingDatabase, "any-sign-in"); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("with a nil database: got %v, want %v", err, ErrStoreUnavailable)
	}
}

// A sign-out that could not be written must say so, so the handler does not
// present an incomplete sign-out as finished.
func TestARecordThatCannotBeWrittenIsReported(t *testing.T) {
	store := &revocationStore{writeFailure: errors.New("the database is unreachable")}
	database := openRevocationStore(t, store)

	if err := Record(context.Background(), database, "the-sign-in", testSignInLifetime); err == nil {
		t.Fatal("a sign-out that could not be written was reported as written")
	}

	if err := Record(context.Background(), database, "", testSignInLifetime); err == nil {
		t.Fatal("a sign-out with no identity was accepted")
	}
	if err := Record(context.Background(), database, "the-sign-in", 0); err == nil {
		t.Fatal("a record with no lifetime was accepted; it would refuse nothing")
	}
	if err := Record(context.Background(), nil, "the-sign-in", testSignInLifetime); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("with no store at all: got %v, want %v", err, ErrStoreUnavailable)
	}
}
