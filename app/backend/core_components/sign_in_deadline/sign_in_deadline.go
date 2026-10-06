// sign_in_deadline.go
// Gives every sign-in a last moment, decided once when it begins and never revised.
// Between the administrator's setting, the one place a session becomes authenticated,
// and the shared boundary that refuses a sign-in which has reached its deadline.
// Exists because a sign-in had no ceiling. It was renewed on every visit, so one
// used daily never ended; and around thirty places write a session, several of them
// on routes reachable without signing in, each writing a fresh signature over
// whatever the session holds. A cookie copied elsewhere could therefore be signed
// again and again and outlive the record of its own sign-out. A deadline stamped
// into the signed cookie at sign-in cannot be pushed forward by any of them.
//
// The deadline is a moment, not a length. Storing the sign-in's start and comparing
// it against whatever the setting says today would leave the setting itself as a way
// to extend a sign-in: sign out under a one-day limit, keep the cookie signed, then
// raise the limit to thirty days, and the same cookie is accepted again once its
// refusal record has run out. Changing the setting therefore governs sign-ins made
// after the change and never touches one already given.
package sign_in_deadline

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"easelect/backend/core_components/system_config_checks"
	"easelect/backend/reusable_components/setting_duration"

	"github.com/gorilla/sessions"
)

// SessionKey is where a sign-in carries its own last moment, as whole seconds
// since the epoch. It is a plain integer because the session is serialised by
// encoding/gob, which needs a registered type for anything it does not already
// know; a number needs nothing and means the same on both sides.
// auth_generation.ClearIdentity removes it with the rest of the authenticated
// identity, which is why that file names this constant.
const SessionKey = "sign_in_expires_at"

// NeverExpires marks a sign-in that was deliberately given no deadline, because
// the limit was switched off when it began. It is a value rather than an absent
// key so the two can be told apart: this one was decided, and a missing key was
// not. A sign-in with a missing key is refused.
const NeverExpires int64 = -1

// ConfigKey names the one settings row that decides the ceiling.
const ConfigKey = system_config_checks.SignInLimitKey

// Policy is what that row says. The three parts travel together because none of
// them means anything alone.
type Policy struct {
	Enabled bool   `json:"limit_enabled"`
	Unit    string `json:"limit_unit"`
	Amount  int    `json:"limit_amount"`
}

// DefaultPolicy is what a site gets when the row is missing or cannot be read as
// a policy. It is the protective answer, not the permissive one: a row that has
// been deleted or damaged must not quietly remove the ceiling. Switching the
// limit off is possible, but only by saying so.
var limitDefinition, DefaultPolicy = defaultLimitPolicy()

// A broken built-in definition is a build defect, never an unlimited fallback.
func defaultLimitPolicy() (setting_duration.Definition, Policy) {
	definition, found := system_config_checks.DurationDefinition(ConfigKey)
	if !found {
		panic("the sign-in limit has no registered duration definition")
	}
	value, err := setting_duration.Parse(definition.Default, definition)
	if err != nil {
		panic(fmt.Sprintf("invalid built-in sign-in limit: %v", err))
	}
	return definition, Policy{Enabled: value.Enabled, Unit: value.Unit, Amount: value.Amount}
}

// ErrPolicyUnreadable means the database could not be asked. It is deliberately
// not the same as a missing row: an absent policy has an answer, while a failed
// read has none, and answering a failed read with a default would let a database
// fault quietly widen a site's ceiling.
var ErrPolicyUnreadable = errors.New("the sign-in limit could not be read")

// Querier is the narrow read capability this package needs.
type Querier interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

// Duration gives the elapsed length for callers that have no calendar date.
// Calendar units require a starting date and are applied by Decide instead.
func (p Policy) Duration() (time.Duration, error) {
	if err := setting_duration.Validate(p.durationValue(), limitDefinition); err != nil {
		return 0, err
	}
	unit := setting_duration.NormalizeUnit(p.Unit)
	if unit == "months" || unit == "years" {
		return 0, errors.New("calendar durations require a starting date")
	}
	start := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	end, err := p.durationValue().AddTo(start)
	return end.Sub(start), err
}

func (p Policy) durationValue() setting_duration.Value {
	return setting_duration.Value{Enabled: p.Enabled, Unit: p.Unit, Amount: p.Amount}
}

// Valid uses the same rule as every settings writer.
func (p Policy) Valid() bool {
	return setting_duration.Validate(p.durationValue(), limitDefinition) == nil
}

// ReadPolicy returns the configured ceiling and the database's own idea of the
// current moment, in one question, so a sign-in costs one extra exchange and not
// two. The database's clock is used at both ends -- here and at the boundary --
// so a workstation or container whose clock is wrong cannot hand out a deadline
// that is wrong by the same amount.
//
// A row that is missing, or that cannot be read as a policy, yields DefaultPolicy
// and says so in the log, because an operator can only fix what they are told
// about. A database that cannot be asked yields ErrPolicyUnreadable.
func ReadPolicy(ctx context.Context, db Querier) (Policy, time.Time, error) {
	if db == nil {
		return Policy{}, time.Time{}, ErrPolicyUnreadable
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return Policy{}, time.Time{}, ErrPolicyUnreadable
	}

	var (
		now time.Time
		raw sql.NullString
	)
	err := db.QueryRowContext(ctx, `
		SELECT now(),
		       (SELECT json_value::text
		          FROM public.system_config
		         WHERE key = $1)
	`, ConfigKey).Scan(&now, &raw)
	if err != nil {
		return Policy{}, time.Time{}, fmt.Errorf("%w: %v", ErrPolicyUnreadable, err)
	}

	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		log.Printf("[sign_in_deadline] no %q setting was found; using the built-in limit of %d %s",
			ConfigKey, DefaultPolicy.Amount, DefaultPolicy.Unit)
		return DefaultPolicy, now, nil
	}

	policy, err := decodePolicy(raw.String)
	if err != nil {
		log.Printf("\033[31m[sign_in_deadline] the %q setting could not be read as a policy (%v); using the built-in limit of %d %s\033[0m",
			ConfigKey, err, DefaultPolicy.Amount, DefaultPolicy.Unit)
		return DefaultPolicy, now, nil
	}
	return policy, now, nil
}

// decodePolicy reads the stored setting, and is strict about one thing above all:
// whether the limit is switched off has to be *said*, not merely left out.
//
// Decoding straight into Policy looked right and was not. An empty object, a JSON
// null, or a row missing limit_enabled all decode without error and leave the
// field at Go's zero value, which is false -- so a damaged setting silently
// removed the ceiling and every sign-in made afterwards was given no deadline at
// all. Absence now means the setting could not be read, which sends the caller to
// the built-in limit, and only an explicit false switches the ceiling off.
func decodePolicy(raw string) (Policy, error) {
	value, err := setting_duration.Parse(raw, limitDefinition)
	if err != nil {
		return Policy{}, err
	}
	return Policy{Enabled: value.Enabled, Unit: value.Unit, Amount: value.Amount}, nil
}

// Decide works out the last moment a sign-in starting now may be used, without
// writing it anywhere. The one place that turns a session into an authenticated
// one asks for this before it writes any of the identity, so a database that
// cannot be asked leaves no half-written sign-in behind.
func Decide(ctx context.Context, db Querier) (int64, error) {
	policy, now, err := ReadPolicy(ctx, db)
	if err != nil {
		return 0, err
	}
	if !policy.Enabled {
		return NeverExpires, nil
	}
	deadline, err := policy.durationValue().AddTo(now)
	if err != nil {
		// ReadPolicy only returns policies it has already accepted, so reaching
		// here means the two disagree. Refusing to sign in is the safe answer.
		return 0, fmt.Errorf("the accepted sign-in limit is not a length of time: %w", err)
	}
	return deadline.Unix(), nil
}

// Stamp decides a deadline and writes it into a session in one step.
//
// Nothing in the application calls this. The one place that signs a session in
// calls Decide and writes the value itself, because it has to ask everything that
// can fail before it writes any part of the identity. This is kept for tests that
// need a session that looks signed in without reproducing that ordering, and it
// goes through Decide so the two cannot drift apart.
func Stamp(ctx context.Context, db Querier, session *sessions.Session) error {
	if session == nil {
		return errors.New("cannot give a deadline to a sign-in without a session")
	}
	expiresAt, err := Decide(ctx, db)
	if err != nil {
		return err
	}
	session.Values[SessionKey] = expiresAt
	return nil
}

// SessionValue reads the deadline from a decoded session, and reports whether
// there was one at all. A session with none is not given the benefit of the
// doubt: deriving a deadline now, from a cookie that has already been renewed
// any number of times, would be exactly the extension this prevents.
func SessionValue(session *sessions.Session) (int64, bool) {
	if session == nil {
		return 0, false
	}
	switch stamped := session.Values[SessionKey].(type) {
	case int64:
		return stamped, true
	case int:
		// A session written before this contract existed, or by a serialiser that
		// narrowed the number, still means the same moment.
		return int64(stamped), true
	default:
		return 0, false
	}
}

// Unlimited reports whether this deadline is the deliberate absence of one.
func Unlimited(expiresAt int64) bool {
	return expiresAt == NeverExpires
}
