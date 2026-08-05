// dataset_alias_handler_test.go
// Verifies the dedicated dataset alias admin handlers for read and save flows.
// Bridges router HTTP handling, lazy transactions, and dataset alias editor logic with a stateful SQL test double.
// Exists to keep the admin alias tool coherent while app_ aliases stay automatic and system_ aliases stay explicit opt-in.
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
	"sync"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

type datasetAliasHandlerMockState struct {
	mu      sync.Mutex
	tables  map[string]int
	aliases map[string]string
}

type datasetAliasHandlerMockDriver struct{ state *datasetAliasHandlerMockState }
type datasetAliasHandlerMockConn struct{ state *datasetAliasHandlerMockState }
type datasetAliasHandlerMockTx struct{}

type datasetAliasHandlerMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

type datasetAliasHandlerResponse struct {
	Status                          string `json:"status"`
	Message                         string `json:"message"`
	SystemAliasPolicyRecommendation string `json:"system_alias_policy_recommendation"`
	Dataset                         struct {
		DatasetName              string `json:"dataset_name"`
		StoredPrimaryAlias       string `json:"stored_primary_alias"`
		EffectivePublicAlias     string `json:"effective_public_alias"`
		AliasSource              string `json:"alias_source"`
		CanonicalDatasetPath     string `json:"canonical_dataset_path"`
		DefaultAliasAutoReserved bool   `json:"default_alias_auto_reserved"`
	} `json:"dataset"`
}

type datasetAliasHandlerSnapshotResponse struct {
	SystemAliasPolicyRecommendation string `json:"system_alias_policy_recommendation"`
	Datasets                        []struct {
		DatasetName                 string `json:"dataset_name"`
		StoredPrimaryAlias          string `json:"stored_primary_alias"`
		EffectivePublicAlias        string `json:"effective_public_alias"`
		AliasSource                 string `json:"alias_source"`
		DefaultPublicAliasCandidate string `json:"default_public_alias_candidate"`
		DefaultAliasAutoReserved    bool   `json:"default_alias_auto_reserved"`
	} `json:"datasets"`
}

var datasetAliasHandlerDriverCounter int64

func TestGetDatasetAliasManagementHandlerReturnsPolicyAndAliasSources(t *testing.T) {
	db := openDatasetAliasHandlerTestDB(t, map[string]int{
		"app_orders":   11,
		"system_users": 12,
	}, nil)

	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = previousDB
	})

	req := httptest.NewRequest(http.MethodGet, "/api/dataset-alias-management", nil)
	rec := httptest.NewRecorder()

	GetDatasetAliasManagementHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var payload datasetAliasHandlerSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if !strings.Contains(payload.SystemAliasPolicyRecommendation, "system_ aliases") {
		t.Fatalf("policy recommendation = %q, want explicit system_ opt-in guidance", payload.SystemAliasPolicyRecommendation)
	}

	appOrders := findDatasetAliasHandlerSnapshotEntry(t, payload.Datasets, "app_orders")
	if appOrders.EffectivePublicAlias != "orders" {
		t.Fatalf("app_orders effective alias = %q, want orders", appOrders.EffectivePublicAlias)
	}
	if appOrders.AliasSource != "automatic_app_policy" {
		t.Fatalf("app_orders alias source = %q, want automatic_app_policy", appOrders.AliasSource)
	}
	if !appOrders.DefaultAliasAutoReserved {
		t.Fatal("expected app_orders stripped alias to stay auto-reserved")
	}

	systemUsers := findDatasetAliasHandlerSnapshotEntry(t, payload.Datasets, "system_users")
	if systemUsers.EffectivePublicAlias != "" {
		t.Fatalf("system_users effective alias = %q, want empty", systemUsers.EffectivePublicAlias)
	}
	if systemUsers.DefaultPublicAliasCandidate != "users" {
		t.Fatalf("system_users default candidate = %q, want users", systemUsers.DefaultPublicAliasCandidate)
	}
	if systemUsers.DefaultAliasAutoReserved {
		t.Fatal("expected system_users stripped alias to remain opt-in")
	}
}

func TestSaveDatasetAliasManagementHandlerStoresExplicitSystemAlias(t *testing.T) {
	db := openDatasetAliasHandlerTestDB(t, map[string]int{
		"system_reports": 21,
	}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/dataset-alias-management/save", strings.NewReader(`{"dataset_name":"system_reports","alias_slug":"reports-admin"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(dbutils.SetLazyTx(req.Context(), dbutils.NewLazyTx(db)))

	rec := httptest.NewRecorder()
	SaveDatasetAliasManagementHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}

	var payload datasetAliasHandlerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if payload.Message != "Dataset alias saved" {
		t.Fatalf("message = %q, want Dataset alias saved", payload.Message)
	}
	if payload.Dataset.DatasetName != "system_reports" {
		t.Fatalf("dataset_name = %q, want system_reports", payload.Dataset.DatasetName)
	}
	if payload.Dataset.StoredPrimaryAlias != "reports-admin" || payload.Dataset.EffectivePublicAlias != "reports-admin" {
		t.Fatalf("stored/effective alias = (%q, %q), want (reports-admin, reports-admin)", payload.Dataset.StoredPrimaryAlias, payload.Dataset.EffectivePublicAlias)
	}
	if payload.Dataset.AliasSource != "database_primary_active" {
		t.Fatalf("alias source = %q, want database_primary_active", payload.Dataset.AliasSource)
	}
	if payload.Dataset.DefaultAliasAutoReserved {
		t.Fatal("expected explicit system alias to stay opt-in instead of auto-reserved")
	}
	if payload.Dataset.CanonicalDatasetPath != "/reports-admin" {
		t.Fatalf("canonical path = %q, want /reports-admin", payload.Dataset.CanonicalDatasetPath)
	}
}

func TestSaveDatasetAliasManagementHandlerClearsAppAliasBackToAutomaticRoute(t *testing.T) {
	db := openDatasetAliasHandlerTestDB(t, map[string]int{
		"app_orders": 11,
	}, map[string]string{
		"app_orders": "shop-orders",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/dataset-alias-management/save", strings.NewReader(`{"dataset_name":"app_orders","alias_slug":""}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(dbutils.SetLazyTx(req.Context(), dbutils.NewLazyTx(db)))

	rec := httptest.NewRecorder()
	SaveDatasetAliasManagementHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}

	var payload datasetAliasHandlerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if payload.Message != "Dataset alias cleared" {
		t.Fatalf("message = %q, want Dataset alias cleared", payload.Message)
	}
	if payload.Dataset.StoredPrimaryAlias != "" {
		t.Fatalf("stored_primary_alias = %q, want empty", payload.Dataset.StoredPrimaryAlias)
	}
	if payload.Dataset.EffectivePublicAlias != "orders" {
		t.Fatalf("effective_public_alias = %q, want orders", payload.Dataset.EffectivePublicAlias)
	}
	if payload.Dataset.AliasSource != "automatic_app_policy" {
		t.Fatalf("alias source = %q, want automatic_app_policy", payload.Dataset.AliasSource)
	}
	if !payload.Dataset.DefaultAliasAutoReserved {
		t.Fatal("expected app_orders stripped alias to remain auto-reserved after clear")
	}
	if payload.Dataset.CanonicalDatasetPath != "/orders" {
		t.Fatalf("canonical path = %q, want /orders", payload.Dataset.CanonicalDatasetPath)
	}
}

func openDatasetAliasHandlerTestDB(t *testing.T, tables map[string]int, aliases map[string]string) *sql.DB {
	t.Helper()

	state := &datasetAliasHandlerMockState{
		tables:  make(map[string]int, len(tables)),
		aliases: make(map[string]string, len(aliases)),
	}
	for datasetName, tableUID := range tables {
		state.tables[datasetName] = tableUID
	}
	for datasetName, aliasSlug := range aliases {
		state.aliases[datasetName] = aliasSlug
	}

	driverName := fmt.Sprintf("dataset_alias_handler_%d", atomic.AddInt64(&datasetAliasHandlerDriverCounter, 1))
	sql.Register(driverName, &datasetAliasHandlerMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func findDatasetAliasHandlerSnapshotEntry(t *testing.T, entries []struct {
	DatasetName                 string `json:"dataset_name"`
	StoredPrimaryAlias          string `json:"stored_primary_alias"`
	EffectivePublicAlias        string `json:"effective_public_alias"`
	AliasSource                 string `json:"alias_source"`
	DefaultPublicAliasCandidate string `json:"default_public_alias_candidate"`
	DefaultAliasAutoReserved    bool   `json:"default_alias_auto_reserved"`
}, datasetName string) struct {
	DatasetName                 string `json:"dataset_name"`
	StoredPrimaryAlias          string `json:"stored_primary_alias"`
	EffectivePublicAlias        string `json:"effective_public_alias"`
	AliasSource                 string `json:"alias_source"`
	DefaultPublicAliasCandidate string `json:"default_public_alias_candidate"`
	DefaultAliasAutoReserved    bool   `json:"default_alias_auto_reserved"`
} {
	t.Helper()

	for _, entry := range entries {
		if entry.DatasetName == datasetName {
			return entry
		}
	}
	t.Fatalf("missing dataset %q in alias snapshot", datasetName)
	return struct {
		DatasetName                 string `json:"dataset_name"`
		StoredPrimaryAlias          string `json:"stored_primary_alias"`
		EffectivePublicAlias        string `json:"effective_public_alias"`
		AliasSource                 string `json:"alias_source"`
		DefaultPublicAliasCandidate string `json:"default_public_alias_candidate"`
		DefaultAliasAutoReserved    bool   `json:"default_alias_auto_reserved"`
	}{}
}

func (d *datasetAliasHandlerMockDriver) Open(string) (driver.Conn, error) {
	return &datasetAliasHandlerMockConn{state: d.state}, nil
}

func (c *datasetAliasHandlerMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in dataset alias handler mock")
}

func (c *datasetAliasHandlerMockConn) Close() error { return nil }
func (c *datasetAliasHandlerMockConn) Begin() (driver.Tx, error) {
	return &datasetAliasHandlerMockTx{}, nil
}
func (c *datasetAliasHandlerMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &datasetAliasHandlerMockTx{}, nil
}

func (*datasetAliasHandlerMockTx) Commit() error   { return nil }
func (*datasetAliasHandlerMockTx) Rollback() error { return nil }

func (c *datasetAliasHandlerMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for index, arg := range args {
		named[index] = driver.NamedValue{Ordinal: index + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *datasetAliasHandlerMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	switch {
	case strings.Contains(query, "SELECT t.table_name, a.alias_slug") && strings.Contains(query, "FROM system_db_table_aliases a"):
		return buildDatasetAliasHandlerAliasRows(c.state), nil
	case strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasHandlerTableRows(c.state), nil
	case strings.Contains(query, "SELECT table_uid") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasHandlerTableUIDRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT t.table_name") && strings.Contains(query, "WHERE a.alias_slug = $1"):
		return buildDatasetAliasHandlerAliasOwnerRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT table_name") && strings.Contains(query, "FROM system_db_tables") && strings.Contains(query, "LIMIT 1"):
		return buildDatasetAliasHandlerAutomaticOwnerRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT id, table_name") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasHandlerConflictRows(c.state, args), nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (c *datasetAliasHandlerMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for index, arg := range args {
		named[index] = driver.NamedValue{Ordinal: index + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *datasetAliasHandlerMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	switch {
	case strings.Contains(query, "DELETE FROM system_db_table_aliases") && strings.Contains(query, "alias_slug <> $2"):
		tableUID := namedIntArg(args, 0)
		aliasSlug := namedStringArg(args, 1)
		for datasetName, existingAlias := range c.state.aliases {
			if c.state.tables[datasetName] == tableUID && existingAlias != aliasSlug {
				delete(c.state.aliases, datasetName)
			}
		}
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "DELETE FROM system_db_table_aliases"):
		tableUID := namedIntArg(args, 0)
		for datasetName := range c.state.aliases {
			if c.state.tables[datasetName] == tableUID {
				delete(c.state.aliases, datasetName)
			}
		}
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "INSERT INTO system_db_table_aliases"):
		tableUID := namedIntArg(args, 0)
		aliasSlug := namedStringArg(args, 1)
		datasetName := datasetAliasHandlerDatasetNameByUID(c.state, tableUID)
		if datasetName == "" {
			return nil, fmt.Errorf("unknown table_uid %d", tableUID)
		}
		c.state.aliases[datasetName] = aliasSlug
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "UPDATE system_db_table_aliases"):
		return driver.RowsAffected(1), nil
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
}

func buildDatasetAliasHandlerAliasRows(state *datasetAliasHandlerMockState) driver.Rows {
	rows := make([][]driver.Value, 0, len(state.aliases))
	for datasetName, aliasSlug := range state.aliases {
		rows = append(rows, []driver.Value{datasetName, aliasSlug})
	}
	return &datasetAliasHandlerMockRows{
		cols: []string{"table_name", "alias_slug"},
		rows: rows,
	}
}

func buildDatasetAliasHandlerTableRows(state *datasetAliasHandlerMockState) driver.Rows {
	rows := make([][]driver.Value, 0, len(state.tables))
	for datasetName, tableUID := range state.tables {
		rows = append(rows, []driver.Value{int64(tableUID), datasetName})
	}
	return &datasetAliasHandlerMockRows{
		cols: []string{"table_uid", "table_name"},
		rows: rows,
	}
}

func buildDatasetAliasHandlerTableUIDRows(state *datasetAliasHandlerMockState, datasetName string) driver.Rows {
	tableUID, ok := state.tables[datasetName]
	if !ok {
		return &datasetAliasHandlerMockRows{cols: []string{"table_uid"}}
	}
	return &datasetAliasHandlerMockRows{
		cols: []string{"table_uid"},
		rows: [][]driver.Value{{int64(tableUID)}},
	}
}

func buildDatasetAliasHandlerAliasOwnerRows(state *datasetAliasHandlerMockState, aliasSlug string) driver.Rows {
	for datasetName, existingAlias := range state.aliases {
		if existingAlias == aliasSlug {
			return &datasetAliasHandlerMockRows{
				cols: []string{"table_name"},
				rows: [][]driver.Value{{datasetName}},
			}
		}
	}
	return &datasetAliasHandlerMockRows{cols: []string{"table_name"}}
}

func buildDatasetAliasHandlerAutomaticOwnerRows(state *datasetAliasHandlerMockState, datasetName string) driver.Rows {
	if _, ok := state.tables[datasetName]; !ok {
		return &datasetAliasHandlerMockRows{cols: []string{"table_name"}}
	}
	return &datasetAliasHandlerMockRows{
		cols: []string{"table_name"},
		rows: [][]driver.Value{{datasetName}},
	}
}

func buildDatasetAliasHandlerConflictRows(state *datasetAliasHandlerMockState, args []driver.NamedValue) driver.Rows {
	segment := namedStringArg(args, 0)
	excludeID := namedIntArg(args, 1)

	for datasetName, tableUID := range state.tables {
		if datasetName == segment && tableUID != excludeID {
			return &datasetAliasHandlerMockRows{
				cols: []string{"id", "table_name"},
				rows: [][]driver.Value{{int64(tableUID), datasetName}},
			}
		}
	}

	return &datasetAliasHandlerMockRows{cols: []string{"id", "table_name"}}
}

func datasetAliasHandlerDatasetNameByUID(state *datasetAliasHandlerMockState, tableUID int) string {
	for datasetName, currentUID := range state.tables {
		if currentUID == tableUID {
			return datasetName
		}
	}
	return ""
}

func namedStringArg(args []driver.NamedValue, index int) string {
	if len(args) <= index {
		return ""
	}
	value, _ := args[index].Value.(string)
	return value
}

func namedIntArg(args []driver.NamedValue, index int) int {
	if len(args) <= index {
		return 0
	}
	switch value := args[index].Value.(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	default:
		return 0
	}
}

func (r *datasetAliasHandlerMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *datasetAliasHandlerMockRows) Close() error      { return nil }

func (r *datasetAliasHandlerMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}
