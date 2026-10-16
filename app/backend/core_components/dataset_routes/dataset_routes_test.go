// dataset_routes_test.go
// Verifies routing policy, accepted name pools and alias availability.
// Connects incoming and generated dataset names with scripted database replies.
// Protects stable identity and route ownership without accessing a database.
package dataset_routes

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
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
	namespaceError  error
	execCalls       *[]string
}

type datasetRouteConn struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
	namespaceError  error
	execCalls       *[]string
}

type datasetRouteStmt struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
	namespaceError  error
	execCalls       *[]string
}

type datasetRouteRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

type datasetRouteTx struct{}

func TestDatasetNamePoolsShareServerPolicyAndStableUID(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		tables:  []datasetAliasTableMetadata{{11, "app_orders"}, {12, "system_users"}, {13, "system_help"}},
		aliases: map[string]string{"app_orders": "shop-orders", "system_help": "help"},
	})
	defer db.Close()
	pools, err := LoadDatasetNamePools(db)
	if err != nil {
		t.Fatal(err)
	}
	want := DatasetNamePool{TableUID: 11, DatasetName: "app_orders", SchemaName: "public", Names: []string{"app_orders", "shop-orders"}, PreferredName: "shop-orders"}
	if !reflect.DeepEqual(pools[11], want) {
		t.Fatalf("pool = %#v, want %#v", pools[11], want)
	}
	if got := pools[12]; !reflect.DeepEqual(got.Names, []string{"system_users"}) || got.PreferredName != "system_users" {
		t.Fatalf("system names must stay opt-in: %#v", got)
	}
	if pools[13].PreferredName != "help" {
		t.Fatal("explicit system alias missing")
	}
}

func TestDatasetNamePoolsKeepCanonicalOwnershipAndActiveSecondaryNames(t *testing.T) {
	tables := []datasetNamePoolTable{{11, "app_orders", "public"}, {12, "orders", "public"}, {13, "hidden_real", "public"}}
	aliases := map[int][]datasetNamePoolAlias{11: {{"hidden_real", true}, {"old-orders", false}, {"orders", false}, {"api", false}}}
	pools := buildDatasetNamePools(tables, aliases)
	if !reflect.DeepEqual(pools[11].Names, []string{"app_orders", "old-orders"}) {
		t.Fatalf("global ownership failed: %#v", pools)
	}
	if pools[11].PreferredName != "app_orders" || pools[12].PreferredName != "orders" {
		t.Fatalf("canonical owner changed: %#v", pools)
	}
	if got := buildDatasetNamePools(nil, aliases); len(got) != 0 {
		t.Fatalf("empty catalogue = %#v", got)
	}
}

func TestDatasetNamePoolsFailClosedOnAliasReadFailure(t *testing.T) {
	db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{aliasQueryError: fmt.Errorf("unavailable")})
	defer db.Close()
	if _, err := LoadDatasetNamePools(db); err == nil {
		t.Fatal("failed alias read must not publish an incomplete pool")
	}
}

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

func TestValidateDatasetRouteAvailabilityUsesLockedDatabaseNamespace(t *testing.T) {
	for _, name := range []string{"login", "service_catalog", "App_Other_Table", "secondary-orders"} {
		t.Run(name, func(t *testing.T) {
			calls := []string{}
			db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
				namespaceError: &pq.Error{Code: "P0001", Message: NamespaceConflictKey, Detail: name}, execCalls: &calls,
			})
			defer db.Close()
			err := ValidateDatasetRouteAvailability(db, name, 41)
			var conflict *RouteConflictError
			if !errors.As(err, &conflict) || conflict.Segment != name {
				t.Fatalf("expected database namespace refusal, got %v", err)
			}
			if len(calls) != 2 || !strings.Contains(calls[0], "app_lock_dataset_namespace()") ||
				!strings.Contains(calls[1], "app_validate_dataset_name($1, $2)") {
				t.Fatalf("namespace validation did not lock first: %v", calls)
			}
		})
	}
}

func TestValidateDatasetRouteAvailabilityAcceptsDatabaseApproval(t *testing.T) {
	db := openDatasetRouteTestDB(t, nil, nil)
	defer db.Close()
	if err := ValidateDatasetRouteAvailability(db, "system_service_catalog", 0); err != nil {
		t.Fatal(err)
	}
}

func TestDatasetNamePoolsFoldRealAndSecondaryNames(t *testing.T) {
	pools := buildDatasetNamePools([]datasetNamePoolTable{{11, "Reports", "public"}, {12, "app_orders", "public"}},
		map[int][]datasetNamePoolAlias{12: {{"reports", false}, {"old-orders", false}, {"shop-orders", true}}})
	if !reflect.DeepEqual(pools[12].Names, []string{"app_orders", "old-orders", "shop-orders"}) || pools[11].PreferredName != "Reports" {
		t.Fatalf("case-folded real name was not protected: %+v", pools)
	}
}

// The browser registry reads the same cases; exact legacy names precede folding.
func TestDatasetResolversPreserveExactLegacyCaseNames(t *testing.T) {
	data, err := os.ReadFile("../../../testing/shared_contracts/dataset_name_resolution_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples struct {
		Lookups []struct {
			Name string
			UID  int
		}
	}
	if err := json.Unmarshal(data, &examples); err != nil {
		t.Fatal(err)
	}
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprintf("reverse_%t", reverse), func(t *testing.T) {
			tables := []datasetAliasTableMetadata{{81, "Reports"}, {82, "reports"}}
			if reverse {
				tables[0], tables[1] = tables[1], tables[0]
			}
			db := openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{tables: tables,
				aliases: map[string]string{"Reports": "upper-reports", "reports": "lower-reports"}})
			defer db.Close()
			for _, example := range examples.Lookups {
				got := ResolveRawDatasetNameWithQuerier(db, example.Name)
				want := ""
				if example.UID == 81 {
					want = "Reports"
				}
				if example.UID == 82 {
					want = "reports"
				}
				if got != want {
					t.Errorf("lookup %q = %q, want %q (ambiguous names must be refused)", example.Name, got, want)
				}
			}
		})
	}
}

type datasetRouteTestOptions struct {
	rows            map[string]datasetRouteRow
	aliases         map[string]string
	tables          []datasetAliasTableMetadata
	missingAliasDB  bool
	aliasQueryError error
	namespaceError  error
	execCalls       *[]string
}

func openDatasetRouteTestDB(t *testing.T, rows map[string]datasetRouteRow, aliases map[string]string) *sql.DB {
	return openDatasetRouteTestDBWithOptions(t, datasetRouteTestOptions{
		rows:    rows,
		aliases: aliases,
	})
}

func openDatasetRouteTestDBWithOptions(t *testing.T, options datasetRouteTestOptions) *sql.DB {
	t.Helper()

	// Stored aliases reference registered datasets; model that identity even
	// when a test supplies only the alias map to this convenience fixture.
	if options.tables == nil {
		for name := range options.aliases {
			options.tables = append(options.tables, datasetAliasTableMetadata{TableUID: len(options.tables) + 1, DatasetName: name})
		}
	}

	driverName := fmt.Sprintf("dataset_route_test_%d", time.Now().UnixNano())
	sql.Register(driverName, &datasetRouteDriver{
		rows:            options.rows,
		aliases:         options.aliases,
		tables:          append([]datasetAliasTableMetadata(nil), options.tables...),
		missingAliasDB:  options.missingAliasDB,
		aliasQueryError: options.aliasQueryError,
		namespaceError:  options.namespaceError, execCalls: options.execCalls,
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
		namespaceError:  d.namespaceError, execCalls: d.execCalls,
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

func (c *datasetRouteConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if c.execCalls != nil {
		*c.execCalls = append(*c.execCalls, query)
	}
	if strings.Contains(query, "app_lock_dataset_namespace()") {
		return driver.RowsAffected(1), nil
	}
	if strings.Contains(query, "app_validate_dataset_name(") || strings.Contains(query, "app_validate_dataset_alias(") {
		return driver.RowsAffected(0), c.namespaceError
	}
	return nil, fmt.Errorf("unexpected exec: %s", query)
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
		if strings.Contains(query, "SELECT table_uid, alias_slug") {
			for _, table := range tables {
				if alias, ok := aliases[table.DatasetName]; ok {
					data = append(data, []driver.Value{int64(table.TableUID), alias, true})
				}
			}
			return &datasetRouteRows{cols: []string{"table_uid", "alias_slug", "is_primary"}, data: data}, nil
		}
		for rawName, publicName := range aliases {
			data = append(data, []driver.Value{rawName, publicName})
		}
		return &datasetRouteRows{cols: []string{"table_name", "alias_slug"}, data: data}, nil
	}
	if strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables") {
		data := make([][]driver.Value, 0, len(tables))
		for _, table := range tables {
			row := []driver.Value{int64(table.TableUID), table.DatasetName}
			if strings.Contains(query, "schema_name") {
				row = append(row, "public")
			}
			data = append(data, row)
		}
		if strings.Contains(query, "schema_name") {
			return &datasetRouteRows{cols: []string{"table_uid", "table_name", "schema_name"}, data: data}, nil
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
