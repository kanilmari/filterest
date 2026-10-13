// guest_ui_bootstrap_test.go
// Proves the public auth bootstrap delivers guest UI grants on every guest exit.
// Connects real bootstrap handling to scripted permission rows and cookie state.
// Keeps failed reads and authenticated identities from retaining guest grants.
package auth

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"

	"easelect/backend/core_components/auth_generation"
	"github.com/gorilla/sessions"
)

func TestGuestUIBootstrap(t *testing.T) {
	for _, tc := range []struct {
		name                                               string
		userID                                             int
		loginRequired, authenticated, readError, rowsError bool
	}{
		{"anonymous public site", 0, false, false, false, false},
		{"anonymous login site", 0, true, false, false, false},
		{"guest cookie", 1, false, false, false, false},
		{"stale guest cookie on login site", 1, true, false, false, false},
		{"revoked signed-in session", 42, false, false, false, false},
		{"signed in excludes guests", 42, false, true, false, false},
		{"failed permission query", 0, false, false, true, false},
		{"partial permission read", 0, false, false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := setupAuthModesTestStore(t)
			endpoints := []string{"/ui/article/section/details", "/ui/view/card"}
			setupAuthModesMockDB(t, authModesMockConfig{loginToBrowse: tc.loginRequired,
				guestUIEndpoints: endpoints, guestUIReadError: tc.readError, guestUIRowsError: tc.rowsError})
			matcher := authModesAuthenticationGenerationMatches
			t.Cleanup(func() { authModesAuthenticationGenerationMatches = matcher })
			authModesAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
				return tc.authenticated, nil
			}
			var values map[interface{}]interface{}
			if tc.userID > 0 {
				values = map[interface{}]interface{}{"user_id": tc.userID}
			}
			response := httptest.NewRecorder()
			GetAuthModesHandler(response, buildAuthModesReq(t, store, "/api/auth-modes", values))
			var body AuthModesResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(response.Code, response.Header())
			}
			if tc.authenticated || tc.readError || tc.rowsError {
				if len(body.GuestUIEndpoints) != 0 {
					t.Fatal("unexpected guest grants", body.GuestUIEndpoints)
				}
			} else if !reflect.DeepEqual(body.GuestUIEndpoints, endpoints) {
				t.Fatal(body.GuestUIEndpoints)
			}
		})
	}
}
