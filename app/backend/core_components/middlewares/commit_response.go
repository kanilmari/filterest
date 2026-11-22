// commit_response.go
// Holds finite write responses until transaction completion, including grant mutations.
// Read responses, and streams or flushes with no open request transaction, keep forwarding.
// Preserves unbounded finite output and replaces uncommitted success on failure.
package middlewares

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"easelect/backend/core_components/httpresponse"
)

type commitResponse struct {
	forward                 *httpresponse.StatusCapture
	enabled, written, final bool
	status                  int
	header                  http.Header
	initialHeader           http.Header
	body                    bytes.Buffer
	// automatic marks buffering the middleware chose for an unsafe method, as
	// opposed to a handler's explicit EnableCommitBuffer. Only automatic
	// buffering may give way to a declared stream or an explicit Flush, and
	// only while no request transaction is open: then nothing awaits commit.
	automatic bool
	// claimForwarding reports whether output may be forwarded now: true only
	// while no request transaction is open, and from then on none can open,
	// so nothing forwarded can later turn out uncommitted. Nil means never.
	claimForwarding func() bool
}

func newCommitResponse(w http.ResponseWriter) *commitResponse {
	return &commitResponse{forward: httpresponse.NewStatusCapture(w), status: http.StatusOK}
}

func (w *commitResponse) EnableCommitBuffer() error {
	if w.written && !w.enabled {
		return fmt.Errorf("commit buffering must start before HTTP output")
	}
	w.startBuffering()
	// An explicit opt-in (for example a grant mutation) may never bypass commit.
	w.automatic = false
	return nil
}

// enableAutomaticBuffer is the middleware's default for finite writes.
func (w *commitResponse) enableAutomaticBuffer() {
	w.startBuffering()
	w.automatic = true
}

func (w *commitResponse) startBuffering() {
	if !w.enabled {
		w.header = w.forward.Header().Clone()
		w.initialHeader = w.forward.Header().Clone()
		w.enabled = true
	}
}

// mayForward is true only for automatic buffering with nothing to confirm.
// It claims the rest of the request for forwarding, so call it only when
// output will be forwarded if it returns true.
func (w *commitResponse) mayForward() bool {
	return w.enabled && w.automatic && w.claimForwarding != nil && w.claimForwarding()
}

// startResponse lets a declared event/NDJSON stream forward from its first
// output, unless a request transaction is already open: a stream cannot be
// replaced after a failed commit, so a transactional writer stays buffered.
func (w *commitResponse) startResponse() {
	if w.written || !w.enabled || !w.automatic {
		return
	}
	mediaType, _, _ := strings.Cut(w.header.Get("Content-Type"), ";")
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "text/event-stream", "application/x-ndjson":
		if w.mayForward() {
			w.copyHeaders(w.header)
			w.enabled = false
		}
	}
}
func (w *commitResponse) Header() http.Header {
	if w.enabled {
		return w.header
	}
	return w.forward.Header()
}
func (w *commitResponse) WriteHeader(status int) {
	if w.enabled && status >= 100 && status < 200 && status != http.StatusSwitchingProtocols {
		// Informational headers are dropped while held. They are not the final
		// response, so they neither start output nor decide stream forwarding.
		return
	}
	w.startResponse()
	w.written = true
	if !w.enabled {
		w.forward.WriteHeader(status)
		return
	}
	if !w.final {
		w.final = true
		w.status = status
	}
}
func (w *commitResponse) Write(body []byte) (int, error) {
	w.startResponse()
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

// Flush never releases output that awaits a commit. With automatic buffering
// and no open request transaction, it delivers what was written so far, as
// before buffering existed: pool-only handlers such as password reset rely on
// acknowledging the request before their background work starts.
func (w *commitResponse) Flush() {
	w.startResponse()
	if w.enabled {
		if !w.final {
			w.WriteHeader(http.StatusOK)
		}
		if !w.mayForward() {
			return
		}
		w.release()
		w.enabled = false
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
	w.copyHeaders(w.header)
	w.forward.WriteHeader(w.status)
	_, _ = w.forward.Write(w.body.Bytes())
	w.body.Reset()
}
func (w *commitResponse) commitFailed() {
	if !w.enabled {
		return
	}
	w.replaceWithError("transaction commit failed")
}

func (w *commitResponse) copyHeaders(header http.Header) {
	for key := range w.forward.Header() {
		delete(w.forward.Header(), key)
	}
	for key, values := range header {
		w.forward.Header()[key] = append([]string(nil), values...)
	}
}

func (w *commitResponse) replaceWithError(message string) {
	// Buffered success headers (Location, Content-Length, cookies) belong to the
	// uncommitted operation and must not accompany the replacement error.
	w.body.Reset()
	w.copyHeaders(w.initialHeader)
	httpresponse.RespondWithError(w.forward, http.StatusInternalServerError, message)
}
