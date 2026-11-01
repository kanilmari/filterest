// category_filter_button_width_mode_test.go
// Verifies category width delivery through the real auth bootstrap handler.
// Connects stored text, missing rows and read failures to every public response.
// Keeps layout independent of Home availability and signed-in state.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"github.com/gorilla/sessions"
)

type categoryWidthDriver struct {
	config          authModesMockConfig
	value           driver.Value
	missing, failed bool
}
type categoryWidthConn struct {
	*authModesMockConn
	fixture categoryWidthDriver
}

var categoryWidthDriverID atomic.Int64

func (d categoryWidthDriver) Open(string) (driver.Conn, error) {
	return &categoryWidthConn{&authModesMockConn{cfg: d.config}, d}, nil
}
func (c *categoryWidthConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if len(args) == 1 && args[0].Value == categoryFilterButtonWidthModeKey {
		if c.fixture.failed {
			return nil, errors.New("simulated setting read error")
		}
		return &authModesMockRows{cols: []string{"text_value"}, vals: []driver.Value{c.fixture.value}, empty: c.fixture.missing}, nil
	}
	return c.authModesMockConn.QueryContext(ctx, query, args)
}

func TestCategoryButtonWidthAuthModesStoredValuesAndFallback(t *testing.T) {
	for _, tc := range []struct {
		name            string
		value           driver.Value
		missing, failed bool
		want            string
	}{
		{"D", defaultCategoryFilterButtonWidthMode, false, false, defaultCategoryFilterButtonWidthMode},
		{"C", "fit_to_label", false, false, "fit_to_label"},
		{"missing", nil, true, false, defaultCategoryFilterButtonWidthMode},
		{"read error", nil, false, true, defaultCategoryFilterButtonWidthMode},
		{"unknown", "other", false, false, defaultCategoryFilterButtonWidthMode},
		{"null", nil, false, false, defaultCategoryFilterButtonWidthMode},
	} {
		for _, identity := range []struct {
			name             string
			id               int
			private, matches bool
		}{
			{"public visitor", 0, false, false}, {"anonymous private", 0, true, false},
			{"retained guest", 1, true, false}, {"signed in", 42, false, true}, {"stale signed in", 42, false, false},
		} {
			t.Run(tc.name+"/"+identity.name, func(t *testing.T) {
				store := setupAuthModesTestStore(t)
				name := fmt.Sprintf("category_width_%d", categoryWidthDriverID.Add(1))
				sql.Register(name, categoryWidthDriver{authModesMockConfig{loginToBrowse: identity.private, userExists: true}, tc.value, tc.missing, tc.failed})
				db, err := sql.Open(name, "")
				if err != nil {
					t.Fatal(err)
				}
				old, conf, home, matcher := backend.Db, backend.DbConfidential, authModesFrontPageSettingsReader, authModesAuthenticationGenerationMatches
				backend.Db, backend.DbConfidential = db, db
				// Home errors must not prevent a valid category layout answer.
				authModesFrontPageSettingsReader = func(context.Context, *sql.DB) (backend.FrontPageSettings, error) {
					return backend.FrontPageSettings{}, errors.New("Home unavailable")
				}
				authModesAuthenticationGenerationMatches = func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) {
					return identity.matches, nil
				}
				t.Cleanup(func() {
					backend.Db, backend.DbConfidential, authModesFrontPageSettingsReader, authModesAuthenticationGenerationMatches = old, conf, home, matcher
					db.Close()
				})
				var values map[interface{}]interface{}
				if identity.id > 0 {
					values = map[interface{}]interface{}{"user_id": identity.id}
				}
				response := httptest.NewRecorder()
				GetAuthModesHandler(response, buildAuthModesReq(t, store, "/api/auth-modes", values))
				var body AuthModesResponse
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || body.CategoryFilterButtonWidthMode != tc.want {
					t.Fatal(response.Code, response.Header(), body)
				}
			})
		}
	}
}
