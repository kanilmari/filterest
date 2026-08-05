// user_profile_handlers_test.go
// Verifies the profile fetch endpoint rejects anonymous and guest-only sessions.
// Bridges gorilla sessions and the profile handler without needing a database round-trip.
// Exists to prevent guest browsing sessions from triggering confidential-profile lookups and 500s.
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

func prepareUserProfileSessionStore(t *testing.T) {
	t.Helper()

	origStore := e_sessions.Store
	origSessionName := e_sessions.SessionName

	testStore := sessions.NewCookieStore([]byte("01234567890123456789012345678901"))
	testStore.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	}
	e_sessions.Store = testStore
	e_sessions.SessionName = "session"

	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origSessionName
	})
}

func attachSessionUserID(t *testing.T, userID int) *http.Cookie {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/api/user-profile", nil)
	rr := httptest.NewRecorder()

	session, err := e_sessions.GetOrCreateSession(rr, req)
	if err != nil {
		t.Fatalf("GetOrCreateSession() error = %v", err)
	}
	session.Values["user_id"] = userID
	if err := session.Save(req, rr); err != nil {
		t.Fatalf("session.Save() error = %v", err)
	}

	res := rr.Result()
	defer res.Body.Close()
	for _, cookie := range res.Cookies() {
		if cookie.Name == e_sessions.SessionName {
			return cookie
		}
	}
	t.Fatal("session cookie missing")
	return nil
}

func TestUserProfileFetchHandlerRejectsMissingSessionUser(t *testing.T) {
	prepareUserProfileSessionStore(t)

	req := httptest.NewRequest(http.MethodGet, "/api/user-profile", nil)
	rr := httptest.NewRecorder()

	UserProfileFetchHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(rr.Body.String(), "not_authenticated") {
		t.Fatalf("body = %q, want not_authenticated", rr.Body.String())
	}
}

func TestUserProfileFetchHandlerRejectsGuestSession(t *testing.T) {
	prepareUserProfileSessionStore(t)
	cookie := attachSessionUserID(t, 1)

	req := httptest.NewRequest(http.MethodGet, "/api/user-profile", nil)
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	UserProfileFetchHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(rr.Body.String(), "not_authenticated") {
		t.Fatalf("body = %q, want not_authenticated", rr.Body.String())
	}
}
