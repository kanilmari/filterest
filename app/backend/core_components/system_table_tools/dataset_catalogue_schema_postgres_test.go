// dataset_catalogue_schema_postgres_test.go
// Proves schema identity using real tables, stored aliases and permission grants.
// Connects isolated PostgreSQL to guest, reader and administrator catalogue responses.
// Forces both metadata orders so equal physical names cannot hide a privacy defect.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/pipeline/access_control"
)

func TestDatasetCataloguePostgresSameNamesAcrossSchemasMetadataOrders(t *testing.T) {
	db := catalogueDisposableDatabase(t) // Opt-in precedes cluster creation and all SQL.
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "0")
	if _, err := db.Exec(`
		CREATE SCHEMA audit;
		CREATE TABLE public.app_orders (id integer PRIMARY KEY);
		CREATE TABLE audit.app_orders (id integer PRIMARY KEY);
		UPDATE system_db_tables SET table_name='app_orders', schema_name='audit' WHERE table_uid=12;
		INSERT INTO system_db_table_aliases VALUES (12,'private-audit-orders',true,true),
		 (11,'shared-orders',false,true),(12,'shared-orders',false,true);
		INSERT INTO system_group_table_func_rights (user_group_id,function_id,target_table_uid,target_schema_name)
		 VALUES (1,1,12,'audit');
	`); err != nil {
		t.Fatal(err)
	}
	for _, direction := range []string{"ASC", "DESC"} {
		t.Run("metadata_"+direction, func(t *testing.T) {
			ordered := &catalogueMetadataOrderDriver{source: db, direction: direction}
			name := fmt.Sprintf("catalogue_order_%d", time.Now().UnixNano())
			sql.Register(name, ordered)
			orderedDB, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			previous := backend.Db
			backend.Db = orderedDB
			t.Cleanup(func() { backend.Db = previous; orderedDB.Close() })
			for _, user := range []int{1, 42, 99} {
				t.Run(fmt.Sprintf("user_%d", user), func(t *testing.T) {
					readable, err := access_control.GetTablesReadableByUser(orderedDB, user)
					if err != nil || !readable[11] || readable[12] {
						t.Fatalf("schema-aware read set: %v, error=%v", readable, err)
					}
					response := httptest.NewRecorder()
					GetGroupedTables(response, catalogueRequest(t, user))
					assertPublicOrdersPool(t, response)
					wantOrder := []int{11, 12}
					if direction == "DESC" {
						wantOrder = []int{12, 11}
					}
					if !reflect.DeepEqual(ordered.seenOrder, wantOrder) {
						t.Fatalf("did not exercise requested metadata order: %v want %v", ordered.seenOrder, wantOrder)
					}
					pools, err := dataset_routes.LoadDatasetNamePools(orderedDB)
					if err != nil || pools[11].SchemaName != "public" || pools[12].SchemaName != "audit" ||
						!reflect.DeepEqual(pools[12].Names, []string{"app_orders", "private-audit-orders"}) || pools[12].PreferredName != "private-audit-orders" {
						t.Fatalf("schema identities or private ownership lost: %v, error=%v", pools, err)
					}
					for _, publicName := range pools[11].Names {
						if got := dataset_routes.ResolveRawDatasetNameWithQuerier(orderedDB, publicName); got != "app_orders" {
							t.Fatalf("public address %s resolved as %s", publicName, got)
						}
					}
					for _, rejected := range []string{"private-audit-orders", "shared-orders"} {
						if got := dataset_routes.ResolveRawDatasetNameWithQuerier(orderedDB, rejected); got != rejected {
							t.Fatalf("unsupported or ambiguous name %s resolved as %s", rejected, got)
						}
					}
					if got := dataset_routes.ResolvePublicDatasetNameWithQuerier(orderedDB, "app_orders"); got != "shop-orders" {
						t.Fatalf("generated address inherited private name: %s", got)
					}
				})
			}
		})
	}
}

// This read-only adapter executes every query on the real disposable cluster.
// Only metadata tie ordering changes; stored rows and the real grants decide responses.
type catalogueMetadataOrderDriver struct {
	source    *sql.DB
	direction string
	seenOrder []int
}

type catalogueMetadataOrderConn struct{ *catalogueMetadataOrderDriver }

func (d *catalogueMetadataOrderDriver) Open(string) (driver.Conn, error) {
	return &catalogueMetadataOrderConn{d}, nil
}
func (*catalogueMetadataOrderConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("metadata order adapter supports reads through QueryContext only")
}
func (*catalogueMetadataOrderConn) Close() error { return nil }
func (*catalogueMetadataOrderConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("metadata order adapter does not mutate the fixture")
}

func (c *catalogueMetadataOrderConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	metadata := strings.Contains(query, "SELECT table_uid, table_name") && strings.Contains(query, "FROM system_db_tables")
	if metadata {
		query = strings.Replace(query, "ORDER BY table_name", "ORDER BY table_name, table_uid "+c.direction, 1)
		c.seenOrder = nil
	}
	values := make([]any, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	rows, err := c.source.QueryContext(ctx, query, values...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := &orphanQueueRows{cols: columns}
	for rows.Next() {
		scanned := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range scanned {
			pointers[i] = &scanned[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make([]driver.Value, len(columns))
		for i, value := range scanned {
			row[i] = value
		}
		if metadata && row[1] == "app_orders" {
			c.seenOrder = append(c.seenOrder, int(row[0].(int64)))
		}
		result.data = append(result.data, row)
	}
	return result, rows.Err()
}
