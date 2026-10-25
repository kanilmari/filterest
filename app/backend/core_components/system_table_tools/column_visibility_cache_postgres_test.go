// column_visibility_cache_postgres_test.go
// Proves hides take effect immediately for two warm result readers and all views.
// Connects real card/generic handlers with the real transaction middleware.
// Uses only a disposable PostgreSQL cluster, removed by the shared fixture.
package system_table_tools

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
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"easelect/backend/core_components/middlewares"
	"github.com/lib/pq"
)

func TestCardVisibilityImmediateResultsInvalidationPostgres(t *testing.T) {
	testColumnVisibilityImmediateResults(t, false)
}

func TestGenericColumnVisibilityImmediateResultsInvalidationPostgres(t *testing.T) {
	testColumnVisibilityImmediateResults(t, true)
}

func testColumnVisibilityImmediateResults(t *testing.T, generic bool) {
	t.Helper()
	db := frontPageDisposableDB(t)
	const dataset = "b324_visibility"
	frontPageExec(t, db, `
 UPDATE system_users SET admin_access_allowed=true WHERE id=42;
 CREATE TABLE b324_visibility(id integer PRIMARY KEY, payload text);
 INSERT INTO b324_visibility VALUES(1,'must-disappear-immediately');
 INSERT INTO system_db_tables(table_name,schema_name,folder_id) VALUES('b324_visibility','public',1);
 INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,show_value_on_card)
 SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,true
 FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
 WHERE col.table_schema='public' AND col.table_name='b324_visibility';
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='b324_visibility';`)
	// Generic metadata saves reconcile actual grants using these isolated roles.
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		name := "b324_" + label
		t.Setenv(key, name)
		frontPageExec(t, db, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	var idUID, payloadUID, payloadID int
	if err := db.QueryRow(`SELECT column_uid FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name=$1) AND column_name='id'`, dataset).Scan(&idUID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT column_uid,id FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name=$1) AND column_name='payload'`, dataset).Scan(&payloadUID, &payloadID); err != nil {
		t.Fatal(err)
	}
	clear := func() {
		read.InvalidateSchemaCache(dataset)
		read.InvalidatePermissionsCache(dataset)
		read.InvalidateUserColumnSettingsCache(dataset, "")
	}
	clear()
	t.Cleanup(clear)
	settingsReads := countVisibilitySettingsReads(t, db)
	assertResults := func(t *testing.T, present, reloadSettings bool) {
		t.Helper()
		for _, user := range []int{42, 73} {
			for _, view := range []string{"card", "table"} {
				before := settingsReads.Load()
				request := frontPageSessionRequest(t, user, "basic", "GET", "/api/get-results?dataset="+dataset+"&view_key="+view)
				response := httptest.NewRecorder()
				middlewares.WithLazyTransaction(http.HandlerFunc(read.GetResults)).ServeHTTP(response, request)
				var result struct {
					Data    []map[string]any `json:"data"`
					Columns []string         `json:"columns"`
				}
				if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Data) != 1 {
					t.Fatalf("user %d view %s: %d %s", user, view, response.Code, response.Body)
				}
				value, hasKey := result.Data[0]["payload"]
				if hasKey != present || (present && value != "must-disappear-immediately") {
					t.Fatalf("user %d view %s: payload present=%v value=%v; want present=%v", user, view, hasKey, value, present)
				}
				listed := false
				for _, column := range result.Columns {
					listed = listed || column == "payload"
				}
				if listed != present || (!present && strings.Contains(response.Body.String(), "must-disappear-immediately")) {
					t.Fatalf("hidden value or column leaked: %s", response.Body)
				}
				if reloaded := settingsReads.Load() > before; reloaded != reloadSettings {
					t.Fatalf("user %d view %s: settings reloaded=%v, want %v", user, view, reloaded, reloadSettings)
				}
			}
		}
	}
	save := func(t *testing.T, flag string, value any) {
		t.Helper()
		var body any
		var handler http.HandlerFunc
		if generic {
			body = map[string]any{"id": payloadID, "column": flag, "value": value}
			handler = func(w http.ResponseWriter, r *http.Request) { update.UpdateRowHandler(w, r, "system_column_details") }
		} else {
			columns := []CardVisibilityColumn{
				{ColumnUID: idUID, ClientDeliveryMode: "include", ShowValueOnCard: true},
				{ColumnUID: payloadUID, ClientDeliveryMode: "include", ShowValueOnCard: true},
			}
			if flag == "hide_everywhere" {
				columns[1].HideEverywhere = value.(bool)
			} else {
				columns[1].ClientDeliveryMode = value.(string)
			}
			body = map[string]any{"table_name": dataset, "columns": columns}
			handler = UpdateCardVisibilityHandler
		}
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		request := frontPageSessionRequest(t, 42, "admin", "POST", "/api/visibility-regression")
		request.Body = io.NopCloser(strings.NewReader(string(raw)))
		response := httptest.NewRecorder()
		middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("save %s=%v: %d %s", flag, value, response.Code, response.Body)
		}
	}
	for index, flag := range []string{"hide_everywhere", "client_delivery_mode"} {
		t.Run(fmt.Sprintf("%s/generic=%v", flag, generic), func(t *testing.T) {
			var hide, unhide any = true, false
			if flag == "client_delivery_mode" {
				hide, unhide = "server_only", "include"
			}
			assertResults(t, true, index == 0)
			assertResults(t, true, false) // Prove both users/views really hit warm settings.
			save(t, flag, hide)
			assertResults(t, false, true) // Immediate key absence AND fresh settings for every reader.
			save(t, flag, unhide)
			assertResults(t, true, true)
		})
	}
}

// A fresh schema read already filters these flags on the current base. Count
// real settings queries too, so the card regression detects a missing settings
// eviction even when schema eviction alone happens to suppress the raw value.
// The connector forwards actual PostgreSQL queries and transaction operations.
func countVisibilitySettingsReads(t *testing.T, db *sql.DB) *atomic.Int64 {
	t.Helper()
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	connector, err := pq.NewConnector(fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	reads := &atomic.Int64{}
	counted := sql.OpenDB(&visibilityCountingConnector{connector, reads})
	previousDB, previousAdmin, previousBasic, previousGuest := backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest
	backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = counted, counted, counted, counted
	t.Cleanup(func() {
		backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest = previousDB, previousAdmin, previousBasic, previousGuest
		counted.Close()
	})
	return reads
}

type visibilityCountingConnector struct {
	driver.Connector
	reads *atomic.Int64
}

func (c *visibilityCountingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &visibilityCountingConn{conn, c.reads}, nil
}

type visibilityCountingConn struct {
	driver.Conn
	reads *atomic.Int64
}

func (c *visibilityCountingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "SELECT details.column_name, COALESCE(details.co_number, details.column_uid), 0, false") {
		c.reads.Add(1)
	}
	return c.Conn.(driver.QueryerContext).QueryContext(ctx, query, args)
}

func (c *visibilityCountingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return c.Conn.(driver.ExecerContext).ExecContext(ctx, query, args)
}

func (c *visibilityCountingConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, options)
}
