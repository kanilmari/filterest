// provider_api_key_handler.go
// Accepts a named AI provider's API key from an authenticated administrator without echoing it.
// Bridges the embedding admin page's key form and the protected environment-file writer.
// Exists so an administrator installs a provider key in the interface instead of editing a server file.
package router

import (
	"encoding/json"
	"errors"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

type saveProviderAPIKeyRequest struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
}

// saveProviderAPIKeyResponse names the provider that was configured and nothing
// else. The stored value is never part of an answer.
type saveProviderAPIKeyResponse struct {
	Saved    bool   `json:"saved"`
	Provider string `json:"provider"`
}

var providerAPIKeySaver = backend.SaveProviderAPIKey

// saveProviderAPIKeyHandler distinguishes three outcomes the administrator must
// be able to tell apart: a refused value, an installation whose settings the
// application cannot write, and an unexpected failure. Conflating them would
// let the page claim a success it did not achieve.
func saveProviderAPIKeyHandler(w http.ResponseWriter, r *http.Request) {
	var payload saveProviderAPIKeyRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid JSON request body")
		return
	}

	if err := providerAPIKeySaver(payload.Provider, payload.APIKey); err != nil {
		switch {
		case errors.Is(err, backend.ErrUnknownAPIKeyProvider):
			httpresponse.RespondWithError(w, http.StatusBadRequest, "unknown API key provider")
		case errors.Is(err, backend.ErrInvalidProviderAPIKey):
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid provider API key")
		case errors.Is(err, backend.ErrProtectedEnvironmentNotWritable):
			httpresponse.RespondWithError(
				w,
				http.StatusConflict,
				"this installation's protected settings cannot be written by the application",
			)
		default:
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to store the provider API key")
		}
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, saveProviderAPIKeyResponse{
		Saved:    true,
		Provider: backend.NormalizeAPIKeyProvider(payload.Provider),
	})
}
