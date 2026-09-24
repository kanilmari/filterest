// dataset_ui_visibility_test.go
// Verifies hidden direct dataset URLs stop before HTML or SEO rendering.
// Bridges current visibility, existing sessions and root-handler fixtures.
// Exists to cover guest, ordinary and admin routes independently of SPA state.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"fmt"
	gorillaSessions "github.com/gorilla/sessions"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type hiddenRootDriver struct {
	hidden bool
	fail   bool
}
type hiddenRootConn struct {
	*rootHandlerMockConn
	hidden bool
	fail   bool
}

func (d hiddenRootDriver) Open(string) (driver.Conn, error) {
	return hiddenRootConn{&rootHandlerMockConn{config: rootHandlerMockConfig{loginToBrowse: false}}, d.hidden, d.fail}, nil
}
func (c hiddenRootConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(q, "dataset.ui_hidden") {
		if c.fail {
			return nil, fmt.Errorf("metadata unavailable")
		}
		// Policy truth is separately exercised on disposable PostgreSQL.
		hidden := c.hidden && args[1].Value != int64(7)
		return &rootHandlerMockRows{cols: []string{"hidden"}, vals: []driver.Value{hidden}}, nil
	}
	return c.rootHandlerMockConn.QueryContext(ctx, q, args)
}
func TestDirectHiddenDatasetDoesNotRenderShellOrSEO(t *testing.T) {
	for _, tc := range []struct {
		name         string
		hidden, fail bool
		user, status int
	}{
		{"ordinary visible", false, false, 42, 200},
		{"ordinary hidden", true, false, 42, 404},
		{"guest hidden", true, false, 1, 404},
		{"administrator hidden", true, false, 7, 200},
		{"administrator visible", false, false, 7, 200},
		{"metadata failure", false, true, 42, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupRootHandlerMockDB(t, false)
			setupRootHandlerSessionStore(t)
			setupRootHandlerFrontend(t)
			name := fmt.Sprintf("hidden_root_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
			sql.Register(name, hiddenRootDriver{tc.hidden, tc.fail})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			backend.Db = db
			backend.DbConfidential = db
			t.Cleanup(func() { db.Close() })
			withRootAuthenticationGenerationMatch(t, func(context.Context, auth_generation.Querier, *gorillaSessions.Session, int) (bool, error) {
				return true, nil
			})
			req := httptest.NewRequest(http.MethodGet, "/app_service_catalog/42-private-title?view=article_view", nil)
			attachRootHandlerSessionUser(t, req, tc.user)
			rec := httptest.NewRecorder()
			rootHandler(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status=%d want%d body=%s", rec.Code, tc.status, rec.Body)
			}
			if tc.status != 200 && (strings.Contains(rec.Body.String(), "<html") || strings.Contains(rec.Body.String(), "og:") || strings.Contains(rec.Body.String(), "private-title")) {
				t.Fatalf("hidden page leaked HTML/SEO: %s", rec.Body)
			}
		})
	}
}
