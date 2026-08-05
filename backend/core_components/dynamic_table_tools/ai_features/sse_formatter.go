// sse_formatter.go
// Provides shared Server-Sent Events payload escaping for AI feature streams.
// Bridges streaming handlers and browser EventSource consumers with one safe
// formatter for newline-sensitive SSE data frames.
package ai_features

import (
	"strings"
)

// escape_for_sse muuttaa rivinvaihdot SSE:lle sopivaksi
func escape_for_sse(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}
