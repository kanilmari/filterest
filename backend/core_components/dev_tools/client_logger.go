// client_logger.go
// Development-only endpoint that prints frontend log entries in the backend terminal.
// Bridges dev-browser diagnostics and colored server-side console output for local debugging.
// Exists to make client-side failures visible even when the browser console is not in focus.
package devtools

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type ClientLogEntry struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Stack   string `json:"stack,omitempty"`
	Source  string `json:"source,omitempty"`
	Line    int    `json:"line,omitempty"`
	Col     int    `json:"col,omitempty"`
}

// LogClientError accepts a forwarded frontend log entry and prints it with level-specific formatting.
func LogClientError(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var entry ClientLogEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	// Use a distinct prefix and color for visibility
	prefix := "\033[33m[CLIENT-LOG]\033[0m" // Yellow
	if entry.Type == "error" {
		prefix = "\033[31m[CLIENT-ERR]\033[0m" // Red
	}

	log.Printf("%s %s", prefix, entry.Message)
	if entry.Stack != "" {
		fmt.Printf("\033[90m%s\033[0m\n", entry.Stack) // Grey stack trace
	} else if entry.Source != "" {
		fmt.Printf("\033[90mAt %s:%d:%d\033[0m\n", entry.Source, entry.Line, entry.Col)
	}

	w.WriteHeader(http.StatusOK)
}
