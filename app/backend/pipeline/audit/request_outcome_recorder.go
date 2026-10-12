// request_outcome_recorder.go
// Carries exceptional outcomes after a streaming response has already begun.
// Connects handlers to the existing request-final audit event and success flag.
// Keeps failures and access revocations auditable even when HTTP remains 200.
package audit

import (
	"context"
	"sync/atomic"
)

type requestOutcomeKey struct{}
type requestOutcome struct{ failed atomic.Bool }

// MarkRequestFailed records a handler failure independently of HTTP status.
// WithAudit retains the request's event with success=false when the handler
// returns. Calls outside that middleware are harmless. Normal client closure
// and stream lifetime expiry do not mark a failure.
func MarkRequestFailed(ctx context.Context) {
	if outcome, ok := ctx.Value(requestOutcomeKey{}).(*requestOutcome); ok {
		outcome.failed.Store(true)
	}
}
