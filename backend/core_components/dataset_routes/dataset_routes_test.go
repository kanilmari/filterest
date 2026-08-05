package dataset_routes

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
)

type datasetRouteRow struct {
	id        int
	tableName string
}

type datasetRouteDriver struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
}

type datasetRouteConn struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
}

type datasetRouteStmt struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
}

type datasetRouteRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

type datasetRouteTx struct{}

func TestResolveRawDatasetNameMapsPublicAlias(t *testing.T) {
	if got := ResolveRawDatasetName("service_catalog"); got != "app_service_catalog" {
		t.Fatalf("ResolveRawDatasetName(service_catalog) = %q, want app_service_catalog", got)
	}
}

func TestResolvePublicDatasetNameMapsRawName(t *testing.T) {
	if got := ResolvePublicDatasetName("app_service_catalog"); got != "service_catalog" {
		t.Fatalf("ResolvePublicDatasetName(app_service_catalog) = %q, want service_catalog", got)
	}
}

func TestResolveRawDatasetNameUsesSharedBackendAliasSource(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, map[string]string{
		"app_service_catalog": "service_directory",
	})
	defer db.Close()

	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = previousDB
	})

	if got := ResolveRawDatasetName("service_directory"); got != "app_service_catalog" {
		t.Fatalf("ResolveRawDatasetName(service_directory) = %q, want app_service_catalog", got)
	}
}

func TestResolvePublicDatasetNameUsesSharedBackendAliasSource(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, map[string]string{
		"app_service_catalog": "service_directory",
	})
	defer db.Close()

	previousDB := backend.Db
	backend.Db = db
	t.Cleanup(func() {
		backend.Db = previousDB
	})

	if got := ResolvePublicDatasetName("app_service_catalog"); got != "service_directory" {
		t.Fatalf("ResolvePublicDatasetName(app_service_catalog) = %q, want service_directory", got)
	}
}

func TestLoadAliasRegistryPrefersDatabaseSourceWhenAvailable(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, map[string]string{
		"app_service_catalog": "service_directory",
	})
	defer db.Close()

	registry, err := LoadAliasRegistry(db)
	if err != nil {
		t.Fatalf("LoadAliasRegistry returned error: %v", err)
	}
	if got := registry.RawToPublic["app_service_catalog"]; got != "service_directory" {
		t.Fatalf("RawToPublic[app_service_catalog] = %q, want service_directory", got)
	}
	if got := ResolveRawDatasetNameWithQuerier(db, "service_directory"); got != "app_service_catalog" {
		t.Fatalf("ResolveRawDatasetNameWithQuerier(service_directory) = %q, want app_service_catalog", got)
	}
}

func TestLoadAliasRegistryFallsBackWhenAliasTableMissing(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables: []datasetAliasTableMetadata{
			{TableUID: 7, DatasetName: "app_service_catalog"},
		},
		missingAliasDB: true,
	})
	defer db.Close()

	registry, err := LoadAliasRegistry(db)
	if err != nil {
		t.Fatalf("LoadAliasRegistry returned error: %v", err)
	}
	if got := registry.RawToPublic["app_service_catalog"]; got != "service_catalog" {
		t.Fatalf("RawToPublic fallback = %q, want service_catalog", got)
	}
}

func TestLoadAliasRegistryAddsAutomaticAppAliasesFromDatasetNames(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables: []datasetAliasTableMetadata{
			{TableUID: 11, DatasetName: "app_orders"},
			{TableUID: 12, DatasetName: "system_users"},
		},
	})
	defer db.Close()

	registry, err := LoadAliasRegistry(db)
	if err != nil {
		t.Fatalf("LoadAliasRegistry returned error: %v", err)
	}
	if got := registry.RawToPublic["app_orders"]; got != "orders" {
		t.Fatalf("RawToPublic[app_orders] = %q, want orders", got)
	}
	if got := registry.PublicToRaw["orders"]; got != "app_orders" {
		t.Fatalf("PublicToRaw[orders] = %q, want app_orders", got)
	}
	if got := registry.RawToPublic["system_users"]; got != "" {
		t.Fatalf("RawToPublic[system_users] = %q, want empty", got)
	}
}

func TestResolveRawDatasetNameFallsBackWhenSharedAliasTableMissing(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables: []datasetAliasTableMetadata{
			{TableUID: 7, DatasetName: "app_service_catalog"},
		},
		missingAliasDB: true,
	})
	defer db.Close()

	if got := ResolveRawDatasetNameWithQuerier(db, "service_catalog"); got != "app_service_catalog" {
		t.Fatalf("ResolveRawDatasetNameWithQuerier(service_catalog) = %q, want app_service_catalog", got)
	}
}

func TestResolvePublicDatasetNameWithQuerierUsesAutomaticAppAlias(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables: []datasetAliasTableMetadata{
			{TableUID: 11, DatasetName: "app_orders"},
		},
	})
	defer db.Close()

	if got := ResolvePublicDatasetNameWithQuerier(db, "app_orders"); got != "orders" {
		t.Fatalf("ResolvePublicDatasetNameWithQuerier(app_orders) = %q, want orders", got)
	}
	if got := ResolveRawDatasetNameWithQuerier(db, "orders"); got != "app_orders" {
		t.Fatalf("ResolveRawDatasetNameWithQuerier(orders) = %q, want app_orders", got)
	}
}

func TestDefaultPublicDatasetAliasCandidateStripsKnownPrefixes(t *testing.T) {
	testCases := map[string]string{
		"app_service_catalog":    "service_catalog",
		"system_service_catalog": "service_catalog",
	}

	for input, want := range testCases {
		got, ok := DefaultPublicDatasetAliasCandidate(input)
		if !ok || got != want {
			t.Fatalf("DefaultPublicDatasetAliasCandidate(%q) = (%q, %t), want (%q, true)", input, got, ok, want)
		}
	}
}

func TestValidateDatasetRouteAvailabilityRejectsReservedTopLevelSegment(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, nil)
	defer db.Close()

	err := ValidateDatasetRouteAvailability(db, "login", 0)
	if err == nil {
		t.Fatal("expected conflict error")
	}
	if got := err.Error(); got != `dataset route segment "login" is already in use: dataset name conflicts with a reserved top-level route` {
		t.Fatalf("error = %q", got)
	}
}

func TestValidateDatasetRouteAvailabilityRejectsExplicitAliasCollision(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		missingAliasDB: true,
	})
	defer db.Close()

	err := ValidateDatasetRouteAvailability(db, "service_catalog", 0)
	if err == nil {
		t.Fatal("expected explicit alias conflict")
	}
	if got := err.Error(); got != `dataset route segment "service_catalog" is already in use: dataset name conflicts with the public alias for "app_service_catalog"` {
		t.Fatalf("error = %q", got)
	}
}

func TestValidateDatasetRouteAvailabilityRejectsAutomaticAppAliasCollision(t *testing.T) {
	db := openDatasetRouteTestDB(t, map[string]datasetRouteRow{
		"other_table": {id: 14, tableName: "other_table"},
	}, nil)
	defer db.Close()

	err := ValidateDatasetRouteAvailability(db, "app_other_table", 0)
	if err == nil {
		t.Fatal("expected default alias conflict")
	}
	if got := err.Error(); got != `dataset route segment "other_table" is already in use: default public alias conflicts with existing dataset "other_table"` {
		t.Fatalf("error = %q", got)
	}
}

func TestValidateDatasetRouteAvailabilityAllowsExplicitAliasOwner(t *testing.T) {
	db := openDatasetRouteTestDB(t, map[string]datasetRouteRow{
		"app_service_catalog": {id: 7, tableName: "app_service_catalog"},
	}, nil)
	defer db.Close()

	if err := ValidateDatasetRouteAvailability(db, "app_service_catalog", 7); err != nil {
		t.Fatalf("expected explicit alias owner to pass, got %v", err)
	}
}

func TestValidateDatasetRouteAvailabilityDoesNotAutoEnforceSystemPrefixAlias(t *testing.T) {
	db := openDatasetRouteTestDB(t, map[string]datasetRouteRow{
		"service_catalog": {id: 8, tableName: "service_catalog"},
	}, nil)
	defer db.Close()

	if err := ValidateDatasetRouteAvailability(db, "system_service_catalog", 0); err != nil {
		t.Fatalf("expected system_ alias candidate to remain non-blocking in first slice, got %v", err)
	}
}

type datasetRouteTestOptions struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
}

func openDatasetRouteTestDB(t *testing.T, rows map[string]datasetRouteRow, aliases map[string]string) *sql.DB {
	return openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		rows:    rows,
		aliases: aliases,
	})
}

func openDatasetRouteTestDBWithOptions(t *testing.T, options datasetRouteTestOptions) *sql.DB {
	t.Helper()

	driverName := fmt.Sprintf("dataset_route_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &datasetRouteDriver{
		rows:            options.rows,
		aliases:         options.aliases,
		tables:          append([]datasetAliasTableMetadata(nil), options.tables...),
		missingAliasDB:  options.missingAliasDB,
		aliasQueryError: options.aliasQueryError,
	})

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db
}

func (d *datasetRouteDriver) Open(string) (driver.Conn, error) {
	copied := make(map[string]datasetRouteRow, len(d.rows))
	for key, value := range d.rows {
		copied[key] = value
	}
	copiedAliases := make(map[string]string, len(d.aliases))
	for key, value := range d.aliases {
		copiedAliases[key] = value
	}
	copiedTables := append([]datasetAliasTableMetadata(nil), d.tables...)
	return &datasetRouteConn{
		rows:            copied,
		aliases:         copiedAliases,
		tables:          copiedTables,
		missingAliasDB:  d.missingAliasDB,
		aliasQueryError: d.aliasQueryError,
	}, nil
}

func (c *datasetRouteConn) Prepare(string) (driver.Stmt, error) {
	return &datasetRouteStmt{
		rows:            c.rows,
		aliases:         c.aliases,
		tables:          c.tables,
		missingAliasDB:  c.missingAliasDB,
		aliasQueryError: c.aliasQueryError,
	}, nil
}

func (c *datasetRouteConn) Close() error { return nil }

func (c *datasetRouteConn) Begin() (driver.Tx, error) { return &datasetRouteTx{}, nil }

func (c *datasetRouteConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &datasetRouteTx{}, nil
}

func (*datasetRouteTx) Commit() error   { return nil }
func (*datasetRouteTx) Rollback() error { return nil }

func (c *datasetRouteConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return buildDatasetRouteRows(c.rows, c.aliases, c.tables, c.missingAliasDB, c.aliasQueryError, query, args)
}

func (s *datasetRouteStmt) Close() error  { return nil }
func (s *datasetRouteStmt) NumInput() int { return -1 }

func (s *datasetRouteStmt) Exec([]driver.Value) (driver.Result, error) {
	return nil, fmt.Errorf("exec not supported")
}

func (s *datasetRouteStmt) Query(args []driver.Value) (driver.Rows, error) {
	named := make([]driver.NamedValue, len(args))
	for i, arg := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: arg}
	}
	return buildDatasetRouteRows(s.rows, s.aliases, s.tables, s.missingAliasDB, s.aliasQueryError, "", named)
}

func buildDatasetRouteRows(
	rows map[string]datasetRouteRow,
	aliases map[string]string,
	tables []datasetAliasTableMetadata,
	missingAliasDB bool,
	aliasQueryError error,
	query string,
	args []driver.NamedValue,
) (driver.Rows, error) {
	if aliasQueryError != nil && queryContainsAliasTable(query) {
		return nil, aliasQueryError
	}
	if missingAliasDB && queryContainsAliasTable(query) {
		return nil, &pq.Error{Code: "42P01"}
	}
	if queryContainsAliasTable(query) {
		data := make([][]driver.Value, 0, len(aliases))
		for rawName, publicName := range aliases {
			data = append(data, []driver.Value{rawName, publicName})
		}
		return &datasetRouteRows{cols: []string{"table_name", "alias_slug"}, data: data}, nil
	}
	if strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables") {
		data := make([][]driver.Value, 0, len(tables))
		for _, table := range tables {
			data = append(data, []driver.Value{int64(table.TableUID), table.DatasetName})
		}
		return &datasetRouteRows{cols: []string{"table_uid", "table_name"}, data: data}, nil
	}

	if len(args) < 2 {
		return nil, fmt.Errorf("unexpected arg count: %d", len(args))
	}

	segment, _ := args[0].Value.(string)
	excludeID := int64(0)
	switch value := args[1].Value.(type) {
	case int:
		excludeID = int64(value)
	case int32:
		excludeID = int64(value)
	case int64:
		excludeID = value
	}

	row, ok := rows[segment]
	if !ok || int64(row.id) == excludeID {
		return &datasetRouteRows{cols: []string{"id", "table_name"}}, nil
	}

	return &datasetRouteRows{
		cols: []string{"id", "table_name"},
		data: [][]driver.Value{{int64(row.id), row.tableName}},
	}, nil
}

func queryContainsAliasTable(query string) bool {
	return strings.Contains(query, "system_db_table_aliases")
}

func (r *datasetRouteRows) Columns() []string { return append([]string(nil), r.cols...) }
func (r *datasetRouteRows) Close() error      { return nil }

func (r *datasetRouteRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.idx])
	r.idx++
	return nil
}
