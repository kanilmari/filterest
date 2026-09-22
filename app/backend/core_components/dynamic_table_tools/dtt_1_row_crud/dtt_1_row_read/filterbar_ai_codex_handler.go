// filterbar_ai_codex_handler.go
// Keeps the dataset chat's coding-agent route and the request it accepts.
// Bridges the browser chat with the one coding-agent runner and its explicit job modes.
// Exists so the route name stays stable while code work and the site assistant share one runner.
package dtt_1_row_read

import (
	"net/http"
	"strings"
)

const (
	codingAgentMaxConversation = 24
	codingAgentMaxMessageChars = 6000
)

// codingAgentChatRequest is what the browser may send for one chat turn. The
// mode names which of this site's permitted runner modes answers it.
type codingAgentChatRequest struct {
	Dataset  string                      `json:"dataset"`
	Query    string                      `json:"query"`
	Lang     string                      `json:"lang,omitempty"`
	Mode     string                      `json:"mode"`
	Messages []aiChatConversationMessage `json:"messages,omitempty"`
}

// FilterbarAICodexQueryHandler serves an administrator's dataset chat with the
// coding-agent runner: GET reports the permitted modes and runner readiness, POST
// starts a durable job in one explicit mode, and GET with job_id reads its status.
func FilterbarAICodexQueryHandler(w http.ResponseWriter, r *http.Request) {
	handleConfiguredCodingAgent(w, r)
}

// trimCodingAgentMessages keeps the latest turns within the runner's request
// size, dropping empty messages and truncating very long ones.
func trimCodingAgentMessages(messages []aiChatConversationMessage) []aiChatConversationMessage {
	if len(messages) == 0 {
		return []aiChatConversationMessage{}
	}
	start := 0
	if len(messages) > codingAgentMaxConversation {
		start = len(messages) - codingAgentMaxConversation
	}

	trimmed := make([]aiChatConversationMessage, 0, len(messages)-start)
	for _, message := range messages[start:] {
		role := strings.TrimSpace(message.Role)
		content := strings.TrimSpace(message.Content)
		if role == "" || content == "" {
			continue
		}
		if len([]rune(content)) > codingAgentMaxMessageChars {
			runes := []rune(content)
			content = string(runes[:codingAgentMaxMessageChars]) + "\n[truncated]"
		}
		trimmed = append(trimmed, aiChatConversationMessage{
			Role:    role,
			Content: content,
		})
	}
	return trimmed
}
