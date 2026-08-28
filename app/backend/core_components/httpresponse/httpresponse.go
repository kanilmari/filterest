// httpresponse.go
// Provides standardized HTTP response helpers for the Easelect backend.
// Bridges handlers and middleware through consistent JSON formatting and final-status capture.
// Exists to keep the API response contract and request-final decisions aligned.

package httpresponse

import (
	"encoding/json"
	"log"
	"net/http"
)

// StatusCapture records the effective final status written by a downstream
// handler while preserving the original response writer. A response that does
// not explicitly write headers still has the net/http default status 200.
type StatusCapture struct {
	http.ResponseWriter
	statusCode   int
	finalWritten bool
}

// NewStatusCapture wraps a response writer so request-final middleware can
// decide its outcome from the status that was sent to the client.
func NewStatusCapture(w http.ResponseWriter) *StatusCapture {
	return &StatusCapture{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}
}

// StatusCode returns the effective final HTTP status. Informational 1xx
// headers do not replace the eventual final status; 101 is final because it
// switches protocols.
func (capture *StatusCapture) StatusCode() int {
	return capture.statusCode
}

// WriteHeader records only the first final response status while allowing
// informational headers to pass through to the underlying writer.
func (capture *StatusCapture) WriteHeader(code int) {
	if code >= 100 && code < 200 && code != http.StatusSwitchingProtocols {
		capture.ResponseWriter.WriteHeader(code)
		return
	}
	if !capture.finalWritten {
		capture.statusCode = code
		capture.finalWritten = true
	}
	capture.ResponseWriter.WriteHeader(code)
}

// Write records the implicit 200 status before forwarding response bytes.
func (capture *StatusCapture) Write(body []byte) (int, error) {
	if !capture.finalWritten {
		capture.statusCode = http.StatusOK
		capture.finalWritten = true
	}
	return capture.ResponseWriter.Write(body)
}

// Flush preserves http.Flusher compatibility for handlers that stream a
// response and records the implicit 200 caused by flushing headers.
func (capture *StatusCapture) Flush() {
	if !capture.finalWritten {
		capture.statusCode = http.StatusOK
		capture.finalWritten = true
	}
	if flusher, ok := capture.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap lets http.ResponseController reach optional interfaces implemented by
// the original response writer.
func (capture *StatusCapture) Unwrap() http.ResponseWriter {
	return capture.ResponseWriter
}

// ErrorBody is the standard JSON error response structure.
// Every error response from this application should use this format.
// AuthFailure is set only by RespondWithAuthFailure — the frontend uses it to
// distinguish session/auth failures (redirect to /login) from business-logic
// permission denials (show toast). See Pipeline_Architecture.md §6.
type ErrorBody struct {
	Error       string `json:"error"`
	Code        int    `json:"code"`
	AuthFailure bool   `json:"auth_failure,omitempty"`
}

// RespondWithError writes a JSON error response with the given HTTP status code.
// Sets Content-Type to application/json. Safe to call only once per request
// (before headers have been sent to the client).
func RespondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(ErrorBody{Error: message, Code: code}); err != nil {
		log.Printf("[httpresponse] failed to encode error response: %v", err)
	}
}

// RespondWithAuthFailure writes a 403 JSON error response with auth_failure=true.
// Use this ONLY for session/authentication failures where the frontend should
// redirect to /login. For business-logic permission denials, use RespondWithError.
func RespondWithAuthFailure(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusForbidden)
	body := ErrorBody{Error: message, Code: http.StatusForbidden, AuthFailure: true}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("[httpresponse] failed to encode auth failure response: %v", err)
	}
}

// RespondWithJSON writes a JSON success response with the given HTTP status code.
// The data parameter is encoded to JSON. Sets Content-Type to application/json.
func RespondWithJSON(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("[httpresponse] failed to encode JSON response: %v", err)
	}
}
