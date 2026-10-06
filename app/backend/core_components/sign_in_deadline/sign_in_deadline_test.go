// sign_in_deadline_test.go
// Pins the one promise this package makes: a sign-in's last moment is decided
// when it begins and nothing afterwards can move it.
// Between the settings row an administrator may edit at any time and the deadline
// already signed into somebody's cookie.
// Exists because the obvious design fails quietly. Storing the sign-in's start and
// comparing it against whatever the setting says today would leave the setting as
// a way to extend a sign-in: sign out under a one-day limit, keep the cookie
// signed through some public route, then raise the limit, and the same cookie is
// accepted again once its refusal record has run out. These tests walk that.
package sign_in_deadline

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
	"time"

	"github.com/gorilla/sessions"
)

// deadlineSite is one installation: what its settings row says, and what its
// database thinks the time is.
type deadlineSite struct {
	policyJSON   string
	policyAbsent bool
	now          time.Time
	failure      error
	reads        int
}

type deadlineDriver struct{ site *deadlineSite }
type deadlineConn struct{ site *deadlineSite }
type deadlineRows struct {
	values []driver.Value
	done   bool
}

func (d deadlineDriver) Open(string) (driver.Conn, error)   { return &deadlineConn{d.site}, nil }
func (c *deadlineConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *deadlineConn) Close() error                        { return nil }
func (c *deadlineConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (r *deadlineRows) Columns() []string                   { return []string{"now", "json_value"} }
func (r *deadlineRows) Close() error                        { return nil }
func (r *deadlineRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	copy(values, r.values)
	r.done = true
	return nil
}

func (c *deadlineConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "system_config") || !strings.Contains(query, "SELECT now()") {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	c.site.reads++
	if c.site.failure != nil {
		return nil, c.site.failure
	}
	var policy driver.Value
	if !c.site.policyAbsent {
		policy = c.site.policyJSON
	}
	return &deadlineRows{values: []driver.Value{c.site.now, policy}}, nil
}

var deadlineTestCounter int64

func openDeadlineSite(t *testing.T, site *deadlineSite) *sql.DB {
	t.Helper()
	if site.now.IsZero() {
		site.now = time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	}
	if site.policyJSON == "" && !site.policyAbsent {
		site.policyJSON = `{"limit_enabled": true, "limit_unit": "days", "limit_amount": 30}`
	}
	name := fmt.Sprintf("sign_in_deadline_%d", atomic.AddInt64(&deadlineTestCounter, 1))
	sql.Register(name, deadlineDriver{site})
	database, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open the site: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func emptySession() *sessions.Session {
	return &sessions.Session{Values: map[interface{}]interface{}{}}
}

// The deadline comes from the database's clock, not this machine's, so a
// workstation or container whose clock is wrong cannot hand out a deadline that
// is wrong by the same amount.
func TestTheDeadlineIsCountedFromTheDatabasesOwnClock(t *testing.T) {
	site := &deadlineSite{now: time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)}
	database := openDeadlineSite(t, site)
	session := emptySession()

	if err := Stamp(context.Background(), database, session); err != nil {
		t.Fatalf("stamp the deadline: %v", err)
	}
	stamped, dated := SessionValue(session)
	if !dated {
		t.Fatal("a session that was just signed in carries no deadline")
	}
	want := site.now.Add(30 * 24 * time.Hour).Unix()
	if stamped != want {
		t.Fatalf("the deadline is %v, want %v counted from the database's clock",
			time.Unix(stamped, 0).UTC(), time.Unix(want, 0).UTC())
	}
}

// The whole point of the package: once given, a deadline is not revised by
// anything the setting does afterwards.
func TestChangingTheLimitDoesNotMoveADeadlineAlreadyGiven(t *testing.T) {
	site := &deadlineSite{policyJSON: `{"limit_enabled": true, "limit_unit": "days", "limit_amount": 1}`}
	database := openDeadlineSite(t, site)
	session := emptySession()

	if err := Stamp(context.Background(), database, session); err != nil {
		t.Fatalf("stamp the deadline: %v", err)
	}
	givenAtSignIn, _ := SessionValue(session)

	for _, changed := range []string{
		`{"limit_enabled": true, "limit_unit": "days", "limit_amount": 30}`,
		`{"limit_enabled": false, "limit_unit": "days", "limit_amount": 1}`,
		`not a policy at all`,
	} {
		site.policyJSON = changed
		if stamped, _ := SessionValue(session); stamped != givenAtSignIn {
			t.Fatalf("after the setting became %q the sign-in's deadline moved to %v from %v",
				changed, time.Unix(stamped, 0).UTC(), time.Unix(givenAtSignIn, 0).UTC())
		}
	}
}

// Signing in again in a browser that still holds an old session reuses that
// session object. The new sign-in has to get its own deadline, not inherit one.
func TestSigningInAgainReplacesTheOldDeadline(t *testing.T) {
	site := &deadlineSite{}
	database := openDeadlineSite(t, site)
	session := emptySession()

	if err := Stamp(context.Background(), database, session); err != nil {
		t.Fatalf("first sign-in: %v", err)
	}
	first, _ := SessionValue(session)

	site.now = site.now.Add(10 * 24 * time.Hour)
	if err := Stamp(context.Background(), database, session); err != nil {
		t.Fatalf("second sign-in: %v", err)
	}
	second, _ := SessionValue(session)

	if second == first {
		t.Fatal("signing in again kept the previous sign-in's deadline")
	}
	if want := site.now.Add(30 * 24 * time.Hour).Unix(); second != want {
		t.Fatalf("the second sign-in ends at %v, want %v",
			time.Unix(second, 0).UTC(), time.Unix(want, 0).UTC())
	}
}

// Switching the limit off is allowed, and it is recorded as a decision rather
// than as an absence, so the two can be told apart later.
func TestSwitchingTheLimitOffIsRecordedAsADecision(t *testing.T) {
	site := &deadlineSite{policyJSON: `{"limit_enabled": false, "limit_unit": "days", "limit_amount": 30}`}
	database := openDeadlineSite(t, site)
	session := emptySession()

	if err := Stamp(context.Background(), database, session); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	stamped, dated := SessionValue(session)
	if !dated {
		t.Fatal("a sign-in made with the limit off carries nothing at all, so it cannot be told from one made before the limit existed")
	}
	if !Unlimited(stamped) {
		t.Fatalf("the sign-in was given the deadline %v rather than none",
			time.Unix(stamped, 0).UTC())
	}
}

// A row that is missing or damaged must not quietly remove the ceiling. It gives
// the built-in limit, which is the protective answer, not the permissive one.
func TestAMissingOrDamagedSettingFallsBackToTheBuiltInLimit(t *testing.T) {
	for name, site := range map[string]*deadlineSite{
		"no row at all":        {policyAbsent: true},
		"not JSON":             {policyJSON: `limit_enabled = true`},
		"no unit of time":      {policyJSON: `{"limit_enabled": true, "limit_unit": "fortnights", "limit_amount": 2}`},
		"an amount of nothing": {policyJSON: `{"limit_enabled": true, "limit_unit": "days", "limit_amount": 0}`},
		"a negative amount":    {policyJSON: `{"limit_enabled": true, "limit_unit": "days", "limit_amount": -5}`},
		"an absurd amount":     {policyJSON: `{"limit_enabled": true, "limit_unit": "hours", "limit_amount": 99999999}`},
		// A figure small enough to pass as hours but not as days. Bounding the
		// count without its unit let this through, and multiplying it as days
		// overflowed to a moment about 292 years in the past -- a ceiling already
		// reached, which would have ended every sign-in as it was made.
		"days that overflow as days": {policyJSON: `{"limit_enabled": true, "limit_unit": "days", "limit_amount": 106752}`},
		// Nothing here says whether the limit is on or off, and a value Go simply
		// leaves at false is not the same as one somebody switched off. Reading
		// these as "off" silently removed the ceiling.
		"an empty policy":          {policyJSON: `{}`},
		"a policy of null":         {policyJSON: `null`},
		"no word on being enabled": {policyJSON: `{"limit_unit": "days", "limit_amount": 7}`},
		"enabled left as null":     {policyJSON: `{"limit_enabled": null, "limit_unit": "days", "limit_amount": 7}`},
	} {
		t.Run(name, func(t *testing.T) {
			database := openDeadlineSite(t, site)
			session := emptySession()
			if err := Stamp(context.Background(), database, session); err != nil {
				t.Fatalf("stamp: %v", err)
			}
			stamped, dated := SessionValue(session)
			if !dated || Unlimited(stamped) {
				t.Fatal("a damaged setting removed the ceiling instead of falling back to it")
			}
			builtIn, err := DefaultPolicy.Duration()
			if err != nil {
				t.Fatalf("the built-in limit is not a length of time: %v", err)
			}
			if want := site.now.Add(builtIn).Unix(); stamped != want {
				t.Fatalf("the sign-in ends at %v, want the built-in %v",
					time.Unix(stamped, 0).UTC(), time.Unix(want, 0).UTC())
			}
		})
	}
}

// A database that cannot be asked is a different thing from a row that is not
// there. Answering it with a default would let a fault widen a site's ceiling.
func TestADatabaseThatCannotBeAskedIsNotAMissingSetting(t *testing.T) {
	site := &deadlineSite{failure: errors.New("the database is unreachable")}
	database := openDeadlineSite(t, site)
	session := emptySession()

	err := Stamp(context.Background(), database, session)
	if !errors.Is(err, ErrPolicyUnreadable) {
		t.Fatalf("an unreachable database answered %v, want %v", err, ErrPolicyUnreadable)
	}
	if _, dated := SessionValue(session); dated {
		t.Fatal("a sign-in was given a deadline although the limit could not be read")
	}

	if _, _, err := ReadPolicy(context.Background(), nil); !errors.Is(err, ErrPolicyUnreadable) {
		t.Fatalf("a missing database answered %v, want %v", err, ErrPolicyUnreadable)
	}
	var missing *sql.DB
	if _, _, err := ReadPolicy(context.Background(), missing); !errors.Is(err, ErrPolicyUnreadable) {
		t.Fatalf("a nil database answered %v, want %v", err, ErrPolicyUnreadable)
	}
}

// A session carrying no deadline is reported as carrying none, and never given
// one after the fact. Filling it in now, from a cookie that may have been signed
// again any number of times, would be the extension this prevents.
func TestASessionWithNoDeadlineIsReportedAsHavingNone(t *testing.T) {
	if _, dated := SessionValue(nil); dated {
		t.Fatal("a missing session reported a deadline")
	}
	if _, dated := SessionValue(emptySession()); dated {
		t.Fatal("a session that was never signed in reported a deadline")
	}

	// A number that arrived as a plain int still means the same moment.
	narrowed := emptySession()
	narrowed.Values[SessionKey] = 1790000000
	stamped, dated := SessionValue(narrowed)
	if !dated || stamped != 1790000000 {
		t.Fatalf("a deadline stored as int read back as %v, %v", stamped, dated)
	}

	// Anything else is not a deadline.
	wrong := emptySession()
	wrong.Values[SessionKey] = "next Tuesday"
	if _, dated := SessionValue(wrong); dated {
		t.Fatal("a deadline that is not a number was accepted")
	}
}

// Hours and days both mean elapsed time. A day is twenty-four hours, so the limit
// does not move with daylight saving.
func TestTheUnitsAreElapsedTime(t *testing.T) {
	for _, testCase := range []struct {
		policy Policy
		want   time.Duration
	}{
		{Policy{Enabled: true, Unit: "hours", Amount: 36}, 36 * time.Hour},
		{Policy{Enabled: true, Unit: "hour", Amount: 1}, time.Hour},
		{Policy{Enabled: true, Unit: "days", Amount: 30}, 30 * 24 * time.Hour},
		{Policy{Enabled: true, Unit: "DAYS", Amount: 1}, 24 * time.Hour},
		{Policy{Enabled: true, Unit: " days ", Amount: 2}, 48 * time.Hour},
	} {
		got, err := testCase.policy.Duration()
		if err != nil {
			t.Fatalf("%+v: %v", testCase.policy, err)
		}
		if got != testCase.want {
			t.Fatalf("%+v is %v, want %v", testCase.policy, got, testCase.want)
		}
	}
}

// The bound belongs to the unit, not to the count. A number that is reasonable as
// hours is not reasonable as days, and multiplying it as days must not wrap round
// into the past.
func TestTheLimitIsBoundedAgainstItsOwnUnit(t *testing.T) {
	tenYears := 10 * 365 * 24 * time.Hour
	for _, testCase := range []struct {
		policy Policy
		want   time.Duration // zero means it must be refused
	}{
		{Policy{Enabled: true, Unit: "hours", Amount: 87600}, tenYears},
		{Policy{Enabled: true, Unit: "hours", Amount: 87601}, 0}, // one hour past it
		{Policy{Enabled: true, Unit: "days", Amount: 3650}, tenYears},
		{Policy{Enabled: true, Unit: "days", Amount: 3651}, 0},   // one day past it
		{Policy{Enabled: true, Unit: "days", Amount: 106752}, 0}, // what used to overflow
	} {
		got, err := testCase.policy.Duration()
		if testCase.want == 0 {
			if err == nil {
				t.Fatalf("%d %s was accepted as %v", testCase.policy.Amount, testCase.policy.Unit, got)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%d %s was refused: %v", testCase.policy.Amount, testCase.policy.Unit, err)
		}
		// The exact length, not merely a positive one: an accepted amount that came
		// back shorter than it says would otherwise pass here unnoticed.
		if got != testCase.want {
			t.Fatalf("%d %s is %v, want exactly %v",
				testCase.policy.Amount, testCase.policy.Unit, got, testCase.want)
		}
	}
}

// Switching the ceiling off is a decision somebody makes, and only an explicit
// false makes it. This is the counterpart to the damaged-setting cases above: it
// proves the strictness there did not also break the setting working as intended.
func TestOnlyAnExplicitFalseSwitchesTheCeilingOff(t *testing.T) {
	site := &deadlineSite{policyJSON: `{"limit_enabled": false, "limit_unit": "days", "limit_amount": 30}`}
	database := openDeadlineSite(t, site)

	expiresAt, err := Decide(context.Background(), database)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if !Unlimited(expiresAt) {
		t.Fatalf("an explicitly disabled limit gave the deadline %v",
			time.Unix(expiresAt, 0).UTC())
	}
}

// Deciding is separate from writing so that the one place which turns a session
// into an authenticated one can ask everything that might fail before it writes
// anything. That ordering is proved where it lives, in the identity setter's own
// test; what is proved here is only that the decision reports a failure instead of
// inventing an answer.
func TestDecidingReportsAFailedReadRatherThanGuessing(t *testing.T) {
	site := &deadlineSite{failure: errors.New("the database is unreachable")}
	database := openDeadlineSite(t, site)

	if _, err := Decide(context.Background(), database); !errors.Is(err, ErrPolicyUnreadable) {
		t.Fatalf("an unreachable database answered %v, want %v", err, ErrPolicyUnreadable)
	}
}

// Months and years are anchored to the database's calendar date at sign-in.
func TestDecideUsesSharedCalendarDurations(t *testing.T) {
	for _, test := range []struct {
		now  time.Time
		unit string
		want time.Time
	}{
		{time.Date(2025, 1, 31, 12, 0, 0, 0, time.UTC), "months", time.Date(2025, 3, 3, 12, 0, 0, 0, time.UTC)},
		{time.Date(2024, 2, 29, 12, 0, 0, 0, time.UTC), "years", time.Date(2025, 3, 1, 12, 0, 0, 0, time.UTC)},
	} {
		site := &deadlineSite{now: test.now, policyJSON: fmt.Sprintf(`{"limit_enabled":true,"limit_unit":%q,"limit_amount":1}`, test.unit)}
		expires, err := Decide(context.Background(), openDeadlineSite(t, site))
		if err != nil || expires != test.want.Unix() {
			t.Fatalf("%s: %d %v, want %d", test.unit, expires, err, test.want.Unix())
		}
	}
}
