// front_page_auth_modes_test.go
// Verifies optional home presentation fields on all four existing bootstrap exits.
// Authentication fixtures stay unchanged; only the optional presentation readers are replaced.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"github.com/gorilla/sessions"
)

func TestFrontPageAuthModesAllResponsesAndFallback(t *testing.T) {
	for _, tc := range []struct {
		name                             string
		userID                           int
		loginRequired, generationMatches bool
	}{
		{"anonymous login site", 0, true, false}, {"stale signed in", 42, false, false},
		{"guest login site", 1, true, false}, {"signed in", 42, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := setupAuthModesTestStore(t)
			setupAuthModesMockDB(t, authModesMockConfig{loginToBrowse: tc.loginRequired, userExists: true})
			settings, name, matcher := authModesFrontPageSettingsReader, authModesFrontPageSiteNameReader, authModesAuthenticationGenerationMatches
			t.Cleanup(func() {
				authModesFrontPageSettingsReader, authModesFrontPageSiteNameReader, authModesAuthenticationGenerationMatches = settings, name, matcher
			})
			authModesFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
				return backend.FrontPageSettings{SeparateFrontPage: true, FrontPageButtonShowsSiteName: true}, nil
			}
			authModesFrontPageSiteNameReader = func(context.Context, *sql.DB) string { return "Test site" }
			authModesAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
				return tc.generationMatches, nil
			}
			var values map[interface{}]interface{}
			if tc.userID > 0 {
				values = map[interface{}]interface{}{"user_id": tc.userID, "user_role": "basic"}
			}
			response := httptest.NewRecorder()
			GetAuthModesHandler(response, buildAuthModesReq(t, store, "/api/auth-modes", values))
			var result AuthModesResponse
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(response.Code, err, response.Body.String())
			}
			if response.Code != 200 || !result.SeparateFrontPage || result.FrontPageButtonSiteName != "Test site" {
				t.Fatal(response.Code, result)
			}
			authModesFrontPageSiteNameReader = func(context.Context, *sql.DB) string { return "" }
			if result := buildAuthModesResponse(httptest.NewRequest("GET", "/api/auth-modes", nil), "login", false, backend.LoginAccessSettings{}); result.FrontPageButtonSiteName != "" {
				t.Fatal(result)
			}
			authModesFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
				return backend.FrontPageSettings{}, errors.New("unavailable")
			}
			result = buildAuthModesResponse(httptest.NewRequest("GET", "/api/auth-modes", nil), "login", false, backend.LoginAccessSettings{})
			if result.SeparateFrontPage || result.FrontPageButtonSiteName != "" {
				t.Fatal(result)
			}
		})
	}
}
