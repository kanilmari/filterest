// front_page_boxes_execution_budget_postgres_test.go
// Proves a real blocked Home row read stops within the shared box budget.
// Connects PostgreSQL locking, the canonical RLS reader and real transaction middleware.
// Requires a following read, restored session settings and a committed request transaction.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/middlewares"
)

func TestFrontPageBoxesBlockedReadRespectsBudgetAndCommitsPostgres(t *testing.T) {
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
        INSERT INTO app_service_catalog VALUES(901,42,'Blocked private title',false,false,false,false);
        INSERT INTO wl143_content VALUES(1,'Following read succeeds',now());
        UPDATE system_config SET boolean_value=true WHERE key IN ('separate_front_page','front_page_show_blocks');`)
	policies, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "front_page_service_catalog_policies.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(policies))
	frontPageRuntimeDB(t, db)
	// Connections open lazily, so the pilot and following request statements
	// inherit this non-default value. Savepoint recovery must restore it.
	frontPageExec(t, db, `ALTER ROLE front_page_runtime SET statement_timeout='8s'`)
	boxes := []frontPageBlockInput{{Dataset: "app_service_catalog", ResultLimit: 1, SortOrder: 1, Enabled: true}}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &boxes}); err != nil {
		t.Fatal(err)
	}
	read.InvalidateSchemaCache("app_service_catalog")
	read.InvalidatePermissionsCache("app_service_catalog")
	read.InvalidateUserColumnSettingsCache("app_service_catalog", "card")
	realResultsHandler := frontPageResultsHandler
	var delegatedContext context.Context
	var shared *sql.Tx
	delegateCalls, delegateStatus := 0, 0
	frontPageResultsHandler = func(w http.ResponseWriter, delegated *http.Request) {
		delegateCalls++
		if _, open := dbutils.PeekTx(delegated.Context()); open {
			t.Fatal("pilot transaction opened before canonical delegation")
		}
		projection := httptest.NewRecorder()
		realResultsHandler(projection, delegated)
		shared, _ = dbutils.PeekTx(delegated.Context())
		delegatedContext, delegateStatus = delegated.Context(), projection.Code
		w.WriteHeader(projection.Code)
		w.Write(projection.Body.Bytes())
	}
	t.Cleanup(func() { frontPageResultsHandler = realResultsHandler })

	// A SELECT cannot pass this lock, even with MVCC. The six-second failsafe
	// makes the unfixed code terminate, while the fixed request must return in 3 s.
	blocker, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var released atomic.Bool
	failsafe := time.AfterFunc(6*time.Second, func() { released.Store(true); blocker.Rollback() })
	defer func() {
		blocker.Rollback()
		failsafe.Stop()
	}()
	if _, err := blocker.Exec(`LOCK TABLE public.app_service_catalog IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	committed, followed := false, false
	handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if _, open := dbutils.PeekTx(request.Context()); open {
			t.Fatal("middleware opened the transaction eagerly")
		}
		if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
			t.Fatal("real transaction middleware missing")
		}
		home := httptest.NewRecorder()
		GetFrontPageHandler(home, request)
		tx, open := dbutils.PeekTx(request.Context())
		if !open || tx != shared || delegatedContext == nil || delegatedContext.Err() != nil {
			t.Fatal("Home invalidated its request transaction")
		}
		var title, actor, role, timeout string
		var owner, bypass bool
		err := tx.QueryRowContext(request.Context(), `SELECT title,current_setting('app.user_id'),current_user,
            current_setting('statement_timeout'),current_user=pg_get_userbyid(c.relowner),r.rolbypassrls
            FROM wl143_content CROSS JOIN pg_class c JOIN pg_roles r ON r.rolname=current_user
            WHERE wl143_content.id=1 AND c.oid='app_service_catalog'::regclass`).Scan(&title, &actor, &role, &timeout, &owner, &bypass)
		if err != nil || title != "Following read succeeds" || actor != "42" || role != "front_page_runtime" || timeout != "8s" || owner || bypass {
			t.Fatal("following transaction read/settings/actor failed", title, actor, role, timeout, owner, bypass, err)
		}
		followed = true
		w.Header().Set("Cache-Control", home.Header().Get("Cache-Control"))
		w.Header().Set("Vary", home.Header().Get("Vary"))
		w.WriteHeader(home.Code)
		w.Write(home.Body.Bytes())
	}))
	response := httptest.NewRecorder()
	start := time.Now()
	handler.ServeHTTP(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	elapsed := time.Since(start)
	var result struct {
		Blocks  []frontPageResultBlock `json:"blocks"`
		Partial bool                   `json:"partial"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 0 || !result.Partial {
		t.Fatal("blocked box leaked or response was not partial", response.Code, response.Body.String(), err)
	}
	if elapsed > 3*time.Second+400*time.Millisecond || released.Load() {
		t.Fatal("Home exceeded its database budget", elapsed, "failsafe released lock:", released.Load())
	}
	if delegateCalls != 1 || delegateStatus != http.StatusInternalServerError || !followed || !committed {
		t.Fatal("did not time out, follow with a read and commit", delegateCalls, delegateStatus, followed, committed)
	}
	if strings.Contains(response.Body.String(), "Blocked private title") || strings.Contains(response.Body.String(), "app_service_catalog") {
		t.Fatal("omitted box disclosed private metadata", response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
		t.Fatal("Home cache policy changed", response.Header())
	}
}
