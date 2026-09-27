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

	"easelect/backend/core_components/sign_in_deadline"

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
	lastUnlimited    *bool
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
	expiresAt, _ := args[1].Value.(int64)
	unlimited, _ := args[2].Value.(bool)
	c.store.lastUnlimited = &unlimited

	// The statement asks two things of one clock: is this sign-in still within
	// the deadline it was given, and is there a record still refusing it. Whether
	// the sign-in is unlimited comes from the third argument, exactly as the
	// statement reads it. Working it out here from a negative number instead
	// would leave the wiring between Go and the statement untested -- the fake
	// would agree with itself whatever Go actually sent.
	withinDeadline := unlimited || c.store.now.Before(time.Unix(expiresAt, 0))
	expiry, recorded := c.store.expiryBySignInID[signInID]
	stillRefused := recorded && expiry.After(c.store.now)

	return &revocationRows{
		names:  []string{"usable"},
		values: []driver.Value{withinDeadline && !stillRefused},
	}, nil
}

func (c *revocationConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "INSERT INTO public.system_revoked_sign_ins") {
		return nil, fmt.Errorf("unexpected statement: %s", query)
	}
	c.store.writes++
	if c.store.writeFailure != nil {
		return nil, c.store.writeFailure
	}
	// The same statement first removes every record that has run out. A record
	// with no end -- the sign-in was given no deadline -- is never among them.
	for signInID, expiry := range c.store.expiryBySignInID {
		if expiry != forever && !expiry.After(c.store.now) {
			delete(c.store.expiryBySignInID, signInID)
		}
	}
	signInID, _ := args[0].Value.(string)
	expiresAt, _ := args[1].Value.(int64)
	unlimited, _ := args[2].Value.(bool)

	// A sign-in already past its deadline is refused by the deadline itself, so
	// the statement's WHERE writes nothing for it.
	if !unlimited && !time.Unix(expiresAt, 0).After(c.store.now) {
		return driver.RowsAffected(0), nil
	}
	if _, already := c.store.expiryBySignInID[signInID]; !already {
		if unlimited {
			c.store.expiryBySignInID[signInID] = forever
		} else {
			c.store.expiryBySignInID[signInID] = time.Unix(expiresAt, 0)
		}
	}
	return driver.RowsAffected(1), nil
}

// forever stands in for the database's own infinity: the end of a record that
// refuses a sign-in which was never given a deadline.
var forever = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

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

// deadlineAfter is the moment a sign-in started now would be given, as the
// session carries it: whole seconds since the epoch.
func deadlineAfter(from time.Time, after time.Duration) int64 {
	return from.Add(after).Unix()
}

const testSignInLimit = 30 * 24 * time.Hour

// Every sign-in gets its own identity, and nobody holding nothing can guess it.
func TestEachSignInGetsItsOwnUnguessableIdentity(t *testing.T) {
	seen := map[string]bool{}
	for attempt := 0; attempt < 64; attempt++ {
		signInID, err := NewSignInID()
		if err != nil {
			t.Fatalf("mint a sign-in identity: %v", err)
		}
		// What the sign-in handler then writes, and what the boundary reads back.
		session := &sessions.Session{Values: map[interface{}]interface{}{SessionKey: signInID}}
		if readBack, present := SessionValue(session); !present || readBack != signInID {
			t.Fatalf("the identity read back as %q, %v", readBack, present)
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

// The promise the repair rests on: what has been signed out stays signed out,
// for exactly as long as it could otherwise have been presented.
func TestASignedOutSignInIsRefusedUntilItsOwnDeadline(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedInAt := store.now
	deadline := deadlineAfter(signedInAt, testSignInLimit)

	if err := Record(context.Background(), database, "the-signed-out-sign-in", deadline); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	for _, moment := range []time.Duration{0, time.Second, 24 * time.Hour, testSignInLimit - time.Second} {
		store.now = signedInAt.Add(moment)
		usable, err := StillUsable(context.Background(), database, "the-signed-out-sign-in", deadline)
		if err != nil {
			t.Fatalf("read the record %v after the sign-out: %v", moment, err)
		}
		if usable {
			t.Fatalf("%v after the sign-out the sign-in was accepted again", moment)
		}
	}
}

// The record only has to outlive the sign-in it refuses, and it is written to end
// at exactly that moment. Past it, the deadline refuses the same sign-in on its
// own, so the record may be thrown away without letting anything back in.
func TestOnceTheRecordEndsTheDeadlineRefusesTheSameSignIn(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedInAt := store.now
	deadline := deadlineAfter(signedInAt, testSignInLimit)

	if err := Record(context.Background(), database, "the-signed-out-sign-in", deadline); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	// Past the deadline the record has run out. The sign-in must still be refused.
	store.now = signedInAt.Add(testSignInLimit + time.Second)
	usable, err := StillUsable(context.Background(), database, "the-signed-out-sign-in", deadline)
	if err != nil {
		t.Fatalf("read after the record ran out: %v", err)
	}
	if usable {
		t.Fatal("once its record expired the sign-in was accepted again; the deadline is not being enforced")
	}
}

// A sign-in nobody signed out is still finished when its time is up. This is what
// closes the gap the revocation record alone could not: a cookie kept readable by
// being signed again elsewhere still carries the deadline it was born with.
func TestASignInIsRefusedAtItsDeadlineWithoutAnySignOut(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedInAt := store.now
	deadline := deadlineAfter(signedInAt, testSignInLimit)

	for _, testCase := range []struct {
		when time.Duration
		want bool
	}{
		{testSignInLimit - time.Second, true},
		// Exactly at the deadline it is already finished. Anything else leaves one
		// instant in which a sign-in is neither current nor yet expired.
		{testSignInLimit, false},
		{testSignInLimit + time.Second, false},
	} {
		store.now = signedInAt.Add(testCase.when)
		usable, err := StillUsable(context.Background(), database, "a-sign-in-nobody-ended", deadline)
		if err != nil {
			t.Fatalf("%v after signing in: %v", testCase.when, err)
		}
		if usable != testCase.want {
			t.Fatalf("%v after signing in the sign-in was usable = %v, want %v", testCase.when, usable, testCase.want)
		}
	}
}

// A sign-in made while the limit was switched off has no deadline to reach, so
// only a sign-out can end it -- and that record may never be dropped, because
// nothing would ever prove it spent.
func TestASignInWithNoDeadlineIsRefusedForGoodOnceSignedOut(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	signedInAt := store.now

	usable, err := StillUsable(context.Background(), database, "an-unlimited-sign-in", sign_in_deadline.NeverExpires)
	if err != nil {
		t.Fatalf("read an unlimited sign-in: %v", err)
	}
	if !usable {
		t.Fatal("a sign-in with no deadline was refused although nobody signed it out")
	}

	if err := Record(context.Background(), database, "an-unlimited-sign-in", sign_in_deadline.NeverExpires); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}
	for _, moment := range []time.Duration{time.Second, 10 * 365 * 24 * time.Hour} {
		store.now = signedInAt.Add(moment)
		usable, err := StillUsable(context.Background(), database, "an-unlimited-sign-in", sign_in_deadline.NeverExpires)
		if err != nil {
			t.Fatalf("read %v after the sign-out: %v", moment, err)
		}
		if usable {
			t.Fatalf("%v after signing out, a sign-in with no deadline was accepted again", moment)
		}
	}
}

// A sign-in already past its deadline is refused by the deadline itself, so there
// is nothing worth writing down about it.
func TestSigningOutAnAlreadyFinishedSignInWritesNothing(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, -time.Hour)

	if err := Record(context.Background(), database, "a-finished-sign-in", deadline); err != nil {
		t.Fatalf("signing out a finished sign-in must still succeed: %v", err)
	}
	if len(store.expiryBySignInID) != 0 {
		t.Fatalf("a finished sign-in left %d record(s) behind", len(store.expiryBySignInID))
	}
	usable, err := StillUsable(context.Background(), database, "a-finished-sign-in", deadline)
	if err != nil {
		t.Fatalf("read a finished sign-in: %v", err)
	}
	if usable {
		t.Fatal("a sign-in past its deadline was accepted")
	}
}

// Housekeeping is paid for by the act that creates the work: one sign-out clears
// the records of every earlier sign-out that has run out.
func TestASignOutClearsTheRecordsThatHaveRunOut(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	firstSignOutAt := store.now

	for _, signInID := range []string{"one-old-sign-out", "another-old-sign-out"} {
		if err := Record(context.Background(), database, signInID, deadlineAfter(firstSignOutAt, testSignInLimit)); err != nil {
			t.Fatalf("record %q: %v", signInID, err)
		}
	}
	if len(store.expiryBySignInID) != 2 {
		t.Fatalf("the store holds %d records, want 2", len(store.expiryBySignInID))
	}

	store.now = firstSignOutAt.Add(testSignInLimit + time.Hour)
	if err := Record(context.Background(), database, "a-later-sign-out", deadlineAfter(store.now, testSignInLimit)); err != nil {
		t.Fatalf("record the later sign-out: %v", err)
	}
	if len(store.expiryBySignInID) != 1 {
		t.Fatalf("after a later sign-out the store holds %d records, want only the newest", len(store.expiryBySignInID))
	}
	if _, kept := store.expiryBySignInID["a-later-sign-out"]; !kept {
		t.Fatal("the sign-out that did the clearing cleared itself away")
	}
}

// Signing out on a phone must not sign the same person out of their desktop.
func TestOnlyTheBrowserThatSignedOutIsRefused(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, testSignInLimit)

	if err := Record(context.Background(), database, "the-phone", deadline); err != nil {
		t.Fatalf("record the phone's sign-out: %v", err)
	}

	usable, err := StillUsable(context.Background(), database, "the-desktop", deadline)
	if err != nil {
		t.Fatalf("read the desktop's sign-in: %v", err)
	}
	if !usable {
		t.Fatal("signing out on one browser signed the same person out of another")
	}
}

// Two sign-outs of the same browser leave one record, and the first one's end
// stands: a second sign-out may not push a refusal further into the future than
// the sign-in it refuses could ever reach.
func TestSigningTheSameBrowserOutTwiceRecordsItOnce(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, testSignInLimit)

	for attempt := 0; attempt < 2; attempt++ {
		if err := Record(context.Background(), database, "one-browser", deadline); err != nil {
			t.Fatalf("sign-out %d: %v", attempt+1, err)
		}
	}
	if len(store.expiryBySignInID) != 1 {
		t.Fatalf("two sign-outs of one browser left %d records", len(store.expiryBySignInID))
	}
	if got := store.expiryBySignInID["one-browser"]; !got.Equal(time.Unix(deadline, 0)) {
		t.Fatalf("the record ends at %v, want the sign-in's own deadline %v", got, time.Unix(deadline, 0))
	}
}

// A visitor who never signed in carries no identity, and nothing is asked of the
// database on their behalf.
func TestASignInWithNoIdentityAsksTheDatabaseNothing(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)

	usable, err := StillUsable(context.Background(), database, "", deadlineAfter(store.now, testSignInLimit))
	if err != nil {
		t.Fatalf("an unidentified sign-in: %v", err)
	}
	if !usable {
		t.Fatal("a request carrying no sign-in identity was refused here rather than at the boundary")
	}
	if store.reads != 0 {
		t.Fatalf("the database was asked %d times about a request that carries no sign-in", store.reads)
	}
}

// A session that carries an identity is compared, and a signed-out one refused.
func TestASessionCarryingAnIdentityIsCompared(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, testSignInLimit)

	if err := Record(context.Background(), database, "the-signed-out-sign-in", deadline); err != nil {
		t.Fatalf("record the sign-out: %v", err)
	}

	signInID, present := SessionValue(sessionWithSignInID("the-signed-out-sign-in"))
	if !present {
		t.Fatal("a signed-in session reported no identity")
	}
	usable, err := StillUsable(context.Background(), database, signInID, deadline)
	if err != nil {
		t.Fatalf("compare the session: %v", err)
	}
	if usable {
		t.Fatal("a session naming a signed-out sign-in was accepted")
	}
	if store.reads != 1 {
		t.Fatalf("the database was asked %d times, want once", store.reads)
	}
}

// A store that cannot be read is never read as a pass.
func TestAnUnreachableStoreIsNeverReadAsAPass(t *testing.T) {
	store := &revocationStore{readFailure: errors.New("the store is unreachable")}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, testSignInLimit)

	usable, err := StillUsable(context.Background(), database, "any-sign-in", deadline)
	if err == nil {
		t.Fatal("an unreadable store answered without an error")
	}
	if usable {
		t.Fatal("an unreadable store was read as a pass")
	}

	if _, err := StillUsable(context.Background(), nil, "any-sign-in", deadline); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("a missing store answered %v, want %v", err, ErrStoreUnavailable)
	}
	var missingDatabase *sql.DB
	if _, err := StillUsable(context.Background(), missingDatabase, "any-sign-in", deadline); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("a nil database answered %v, want %v", err, ErrStoreUnavailable)
	}
}

// A sign-out that could not be written is reported, so the person is told rather
// than shown a sign-out that did not happen.
func TestARecordThatCannotBeWrittenIsReported(t *testing.T) {
	store := &revocationStore{writeFailure: errors.New("the store is unreachable")}
	database := openRevocationStore(t, store)
	deadline := deadlineAfter(store.now, testSignInLimit)

	if err := Record(context.Background(), database, "the-sign-in", deadline); err == nil {
		t.Fatal("a sign-out that could not be written was reported as done")
	}
	if err := Record(context.Background(), database, "", deadline); err == nil {
		t.Fatal("a sign-out with no sign-in identity was accepted")
	}
	if err := Record(context.Background(), nil, "the-sign-in", deadline); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("a missing store answered %v, want %v", err, ErrStoreUnavailable)
	}
}

// The statement is handed three things, and the third is the one the SQL actually
// branches on. A fake that worked "unlimited" out for itself from a negative
// number would agree with itself whatever Go sent, so this pins the wiring: what
// the package decides in Go is what arrives at the statement.
func TestTheStatementIsToldWhetherTheSignInIsUnlimited(t *testing.T) {
	store := &revocationStore{}
	database := openRevocationStore(t, store)

	for _, testCase := range []struct {
		name      string
		expiresAt int64
		unlimited bool
	}{
		{"an ordinary deadline", deadlineAfter(store.now, testSignInLimit), false},
		{"no deadline at all", sign_in_deadline.NeverExpires, true},
	} {
		store.lastUnlimited = nil
		if _, err := StillUsable(context.Background(), database, "a-sign-in", testCase.expiresAt); err != nil {
			t.Fatalf("%s: %v", testCase.name, err)
		}
		if store.lastUnlimited == nil {
			t.Fatalf("%s: the statement was never told whether the sign-in is unlimited", testCase.name)
		}
		if *store.lastUnlimited != testCase.unlimited {
			t.Fatalf("%s: the statement was told unlimited = %v, want %v",
				testCase.name, *store.lastUnlimited, testCase.unlimited)
		}
	}
}
