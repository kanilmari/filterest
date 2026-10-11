// dataset_document_schema_postgres_test.go
// Proves document and sitemap schema boundaries using stored PostgreSQL grants.
// Connects isolated public/audit tables to the real router metadata and permission SQL.
// Starts no cluster or SQL until disposable PostgreSQL verification is explicitly enabled.
package router

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
)

func TestDocumentSchemaPostgresMetadataAndAuditOnlyGrants(t *testing.T) {
	db := routeIdentityDisposableDB(t) // The opt-in check precedes every database operation.
	if _, err := db.Exec(`
		ALTER TABLE system_group_table_func_rights ADD user_group_id integer,
		 ADD target_table_uid integer, ADD target_schema_name text;
		CREATE SCHEMA audit;
		CREATE TABLE public.app_orders (id integer PRIMARY KEY);
		CREATE TABLE audit.app_orders (id integer PRIMARY KEY);
		CREATE TABLE system_db_tables (table_uid integer PRIMARY KEY, table_name text,
		 schema_name text, display_name text, description text, ui_hidden boolean, updated timestamptz);
		CREATE TABLE system_db_table_aliases (table_uid integer, alias_slug text, is_primary boolean, is_active boolean);
		CREATE TABLE system_user_group_memberships (user_id integer, group_id integer);
		CREATE TABLE system_lang_keys (lang_key text, fi text, en text, yue text);
		INSERT INTO system_db_tables VALUES
		 (11,'app_orders','public','Public Orders','Public order description',false,'2026-10-08T12:30:00Z'),
		 (12,'app_orders','audit','Private Audit Name','Private Audit Description',false,'2026-10-08T12:30:00Z');
		INSERT INTO system_db_table_aliases VALUES
		 (11,'shop-orders',true,true),(11,'old-orders',false,true),(12,'private-audit-orders',true,true);
		INSERT INTO system_functions (id,name,url_route_endpoint,disabled,specific_table_related)
		 VALUES (1,'read','/api/get-results',false,true);
		INSERT INTO system_user_group_memberships VALUES (1,3),(42,2);
		INSERT INTO system_group_table_func_rights (function_id,user_group_id,target_table_uid,target_schema_name)
		 VALUES (1,3,11,'public'),(1,2,11,'public'),(1,3,12,'audit'),(1,2,12,'audit');
	`); err != nil {
		t.Fatal(err)
	}
	for _, privateFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("private_first_%t", privateFirst), func(t *testing.T) {
			setupDocumentSchemaFixture(t, documentSchemaFixture{})
			adapter := &documentSchemaPostgresDriver{source: db, privateFirst: privateFirst}
			name := fmt.Sprintf("document_schema_postgres_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
			sql.Register(name, adapter)
			orderedDB, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			backend.Db, backend.DbConfidential = orderedDB, orderedDB
			t.Cleanup(func() { orderedDB.Close() })
			for _, empty := range []bool{false, true} {
				t.Run(fmt.Sprintf("empty_public_%t", empty), func(t *testing.T) {
					title, description := "Public Orders", "Public order description"
					if empty {
						title, description = "", ""
					}
					if _, err := db.Exec(`UPDATE system_db_tables SET display_name=$1, description=$2 WHERE table_uid=11`, title, description); err != nil {
						t.Fatal(err)
					}
					assertDocumentSchemaMetadata(t, empty)
					wantOrder := []int64{11, 12}
					if privateFirst {
						wantOrder = []int64{12, 11}
					}
					if !reflect.DeepEqual(adapter.seenOrder, wantOrder) {
						t.Fatalf("metadata order=%v want %v", adapter.seenOrder, wantOrder)
					}
				})
			}
		})
	}
	// Keep the audit grants, revoke public grants. Both principals still have a real read
	// right, but it belongs to UID 12 and must not admit UID 11's public address.
	if _, err := db.Exec(`DELETE FROM system_group_table_func_rights WHERE target_table_uid=11`); err != nil {
		t.Fatal(err)
	}
	t.Run("audit_only", func(t *testing.T) {
		setupDocumentSchemaFixture(t, documentSchemaFixture{})
		adapter := &documentSchemaPostgresDriver{source: db, privateFirst: true}
		name := fmt.Sprintf("document_schema_postgres_%d", atomic.AddInt64(&rootHandlerDriverCounter, 1))
		sql.Register(name, adapter)
		orderedDB, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		backend.Db, backend.DbConfidential = orderedDB, orderedDB
		t.Cleanup(func() { orderedDB.Close() })
		assertDocumentSchemaDenied(t)
	})
}

type documentSchemaPostgresDriver struct {
	source       *sql.DB
	privateFirst bool
	seenOrder    []int64
}
type documentSchemaPostgresConn struct {
	*rootHandlerMockConn
	*documentSchemaPostgresDriver
}

func (d *documentSchemaPostgresDriver) Open(string) (driver.Conn, error) {
	return &documentSchemaPostgresConn{&rootHandlerMockConn{}, d}, nil
}

// Every dataset, translation, visibility and permission read runs unchanged on PostgreSQL.
// Only tie order is imposed. Unrelated shell configuration comes from the root fixture.
func (c *documentSchemaPostgresConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "system_db_tables") && !strings.Contains(query, "system_db_table_aliases") &&
		!strings.Contains(query, "system_group_table_func_rights") && !strings.Contains(query, "system_lang_keys") && !strings.Contains(query, "system_functions") {
		return c.rootHandlerMockConn.QueryContext(ctx, query, args)
	}
	order := "ASC"
	if c.privateFirst {
		order = "DESC"
	}
	poolRead := strings.Contains(query, "SELECT table_uid, table_name")
	if poolRead {
		query = strings.Replace(query, "ORDER BY table_name", "ORDER BY table_name, table_uid "+order, 1)
		c.seenOrder = nil
	} else if strings.Contains(query, "SELECT display_name FROM system_db_tables") || strings.Contains(query, "SELECT description FROM system_db_tables") {
		query += " ORDER BY table_uid " + order
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
	result := &sitemapMockRows{cols: columns}
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
		if poolRead {
			c.seenOrder = append(c.seenOrder, row[0].(int64))
		}
		result.vals = append(result.vals, row)
	}
	return result, rows.Err()
}
