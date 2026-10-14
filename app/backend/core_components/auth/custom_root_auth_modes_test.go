// custom_root_auth_modes_test.go
// Proves bootstrap exposes effective custom-root readiness and no operator path.
// Uses existing authentication exits and real temporary files behind the readiness reader.
// Prevents missing files, older settings and login-required guests from triggering reloads.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"github.com/gorilla/sessions"
)

func TestCustomRootAuthModesEffectiveReadinessMatrix(t *testing.T) {
	for _, on := range []bool{false, true} {
		for _, present := range []bool{false, true} {
			for _, tc := range []struct {
				name                   string
				userID                 int
				loginRequired, matches bool
			}{
				{"anonymous private", 0, true, false}, {"retained guest private", 1, true, false},
				{"guest public", 1, false, false}, {"signed in private", 42, true, true},
				{"signed in public", 42, false, true}, {"revoked private", 42, true, false},
			} {
				t.Run(fmt.Sprintf("on=%t/present=%t/%s", on, present, tc.name), func(t *testing.T) {
					store := setupAuthModesTestStore(t)
					setupAuthModesMockDB(t, authModesMockConfig{loginToBrowse: tc.loginRequired, userExists: true})
					settings, available, matcher := authModesFrontPageSettingsReader, authModesSiteRootAvailable, authModesAuthenticationGenerationMatches
					t.Cleanup(func() {
						authModesFrontPageSettingsReader, authModesSiteRootAvailable, authModesAuthenticationGenerationMatches = settings, available, matcher
					})
					authModesFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
						return backend.FrontPageSettings{DisplayIndexHTMLAtStartup: on}, nil
					}
					storage := t.TempDir()
					if present {
						if err := os.Mkdir(filepath.Join(storage, "site_root"), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(storage, "site_root", "index.html"), []byte("custom"), 0600); err != nil {
							t.Fatal(err)
						}
					}
					authModesSiteRootAvailable = func() bool { return backend.SiteRootAvailable(storage) }
					authModesAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
						return tc.matches, nil
					}
					var values map[interface{}]interface{}
					if tc.userID > 0 {
						values = map[interface{}]interface{}{"user_id": tc.userID, "user_role": "basic"}
					}
					response := httptest.NewRecorder()
					GetAuthModesHandler(response, buildAuthModesReq(t, store, "/api/auth-modes", values))
					var result AuthModesResponse
					if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
						t.Fatal(response.Code, err)
					}
					want := on && present && (!tc.loginRequired || tc.userID > 1 && tc.matches)
					if response.Code != 200 || result.DisplayIndexHTMLAtStartup != want {
						t.Fatal(response.Code, result, want)
					}
					if strings.Contains(response.Body.String(), storage) || strings.Contains(response.Body.String(), "site_root") {
						t.Fatal("operator path leaked", response.Body.String())
					}
				})
			}
		}
	}
}
