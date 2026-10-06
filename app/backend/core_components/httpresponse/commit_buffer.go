// commit_buffer.go
// Lets grant-changing handlers opt into commit-confirmed HTTP output.
// Middleware owns buffering; handlers depend only on this small capability.
package httpresponse

import (
	"fmt"
	"net/http"
)

// EnableCommitBuffer must precede every status/body write. Missing middleware
// is an error: a grant mutation must never report success before commit.
func EnableCommitBuffer(w http.ResponseWriter) error {
	for w != nil {
		if buffer, ok := w.(interface{ EnableCommitBuffer() error }); ok {
			return buffer.EnableCommitBuffer()
		}
		wrapper, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			break
		}
		w = wrapper.Unwrap()
	}
	return fmt.Errorf("commit response buffer is unavailable")
}
