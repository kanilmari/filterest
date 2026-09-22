// client_logger.go
// Development-only endpoint that prints frontend log entries in the backend terminal.
// Bridges dev-browser diagnostics and colored server-side console output for local debugging.
// Exists to make client-side failures visible even when the browser console is not in focus.
package devtools

import (
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
)

// maxClientLogBodyBytes bounds the unauthenticated request body. The endpoint
// writes whatever it receives into the developer's terminal and log file, so an
// unbounded body is an easy way to flood both.
const maxClientLogBodyBytes int64 = 16 << 10

// maxClientLogFieldRunes bounds each individual logged field.
const maxClientLogFieldRunes = 2000

type ClientLogEntry struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Stack   string `json:"stack,omitempty"`
	Source  string `json:"source,omitempty"`
	Line    int    `json:"line,omitempty"`
	Col     int    `json:"col,omitempty"`
}

// clientLogRequestIsLocal reports whether the request came from this machine.
// The route has no authentication of its own, so the browser that may write
// into the server log must be the developer's own browser on the development
// machine. A development server reached from the network can no longer write
// here, in development mode or anywhere else.
func clientLogRequestIsLocal(r *http.Request) bool {
	clientIP := ""
	if verifiedIP, ok := r.Context().Value(context_keys.ClientIPKey{}).(string); ok {
		clientIP = verifiedIP
	}
	if strings.TrimSpace(clientIP) == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			clientIP = r.RemoteAddr
		} else {
			clientIP = host
		}
	}
	address := net.ParseIP(strings.TrimSpace(clientIP))
	return address != nil && address.IsLoopback()
}

// sanitizeClientLogText keeps caller-supplied text printable on one terminal
// line. Control characters would otherwise let a caller forge log lines and
// inject terminal escape sequences into the developer's console.
func sanitizeClientLogText(raw string) string {
	cleaned := strings.Map(func(character rune) rune {
		if character == '\n' || character == '\t' {
			return ' '
		}
		if character < 0x20 || character == 0x7f {
			return -1
		}
		return character
	}, raw)
	runes := []rune(cleaned)
	if len(runes) > maxClientLogFieldRunes {
		return string(runes[:maxClientLogFieldRunes]) + "…"
	}
	return cleaned
}

// LogClientError accepts a forwarded frontend log entry and prints it with level-specific formatting.
func LogClientError(w http.ResponseWriter, r *http.Request) {
	if !clientLogRequestIsLocal(r) {
		httpresponse.RespondWithError(w, http.StatusForbidden, "client_log_local_requests_only")
		return
	}

	var entry ClientLogEntry
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxClientLogBodyBytes))
	if err := decoder.Decode(&entry); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	entryType := sanitizeClientLogText(entry.Type)
	message := sanitizeClientLogText(entry.Message)
	stack := sanitizeClientLogText(entry.Stack)
	source := sanitizeClientLogText(entry.Source)

	// Use a distinct prefix and color for visibility
	prefix := "\033[33m[CLIENT-LOG]\033[0m" // Yellow
	if entryType == "error" {
		prefix = "\033[31m[CLIENT-ERR]\033[0m" // Red
	}

	log.Printf("%s %s", prefix, message)
	if stack != "" {
		fmt.Printf("\033[90m%s\033[0m\n", stack) // Grey stack trace
	} else if source != "" {
		fmt.Printf("\033[90mAt %s:%d:%d\033[0m\n", source, entry.Line, entry.Col)
	}

	w.WriteHeader(http.StatusOK)
}
