// sign_in_limit_fixture_test.go
// One answer to the one question every sign-in now asks the database first.
// Between the fake databases in this package's tests and sign_in_deadline, which
// reads the configured ceiling and the database's own clock together before it
// stamps a deadline into the session.
// Exists so each of those fakes gains one line rather than its own copy of the
// policy, and so a test that means to exercise a different limit says so instead
// of silently inheriting one.
package auth

import (
	"database/sql/driver"
	"io"
	"strings"
	"time"
)

// signInLimitRows is what the database answers when a sign-in asks how long it
// may last: the current moment by its own clock, and the configured policy.
type signInLimitRows struct {
	now    time.Time
	policy string
	done   bool
}

func (r *signInLimitRows) Columns() []string { return []string{"now", "json_value"} }
func (r *signInLimitRows) Close() error      { return nil }
func (r *signInLimitRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.now
	dest[1] = r.policy
	return nil
}

// isSignInLimitQuery recognises that question. It is matched on the clock rather
// than the table, because several fakes already answer other questions about
// system_config and would otherwise swallow this one.
func isSignInLimitQuery(query string) bool {
	return strings.Contains(query, "SELECT now()") && strings.Contains(query, "system_config")
}

// answerSignInLimit is the ordinary answer: thirty days, counted from now.
func answerSignInLimit() driver.Rows {
	return &signInLimitRows{
		now:    time.Now(),
		policy: `{"limit_enabled": true, "limit_unit": "days", "limit_amount": 30}`,
	}
}
