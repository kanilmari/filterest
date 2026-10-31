// front_page_boxes_cohort_budget_postgres_test.go
// Proves Home's active-cohort poll cannot spend a fresh second on a catalog lock.
// Connects a held lifecycle lease, real Home middleware and a blocked pg_locks read.
// Requires observed contention, omission, preserved session settings and successful recovery.
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

func TestFrontPageBoxesActiveCohortPollRespectsBudgetPostgres(t *testing.T) {
	ctx := frontPageBudgetContext(t)
	db := frontPageDisposableDB(t, ctx)
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
        INSERT INTO app_service_catalog VALUES(901,42,'Cohort actor row',false,false,false,false),
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
	var socket, port string
	if err := db.QueryRowContext(ctx, `SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	lifecycle, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	defer lifecycle.Close()
	lifecycle.SetMaxOpenConns(1)
	var sessionPID, blockerPID int
	if _, err := lifecycle.ExecContext(ctx, `SET statement_timeout='8s'`); err != nil {
		t.Fatal(err)
	}
	if err := lifecycle.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&sessionPID); err != nil {
		t.Fatal(err)
	}
	canonical, oldClock := frontPageResultsHandler, frontPageNow
	defer func() { frontPageResultsHandler, frontPageNow = canonical, oldClock }()
	const budget = 20 * time.Millisecond
	blocked, committed := false, false
	delegates := 0
	var blocker *sql.Tx
	var observer *sql.Conn
	var failsafe *time.Timer
	var observed, released atomic.Bool
	var pollElapsed time.Duration
	defer func() {
		if blocker != nil {
			blocker.Rollback()
		}
		if failsafe != nil {
			failsafe.Stop()
		}
		if observer != nil {
			observer.Close()
		}
	}()
	frontPageResultsHandler = func(w http.ResponseWriter, request *http.Request) {
		delegates++
		if _, open := dbutils.PeekTx(request.Context()); open {
			t.Fatal("transaction opened before active-cohort admission")
		}
		if !blocked {
			canonical(w, request)
			return
		}
		deadline, ok := dbutils.ReadBudgetContext(request.Context()).Deadline()
		if !ok || time.Until(deadline) <= 0 || time.Until(deadline) > budget {
			t.Fatal("Home did not reach delegation with a short remaining budget", deadline)
		}
		// Lock the poll's view, never pg_database: connection startup and
		// pg_stat_activity both need that catalog. The observer uses the lock
		// manager function directly and never queries the locked view.
		failsafe = time.AfterFunc(3*time.Second, func() { released.Store(true); blocker.Rollback() })
		if _, err := blocker.ExecContext(ctx, `LOCK TABLE pg_catalog.pg_locks IN ACCESS EXCLUSIVE MODE`); err != nil {
			t.Fatal(err)
		}
		// Observe an ungranted catalog lock on the EXISTING lifecycle backend.
		// A timeout in a different path or before polling cannot satisfy this.
		observe, stop := context.WithCancel(ctx)
		defer stop()
		done := make(chan struct{})
		go func() {
			defer close(done)
			for observe.Err() == nil {
				var waiting bool
				err := observer.QueryRowContext(observe, `SELECT $2=ANY(pg_blocking_pids($1))`, sessionPID, blockerPID).Scan(&waiting)
				if err != nil {
					return
				}
				if waiting {
					observed.Store(true)
					return
				}
				time.Sleep(time.Millisecond)
			}
		}()
		// Round 7 takes its fresh one-second timeout and fails the timing check.
		// Keep the independent failsafe armed through the explicit lock release.
		start := time.Now()
		canonical(w, request)
		pollElapsed = time.Since(start)
		stop()
		<-done
	}
	handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
			t.Fatal("real lazy transaction middleware missing")
		}
		GetFrontPageHandler(w, request)
		if _, open := dbutils.PeekTx(request.Context()); open == blocked {
			t.Fatal("blocked poll opened transaction or readable box did not", open, blocked)
		}
	}))
	run := func(omitted bool) {
		t.Helper()
		delegates, committed = 0, false
		start, clockCalls := time.Now(), 0
		frontPageNow = func() time.Time {
			clockCalls++
			if blocked && clockCalls > 1 {
				return start.Add(3*time.Second - budget)
			}
			return start
		}
		request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page").WithContext(ctx)
		response := httptest.NewRecorder()
		requestStart := time.Now()
		if err := runtime_grants.WithLazyRequestBarrier(request.Context(), lifecycle, func(ctx context.Context) {
			handler.ServeHTTP(response, request.WithContext(ctx))
		}); err != nil {
			t.Fatal(err)
		}
		requestElapsed := time.Since(requestStart)
		var result struct {
			Blocks  []frontPageResultBlock `json:"blocks"`
			Partial bool                   `json:"partial"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || delegates != 1 || roleDB.Stats().InUse != 0 {
			t.Fatal("Home failed or did not reach canonical delegate", response.Code, response.Body.String(), delegates, roleDB.Stats(), err)
		}
		if omitted {
			if len(result.Blocks) != 0 || !result.Partial || committed || strings.Contains(response.Body.String(), "Cohort actor row") || strings.Contains(response.Body.String(), "app_service_catalog") {
				t.Fatal("timed-out cohort poll did not omit box fail-closed", response.Body.String(), committed)
			}
			if pollElapsed > budget+100*time.Millisecond || requestElapsed > budget+200*time.Millisecond || pollElapsed < 5*time.Millisecond || !observed.Load() || released.Load() {
				t.Fatal("active poll escaped budget or never blocked on its view", pollElapsed, requestElapsed, observed.Load(), released.Load())
			}
		} else if len(result.Blocks) != 1 || len(result.Blocks[0].Data) != 1 || !committed || !strings.Contains(response.Body.String(), "Cohort actor row") || strings.Contains(response.Body.String(), "Foreign hidden row") {
			t.Fatal("baseline/following RLS box did not read and commit", response.Body.String(), committed)
		}
	}
	run(false) // A real readable baseline makes omission non-vacuous.
	_, releaseActive, err := runtime_grants.AcquireRequestBarrier(ctx, lifecycle)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseActive()
	time.Sleep(30 * time.Millisecond) // The active gate's 25 ms pollAt has passed.
	observer, err = db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	blocker, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := blocker.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	blocked = true
	run(true)
	// Release before any postcondition that reads pg_locks. Disarm only after
	// rollback completes, so an inspection failure cannot strand the lock.
	if err := blocker.Rollback(); err != nil {
		t.Fatal(err)
	}
	failsafe.Stop()
	var idle, shared bool
	if err := observer.QueryRowContext(ctx, `SELECT state='idle' AND xact_start IS NULL FROM pg_stat_activity WHERE pid=$1`, sessionPID).Scan(&idle); err != nil || !idle || lifecycle.Stats().InUse != 1 {
		t.Fatal("poll left aborted transaction or lost active session", idle, lifecycle.Stats(), err)
	}
	const barrier = "filterest.runtime_startup_barrier"
	if err := observer.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory'
        AND mode='ShareLock' AND granted AND objid=(hashtext($2)::bigint & 4294967295)::oid)`, sessionPID, barrier).Scan(&shared); err != nil || !shared {
		t.Fatal("poll cancelled another request's shared lock", shared, err)
	}
	blocked = false
	run(false) // Joins the SAME active cohort after the poll's view is unblocked.
	if err := releaseActive(); err != nil || lifecycle.Stats().InUse != 0 {
		t.Fatal("active lifecycle connection leaked", err, lifecycle.Stats())
	}
	var followingPID int
	var timeout string
	if err := lifecycle.QueryRowContext(ctx, `SELECT pg_backend_pid(),current_setting('statement_timeout')`).Scan(&followingPID, &timeout); err != nil || followingPID != sessionPID || timeout != "8s" {
		t.Fatal("poll replaced session or leaked local timeout", followingPID, sessionPID, timeout, err)
	}
	probe, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback()
	var exclusive bool
	if err := probe.QueryRowContext(ctx, `SELECT pg_try_advisory_xact_lock(hashtext($1))`, barrier).Scan(&exclusive); err != nil || !exclusive {
		t.Fatal("cohort cleanup leaked shared advisory lock", exclusive, err)
	}
	if err := probe.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := observer.Close(); err != nil || db.Stats().InUse != 0 || roleDB.Stats().InUse != 0 || lifecycle.Stats().InUse != 0 {
		t.Fatal("cohort proof leaked a pool slot", err, db.Stats(), roleDB.Stats(), lifecycle.Stats())
	}
}
