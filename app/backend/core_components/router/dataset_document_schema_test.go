// dataset_document_schema_test.go
// Proves document metadata and read rights keep the public dataset's identity.
// Connects real page/sitemap handlers with equal names in public and audit schemas.
// Exercises both registry orders and grants that belong only to the private namesake.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"github.com/gorilla/sessions"
)

type documentSchemaFixture struct {
	privateFirst        bool
	publicGrant         bool
	emptyPublicMetadata bool
	signInRequired      bool
}

func setupDocumentSchemaFixture(t *testing.T, fixture documentSchemaFixture) {
	t.Helper()
	setupRootHandlerMockDB(t, false)
	name := fmt.Sprintf("document_schema_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
	sql.Register(name, documentSchemaDriver{fixture})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	backend.Db, backend.DbConfidential = db, db
	backend.ResetEaselectInstanceRoleCache()
	t.Cleanup(func() { db.Close() })
	setupRootHandlerSessionStore(t)
	setupRootHandlerFrontend(t)
	withRootAuthenticationGenerationMatch(t, func(context.Context, auth_generation.Querier, *sessions.Session, int) (bool, error) { return true, nil })
}

func assertDocumentSchemaMetadata(t *testing.T, emptyPublicMetadata bool) {
	t.Helper()
	title, description := "Public Orders", "Public order description"
	if emptyPublicMetadata {
		title, description = "App Orders", "App Orders"
	}
	for _, userID := range []int{1, 42} {
		for _, address := range []string{"shop-orders", "old-orders", "app_orders"} {
			for _, suffix := range []string{"", "/42-order"} {
				response := httptest.NewRecorder()
				request := httptest.NewRequest("GET", "/"+address+suffix, nil)
				attachRootHandlerSessionUser(t, request, userID)
				rootHandler(response, request)
				body := response.Body.String()
				if response.Code != 200 {
					t.Errorf("%s%s status=%d: %s", address, suffix, response.Code, body)
					continue
				}
				for _, wanted := range []string{
					"<title>" + title + " — example.com</title>",
					`<meta property="og:title" content="` + title + `">`,
					`<meta name="description" content="` + description + `">`,
					`<meta property="og:description" content="` + description + `">`,
				} {
					if !strings.Contains(body, wanted) {
						t.Errorf("%s%s missing %s: %s", address, suffix, wanted, body)
					}
				}
				if strings.Contains(body, "Private Audit") {
					t.Errorf("%s%s disclosed private namesake metadata: %s", address, suffix, body)
				}
			}
		}
	}
}

func TestDocumentMetadataKeepsPublicUIDInBothRegistryOrders(t *testing.T) {
	for _, privateFirst := range []bool{false, true} {
		for _, empty := range []bool{false, true} {
			t.Run(fmt.Sprintf("private_first_%t_empty_public_%t", privateFirst, empty), func(t *testing.T) {
				setupDocumentSchemaFixture(t, documentSchemaFixture{privateFirst: privateFirst, publicGrant: true, emptyPublicMetadata: empty})
				assertDocumentSchemaMetadata(t, empty)
			})
		}
	}
}

func assertDocumentSchemaDenied(t *testing.T) {
	t.Helper()
	for _, userID := range []int{1, 42} {
		for _, address := range []string{"shop-orders", "old-orders", "app_orders"} {
			t.Run(fmt.Sprintf("user_%d_%s", userID, address), func(t *testing.T) {
				request := httptest.NewRequest("GET", "/"+address+"/42-order", nil)
				attachRootHandlerSessionUser(t, request, userID)
				response := httptest.NewRecorder()
				rootHandler(response, request)
				wantStatus := http.StatusForbidden
				if userID == 1 {
					wantStatus = http.StatusSeeOther
				}
				if response.Code != wantStatus || strings.Contains(response.Body.String(), "root-shell") || strings.Contains(response.Body.String(), "Public Orders") {
					t.Errorf("audit-only grant admitted public document: status=%d body=%s", response.Code, response.Body.String())
				}
				if userID == 1 && !strings.HasPrefix(response.Header().Get("Location"), "/login") {
					t.Errorf("guest denial missing login redirect: %s", response.Header().Get("Location"))
				}
			})
		}
	}
	t.Run("sitemap", func(t *testing.T) {
		response := httptest.NewRecorder()
		sitemapHandler(response, httptest.NewRequest("GET", "/sitemap.xml", nil))
		var sitemap urlSet
		if err := xml.Unmarshal(response.Body.Bytes(), &sitemap); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || len(sitemap.URLs) != 1 || strings.Contains(response.Body.String(), "orders") {
			t.Errorf("audit-only guest grant published public address: %s", response.Body.String())
		}
	})
}

func TestDocumentAndSitemapRejectAuditOnlyReadGrants(t *testing.T) {
	setupDocumentSchemaFixture(t, documentSchemaFixture{privateFirst: true})
	assertDocumentSchemaDenied(t)
}

func TestDocumentSignInEntryOmitsDatasetMetadata(t *testing.T) {
	setupDocumentSchemaFixture(t, documentSchemaFixture{privateFirst: true, signInRequired: true})
	response := httptest.NewRecorder()
	rootHandler(response, httptest.NewRequest("GET", "/shop-orders?login-entry=1", nil))
	body := response.Body.String()
	if response.Code != 200 || !strings.Contains(body, "root-shell") || strings.Contains(body, "Public Orders") || strings.Contains(body, "Private Audit") {
		t.Fatalf("sign-in shell published dataset metadata: %d %s", response.Code, body)
	}
}

type documentSchemaDriver struct{ documentSchemaFixture }
type documentSchemaConn struct {
	*rootHandlerMockConn
	documentSchemaFixture
}

func (d documentSchemaDriver) Open(string) (driver.Conn, error) {
	return &documentSchemaConn{&rootHandlerMockConn{config: rootHandlerMockConfig{loginToBrowse: d.signInRequired}}, d.documentSchemaFixture}, nil
}

func (c *documentSchemaConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT table_uid, table_name"):
		values := [][]driver.Value{{int64(11), "app_orders", "public"}, {int64(12), "app_orders", "audit"}}
		if c.privateFirst {
			values[0], values[1] = values[1], values[0]
		}
		return &sitemapMockRows{cols: []string{"table_uid", "table_name", "schema_name"}, vals: values}, nil
	case strings.Contains(query, "FROM system_db_table_aliases"):
		return &sitemapMockRows{cols: []string{"table_uid", "alias_slug", "is_primary"}, vals: [][]driver.Value{
			{int64(11), "shop-orders", true}, {int64(11), "old-orders", false}, {int64(12), "private-audit-orders", true},
		}}, nil
	case strings.Contains(query, "SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name"):
		return &rootHandlerMockRows{cols: []string{"exists"}, vals: []driver.Value{true}}, nil
	case strings.Contains(query, "SELECT display_name FROM system_db_tables"), strings.Contains(query, "SELECT description FROM system_db_tables"):
		private := c.privateFirst
		if strings.Contains(query, "WHERE table_uid = $1") {
			private = fmt.Sprint(args[0].Value) == "12"
		}
		value := "Public Orders"
		if strings.Contains(query, "SELECT description") {
			value = "Public order description"
		}
		if c.emptyPublicMetadata {
			value = ""
		}
		if private {
			value = "Private Audit Name"
			if strings.Contains(query, "SELECT description") {
				value = "Private Audit Description"
			}
		}
		return &rootHandlerMockRows{cols: []string{"value"}, vals: []driver.Value{value}}, nil
	case strings.Contains(query, "NOT t.ui_hidden"):
		if strings.Contains(query, "t.table_uid") {
			return &sitemapMockRows{cols: []string{"table_uid", "table_name", "updated"}, vals: [][]driver.Value{{int64(11), "app_orders", sitemapTestUpdated}}}, nil
		}
		return &sitemapMockRows{cols: []string{"table_name", "updated"}, vals: [][]driver.Value{{"app_orders", sitemapTestUpdated}}}, nil
	case strings.Contains(query, "FROM system_group_table_func_rights"):
		allowed := false
		if len(args) == 3 && fmt.Sprint(args[0].Value) == "/api/get-results" {
			target := fmt.Sprint(args[2].Value)
			// Audit grants always exist. A name-only join accepts them for public too.
			allowed = target == "12" || (target == "11" && c.publicGrant) || (target == "app_orders" && strings.Contains(query, "sdt.table_name"))
		}
		return &rootHandlerMockRows{cols: []string{"allowed"}, vals: []driver.Value{1}, empty: !allowed}, nil
	}
	return c.rootHandlerMockConn.QueryContext(ctx, query, args)
}
