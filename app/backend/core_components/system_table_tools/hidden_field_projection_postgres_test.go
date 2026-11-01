// hidden_field_projection_postgres_test.go
// Proves map support and FK labels with real guest/basic sessions and SELECT grants.
// Reuses the disposable public-bootstrap fixture and actual visibility-save handler.
// Bounds each proof to 90 seconds; no installation database or provider is used.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/middlewares"
)

func hiddenProjectionPostgres(t *testing.T) (*sql.DB, context.Context) {
	t.Helper()
	// Also covers cluster setup and code that has not yet adopted QueryContext.
	watchdog := time.AfterFunc(90*time.Second, func() { panic("hidden-field PostgreSQL proof exceeded 90 seconds") })
	t.Cleanup(func() { watchdog.Stop() })
	ctx, cancel := context.WithTimeout(t.Context(), 80*time.Second)
	t.Cleanup(cancel)
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `
 UPDATE system_users SET admin_access_allowed=true WHERE id=73;
 INSERT INTO system_user_group_memberships(user_id,group_id)
 SELECT 1,2 WHERE NOT EXISTS(SELECT 1 FROM system_user_group_memberships WHERE user_id=1 AND group_id=2);
 CREATE TABLE b325_places(id integer PRIMARY KEY,title text,position point,private_position point,server_position point);
 INSERT INTO b325_places VALUES(1,'Needle',point(24,60),point(25,61),point(26,62));
 CREATE TABLE b325_parents(id integer PRIMARY KEY,title text);
 CREATE TABLE b325_children(id integer PRIMARY KEY,title text,parent_id integer REFERENCES b325_parents(id));
 CREATE TABLE b325_roots(id integer PRIMARY KEY,child_id integer REFERENCES b325_children(id));
 INSERT INTO b325_parents VALUES(1,'Parent display label');
 INSERT INTO b325_children VALUES(1,'Needle',1);
 INSERT INTO b325_roots VALUES(1,1);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id,fk_display_column)
 VALUES('b325_places','public',1,'title'),('b325_parents','public',1,'title'),
       ('b325_children','public',1,'title'),('b325_roots','public',1,'id');
 INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,hide_everywhere,client_delivery_mode)
 SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
        col.column_name='private_position',CASE WHEN col.column_name='server_position' THEN 'server_only' ELSE 'include' END
 FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
 WHERE col.table_schema='public' AND col.table_name IN ('b325_places','b325_parents','b325_children','b325_roots');
 INSERT INTO system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
 VALUES(500001,'b325_search',false,true,'/api/get-intelligent-results'),
       (500002,'b325_related',false,true,'/api/fetch-dynamic-children');
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT 2,func,table_uid FROM system_db_tables CROSS JOIN unnest(ARRAY[500000,500001,500002]) AS func
 WHERE table_name IN ('b325_places','b325_parents','b325_children','b325_roots');`)
	reader := frontPageRuntimeDB(t, db) // NOSUPERUSER table-wide SELECT, no hidden-column denial.
	var superuser, admin bool
	if err := reader.QueryRowContext(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname=current_user`).Scan(&superuser); err != nil || superuser {
		t.Fatal("reader must not be a superuser", superuser, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(admin_access_allowed,false) FROM system_users WHERE id=42`).Scan(&admin); err != nil || admin {
		t.Fatal("basic fixture must not be an administrator", admin, err)
	}
	for _, table := range []string{"b325_places", "b325_parents", "b325_children", "b325_roots"} {
		clear := func() {
			read.InvalidateSchemaCache(table)
			read.InvalidatePermissionsCache(table)
			read.InvalidateUserColumnSettingsCache(table, "")
		}
		clear()
		t.Cleanup(clear)
	}
	return db, ctx
}

type hiddenProjectionResponse struct {
	Data        []map[string]any `json:"data"`
	GeomColumns []string         `json:"geom_columns"`
	ChildTables []struct {
		Dataset   string           `json:"dataset"`
		Direction string           `json:"reference_direction"`
		Rows      []map[string]any `json:"rows"`
	} `json:"child_tables"`
}

func hiddenProjectionRequest(t *testing.T, ctx context.Context, user int, role, target, body string, handler http.HandlerFunc) []hiddenProjectionResponse {
	t.Helper()
	method := "GET"
	if body != "" {
		method = "POST"
	}
	request := frontPageSessionRequest(t, user, role, method, target).WithContext(ctx)
	request.Body = io.NopCloser(strings.NewReader(body))
	response := httptest.NewRecorder()
	middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("%s as %s: %d %s", target, role, response.Code, response.Body)
	}
	decoder := json.NewDecoder(response.Body)
	var packets []hiddenProjectionResponse
	for {
		var packet hiddenProjectionResponse
		if err := decoder.Decode(&packet); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		packets = append(packets, packet)
	}
	if len(packets) == 0 {
		t.Fatal("response had no packets")
	}
	return packets
}

func saveHiddenProjectionFlag(t *testing.T, ctx context.Context, db *sql.DB, table, column string, hidden bool, mode string) {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT column_uid,co_number,column_name,COALESCE(hide_everywhere,false),
 COALESCE(client_delivery_mode,'include') FROM system_column_details
 WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name=$1) ORDER BY co_number`, table)
	if err != nil {
		t.Fatal(err)
	}
	var columns []CardVisibilityColumn
	found := false
	for rows.Next() {
		var item CardVisibilityColumn
		var name string
		if err := rows.Scan(&item.ColumnUID, &item.CoNumber, &name, &item.HideEverywhere, &item.ClientDeliveryMode); err != nil {
			t.Fatal(err)
		}
		item.ShowValueOnCard = true
		if name == column {
			item.HideEverywhere, item.ClientDeliveryMode, found = hidden, mode, true
		}
		columns = append(columns, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || !found {
		t.Fatal("missing flag target", table, column, err)
	}
	raw, err := json.Marshal(map[string]any{"table_name": table, "columns": columns})
	if err != nil {
		t.Fatal(err)
	}
	// This is batch 324's real commit + shared invalidation path. No manual
	// eviction follows the save: the very next response must reflect the flags.
	hiddenProjectionRequest(t, ctx, 73, "admin", "/api/card-visibility/update", string(raw), UpdateCardVisibilityHandler)
}

func TestHiddenGeometryResponsePathsPostgres(t *testing.T) {
	db, ctx := hiddenProjectionPostgres(t)
	check := func(privateVisible bool) {
		t.Helper()
		for _, path := range []struct {
			target  string
			handler http.HandlerFunc
			listing bool
		}{
			{"/api/get-results?dataset=b325_places&include_map_support=1", read.GetResults, true},
			{"/api/get-results?dataset=b325_places&view_key=map", read.GetResults, true},
			{"/api/get-intelligent-results?dataset=b325_places&query=Needle&include_map_support=1", read.GetIntelligentResultsHandlerWrapper, false},
			{"/api/get-intelligent-results?dataset=b325_places&query=Needle&view_key=map&stream=1", read.GetIntelligentResultsHandlerWrapper, false},
		} {
			packets := hiddenProjectionRequest(t, ctx, 42, "basic", path.target, "", path.handler)
			count := 0
			for _, packet := range packets {
				wantGeometry := []string{"position"}
				if privateVisible {
					wantGeometry = append(wantGeometry, "private_position")
				}
				if path.listing && !reflect.DeepEqual(packet.GeomColumns, wantGeometry) {
					t.Fatalf("geometry metadata=%v want=%v", packet.GeomColumns, wantGeometry)
				}
				for _, column := range packet.GeomColumns {
					if column == "server_position" || column == "private_position" && !privateVisible {
						t.Fatal("hidden geometry advertised", packet.GeomColumns)
					}
				}
				for _, row := range packet.Data {
					count++
					if row["position"] != "(24,60)" {
						t.Fatal("visible geometry lost", row)
					}
					value, present := row["private_position"]
					if present != privateVisible || privateVisible && value != "(25,61)" {
						t.Fatal("private geometry delivery wrong", row)
					}
					if _, present := row["server_position"]; present {
						t.Fatal("server-only geometry leaked", row)
					}
				}
			}
			if count != 1 {
				t.Fatalf("%s returned %d rows", path.target, count)
			}
		}
	}
	check(false)
	saveHiddenProjectionFlag(t, ctx, db, "b325_places", "private_position", false, "include")
	check(true)
	saveHiddenProjectionFlag(t, ctx, db, "b325_places", "private_position", true, "include")
	check(false)
	saveHiddenProjectionFlag(t, ctx, db, "b325_places", "private_position", false, "server_only")
	check(false)
	saveHiddenProjectionFlag(t, ctx, db, "b325_places", "private_position", false, "include")
	check(true)
}

func TestHiddenFKLabelResponsePathsPostgres(t *testing.T) {
	db, ctx := hiddenProjectionPostgres(t)
	check := func(visible bool) {
		t.Helper()
		var want any
		if visible {
			want = "Parent display label"
		}
		aliases, err := read.LinkedLabelEvidenceAliases("b325_children", []string{"parent_id"})
		if err != nil {
			t.Fatal(err)
		}
		for _, labels := range aliases {
			if (len(labels) == 1) != visible || len(labels) > 1 {
				t.Fatal("evidence differs from delivered labels", aliases)
			}
		}
		for _, actor := range []struct {
			id   int
			role string
		}{{42, "basic"}, {1, "guest"}} {
			for _, path := range []struct {
				target, body, alias, direction string
				handler                        http.HandlerFunc
			}{
				{target: "/api/get-results?dataset=b325_children", alias: "parent_name (ln)", handler: read.GetResults},
				{target: "/api/get-intelligent-results?dataset=b325_children&query=Needle", alias: "parent_name (ln)", handler: read.GetIntelligentResultsHandlerWrapper},
				{target: "/api/fetch-dynamic-children?dataset=b325_parents", body: `{"parent_dataset":"b325_parents","parent_pk_value":"1","child_table":"b325_children"}`, alias: "parent_name", direction: "incoming", handler: read.GetDynamicRelatedItemsHandler},
				{target: "/api/fetch-dynamic-children?dataset=b325_roots", body: `{"parent_dataset":"b325_roots","parent_pk_value":"1","child_table":"b325_children"}`, alias: "parent_name", direction: "outgoing", handler: read.GetDynamicRelatedItemsHandler},
			} {
				packets := hiddenProjectionRequest(t, ctx, actor.id, actor.role, path.target, path.body, path.handler)
				rows := packets[0].Data
				if path.direction != "" {
					if len(packets[0].ChildTables) != 1 || packets[0].ChildTables[0].Direction != path.direction || packets[0].ChildTables[0].Dataset != "b325_children" {
						t.Fatal("wrong related projection", packets)
					}
					rows = packets[0].ChildTables[0].Rows
				}
				if len(rows) != 1 {
					t.Fatalf("%s as %s lost child rows: %v", path.target, actor.role, packets)
				}
				label, present := rows[0][path.alias]
				if !present || label != want || fmt.Sprint(rows[0]["parent_id"]) != "1" {
					t.Fatalf("%s as %s: %v want label=%v", path.target, actor.role, rows, want)
				}
			}
		}
	}
	check(true)
	check(true) // Warm the schema/join/settings caches before changing the target.
	saveHiddenProjectionFlag(t, ctx, db, "b325_parents", "title", true, "include")
	check(false)
	saveHiddenProjectionFlag(t, ctx, db, "b325_parents", "title", false, "include")
	check(true)
	saveHiddenProjectionFlag(t, ctx, db, "b325_parents", "title", false, "server_only")
	check(false)
	saveHiddenProjectionFlag(t, ctx, db, "b325_parents", "title", false, "include")
	check(true)
}
