// foreign_reference_log.go
// Names a failed linked-row read check for the server log without its message.
// Connects the row update handler's two foreign-reference 500 paths with one log rule.
// Exists because database messages can quote submitted values (e.g. an out-of-range number).

package dtt_1_row_update

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/lib/pq"
)

// foreignReferenceErrorClass returns a content-free class: a SQLSTATE, "no rows", a
// context state, or the error's Go type. It never returns the error's message text.
func foreignReferenceErrorClass(err error) string {
	var pqErr *pq.Error
	switch {
	case errors.As(err, &pqErr):
		return "sqlstate " + string(pqErr.Code)
	case errors.Is(err, sql.ErrNoRows):
		return "no rows"
	case errors.Is(err, context.Canceled):
		return "context canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "context deadline exceeded"
	default:
		return fmt.Sprintf("%T", err)
	}
}
