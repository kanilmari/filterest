// client_logger_test.go
// Guards the narrowed write access of the development client-log endpoint.
// Bridges the unauthenticated forwarding route and the developer's server log.
// Exists because the route writes caller-supplied text into the terminal, so who
// may reach it and how much they may write are the only checks protecting it.
package devtools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/context_keys"
)

func newClientLogRequest(body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/log-client-error", strings.NewReader(body))
}

// TestLogClientErrorAcceptsOnlyLocalRequests guards the narrowed route. The
// endpoint has no authentication of its own, so a development server reached
// from the network could previously write into the developer's log.
func TestLogClientErrorAcceptsOnlyLocalRequests(t *testing.T) {
	remoteAddresses := []string{"203.0.113.9", "10.1.2.3", "192.168.1.40"}
	for _, clientIP := range remoteAddresses {
		t.Run("remote_"+clientIP, func(t *testing.T) {
			req := newClientLogRequest(`{"type":"error","message":"probe"}`)
			req = req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, clientIP))
			rr := httptest.NewRecorder()

			LogClientError(rr, req)

			if rr.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
			}
			if !strings.Contains(rr.Body.String(), "client_log_local_requests_only") {
				t.Fatalf("body = %q", rr.Body.String())
			}
		})
	}

	for _, clientIP := range []string{"127.0.0.1", "::1"} {
		t.Run("local_"+clientIP, func(t *testing.T) {
			req := newClientLogRequest(`{"type":"error","message":"probe"}`)
			req = req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, clientIP))
			rr := httptest.NewRecorder()

			LogClientError(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
			}
		})
	}
}

// A missing or unparseable client address is not this machine.
func TestLogClientErrorRefusesUnknownClientAddress(t *testing.T) {
	req := newClientLogRequest(`{"type":"error","message":"probe"}`)
	req.RemoteAddr = "not-an-address"
	rr := httptest.NewRecorder()

	LogClientError(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}
}

// The body is bounded, so a local page cannot flood the log in one request.
func TestLogClientErrorRejectsOversizedBody(t *testing.T) {
	oversized := `{"type":"error","message":"` + strings.Repeat("x", int(maxClientLogBodyBytes)+1024) + `"}`
	req := newClientLogRequest(oversized)
	req = req.WithContext(context.WithValue(req.Context(), context_keys.ClientIPKey{}, "127.0.0.1"))
	rr := httptest.NewRecorder()

	LogClientError(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

// Control characters would let a caller forge extra log lines and inject
// terminal escape sequences into the developer's console.
func TestSanitizeClientLogTextRemovesControlCharacters(t *testing.T) {
	cleaned := sanitizeClientLogText("first\nsecond\x1b[31mred\x00\r")
	if strings.ContainsAny(cleaned, "\n\r\x00\x1b") {
		t.Fatalf("sanitized text still carries control characters: %q", cleaned)
	}
	if !strings.Contains(cleaned, "first") || !strings.Contains(cleaned, "second") {
		t.Fatalf("sanitized text lost its content: %q", cleaned)
	}
}

func TestSanitizeClientLogTextBoundsLength(t *testing.T) {
	cleaned := sanitizeClientLogText(strings.Repeat("y", maxClientLogFieldRunes+500))
	if len([]rune(cleaned)) > maxClientLogFieldRunes+1 {
		t.Fatalf("sanitized text length = %d runes, want at most %d", len([]rune(cleaned)), maxClientLogFieldRunes+1)
	}
}
