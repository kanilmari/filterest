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
// A record lasts exactly as long as the sign-in it refuses could be presented,
// because that sign-in carries its own deadline (core_components/sign_in_deadline)
// and this record is kept to the same moment. That is what closes the gap this
// file was first written with: around thirty places in the application write a
// session, several on routes reachable without signing in, and each writes a fresh
// signature over whatever the session holds. Someone holding a stolen cookie could
// therefore keep it readable indefinitely -- but not usable, because the deadline
// inside it never moves and is checked here in the same breath.
package sign_in_revocation

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"easelect/backend/core_components/sign_in_deadline"

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

// NewSignInID mints the identity of one sign-in, without writing it anywhere. The
// caller is the one place that turns a session into an authenticated one, and it
// asks for this before it writes any of the identity, so a failure here cannot
// leave a half-written one behind.
func NewSignInID() (string, error) {
	raw := make([]byte, signInIDRandomBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("mint sign-in identity: %w", err)
	}
	return hex.EncodeToString(raw), nil
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

// StillUsable answers the whole question the authentication boundary asks about
// a sign-in: has it been signed out, and has it reached the last moment it was
// given? Both are decided in one exchange with the database, against one reading
// of the database's clock, so the two answers cannot disagree about what time it
// is and the boundary pays for one round trip rather than two.
//
// expiresAt is the moment stamped into the sign-in when it began, in seconds
// since the epoch, or sign_in_deadline.NeverExpires when it was deliberately
// given none. A sign-in is refused at its deadline and not merely after it: the
// alternative leaves one instant in which a sign-in is neither current nor yet
// expired, and the revocation record beside it already stops at equality.
//
// A revocation record is compared only while it is current. That is what makes
// the housekeeping optional rather than load-bearing: a row left behind by a
// cleanup that never ran stops refusing anything the moment it expires, and by
// then the deadline above refuses the same sign-in anyway, because the record is
// written to last exactly as long as the sign-in it refuses could be presented.
func StillUsable(ctx context.Context, db Querier, signInID string, expiresAt int64) (bool, error) {
	if signInID == "" {
		return true, nil
	}
	if db == nil {
		return false, ErrStoreUnavailable
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return false, ErrStoreUnavailable
	}

	// Whether this sign-in has a deadline at all is decided once, in Go, by the
	// package that owns the idea, and handed to the statement as its own answer.
	// Spelling the same rule again in SQL would be a second place to keep in step.
	unlimited := sign_in_deadline.Unlimited(expiresAt)

	var usable bool
	err := db.QueryRowContext(ctx, `
		SELECT ($3 OR now() < to_timestamp($2))
		   AND NOT EXISTS (
			SELECT 1
			FROM public.system_revoked_sign_ins
			WHERE sign_in_id = $1
			  AND expires_at > now()
		)
	`, signInID, expiresAt, unlimited).Scan(&usable)
	if err != nil {
		return false, fmt.Errorf("read revoked sign-in: %w", err)
	}
	return usable, nil
}

// Record writes down that one sign-in has been signed out, for exactly as long
// as that sign-in could otherwise still be presented.
//
// expiresAt is the deadline the sign-in was given when it began, in seconds since
// the epoch, or sign_in_deadline.NeverExpires when it was deliberately given none.
// The record is kept to that same moment and not to a length computed here: a
// length would be recomputed from whatever the setting says today, and a setting
// that can shorten a record is a way to bring a signed-out sign-in back. A sign-in
// with no deadline leaves a record with none either -- PostgreSQL's infinity --
// because there is no honest date on which refusing it could be dropped.
//
// A sign-in already past its deadline needs no record at all: the deadline refuses
// it on its own, from here to forever. Nothing is written and the sign-out is
// still complete.
//
// The same statement removes every record that has run out. Housekeeping is
// therefore paid for by the act that creates the work — one sign-out clears the
// dead rows of every earlier sign-out — and there is no switch to leave off and
// no schedule to miss. It is opportunistic, not a promise: on a site where nobody
// signs out again, yesterday's expired rows simply stay, so this is not a maximum
// retention and should not be described as one. A row that outstays its welcome
// refuses nothing, because StillUsable compares only records that are current.
// Records with no deadline are never swept, because nothing has proved them spent.
//
// What the row holds is one opaque identity and two times. It names no user, no
// address and no browser. That makes the table itself unrevealing; it does not
// make a sign-out unobservable, because the application's own audit log already
// records each sign-out with its user, address and time, and the two can be lined
// up by when they happened. This is pseudonymous storage beside an existing
// record, not anonymity added on top.
func Record(ctx context.Context, db Execer, signInID string, expiresAt int64) error {
	if signInID == "" {
		return errors.New("cannot record a sign-out without a sign-in identity")
	}
	if db == nil {
		return ErrStoreUnavailable
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return ErrStoreUnavailable
	}

	unlimited := sign_in_deadline.Unlimited(expiresAt)

	_, err := db.ExecContext(ctx, `
		WITH expired_records_removed AS (
			DELETE FROM public.system_revoked_sign_ins
			WHERE expires_at <= now()
		)
		INSERT INTO public.system_revoked_sign_ins (sign_in_id, expires_at)
		SELECT $1,
		       CASE WHEN $3 THEN 'infinity'::timestamptz
		            ELSE to_timestamp($2) END
		WHERE $3 OR to_timestamp($2) > now()
		ON CONFLICT (sign_in_id) DO NOTHING
	`, signInID, expiresAt, unlimited)
	if err != nil {
		return fmt.Errorf("record revoked sign-in: %w", err)
	}
	return nil
}
