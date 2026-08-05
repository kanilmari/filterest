// dataset_alias_reader_test.go
// Verifies router dataset alias resolution for raw and public dataset names.
// Bridges the temporary alias registry with router/SEO callers that expect canonical names.
// Exists to prevent the first public dataset alias slice from drifting between inbound and outbound paths.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

func TestResolveRawDatasetNameMapsPublicAliasToRawName(t *testing.T) {
	if got := resolveRawDatasetName("service_catalog"); got != "app_service_catalog" {
		t.Fatalf("resolveRawDatasetName(service_catalog) = %q, want app_service_catalog", got)
	}
}

func TestResolveRawDatasetNameKeepsUnknownNamesUnchanged(t *testing.T) {
	if got := resolveRawDatasetName("system_users"); got != "system_users" {
		t.Fatalf("resolveRawDatasetName(system_users) = %q, want system_users", got)
	}
}

func TestResolvePublicDatasetNameMapsRawNameToAlias(t *testing.T) {
	if got := resolvePublicDatasetName("app_service_catalog"); got != "service_catalog" {
		t.Fatalf("resolvePublicDatasetName(app_service_catalog) = %q, want service_catalog", got)
	}
}

func TestResolveDatasetNameReadsDBBackedAliasRegistryWhenAvailable(t *testing.T) {
	db := openRouterAliasTestDB(t)
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
		_ = db.Close()
	})

	if got := resolveRawDatasetName("service_directory"); got != "app_service_catalog" {
		t.Fatalf("resolveRawDatasetName(service_directory) = %q, want app_service_catalog", got)
	}
	if got := resolvePublicDatasetName("app_service_catalog"); got != "service_directory" {
		t.Fatalf("resolvePublicDatasetName(app_service_catalog) = %q, want service_directory", got)
	}
}

func TestBuildCanonicalDatasetPathPrefersPublicAlias(t *testing.T) {
	got := buildCanonicalDatasetPath("app_service_catalog", []string{"service_catalog", "42-sample-title"})
	if got != "/service_catalog/42-sample-title" {
		t.Fatalf("buildCanonicalDatasetPath() = %q, want /service_catalog/42-sample-title", got)
	}
}

func TestGetDatasetAliasesHandlerReturnsRegistryPayload(t *testing.T) {
	db := openRouterAliasTestDB(t)
	orig := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = orig
		_ = db.Close()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/dataset-aliases", nil)
	rec := httptest.NewRecorder()

	GetDatasetAliasesHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var payload struct {
		RawToPublic map[string]string `json:"raw_to_public"`
		PublicToRaw map[string]string `json:"public_to_raw"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if got := payload.RawToPublic["app_service_catalog"]; got != "service_directory" {
		t.Fatalf("raw_to_public[app_service_catalog] = %q, want service_directory", got)
	}
	if got := payload.PublicToRaw["service_directory"]; got != "app_service_catalog" {
		t.Fatalf("public_to_raw[service_directory] = %q, want app_service_catalog", got)
	}
	if got := payload.RawToPublic["app_orders"]; got != "orders" {
		t.Fatalf("raw_to_public[app_orders] = %q, want orders", got)
	}
	if got := payload.PublicToRaw["orders"]; got != "app_orders" {
		t.Fatalf("public_to_raw[orders] = %q, want app_orders", got)
	}
}

func TestGetDatasetAliasesHandlerRejectsNonGETMethods(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/dataset-aliases", nil)
	rec := httptest.NewRecorder()

	GetDatasetAliasesHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

type routerAliasDriver struct{}
type routerAliasConn struct{}
type routerAliasStmt struct{ query string }
type routerAliasRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}
type routerAliasTx struct{}

func openRouterAliasTestDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("router_alias_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &routerAliasDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

func (d *routerAliasDriver) Open(string) (driver.Conn, error) { return &routerAliasConn{}, nil }
func (c *routerAliasConn) Prepare(query string) (driver.Stmt, error) {
	return &routerAliasStmt{query: query}, nil
}
func (c *routerAliasConn) Close() error              { return nil }
func (c *routerAliasConn) Begin() (driver.Tx, error) { return &routerAliasTx{}, nil }
func (c *routerAliasConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &routerAliasTx{}, nil
}
func (*routerAliasTx) Commit() error   { return nil }
func (*routerAliasTx) Rollback() error { return nil }

func (c *routerAliasConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if query == "" {
		return nil, fmt.Errorf("unexpected empty query")
	}
	return buildRouterAliasRows(query)
}

func (s *routerAliasStmt) Close() error  { return nil }
func (s *routerAliasStmt) NumInput() int { return -1 }
func (s *routerAliasStmt) Exec([]driver.Value) (driver.Result, error) {
	return nil, fmt.Errorf("exec not supported")
}
func (s *routerAliasStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return buildRouterAliasRows(s.query)
}

func buildRouterAliasRows(query string) (driver.Rows, error) {
	switch {
	case containsRouterAliasTableQuery(query):
		return &routerAliasRows{
			cols: []string{"table_name", "alias_slug"},
			data: [][]driver.Value{{"app_service_catalog", "service_directory"}},
		}, nil
	case strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables"):
		return &routerAliasRows{
			cols: []string{"table_uid", "table_name"},
			data: [][]driver.Value{
				{int64(1), "app_service_catalog"},
				{int64(2), "app_orders"},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func containsRouterAliasTableQuery(query string) bool {
	return strings.Contains(query, "system_db_table_aliases")
}

func (r *routerAliasRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *routerAliasRows) Close() error      { return nil }
func (r *routerAliasRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.idx])
	r.idx++
	return nil
}
