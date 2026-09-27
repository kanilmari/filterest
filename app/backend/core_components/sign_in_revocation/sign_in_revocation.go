// sign_in_revocation.go
// Remembers which individual sign-ins have been signed out, so a sign-out sticks.
// Between the sign-out handler, which ends one browser's sign-in, and the
// authentication boundary, which has to keep refusing it afterwards.
// Exists because a sign-in lives entirely in cookies: signing out only expires them
// in the browser, and a request that was already in flight writes all three back
// when it finishes, handing the person working credentials they believe they gave up.
//
// This revokes one sign-in, not one account: signing out on a phone leaves the same
// person's desktop signed in. Ending every sign-in of an account at once is the
// separate, already existing authentication_generation in
// app/backend/core_components/auth_generation/auth_generation.go, which belongs to a
// credential change or a disabled account. The two are deliberately not merged.
//
// What this does not yet reach. A record stops refusing when it expires, and it is
// written to outlive the cookie it refuses -- but only because that cookie's
// signature is not renewed afterwards. Signing out no longer renews it (the sign-out
// handler empties the identity before the session is written), yet the application
// has around thirty other places that write a session, several of them on routes
// reachable without signing in. Someone who already holds a stolen session cookie
// could use one of those to have it signed afresh and so outlast the record. Closing
// that off route by route would be a list to keep in step by hand; the durable fix is
// a sign-in deadline that is stamped once and cannot be pushed forward, checked at
// this same boundary against the database's clock. Until that exists, the guarantee
// here is honest but bounded: a sign-out holds against an ordinary copy of the cookie
// and against a request that was already in flight, not against someone deliberately
// refreshing a stolen one.
package sign_in_revocation

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/gorilla/sessions"
)

// SessionKey is where a sign-in carries its own identity. The value is minted at
// sign-in and travels inside the signed session cookie, so a browser cannot choose
// or alter it: the signature is what makes it trustworthy. Whether a browser can
// *read* it depends on the installation, because session encryption is optional
// (sessions/sessions.go warns when SESSION_SECRET_KEY is unset). Nothing here
// relies on the value being secret from the browser holding it -- only on its
// being unguessable by anyone else, so that no one can end a sign-in that is not
// theirs. auth_generation.ClearIdentity removes it with the rest of the
// authenticated identity, which is why that file names this constant.
const SessionKey = "sign_in_id"

// signInIDRandomBytes is 128 bits of randomness. The identity has to be
// unguessable by someone holding nothing: a guessed value would let a stranger
// end another person's sign-in, which is the only thing knowing it is good for.
const signInIDRandomBytes = 16

// ErrStoreUnavailable is returned when there is no database to ask. The callers
// hand it on exactly as they already hand on a credential read they could not
// make, so this adds no new failure behaviour -- it inherits whatever each
// boundary already does. That is not one answer everywhere: most boundaries say
// the authentication state is unavailable (503), registration refuses (403) and
// the storage route answers as if the file were not there (404). A signed-in
// person is asked to try again rather than signed out. A visitor who never signed
// in does not reach this check at all, though that alone does not keep a public
// site browsable through a database outage, because the configuration read beside
// it can fail too.
var ErrStoreUnavailable = errors.New("revoked sign-in store unavailable")

// Querier is the narrow read capability the check needs.
type Querier interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

// Execer is the narrow write capability recording a sign-out needs.
type Execer interface {
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
}

// newSignInID mints the identity of one sign-in. It is deliberately not exported:
// a sign-in identity is only ever written by Set, at the one moment a session
// becomes authenticated, so nothing outside can mint one to be trusted later.
func newSignInID() (string, error) {
	raw := make([]byte, signInIDRandomBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("mint sign-in identity: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// Set gives a session being signed in its own identity. It is called from the one
// place that turns a session into an authenticated one, so every sign-in gets a
// fresh identity and no two sign-ins of the same person share one.
func Set(session *sessions.Session) error {
	if session == nil {
		return errors.New("cannot identify a sign-in without a session")
	}
	signInID, err := newSignInID()
	if err != nil {
		return err
	}
	session.Values[SessionKey] = signInID
	return nil
}

// SessionValue reads the sign-in identity from a decoded session, and reports
// whether there was one at all rather than returning an empty identity.
//
// The distinction matters because the two answers are acted on differently. A
// visitor who never signed in simply has nothing here. A sign-in made before this
// contract existed also has nothing -- and it cannot be signed out and made to
// stay out, so the shared boundary refuses it
// (core_components/login_access_policy.go) and the person signs in once more.
// Letting such a sign-in continue was considered and rejected: a used sign-in is
// renewed, so one visited daily would never run out on its own.
func SessionValue(session *sessions.Session) (string, bool) {
	if session == nil {
		return "", false
	}
	signInID, ok := session.Values[SessionKey].(string)
	if !ok || signInID == "" {
		return "", false
	}
	return signInID, true
}

// Revoked reports whether this sign-in has been signed out and is still within
// the time its record has to cover.
//
// The record is only compared while it is current. That is what makes the
// housekeeping optional rather than load-bearing: a row left behind by a
// cleanup that never ran stops refusing anything the moment it expires, and by
// then the cookie carrying that sign-in can no longer be read either, because
// the session store accepts a signature only for SignInLifetime
// (sessions/auth_cookie_identity.go, enforced by sessions/sessions.go).
func Revoked(ctx context.Context, db Querier, signInID string) (bool, error) {
	if signInID == "" {
		return false, nil
	}
	if db == nil {
		return false, ErrStoreUnavailable
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return false, ErrStoreUnavailable
	}

	var revoked bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.system_revoked_sign_ins
			WHERE sign_in_id = $1
			  AND expires_at > now()
		)
	`, signInID).Scan(&revoked)
	if err != nil {
		return false, fmt.Errorf("read revoked sign-in: %w", err)
	}
	return revoked, nil
}

// SessionRevoked answers the same question for a whole session, and is what the
// authentication boundary calls. A session with no sign-in identity asks nothing
// of the database.
func SessionRevoked(ctx context.Context, db Querier, session *sessions.Session) (bool, error) {
	signInID, present := SessionValue(session)
	if !present {
		return false, nil
	}
	return Revoked(ctx, db, signInID)
}

// Record writes down that one sign-in has been signed out, for as long as that
// sign-in could otherwise still be presented.
//
// The lifetime is the caller's SignInLifetime, and the database computes both
// ends of it from its own clock, so a difference between the application's clock
// and the database's cannot shorten the record. It has to outlive the cookies it
// refuses, and it does: the browser's copy of the session was last signed before
// this moment, so it becomes unreadable before this record is gone.
//
// The same statement removes every record that has run out. Housekeeping is
// therefore paid for by the act that creates the work — one sign-out clears the
// dead rows of every earlier sign-out — and there is no switch to leave off and
// no schedule to miss. It is opportunistic, not a promise: on a site where nobody
// signs out again, yesterday's expired rows simply stay. That is harmless but it
// is not a seven-day maximum retention, and it should not be described as one. A
// row that outstays its welcome refuses nothing, because Revoked compares only
// records that are current.
//
// What the row holds is one opaque identity and two times. It names no user, no
// address and no browser. That makes the table itself unrevealing; it does not
// make a sign-out unobservable, because the application's own audit log already
// records each sign-out with its user, address and time, and the two can be lined
// up by when they happened. This is pseudonymous storage beside an existing
// record, not anonymity added on top.
func Record(ctx context.Context, db Execer, signInID string, lifetime time.Duration) error {
	if signInID == "" {
		return errors.New("cannot record a sign-out without a sign-in identity")
	}
	if db == nil {
		return ErrStoreUnavailable
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return ErrStoreUnavailable
	}
	if lifetime <= 0 {
		return fmt.Errorf("a revoked sign-in must be remembered for a positive time, got %v", lifetime)
	}

	_, err := db.ExecContext(ctx, `
		WITH expired_records_removed AS (
			DELETE FROM public.system_revoked_sign_ins
			WHERE expires_at <= now()
		)
		INSERT INTO public.system_revoked_sign_ins (sign_in_id, expires_at)
		VALUES ($1, now() + make_interval(secs => $2))
		ON CONFLICT (sign_in_id) DO NOTHING
	`, signInID, lifetime.Seconds())
	if err != nil {
		return fmt.Errorf("record revoked sign-in: %w", err)
	}
	return nil
}
