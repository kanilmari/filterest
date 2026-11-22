// commit_outcome.go
// Separates a database commit that happened from cleanup that failed after it.
// Bridges the pool-admission connector, the lazy request transaction and the response.
// Exists so a saved change is never reported as failed, and then retried, for a late release.
package dbutils

import (
	"errors"
	"fmt"
)

// CommittedCleanupError reports that the database committed the transaction
// but a later release step (admission slot, request barrier) failed. The
// change is saved: callers keep the committed outcome and only log Err.
type CommittedCleanupError struct{ Err error }

func (e *CommittedCleanupError) Error() string {
	return fmt.Sprintf("transaction committed; cleanup after commit failed: %v", e.Err)
}

func (e *CommittedCleanupError) Unwrap() error { return e.Err }

// CommittedWithCleanupError wraps a cleanup failure that followed a
// successful commit. Nil stays nil and an existing marker is not re-wrapped.
func CommittedWithCleanupError(err error) error {
	if err == nil || IsCommittedCleanupError(err) {
		return err
	}
	return &CommittedCleanupError{Err: err}
}

// IsCommittedCleanupError reports whether err says the commit itself succeeded.
func IsCommittedCleanupError(err error) bool {
	var committed *CommittedCleanupError
	return errors.As(err, &committed)
}
