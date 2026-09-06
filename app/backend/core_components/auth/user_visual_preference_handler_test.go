// user_visual_preference_handler_test.go
// Verifies self-scoped theme reads, strict validation, and guest rejection.
// Bridges session identity with injectable preference persistence functions.
// Exists so account appearance cannot be written for a caller-selected user.
package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUserVisualPreferenceHandlerReadsOnlySessionOwner(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 42)
	originalReader := userVisualPreferenceReader
	var capturedUserID int
	userVisualPreferenceReader = func(_ context.Context, userID int) (userVisualPreferenceResponse, error) {
		capturedUserID = userID
		return userVisualPreferenceResponse{ThemeMode: "dark", Revision: 3, Configured: true}, nil
	}
	t.Cleanup(func() { userVisualPreferenceReader = originalReader })

	request := httptest.NewRequest(http.MethodGet, "/api/user-visual-preference?user_id=7", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	UserVisualPreferenceHandler(response, request)

	if response.Code != http.StatusOK || capturedUserID != 42 {
		t.Fatalf("status/owner = %d/%d, want %d/42", response.Code, capturedUserID, http.StatusOK)
	}
	if !strings.Contains(response.Body.String(), `"theme_mode":"dark"`) {
		t.Fatalf("body = %q, want dark preference", response.Body.String())
	}
}

func TestUserVisualPreferenceHandlerWritesValidatedThemeForSessionOwner(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 73)
	originalWriter := userVisualPreferenceWriter
	var capturedUserID int
	var capturedTheme string
	userVisualPreferenceWriter = func(_ context.Context, userID int, themeMode string) (userVisualPreferenceResponse, error) {
		capturedUserID = userID
		capturedTheme = themeMode
		return userVisualPreferenceResponse{ThemeMode: themeMode, Revision: 1, Configured: true}, nil
	}
	t.Cleanup(func() { userVisualPreferenceWriter = originalWriter })

	request := httptest.NewRequest(http.MethodPatch, "/api/user-visual-preference", strings.NewReader(`{"theme_mode":"light"}`))
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	UserVisualPreferenceHandler(response, request)

	if response.Code != http.StatusOK || capturedUserID != 73 || capturedTheme != "light" {
		t.Fatalf("status/owner/theme = %d/%d/%q, want %d/73/light", response.Code, capturedUserID, capturedTheme, http.StatusOK)
	}
}

func TestUserVisualPreferenceHandlerRejectsUnknownOrUnsupportedInput(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 73)
	originalWriter := userVisualPreferenceWriter
	userVisualPreferenceWriter = func(context.Context, int, string) (userVisualPreferenceResponse, error) {
		t.Fatal("invalid request must not reach persistence")
		return userVisualPreferenceResponse{}, nil
	}
	t.Cleanup(func() { userVisualPreferenceWriter = originalWriter })

	for _, body := range []string{
		`{"theme_mode":"sepia"}`,
		`{"theme_mode":"dark","user_id":99}`,
		`{"theme_mode":"dark"}{"theme_mode":"light"}`,
	} {
		request := httptest.NewRequest(http.MethodPatch, "/api/user-visual-preference", strings.NewReader(body))
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		UserVisualPreferenceHandler(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %q status = %d, want %d", body, response.Code, http.StatusBadRequest)
		}
	}
}

func TestUserVisualPreferenceHandlerResetsOnlySessionOwner(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 81)
	originalDeleter := userVisualPreferenceDeleter
	var capturedUserID int
	userVisualPreferenceDeleter = func(_ context.Context, userID int) (userVisualPreferenceResponse, error) {
		capturedUserID = userID
		return userVisualPreferenceResponse{ThemeMode: "system"}, nil
	}
	t.Cleanup(func() { userVisualPreferenceDeleter = originalDeleter })

	request := httptest.NewRequest(http.MethodDelete, "/api/user-visual-preference?user_id=99", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	UserVisualPreferenceHandler(response, request)

	if response.Code != http.StatusOK || capturedUserID != 81 {
		t.Fatalf("status/owner = %d/%d, want %d/81", response.Code, capturedUserID, http.StatusOK)
	}
	if !strings.Contains(response.Body.String(), `"configured":false`) {
		t.Fatalf("body = %q, want unconfigured default", response.Body.String())
	}
}

func TestUserVisualPreferenceHandlerRejectsGuest(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 1)
	request := httptest.NewRequest(http.MethodGet, "/api/user-visual-preference", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()

	UserVisualPreferenceHandler(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}
