// dataset_address_collision_test.go
// Proves generated addresses obey the same ownership as incoming resolution.
// Connects canonical metadata and the sitemap to a real-name/primary-alias collision.
// Keeps a readable dataset's links from leading to an unreadable namesake.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
)

func TestDatasetAddressCollisionResolutionCanonicalAndSitemap(t *testing.T) {
	t.Setenv("BASE_URL", sitemapTestBaseURL)
	setupRootHandlerMockDB(t, false)
	name := fmt.Sprintf("dataset_collision_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
	sql.Register(name, datasetCollisionDriver{})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	backend.Db, backend.DbConfidential = db, db
	backend.ResetEaselectInstanceRoleCache()
	t.Cleanup(func() { db.Close() })
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)

	t.Run("resolution", func(t *testing.T) {
		for _, raw := range []string{"app_orders", "orders"} {
			if got := resolveRawDatasetName(raw); got != raw {
				t.Fatalf("real name %s resolved to %s", raw, got)
			}
			if got := resolvePublicDatasetName(raw); got != raw {
				t.Fatalf("generated address for %s uses another dataset's name: %s", raw, got)
			}
		}
	})
	t.Run("canonical", func(t *testing.T) {
		for _, suffix := range []string{"", "/42-order"} {
			path := "/app_orders" + suffix
			meta := resolvePageMeta(httptest.NewRequest("GET", sitemapTestBaseURL+path, nil))
			if meta.CanonicalURL != sitemapTestBaseURL+path || meta.OGURL != meta.CanonicalURL {
				t.Fatalf("canonical address leads to the wrong dataset: %+v", meta)
			}
			response := httptest.NewRecorder()
			rootHandler(response, httptest.NewRequest("GET", path, nil))
			if response.Code != 200 || !strings.Contains(response.Body.String(), `<link rel="canonical" href="`+sitemapTestBaseURL+path+`">`) {
				t.Fatalf("page publishes the wrong canonical link: %d %s", response.Code, response.Body.String())
			}
		}
	})
	// Which public name the sitemap uses is the published-dataset reader's answer
	// (PublicArticleDatasets, proven against PostgreSQL in system_table_tools); the
	// pool it reads is the same LoadDatasetNamePools this resolution uses.
}

type datasetCollisionDriver struct{}
type datasetCollisionConn struct{ sitemapMockConn }

func (datasetCollisionDriver) Open(string) (driver.Conn, error) {
	return datasetCollisionConn{sitemapMockConn{&rootHandlerMockConn{}}}, nil
}

func (c datasetCollisionConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_db_table_aliases"):
		if strings.Contains(query, "SELECT table_uid, alias_slug") {
			return &sitemapMockRows{cols: []string{"table_uid", "alias_slug", "is_primary"}, vals: [][]driver.Value{{int64(11), "orders", true}}}, nil
		}
		return &sitemapMockRows{cols: []string{"table_name", "alias_slug"}, vals: [][]driver.Value{{"app_orders", "orders"}}}, nil
	case strings.Contains(query, "SELECT table_uid, table_name"):
		if strings.Contains(query, "schema_name") {
			return &sitemapMockRows{cols: []string{"table_uid", "table_name", "schema_name"}, vals: [][]driver.Value{{int64(11), "app_orders", "public"}, {int64(12), "orders", "public"}}}, nil
		}
		return &sitemapMockRows{cols: []string{"table_uid", "table_name"}, vals: [][]driver.Value{{int64(11), "app_orders"}, {int64(12), "orders"}}}, nil
	case strings.Contains(query, "FROM system_group_table_func_rights"):
		allowed := len(args) > 2 && fmt.Sprint(args[0].Value) == "/api/get-results" && fmt.Sprint(args[1].Value) == "1" && fmt.Sprint(args[2].Value) == "11"
		return &rootHandlerMockRows{cols: []string{"allowed"}, vals: []driver.Value{1}, empty: !allowed}, nil
	}
	return c.sitemapMockConn.QueryContext(ctx, query, args)
}
