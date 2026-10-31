// front_page_boxes_admission_budget_postgres_test.go
// Proves Home bounds startup-barrier admission when a box first opens its transaction.
// Connects the complete Home handler, real transaction middleware and lifecycle lease.
// Requires a readable baseline, timed omission, no leaked lock/connection and recovery.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
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
	"easelect/backend/core_components/runtime_grants"
)

func TestFrontPageBoxesLazyAdmissionRespectsBudgetPostgres(t *testing.T) {
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
        INSERT INTO app_service_catalog VALUES(901,42,'Admission actor row',false,false,false,false),
            (902,73,'Foreign hidden row',false,false,false,false);
        UPDATE system_config SET boolean_value=true WHERE key IN ('separate_front_page','front_page_show_blocks');`)
	policies, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "front_page_service_catalog_policies.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(policies))
	roleDB := frontPageRuntimeDB(t, db)
	boxes := []frontPageBlockInput{{Dataset: "app_service_catalog", ResultLimit: 1, SortOrder: 1, Enabled: true}}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &boxes}); err != nil {
		t.Fatal(err)
	}
	read.InvalidateSchemaCache("app_service_catalog")
	read.InvalidatePermissionsCache("app_service_catalog")
	read.InvalidateUserColumnSettingsCache("app_service_catalog", "card")

	// A separate one-slot lifecycle pool exposes a stranded connection immediately.
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	lifecycle, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	defer lifecycle.Close()
	lifecycle.SetMaxOpenConns(1)
	const barrier = "filterest.runtime_startup_barrier"
	var blocker *sql.Tx
	var failsafe *time.Timer
	var released atomic.Bool
	defer func() {
		if blocker != nil {
			blocker.Rollback()
		}
		if failsafe != nil {
			failsafe.Stop()
		}
	}()
	blocked := false
	delegates := 0
	canonical := frontPageResultsHandler
	defer func() { frontPageResultsHandler = canonical }()
	frontPageResultsHandler = func(w http.ResponseWriter, request *http.Request) {
		delegates++
		if _, open := dbutils.PeekTx(request.Context()); open {
			t.Fatal("transaction opened before box delegation")
		}
		if blocked {
			// Lock after Home's preceding catalogue/permission reads. The real
			// pilot opens its initially lazy transaction inside canonical below.
			var err error
			blocker, err = db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := blocker.Exec(`SELECT pg_advisory_xact_lock(hashtext($1))`, barrier); err != nil {
				t.Fatal(err)
			}
			failsafe = time.AfterFunc(6*time.Second, func() { released.Store(true); blocker.Rollback() })
		}
		canonical(w, request)
	}

	committed, followed := false, false
	handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if _, open := dbutils.PeekTx(request.Context()); open {
			t.Fatal("transaction middleware was eager")
		}
		if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
			t.Fatal("real transaction middleware missing")
		}
		home := httptest.NewRecorder()
		GetFrontPageHandler(home, request)
		tx, open := dbutils.PeekTx(request.Context())
		if request.Context().Err() != nil || open == blocked {
			t.Fatal("admission changed request lifetime or opened blocked transaction", open, blocked)
		}
		if open {
			var title, actor, role string
			var owner, bypass bool
			err := tx.QueryRowContext(request.Context(), `SELECT title,current_setting('app.user_id'),current_user,
                current_user=pg_get_userbyid(c.relowner),r.rolbypassrls
                FROM app_service_catalog CROSS JOIN pg_class c JOIN pg_roles r ON r.rolname=current_user
                WHERE app_service_catalog.id=901 AND c.oid='app_service_catalog'::regclass`).Scan(&title, &actor, &role, &owner, &bypass)
			if err != nil || title != "Admission actor row" || actor != "42" || role != "front_page_runtime" || owner || bypass {
				t.Fatal("following read lost actor/RLS transaction", title, actor, role, owner, bypass, err)
			}
			followed = true
		}
		w.WriteHeader(home.Code)
		w.Write(home.Body.Bytes())
	}))
	run := func() (*httptest.ResponseRecorder, time.Duration) {
		t.Helper()
		delegates, committed, followed = 0, false, false
		response := httptest.NewRecorder()
		request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page")
		start := time.Now()
		err := runtime_grants.WithLazyRequestBarrier(request.Context(), lifecycle, func(ctx context.Context) {
			handler.ServeHTTP(response, request.WithContext(ctx))
		})
		elapsed := time.Since(start)
		if err != nil || delegates != 1 || lifecycle.Stats().InUse != 0 || roleDB.Stats().InUse != 0 {
			t.Fatal("request did not delegate once or leaked admission/work connection", err, delegates, lifecycle.Stats(), roleDB.Stats())
		}
		return response, elapsed
	}
	assertResponse := func(response *httptest.ResponseRecorder, omitted bool) {
		t.Helper()
		var result struct {
			Blocks  []frontPageResultBlock `json:"blocks"`
			Partial bool                   `json:"partial"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.Partial != omitted {
			t.Fatal("unexpected Home response", response.Code, response.Body.String(), err)
		}
		if omitted {
			if len(result.Blocks) != 0 || committed || followed || strings.Contains(response.Body.String(), "Admission actor row") || strings.Contains(response.Body.String(), "app_service_catalog") {
				t.Fatal("blocked admission did not omit box fail-closed", response.Body.String(), committed, followed)
			}
		} else if len(result.Blocks) != 1 || len(result.Blocks[0].Data) != 1 || !committed || !followed {
			t.Fatal("baseline/following request did not read and commit", response.Body.String(), committed, followed)
		}
	}
	// A real successful RLS read prevents stale/invalid definitions from making
	// the timeout assertion vacuous, and proves middleware admission is active.
	response, _ := run()
	assertResponse(response, false)
	blocked = true
	response, elapsed := run()
	assertResponse(response, true)
	if elapsed > 3*time.Second+400*time.Millisecond || elapsed < 2*time.Second || released.Load() {
		t.Fatal("lazy admission escaped Home budget or never waited", elapsed, released.Load())
	}
	if err := blocker.Rollback(); err != nil {
		t.Fatal(err)
	}
	failsafe.Stop()
	// An exclusive probe also detects a shared session lock leaked by a
	// cancellation/acquisition race, even when sql.DB reports no in-use slot.
	probe, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback()
	var exclusive bool
	if err := probe.QueryRow(`SELECT pg_try_advisory_xact_lock(hashtext($1))`, barrier).Scan(&exclusive); err != nil || !exclusive {
		t.Fatal("timed-out admission leaked shared advisory lock", exclusive, err)
	}
	if err := probe.Rollback(); err != nil {
		t.Fatal(err)
	}
	blocked = false
	response, _ = run()
	assertResponse(response, false)
}
