// favorites_handler.go
// Serves personal favorites through typed, permission-checked target resolvers.
// Bridges session ownership, the administrator pipeline and the shared favorites table.
// Exists so a client cannot select a target table, key, or another account's favorites.
package favorites

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"unicode/utf8"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

type favorite struct {
	ID        int64  `json:"id"`
	Type      string `json:"type"`
	Route     string `json:"route"`
	SortOrder int    `json:"sort_order"`
}

type favoriteRequest struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	Route string `json:"route"`
}

var favoriteReader = readFavorites
var favoriteAdder = addFavorite
var favoriteDeleter = deleteFavorite

var errTargetNotFound = errors.New("favorite target not found")

// FavoritesHandler reads, adds or removes the signed-in administrator's favorites.
// GET is read-only. POST accepts {type:"admin_tool",route}; DELETE accepts that
// target or {id}. The AdminProfile supplies route rights, CSRF and the admin gate.
func FavoritesHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "authenticated user required")
		return
	}
	// Every authenticated result identifies the session owner for stale browser tabs.
	respond := func(status int, body map[string]any) {
		body["owner_user_id"] = userID
		httpresponse.RespondWithJSON(w, status, body)
	}
	respondError := func(status int, message string) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		respond(status, map[string]any{"error": message, "code": status})
	}
	if r.Method == http.MethodGet {
		items, err := favoriteReader(r.Context(), userID)
		if err != nil {
			respondError(http.StatusInternalServerError, "favorites unavailable")
			return
		}
		respond(http.StatusOK, map[string]any{"favorites": items})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	request, err := decodeFavoriteRequest(r)
	if err != nil {
		respondError(http.StatusBadRequest, "invalid favorite request")
		return
	}
	if r.Method == http.MethodDelete {
		removed, err := favoriteDeleter(r.Context(), userID, request)
		if err != nil {
			respondError(http.StatusInternalServerError, "favorite removal failed")
			return
		}
		respond(http.StatusOK, map[string]any{"removed": removed})
		return
	}
	item, created, err := favoriteAdder(r.Context(), userID, request.Route)
	if errors.Is(err, errTargetNotFound) {
		respondError(http.StatusNotFound, "favorite target unavailable")
		return
	}
	if err != nil {
		respondError(http.StatusInternalServerError, "favorite save failed")
		return
	}
	respond(http.StatusOK, map[string]any{"favorite": item, "created": created})
}

func decodeFavoriteRequest(r *http.Request) (favoriteRequest, error) {
	var request favoriteRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if r.Method == http.MethodPost {
		// POST has no id field: even a zero id is an unknown client reference.
		var target struct {
			Type  string `json:"type"`
			Route string `json:"route"`
		}
		if err := decoder.Decode(&target); err != nil {
			return request, err
		}
		request.Type, request.Route = target.Type, target.Route
	} else {
		var deletion struct {
			ID    *int64  `json:"id"`
			Type  *string `json:"type"`
			Route *string `json:"route"`
		}
		if err := decoder.Decode(&deletion); err != nil {
			return request, err
		}
		if deletion.ID != nil {
			if *deletion.ID <= 0 || deletion.Type != nil || deletion.Route != nil {
				return request, errors.New("expected id or an admin tool route")
			}
			request.ID = *deletion.ID
		} else {
			if deletion.Type != nil {
				request.Type = *deletion.Type
			}
			if deletion.Route != nil {
				request.Route = *deletion.Route
			}
		}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("expected exactly one JSON object")
	}
	if r.Method == http.MethodDelete && request.ID > 0 && request.Type == "" && request.Route == "" {
		return request, nil
	}
	if request.ID != 0 || request.Type != "admin_tool" || utf8.RuneCountInString(request.Route) > 200 || len(request.Route) == 0 || request.Route[0] != '/' {
		return request, errors.New("expected an admin tool route")
	}
	return request, nil
}
