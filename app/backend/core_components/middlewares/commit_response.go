// commit_response.go
// Buffers only explicitly selected grant mutations until transaction completion.
// Ordinary responses and streams retain the existing forwarding status recorder.
package middlewares

import (
	"bytes"
	"fmt"
	"net/http"

	"easelect/backend/core_components/httpresponse"
)

type commitResponse struct {
	forward                 *httpresponse.StatusCapture
	enabled, written, final bool
	status                  int
	header                  http.Header
	initialHeader           http.Header
	body                    bytes.Buffer
}

func newCommitResponse(w http.ResponseWriter) *commitResponse {
	return &commitResponse{forward: httpresponse.NewStatusCapture(w), status: http.StatusOK}
}

func (w *commitResponse) EnableCommitBuffer() error {
	if w.written && !w.enabled {
		return fmt.Errorf("commit buffering must start before HTTP output")
	}
	if !w.enabled {
		w.header = w.forward.Header().Clone()
		w.initialHeader = w.forward.Header().Clone()
		w.enabled = true
	}
	return nil
}
func (w *commitResponse) Header() http.Header {
	if w.enabled {
		return w.header
	}
	return w.forward.Header()
}
func (w *commitResponse) WriteHeader(status int) {
	w.written = true
	if !w.enabled {
		w.forward.WriteHeader(status)
		return
	}
	if status >= 100 && status < 200 && status != http.StatusSwitchingProtocols {
		return
	}
	if !w.final {
		w.final = true
		w.status = status
	}
}
func (w *commitResponse) Write(body []byte) (int, error) {
	if !w.enabled {
		w.written = true
		return w.forward.Write(body)
	}
	if !w.final {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(body)
}
func (w *commitResponse) StatusCode() int {
	if w.enabled {
		return w.status
	}
	return w.forward.StatusCode()
}
func (w *commitResponse) Flush() {
	if w.enabled {
		if !w.final {
			w.WriteHeader(http.StatusOK)
		}
		return
	}
	w.written = true
	w.forward.Flush()
}
func (w *commitResponse) Unwrap() http.ResponseWriter {
	// ResponseController must not bypass an enabled buffer via optional interfaces.
	if w.enabled {
		return nil
	}
	return w.forward
}
func (w *commitResponse) release() {
	if !w.enabled {
		return
	}
	for key := range w.forward.Header() {
		delete(w.forward.Header(), key)
	}
	for key, values := range w.header {
		w.forward.Header()[key] = append([]string(nil), values...)
	}
	w.forward.WriteHeader(w.status)
	_, _ = w.forward.Write(w.body.Bytes())
}
func (w *commitResponse) commitFailed() {
	if !w.enabled {
		return
	} // Preserve today's ordinary-request behaviour.
	// Buffered success headers (Location, Content-Length, cookies) belong to the
	// uncommitted operation and must not accompany the replacement error.
	for key := range w.forward.Header() {
		delete(w.forward.Header(), key)
	}
	for key, values := range w.initialHeader {
		w.forward.Header()[key] = append([]string(nil), values...)
	}
	httpresponse.RespondWithError(w.forward, http.StatusInternalServerError, "transaction commit failed")
}
