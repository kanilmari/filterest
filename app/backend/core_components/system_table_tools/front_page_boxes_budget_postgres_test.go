// front_page_boxes_budget_postgres_test.go
// Proves complete Home reads leave a lazily opened RLS transaction usable.
// Connects the real transaction middleware, canonical pilot reads and box budget.
// Uses the disposable bootstrap fixture, including deterministic late-result omission.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/middlewares"
)

func TestFrontPageBoxesBudgetKeepsLazyRequestTransactionPostgres(t *testing.T) {
	db := frontPageDisposableDB(t, frontPageBudgetContext(t))
	frontPageExec(t, db, `CREATE TABLE public.app_service_catalog(id bigint PRIMARY KEY,user_id bigint,title text,
        published boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT false,
        admin_reviewed boolean NOT NULL DEFAULT false,admin_approved boolean NOT NULL DEFAULT false);
        INSERT INTO public.system_db_tables(table_name,schema_name,folder_id) VALUES('app_service_catalog','public',1);
        INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,card_element,hide_everywhere)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END,
                col.column_name IN ('published','enabled','admin_reviewed','admin_approved')
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='app_service_catalog';
        INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='app_service_catalog';
        INSERT INTO app_service_catalog VALUES(901,42,'Request actor row',false,false,false,false),
            (902,73,'Foreign hidden row',false,false,false,false);
        UPDATE system_config SET boolean_value=true WHERE key IN ('separate_front_page','front_page_show_blocks');`)
	policies, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "front_page_service_catalog_policies.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(policies))
	frontPageRuntimeDB(t, db)
	boxes := []frontPageBlockInput{
		{Dataset: "app_service_catalog", ResultLimit: 1, SortOrder: 1, Enabled: true},
		{Dataset: "app_service_catalog", ResultLimit: 1, SortOrder: 2, Enabled: true},
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &boxes}); err != nil {
		t.Fatal(err)
	}
	read.InvalidateSchemaCache("app_service_catalog")
	read.InvalidatePermissionsCache("app_service_catalog")
	read.InvalidateUserColumnSettingsCache("app_service_catalog", "card")
	realResultsHandler, oldClock := frontPageResultsHandler, frontPageNow
	t.Cleanup(func() { frontPageResultsHandler, frontPageNow = realResultsHandler, oldClock })
	for _, mode := range []string{"on time", "late second box"} {
		t.Run(mode, func(t *testing.T) {
			now := time.Now()
			frontPageNow = func() time.Time { return now }
			calls := 0
			var shared *sql.Tx
			var delegatedContext context.Context
			frontPageResultsHandler = func(w http.ResponseWriter, delegated *http.Request) {
				calls++
				if calls == 1 {
					if _, open := dbutils.PeekTx(delegated.Context()); open {
						t.Fatal("transaction opened before the service-catalog box")
					}
				}
				projection := httptest.NewRecorder()
				realResultsHandler(projection, delegated)
				var result frontPageResultBlock
				if err := json.Unmarshal(projection.Body.Bytes(), &result); err != nil || projection.Code != 200 || len(result.Data) != 1 {
					t.Fatal("canonical RLS read failed", projection.Code, projection.Body.String(), err)
				}
				tx, open := dbutils.PeekTx(delegated.Context())
				if !open || (shared != nil && shared != tx) {
					t.Fatal("pilot did not open/reuse the request transaction")
				}
				shared, delegatedContext = tx, delegated.Context()
				if mode == "late second box" && calls == 2 {
					// The canonical read completes, but its result misses the budget.
					// This exercises timeout omission without a sleep or PG cancellation.
					now = now.Add(3 * time.Second)
				}
				w.WriteHeader(projection.Code)
				w.Write(projection.Body.Bytes())
			}
			committed, followed := false, false
			handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if _, open := dbutils.PeekTx(request.Context()); open {
					t.Fatal("middleware opened the request transaction eagerly")
				}
				if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
					t.Fatal("real transaction middleware missing")
				}
				home := httptest.NewRecorder()
				GetFrontPageHandler(home, request)
				var result struct {
					Blocks  []frontPageResultBlock `json:"blocks"`
					Partial bool                   `json:"partial"`
				}
				late := mode == "late second box"
				want := 2
				if late {
					want = 1
				}
				if err := json.Unmarshal(home.Body.Bytes(), &result); err != nil || home.Code != 200 || calls != 2 || len(result.Blocks) != want || result.Partial != late {
					t.Fatal("Home box budget changed", home.Code, home.Body.String(), calls, err)
				}
				if home.Header().Get("Cache-Control") != "private, no-store" || home.Header().Get("Vary") != "Cookie" {
					t.Fatal("Home cache policy changed", home.Header())
				}
				tx, open := dbutils.PeekTx(request.Context())
				if !open || tx != shared || delegatedContext == nil || delegatedContext.Err() != nil {
					t.Fatal("Home invalidated the pilot's shared transaction")
				}
				var title, actor, role string
				var owner, bypass bool
				err := tx.QueryRowContext(request.Context(), `SELECT title,current_setting('app.user_id'),current_user,
                    current_user=pg_get_userbyid(c.relowner),r.rolbypassrls
                    FROM app_service_catalog CROSS JOIN pg_class c JOIN pg_roles r ON r.rolname=current_user
                    WHERE app_service_catalog.id=901 AND c.oid='app_service_catalog'::regclass`).Scan(&title, &actor, &role, &owner, &bypass)
				if err != nil || title != "Request actor row" || actor != "42" || role != "front_page_runtime" || owner || bypass {
					t.Fatal("following read lost usable RLS transaction/actor", title, actor, role, owner, bypass, err)
				}
				followed = true
				w.WriteHeader(home.Code)
				w.Write(home.Body.Bytes())
			}))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
			if response.Code != 200 || !followed || !committed {
				t.Fatal("request did not complete and commit", response.Code, response.Body.String(), followed, committed)
			}
		})
	}
}
