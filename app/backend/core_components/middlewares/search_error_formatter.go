// search_error_formatter.go
// Formats search failures without visitor text unless the site opts in.
// Connects ordinary, AI and streaming error printers to the logging setting.
// Keeps diagnostic identity and SQLSTATE while excluding messages and queries.
package middlewares

import (
	"errors"
	"fmt"
)

// AppLogSearchError preserves the old error text only with an explicit opt-in.
// Wrapped PostgreSQL errors retain their type and SQLSTATE, never their fields.
func AppLogSearchError(err error, handler, dataset string) string {
	if CheckAppLogSearchTerms() {
		return err.Error()
	}
	cause := err
	for errors.Unwrap(cause) != nil {
		cause = errors.Unwrap(cause)
	}
	state := "unknown"
	var sqlError interface {
		error
		SQLState() string
	}
	if errors.As(err, &sqlError) {
		code := sqlError.SQLState()
		valid := len(code) == 5
		for _, ch := range code {
			valid = valid && (ch >= '0' && ch <= '9' || ch >= 'A' && ch <= 'Z')
		}
		if valid {
			state = code
		}
		cause = sqlError
	}
	return fmt.Sprintf("error_class=%T sqlstate=%s handler=%s dataset=%q", cause, state, handler, dataset)
}
