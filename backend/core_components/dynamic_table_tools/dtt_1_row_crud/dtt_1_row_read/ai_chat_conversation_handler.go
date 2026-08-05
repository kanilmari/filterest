// ai_chat_conversation_handler.go
// Persists the API-first filterbar AI chat conversation for one user and dataset.
// Bridges authenticated app requests and the ai_chat_conversations storage table.
// Exists so the new filterbar chat can restore one server-backed conversation without legacy SQL chat semantics.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

type aiChatConversationMessage struct {
	Role      string                   `json:"role"`
	Content   string                   `json:"content"`
	CreatedAt string                   `json:"created_at,omitempty"`
	Usage     *filterbarAIUsageSummary `json:"usage,omitempty"`
}

type aiChatConversationPayload struct {
	Dataset   string                      `json:"dataset"`
	Messages  []aiChatConversationMessage `json:"messages"`
	Preview   string                      `json:"preview"`
	UpdatedAt *time.Time                  `json:"updated_at"`
}

var aiChatConversationUserIDReader = e_sessions.GetUserIDFromSession
var aiChatConversationLoader = loadAIChatConversation
var aiChatConversationSaver = saveAIChatConversation

// FilterbarAIConversationHandler loads or replaces one authenticated user's conversation for one dataset.
func FilterbarAIConversationHandler(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireAuthenticatedAIChatConversationUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleGetAIChatConversation(w, r, userID)
	case http.MethodPut:
		handlePutAIChatConversation(w, r, userID)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET and PUT accepted")
	}
}

// requireAuthenticatedAIChatConversationUser rejects guest and missing sessions for server-backed chat persistence.
func requireAuthenticatedAIChatConversationUser(w http.ResponseWriter, r *http.Request) (int, bool) {
	userID, err := aiChatConversationUserIDReader(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "authenticated session required")
		return 0, false
	}

	return userID, true
}

// handleGetAIChatConversation returns the stored conversation or an empty server shape for the requested dataset.
func handleGetAIChatConversation(w http.ResponseWriter, r *http.Request, userID int) {
	dataset := strings.TrimSpace(r.URL.Query().Get("dataset"))
	if dataset == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'dataset' query parameter")
		return
	}

	payload, err := aiChatConversationLoader(r.Context(), userID, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error loading AI chat conversation")
		return
	}

	writeAIChatConversationJSON(w, payload)
}

// handlePutAIChatConversation validates and stores the replacement conversation payload for one dataset.
func handlePutAIChatConversation(w http.ResponseWriter, r *http.Request, userID int) {
	var payload aiChatConversationPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON request body")
		return
	}

	normalizedPayload, err := normalizeAIChatConversationPayload(payload)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	savedPayload, err := aiChatConversationSaver(r.Context(), userID, normalizedPayload)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving AI chat conversation")
		return
	}

	writeAIChatConversationJSON(w, savedPayload)
}

// normalizeAIChatConversationPayload enforces the narrow persisted message contract and stable preview shape.
func normalizeAIChatConversationPayload(payload aiChatConversationPayload) (aiChatConversationPayload, error) {
	payload.Dataset = strings.TrimSpace(payload.Dataset)
	if payload.Dataset == "" {
		return aiChatConversationPayload{}, errors.New("dataset is required")
	}

	if payload.Messages == nil {
		payload.Messages = []aiChatConversationMessage{}
	}

	for index, message := range payload.Messages {
		role := strings.TrimSpace(message.Role)
		if role == "" {
			return aiChatConversationPayload{}, errors.New("messages[" + strconv.Itoa(index) + "].role is required")
		}
		if strings.TrimSpace(message.Content) == "" {
			return aiChatConversationPayload{}, errors.New("messages[" + strconv.Itoa(index) + "].content is required")
		}
		payload.Messages[index].Role = role
		payload.Messages[index].CreatedAt = strings.TrimSpace(message.CreatedAt)
	}

	payload.Preview = buildAIChatConversationPreview(payload.Preview, payload.Messages)
	payload.UpdatedAt = nil
	return payload, nil
}

// buildAIChatConversationPreview keeps sidebar preview text compact while preserving multilingual content verbatim.
func buildAIChatConversationPreview(preview string, messages []aiChatConversationMessage) string {
	candidate := collapseAIChatConversationWhitespace(preview)
	if candidate == "" {
		for index := len(messages) - 1; index >= 0; index-- {
			if strings.TrimSpace(messages[index].Role) == "system" {
				continue
			}
			candidate = collapseAIChatConversationWhitespace(messages[index].Content)
			if candidate != "" {
				break
			}
		}
	}

	if len(candidate) > 200 {
		candidateRunes := []rune(candidate)
		if len(candidateRunes) > 200 {
			return string(candidateRunes[:200])
		}
	}

	return candidate
}

// loadAIChatConversation reads the one active conversation row for the authenticated user and dataset.
func loadAIChatConversation(ctx context.Context, userID int, dataset string) (aiChatConversationPayload, error) {
	payload := aiChatConversationPayload{
		Dataset:  dataset,
		Messages: []aiChatConversationMessage{},
		Preview:  "",
	}

	var rawMessages []byte
	var updatedAt time.Time
	err := backend.Db.QueryRowContext(ctx, `
		SELECT preview, messages, updated_at
		FROM ai_chat_conversations
		WHERE user_id = $1 AND dataset = $2
	`, userID, dataset).Scan(&payload.Preview, &rawMessages, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return payload, nil
		}
		return aiChatConversationPayload{}, err
	}

	if err := json.Unmarshal(rawMessages, &payload.Messages); err != nil {
		return aiChatConversationPayload{}, err
	}

	if payload.Messages == nil {
		payload.Messages = []aiChatConversationMessage{}
	}
	payload.UpdatedAt = &updatedAt
	return payload, nil
}

// saveAIChatConversation upserts the single conversation row for one authenticated user and dataset.
func saveAIChatConversation(ctx context.Context, userID int, payload aiChatConversationPayload) (aiChatConversationPayload, error) {
	messagesJSON, err := json.Marshal(payload.Messages)
	if err != nil {
		return aiChatConversationPayload{}, err
	}

	var updatedAt time.Time
	err = backend.Db.QueryRowContext(ctx, `
		INSERT INTO ai_chat_conversations (user_id, dataset, preview, messages)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (user_id, dataset)
		DO UPDATE SET
			preview = EXCLUDED.preview,
			messages = EXCLUDED.messages,
			updated_at = NOW()
		RETURNING updated_at
	`, userID, payload.Dataset, payload.Preview, string(messagesJSON)).Scan(&updatedAt)
	if err != nil {
		return aiChatConversationPayload{}, err
	}

	payload.UpdatedAt = &updatedAt
	return payload, nil
}

// writeAIChatConversationJSON returns the stable conversation envelope shared by GET and PUT.
func writeAIChatConversationJSON(w http.ResponseWriter, payload aiChatConversationPayload) {
	if payload.Messages == nil {
		payload.Messages = []aiChatConversationMessage{}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding AI chat conversation response")
	}
}

func collapseAIChatConversationWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
