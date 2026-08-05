// ai_chat_conversation_handler_test.go
// Verifies the API-first AI chat conversation persistence handler contract.
// Bridges authenticated HTTP requests and the narrow per-user per-dataset storage hooks.
// Exists to keep the new server-backed filterbar chat slice stable while frontend work continues separately.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestNormalizeAIChatConversationPayloadBuildsPreview(t *testing.T) {
	payload, err := normalizeAIChatConversationPayload(aiChatConversationPayload{
		Dataset: " app_service_catalog ",
		Messages: []aiChatConversationMessage{
			{
				Role:    " user ",
				Content: "Hei\n maailma",
			},
		},
	})
	if err != nil {
		t.Fatalf("normalizeAIChatConversationPayload returned error: %v", err)
	}

	if payload.Dataset != "app_service_catalog" {
		t.Fatalf("payload.Dataset = %q, want app_service_catalog", payload.Dataset)
	}
	if payload.Messages[0].Role != "user" {
		t.Fatalf("payload.Messages[0].Role = %q, want user", payload.Messages[0].Role)
	}
	if payload.Preview != "Hei maailma" {
		t.Fatalf("payload.Preview = %q, want collapsed message preview", payload.Preview)
	}
	if payload.UpdatedAt != nil {
		t.Fatalf("payload.UpdatedAt = %#v, want nil", payload.UpdatedAt)
	}
}

func TestNormalizeAIChatConversationPayloadSkipsSystemMemoryInPreview(t *testing.T) {
	payload, err := normalizeAIChatConversationPayload(aiChatConversationPayload{
		Dataset: "app_service_catalog",
		Messages: []aiChatConversationMessage{
			{
				Role:    "user",
				Content: "Find workshops",
			},
			{
				Role:    "assistant",
				Content: "I found two likely workshops.",
			},
			{
				Role:    "system",
				Content: filterbarAIResultMemoryMarker + "\n{\"rows\":[{\"title\":\"Hidden\"}]}",
			},
		},
	})
	if err != nil {
		t.Fatalf("normalizeAIChatConversationPayload returned error: %v", err)
	}

	if payload.Preview != "I found two likely workshops." {
		t.Fatalf("payload.Preview = %q, want visible assistant preview", payload.Preview)
	}
}

func TestBuildAIChatConversationPreviewTruncatesMultilingualTextOnRuneBoundary(t *testing.T) {
	preview := buildAIChatConversationPreview("", []aiChatConversationMessage{
		{
			Role:    "assistant",
			Content: strings.Repeat("ä", 201),
		},
	})

	if !utf8.ValidString(preview) {
		t.Fatalf("preview contains invalid UTF-8: %q", preview)
	}
	if got := utf8.RuneCountInString(preview); got != 200 {
		t.Fatalf("preview rune count = %d, want 200", got)
	}
}

func TestFilterbarAIConversationHandlerGetReturnsStoredConversation(t *testing.T) {
	originalUserIDReader := aiChatConversationUserIDReader
	originalLoader := aiChatConversationLoader
	t.Cleanup(func() {
		aiChatConversationUserIDReader = originalUserIDReader
		aiChatConversationLoader = originalLoader
	})

	updatedAt := time.Date(2026, time.April, 23, 12, 30, 0, 0, time.UTC)
	aiChatConversationUserIDReader = func(r *http.Request) (int, error) {
		return 7, nil
	}
	aiChatConversationLoader = func(_ context.Context, userID int, dataset string) (aiChatConversationPayload, error) {
		if userID != 7 {
			t.Fatalf("userID = %d, want 7", userID)
		}
		if dataset != "app_service_catalog" {
			t.Fatalf("dataset = %q, want app_service_catalog", dataset)
		}
		return aiChatConversationPayload{
			Dataset: "app_service_catalog",
			Messages: []aiChatConversationMessage{
				{Role: "user", Content: "Find Finnish CRMs"},
				{Role: "assistant", Content: "Here are some candidates."},
			},
			Preview:   "Here are some candidates.",
			UpdatedAt: &updatedAt,
		}, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/api/app/ai-chat/conversation?dataset=app_service_catalog", nil)
	rec := httptest.NewRecorder()

	FilterbarAIConversationHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIConversationHandler(GET) status = %d, want 200", rec.Code)
	}

	var response aiChatConversationPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Dataset != "app_service_catalog" {
		t.Fatalf("response.Dataset = %q, want app_service_catalog", response.Dataset)
	}
	if len(response.Messages) != 2 {
		t.Fatalf("len(response.Messages) = %d, want 2", len(response.Messages))
	}
	if response.UpdatedAt == nil || !response.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("response.UpdatedAt = %#v, want %v", response.UpdatedAt, updatedAt)
	}
}

func TestFilterbarAIConversationHandlerRejectsGuestUser(t *testing.T) {
	originalUserIDReader := aiChatConversationUserIDReader
	t.Cleanup(func() {
		aiChatConversationUserIDReader = originalUserIDReader
	})

	aiChatConversationUserIDReader = func(r *http.Request) (int, error) {
		return 1, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/api/app/ai-chat/conversation?dataset=app_service_catalog", nil)
	rec := httptest.NewRecorder()

	FilterbarAIConversationHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("FilterbarAIConversationHandler(guest) status = %d, want 401", rec.Code)
	}
}

func TestFilterbarAIConversationHandlerPutSavesConversation(t *testing.T) {
	originalUserIDReader := aiChatConversationUserIDReader
	originalSaver := aiChatConversationSaver
	t.Cleanup(func() {
		aiChatConversationUserIDReader = originalUserIDReader
		aiChatConversationSaver = originalSaver
	})

	updatedAt := time.Date(2026, time.April, 23, 12, 45, 0, 0, time.UTC)
	aiChatConversationUserIDReader = func(r *http.Request) (int, error) {
		return 9, nil
	}
	aiChatConversationSaver = func(_ context.Context, userID int, payload aiChatConversationPayload) (aiChatConversationPayload, error) {
		if userID != 9 {
			t.Fatalf("userID = %d, want 9", userID)
		}
		if payload.Dataset != "app_service_catalog" {
			t.Fatalf("payload.Dataset = %q, want app_service_catalog", payload.Dataset)
		}
		if payload.Preview != "Need a Finnish CRM recommendation" {
			t.Fatalf("payload.Preview = %q, want derived preview", payload.Preview)
		}
		payload.UpdatedAt = &updatedAt
		return payload, nil
	}

	req := httptest.NewRequest(http.MethodPut, "/api/app/ai-chat/conversation", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"messages": [
			{"role": "user", "content": "Need a Finnish CRM recommendation"}
		],
		"preview": ""
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIConversationHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("FilterbarAIConversationHandler(PUT) status = %d, want 200", rec.Code)
	}

	var response aiChatConversationPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON unmarshal error = %v", err)
	}
	if response.Preview != "Need a Finnish CRM recommendation" {
		t.Fatalf("response.Preview = %q, want derived preview", response.Preview)
	}
	if response.UpdatedAt == nil || !response.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("response.UpdatedAt = %#v, want %v", response.UpdatedAt, updatedAt)
	}
}

func TestFilterbarAIConversationHandlerPutRejectsInvalidMessage(t *testing.T) {
	originalUserIDReader := aiChatConversationUserIDReader
	t.Cleanup(func() {
		aiChatConversationUserIDReader = originalUserIDReader
	})

	aiChatConversationUserIDReader = func(r *http.Request) (int, error) {
		return 9, nil
	}

	req := httptest.NewRequest(http.MethodPut, "/api/app/ai-chat/conversation", strings.NewReader(`{
		"dataset": "app_service_catalog",
		"messages": [
			{"role": "", "content": "hello"}
		]
	}`))
	rec := httptest.NewRecorder()

	FilterbarAIConversationHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("FilterbarAIConversationHandler(PUT invalid) status = %d, want 400", rec.Code)
	}
}
