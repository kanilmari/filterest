// front_page_boxes_metadata_budget_postgres_test.go
// Proves blocked category and canonical metadata reads obey Home's remaining budget.
// Connects the complete Home handler with real lazy transaction middleware and pool reads.
// Requires omission, a following read in the same request transaction and commit.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/middlewares"
)

func TestFrontPageBoxesBlockedCategoryRespectsBudgetAndCommitsPostgres(t *testing.T) {
	frontPageBlockedMetadataProof(t, "system_row_groups")
}

func TestFrontPageBoxesBlockedCanonicalMetadataRespectsBudgetAndCommitsPostgres(t *testing.T) {
	frontPageBlockedMetadataProof(t, "system_db_tables")
}

func frontPageBlockedMetadataProof(t *testing.T, lockedTable string) {
	t.Helper()
	db := frontPageDisposableDB(t, frontPageBudgetContext(t))
	frontPageExec(t, db, `INSERT INTO wl143_content VALUES(1,'Blocked box title',now());
        INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE WHEN col.column_name='title' THEN 'header' ELSE '' END
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name='wl143_content';
        INSERT INTO system_row_groups(slug,title) VALUES('budget-category','{"en":"Budget category"}');
        INSERT INTO system_row_group_memberships(group_id,table_uid,row_id)
            SELECT category.id,registry.table_uid,1 FROM system_row_groups category CROSS JOIN system_db_tables registry
            WHERE category.slug='budget-category' AND registry.table_name='wl143_content';
        UPDATE system_config SET boolean_value=true WHERE key IN ('separate_front_page','front_page_show_blocks');`)
	boxes := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 1, SortOrder: 1, Enabled: true}}
	if lockedTable == "system_row_groups" {
		boxes[0].Query = json.RawMessage(`{"row_group":["budget-category"]}`)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Version: "none", Blocks: &boxes}); err != nil {
		t.Fatal(err)
	}
	roleDB := frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `ALTER ROLE front_page_runtime SET statement_timeout='8s'`)
	read.InvalidateSchemaCache("wl143_content")
	read.InvalidatePermissionsCache("wl143_content")
	read.InvalidateUserColumnSettingsCache("wl143_content", "card")
	// Prove this saved definition is readable before taking the blocking lock.
	proof := httptest.NewRecorder()
	GetFrontPageHandler(proof, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	var before struct {
		Blocks []frontPageResultBlock `json:"blocks"`
	}
	if err := json.Unmarshal(proof.Body.Bytes(), &before); err != nil || proof.Code != 200 || len(before.Blocks) != 1 || len(before.Blocks[0].Data) != 1 {
		t.Fatal("lock target was not a valid readable box", proof.Code, proof.Body.String(), err)
	}
	// The canonical visibility guard reads system_db_tables even with warm
	// existence/schema caches, so the metadata lock cannot be hidden by caching.
	read.InvalidateSchemaCache("wl143_content")

	var blocker *sql.Tx
	var released atomic.Bool
	var failsafe *time.Timer
	lock := func() {
		var err error
		blocker, err = db.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := blocker.Exec("LOCK TABLE public." + lockedTable + " IN ACCESS EXCLUSIVE MODE"); err != nil {
			t.Fatal(err)
		}
		failsafe = time.AfterFunc(6*time.Second, func() { released.Store(true); blocker.Rollback() })
	}
	defer func() {
		if blocker != nil {
			blocker.Rollback()
		}
		if failsafe != nil {
			failsafe.Stop()
		}
	}()
	canonical := frontPageResultsHandler
	delegates := 0
	frontPageResultsHandler = func(w http.ResponseWriter, request *http.Request) {
		delegates++
		if lockedTable == "system_db_tables" {
			// Lock only after Home's catalogue and permission reads, so this
			// specifically blocks canonical metadata, before any row query.
			lock()
		}
		canonical(w, request)
	}
	t.Cleanup(func() { frontPageResultsHandler = canonical })
	if lockedTable == "system_row_groups" {
		lock()
	}

	var shared *sql.Tx
	committed, followed := false, false
	handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		// Earlier request work already owns a transaction when a reference read
		// fails before delegation. It must remain usable even in that case.
		var err error
		shared, err = dbutils.RequireTxWithError(request.Context())
		if err != nil {
			t.Fatal(err)
		}
		var originalTimeout string
		if err := shared.QueryRowContext(request.Context(), "SHOW statement_timeout").Scan(&originalTimeout); err != nil {
			t.Fatal(err)
		}
		if !dbutils.RegisterAfterCommitHook(request.Context(), func() { committed = true }) {
			t.Fatal("missing real middleware")
		}
		home := httptest.NewRecorder()
		GetFrontPageHandler(home, request)
		tx, open := dbutils.PeekTx(request.Context())
		if !open || tx != shared || request.Context().Err() != nil {
			t.Fatal("Home lost the shared transaction")
		}
		var value int
		var actor, timeout string
		if err := tx.QueryRowContext(request.Context(), `SELECT id,current_setting('app.user_id'),current_setting('statement_timeout') FROM wl143_content WHERE id=1`).Scan(&value, &actor, &timeout); err != nil || value != 1 || actor != "42" || timeout != originalTimeout {
			t.Fatal("following read failed", value, actor, timeout, err)
		}
		followed = true
		w.WriteHeader(home.Code)
		w.Write(home.Body.Bytes())
	}))
	// The middleware uses the backend pool, while the canonical row reader uses
	// the actual non-owner runtime pool. Neither pool may be replaced by a fake.
	if roleDB == nil {
		t.Fatal("runtime pool missing")
	}
	response := httptest.NewRecorder()
	start := time.Now()
	handler.ServeHTTP(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page"))
	elapsed := time.Since(start)
	var result struct {
		Blocks  []frontPageResultBlock `json:"blocks"`
		Partial bool                   `json:"partial"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || len(result.Blocks) != 0 || !result.Partial {
		t.Fatal("blocked box was not omitted", response.Code, response.Body.String(), err)
	}
	if elapsed > 3*time.Second+400*time.Millisecond || released.Load() {
		t.Fatal("Home exceeded its budget", elapsed, released.Load())
	}
	wantDelegates := 0
	if lockedTable == "system_db_tables" {
		wantDelegates = 1
	}
	if delegates != wantDelegates || !followed || !committed {
		t.Fatal("omission did not preserve following read and commit", delegates, followed, committed)
	}
	if strings.Contains(response.Body.String(), "Blocked box title") || strings.Contains(response.Body.String(), "wl143_content") {
		t.Fatal("omitted box leaked metadata")
	}
}
