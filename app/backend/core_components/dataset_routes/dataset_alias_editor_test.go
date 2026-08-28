// dataset_alias_editor_test.go
// Verifies the dataset alias admin editor read-model, save path, and alias-collision rules.
// Bridges dataset_routes alias editor logic and a stateful SQL driver double without PostgreSQL.
// Exists to keep alias-management behavior stable while the read path remains backward compatible.
package dataset_routes

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type datasetAliasEditorMockState struct {
	mu      sync.Mutex
	tables  map[string]int
	aliases map[string]string
}

type datasetAliasEditorMockDriver struct{ state *datasetAliasEditorMockState }
type datasetAliasEditorMockConn struct{ state *datasetAliasEditorMockState }
type datasetAliasEditorMockTx struct{}

type datasetAliasEditorMockRows struct {
	cols []string
	rows [][]driver.Value
	idx  int
}

var datasetAliasEditorDriverCounter int64

func TestLoadDatasetAliasManagementSnapshotUsesDatabaseAliasSource(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"app_orders":   11,
		"system_users": 12,
	}, map[string]string{
		"app_orders": "orders",
	})

	snapshot, err := LoadDatasetAliasManagementSnapshot(db)
	if err != nil {
		t.Fatalf("LoadDatasetAliasManagementSnapshot returned error: %v", err)
	}

	if got := snapshot.SystemAliasPolicyRecommendation; !strings.Contains(got, "system_") {
		t.Fatalf("policy recommendation = %q, want explicit system_ guidance", got)
	}

	appOrders, err := findAliasManagementEntry(snapshot, "app_orders")
	if err != nil {
		t.Fatalf("findAliasManagementEntry(app_orders) returned error: %v", err)
	}
	if appOrders.StoredPrimaryAlias != "orders" || appOrders.EffectivePublicAlias != "orders" {
		t.Fatalf("app_orders aliases = (%q, %q), want (orders, orders)", appOrders.StoredPrimaryAlias, appOrders.EffectivePublicAlias)
	}
	if appOrders.AliasSource != aliasSourceDatabase {
		t.Fatalf("AliasSource = %q, want %q", appOrders.AliasSource, aliasSourceDatabase)
	}
	if appOrders.CanonicalDatasetPath != "/orders" {
		t.Fatalf("CanonicalDatasetPath = %q, want /orders", appOrders.CanonicalDatasetPath)
	}
	if !appOrders.DefaultAliasAutoReserved {
		t.Fatal("expected app_orders default alias to be auto-reserved")
	}

	systemUsers, err := findAliasManagementEntry(snapshot, "system_users")
	if err != nil {
		t.Fatalf("findAliasManagementEntry(system_users) returned error: %v", err)
	}
	if systemUsers.DefaultPublicAliasCandidate != "users" {
		t.Fatalf("DefaultPublicAliasCandidate = %q, want users", systemUsers.DefaultPublicAliasCandidate)
	}
	if systemUsers.DefaultAliasAutoReserved {
		t.Fatal("expected stripped system_ alias to remain opt-in")
	}
}

func TestLoadDatasetAliasManagementSnapshotUsesFallbackAliasSourceWhenNoStoredAlias(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"app_service_catalog": 7,
	}, nil)

	snapshot, err := LoadDatasetAliasManagementSnapshot(db)
	if err != nil {
		t.Fatalf("LoadDatasetAliasManagementSnapshot returned error: %v", err)
	}

	entry, err := findAliasManagementEntry(snapshot, "app_service_catalog")
	if err != nil {
		t.Fatalf("findAliasManagementEntry(app_service_catalog) returned error: %v", err)
	}
	if entry.StoredPrimaryAlias != "" {
		t.Fatalf("StoredPrimaryAlias = %q, want empty", entry.StoredPrimaryAlias)
	}
	if entry.EffectivePublicAlias != "service_catalog" {
		t.Fatalf("EffectivePublicAlias = %q, want service_catalog", entry.EffectivePublicAlias)
	}
	if entry.AliasSource != aliasSourceFallback {
		t.Fatalf("AliasSource = %q, want %q", entry.AliasSource, aliasSourceFallback)
	}
}

func TestLoadDatasetAliasManagementSnapshotUsesAutomaticAppAliasSourceWhenNoStoredAlias(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"app_orders": 11,
	}, nil)

	snapshot, err := LoadDatasetAliasManagementSnapshot(db)
	if err != nil {
		t.Fatalf("LoadDatasetAliasManagementSnapshot returned error: %v", err)
	}

	entry, err := findAliasManagementEntry(snapshot, "app_orders")
	if err != nil {
		t.Fatalf("findAliasManagementEntry(app_orders) returned error: %v", err)
	}
	if entry.StoredPrimaryAlias != "" {
		t.Fatalf("StoredPrimaryAlias = %q, want empty", entry.StoredPrimaryAlias)
	}
	if entry.EffectivePublicAlias != "orders" {
		t.Fatalf("EffectivePublicAlias = %q, want orders", entry.EffectivePublicAlias)
	}
	if entry.AliasSource != aliasSourceAutomaticApp {
		t.Fatalf("AliasSource = %q, want %q", entry.AliasSource, aliasSourceAutomaticApp)
	}
	if entry.CanonicalDatasetPath != "/orders" {
		t.Fatalf("CanonicalDatasetPath = %q, want /orders", entry.CanonicalDatasetPath)
	}
}

func TestSavePrimaryAliasPersistsAndReloadsSnapshot(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"system_reports": 21,
	}, nil)

	entry, err := SavePrimaryAlias(db, "system_reports", "reports-admin")
	if err != nil {
		t.Fatalf("SavePrimaryAlias returned error: %v", err)
	}

	if entry.StoredPrimaryAlias != "reports-admin" || entry.EffectivePublicAlias != "reports-admin" {
		t.Fatalf("saved aliases = (%q, %q), want (reports-admin, reports-admin)", entry.StoredPrimaryAlias, entry.EffectivePublicAlias)
	}
	if entry.CanonicalDatasetPath != "/reports-admin" {
		t.Fatalf("CanonicalDatasetPath = %q, want /reports-admin", entry.CanonicalDatasetPath)
	}
}

func TestSavePrimaryAliasClearsStoredPrimaryAlias(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"app_orders": 11,
	}, map[string]string{
		"app_orders": "shop-orders",
	})

	entry, err := SavePrimaryAlias(db, "app_orders", "")
	if err != nil {
		t.Fatalf("SavePrimaryAlias(clear) returned error: %v", err)
	}

	if entry.StoredPrimaryAlias != "" || entry.EffectivePublicAlias != "orders" {
		t.Fatalf("cleared aliases = (%q, %q), want ('', 'orders')", entry.StoredPrimaryAlias, entry.EffectivePublicAlias)
	}
	if entry.AliasSource != aliasSourceAutomaticApp {
		t.Fatalf("AliasSource = %q, want %q", entry.AliasSource, aliasSourceAutomaticApp)
	}
	if entry.CanonicalDatasetPath != "/orders" {
		t.Fatalf("CanonicalDatasetPath = %q, want /orders", entry.CanonicalDatasetPath)
	}
}

func TestValidateExplicitDatasetAliasAvailabilityRejectsAutomaticAppAliasCollision(t *testing.T) {
	db := openDatasetAliasEditorTestDB(t, map[string]int{
		"app_orders":     11,
		"system_reports": 12,
	}, nil)

	err := ValidateExplicitDatasetAliasAvailability(db, "system_reports", "orders")
	if err == nil {
		t.Fatal("expected automatic app alias conflict")
	}

	var routeConflict *RouteConflictError
	if !errors.As(err, &routeConflict) {
		t.Fatalf("expected RouteConflictError, got %T", err)
	}
	if routeConflict.Segment != "orders" {
		t.Fatalf("Segment = %q, want orders", routeConflict.Segment)
	}
}

func openDatasetAliasEditorTestDB(t *testing.T, tables map[string]int, aliases map[string]string) *sql.DB {
	t.Helper()

	state := &datasetAliasEditorMockState{
		tables:  make(map[string]int, len(tables)),
		aliases: make(map[string]string, len(aliases)),
	}
	for datasetName, tableUID := range tables {
		state.tables[datasetName] = tableUID
	}
	for datasetName, aliasSlug := range aliases {
		state.aliases[datasetName] = aliasSlug
	}

	driverName := fmt.Sprintf("dataset_alias_editor_%d", atomic.AddInt64(&datasetAliasEditorDriverCounter, 1))
	sql.Register(driverName, &datasetAliasEditorMockDriver{state: state})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func (d *datasetAliasEditorMockDriver) Open(string) (driver.Conn, error) {
	return &datasetAliasEditorMockConn{state: d.state}, nil
}

func (c *datasetAliasEditorMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented in dataset alias editor mock")
}

func (c *datasetAliasEditorMockConn) Close() error { return nil }
func (c *datasetAliasEditorMockConn) Begin() (driver.Tx, error) {
	return &datasetAliasEditorMockTx{}, nil
}
func (c *datasetAliasEditorMockConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &datasetAliasEditorMockTx{}, nil
}

func (*datasetAliasEditorMockTx) Commit() error   { return nil }
func (*datasetAliasEditorMockTx) Rollback() error { return nil }

func (c *datasetAliasEditorMockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for index, arg := range args {
		named[index] = driver.NamedValue{Ordinal: index + 1, Value: arg}
	}
	return c.QueryContext(context.Background(), query, named)
}

func (c *datasetAliasEditorMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.mu.Lock()
	defer c.state.mu.Unlock()

	switch {
	case strings.Contains(query, "SELECT t.table_name, a.alias_slug") && strings.Contains(query, "FROM system_db_table_aliases a"):
		return buildDatasetAliasEditorAliasRows(c.state), nil
	case strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasEditorTableRows(c.state), nil
	case strings.Contains(query, "SELECT table_uid") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasEditorTableUIDRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT t.table_name") && strings.Contains(query, "WHERE a.alias_slug = $1"):
		return buildDatasetAliasEditorAliasOwnerRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT table_name") && strings.Contains(query, "FROM system_db_tables") && strings.Contains(query, "LIMIT 1"):
		return buildDatasetAliasEditorAutomaticOwnerRows(c.state, namedStringArg(args, 0)), nil
	case strings.Contains(query, "SELECT id, table_name") && strings.Contains(query, "FROM system_db_tables"):
		return buildDatasetAliasEditorConflictRows(c.state, args)
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (c *datasetAliasEditorMockConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for index, arg := range args {
		named[index] = driver.NamedValue{Ordinal: index + 1, Value: arg}
	}
	return c.ExecContext(context.Background(), query, named)
}

func (c *datasetAliasEditorMockConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
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
		datasetName := datasetAliasEditorDatasetNameByUID(c.state, tableUID)
		if datasetName == "" {
			return nil, fmt.Errorf("unknown table_uid %d", tableUID)
		}
		c.state.aliases[datasetName] = aliasSlug
		return driver.RowsAffected(1), nil
	case strings.Contains(query, "UPDATE system_db_table_aliases"):
		aliasSlug := namedStringArg(args, 0)
		for datasetName := range c.state.aliases {
			if c.state.aliases[datasetName] == aliasSlug {
				c.state.aliases[datasetName] = aliasSlug
				return driver.RowsAffected(1), nil
			}
		}
		return nil, fmt.Errorf("unknown alias slug %q", aliasSlug)
	default:
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
}

func buildDatasetAliasEditorAliasRows(state *datasetAliasEditorMockState) driver.Rows {
	datasetNames := make([]string, 0, len(state.aliases))
	for datasetName := range state.aliases {
		datasetNames = append(datasetNames, datasetName)
	}
	sort.Strings(datasetNames)

	rows := make([][]driver.Value, 0, len(datasetNames))
	for _, datasetName := range datasetNames {
		rows = append(rows, []driver.Value{datasetName, state.aliases[datasetName]})
	}

	return &datasetAliasEditorMockRows{
		cols: []string{"table_name", "alias_slug"},
		rows: rows,
	}
}

func buildDatasetAliasEditorTableRows(state *datasetAliasEditorMockState) driver.Rows {
	datasetNames := make([]string, 0, len(state.tables))
	for datasetName := range state.tables {
		datasetNames = append(datasetNames, datasetName)
	}
	sort.Strings(datasetNames)

	rows := make([][]driver.Value, 0, len(datasetNames))
	for _, datasetName := range datasetNames {
		rows = append(rows, []driver.Value{int64(state.tables[datasetName]), datasetName})
	}

	return &datasetAliasEditorMockRows{
		cols: []string{"table_uid", "table_name"},
		rows: rows,
	}
}

func buildDatasetAliasEditorTableUIDRows(state *datasetAliasEditorMockState, datasetName string) driver.Rows {
	tableUID, ok := state.tables[datasetName]
	if !ok {
		return &datasetAliasEditorMockRows{cols: []string{"table_uid"}}
	}
	return &datasetAliasEditorMockRows{
		cols: []string{"table_uid"},
		rows: [][]driver.Value{{int64(tableUID)}},
	}
}

func buildDatasetAliasEditorAliasOwnerRows(state *datasetAliasEditorMockState, aliasSlug string) driver.Rows {
	for datasetName, existingAlias := range state.aliases {
		if existingAlias == aliasSlug {
			return &datasetAliasEditorMockRows{
				cols: []string{"table_name"},
				rows: [][]driver.Value{{datasetName}},
			}
		}
	}
	return &datasetAliasEditorMockRows{cols: []string{"table_name"}}
}

func buildDatasetAliasEditorAutomaticOwnerRows(state *datasetAliasEditorMockState, datasetName string) driver.Rows {
	if _, ok := state.tables[datasetName]; !ok {
		return &datasetAliasEditorMockRows{cols: []string{"table_name"}}
	}
	return &datasetAliasEditorMockRows{
		cols: []string{"table_name"},
		rows: [][]driver.Value{{datasetName}},
	}
}

func buildDatasetAliasEditorConflictRows(state *datasetAliasEditorMockState, args []driver.NamedValue) (driver.Rows, error) {
	if len(args) < 2 {
		return nil, fmt.Errorf("unexpected arg count: %d", len(args))
	}

	datasetName := namedStringArg(args, 0)
	excludeID := namedIntArg(args, 1)

	tableUID, ok := state.tables[datasetName]
	if !ok || tableUID == excludeID {
		return &datasetAliasEditorMockRows{cols: []string{"id", "table_name"}}, nil
	}

	return &datasetAliasEditorMockRows{
		cols: []string{"id", "table_name"},
		rows: [][]driver.Value{{int64(tableUID), datasetName}},
	}, nil
}

func datasetAliasEditorDatasetNameByUID(state *datasetAliasEditorMockState, tableUID int) string {
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

func (r *datasetAliasEditorMockRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *datasetAliasEditorMockRows) Close() error      { return nil }

func (r *datasetAliasEditorMockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.idx])
	r.idx++
	return nil
}
