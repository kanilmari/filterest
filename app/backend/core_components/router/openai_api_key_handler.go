// openai_api_key_handler.go
// Accepts an OpenAI API key from an authenticated administrator without echoing it.
// Bridges the chat setup prompt and the protected environment-file writer.
// Exists so a fresh Filterest installation can activate chat without a manual restart.
package router

import (
	"encoding/json"
	"errors"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

type saveOpenAIAPIKeyRequest struct {
	APIKey string `json:"api_key"`
}

// openAIAPIKeySaver keeps this route's existing request shape and answers
// while the generalised provider saver owns the behaviour.
var openAIAPIKeySaver = backend.SaveOpenAIAPIKey

func saveOpenAIAPIKeyHandler(w http.ResponseWriter, r *http.Request) {

	var payload saveOpenAIAPIKeyRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON request body")
		return
	}
	if err := openAIAPIKeySaver(payload.APIKey); err != nil {
		if errors.Is(err, backend.ErrInvalidProviderAPIKey) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid OpenAI API key")
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to store OpenAI API key")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]bool{"saved": true})
}
