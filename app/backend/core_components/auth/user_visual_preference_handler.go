// user_visual_preference_handler.go
// Serves the authenticated user's allowlisted visual preferences.
// Bridges the login session, request transaction, and account-owned preference row.
// Exists so personal appearance follows the account without accepting arbitrary CSS.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

const defaultUserThemeMode = "system"

type userVisualPreferenceResponse struct {
	ThemeMode  string `json:"theme_mode"`
	Revision   int64  `json:"revision"`
	Configured bool   `json:"configured"`
}

type saveUserVisualPreferenceRequest struct {
	ThemeMode string `json:"theme_mode"`
}

var userVisualPreferenceReader = readUserVisualPreference
var userVisualPreferenceWriter = writeUserVisualPreference
var userVisualPreferenceDeleter = deleteUserVisualPreference

// UserVisualPreferenceHandler reads or replaces the current account's own
// allowlisted visual preference. The owner always comes from the session.
func UserVisualPreferenceHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "authenticated user required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		preference, readErr := userVisualPreferenceReader(r.Context(), userID)
		if readErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "visual preference unavailable")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, preference)
	case http.MethodPatch:
		request, decodeErr := decodeUserVisualPreferenceRequest(r)
		if decodeErr != nil || !isSupportedUserThemeMode(request.ThemeMode) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "theme_mode must be system, dark, or light")
			return
		}
		preference, writeErr := userVisualPreferenceWriter(r.Context(), userID, request.ThemeMode)
		if writeErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "visual preference save failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, preference)
	case http.MethodDelete:
		preference, deleteErr := userVisualPreferenceDeleter(r.Context(), userID)
		if deleteErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "visual preference reset failed")
			return
		}
		httpresponse.RespondWithJSON(w, http.StatusOK, preference)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func deleteUserVisualPreference(ctx context.Context, userID int) (userVisualPreferenceResponse, error) {
	preference := userVisualPreferenceResponse{ThemeMode: defaultUserThemeMode}
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return preference, errors.New("request transaction unavailable")
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM public.system_user_visual_preferences
		WHERE user_id = $1`, userID); err != nil {
		return preference, err
	}
	return preference, nil
}

func decodeUserVisualPreferenceRequest(r *http.Request) (saveUserVisualPreferenceRequest, error) {
	var request saveUserVisualPreferenceRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request body must contain exactly one JSON object")
	}
	return request, nil
}

func isSupportedUserThemeMode(themeMode string) bool {
	return themeMode == "system" || themeMode == "dark" || themeMode == "light"
}

func readUserVisualPreference(ctx context.Context, userID int) (userVisualPreferenceResponse, error) {
	preference := userVisualPreferenceResponse{ThemeMode: defaultUserThemeMode}
	err := backend.Db.QueryRowContext(ctx, `
		SELECT COALESCE(theme_mode, $2), revision
		FROM public.system_user_visual_preferences
		WHERE user_id = $1`, userID, defaultUserThemeMode).Scan(
		&preference.ThemeMode,
		&preference.Revision,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return preference, nil
	}
	if err != nil {
		return preference, err
	}
	preference.Configured = true
	return preference, nil
}

func writeUserVisualPreference(
	ctx context.Context,
	userID int,
	themeMode string,
) (userVisualPreferenceResponse, error) {
	preference := userVisualPreferenceResponse{ThemeMode: themeMode}
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return preference, errors.New("request transaction unavailable")
	}
	err := tx.QueryRowContext(ctx, `
		INSERT INTO public.system_user_visual_preferences (
			user_id, theme_mode, schema_version, revision
		)
		VALUES ($1, $2, 1, 1)
		ON CONFLICT (user_id)
		DO UPDATE SET theme_mode = EXCLUDED.theme_mode,
		              schema_version = EXCLUDED.schema_version,
		              revision = system_user_visual_preferences.revision + 1,
		              updated = now()
		RETURNING theme_mode, revision`, userID, themeMode).Scan(
		&preference.ThemeMode,
		&preference.Revision,
	)
	if err != nil {
		return preference, err
	}
	preference.Configured = true
	return preference, nil
}
