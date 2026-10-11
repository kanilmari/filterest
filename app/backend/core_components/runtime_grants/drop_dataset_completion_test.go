// drop_dataset_completion_test.go
// Injects permission failures and cancellation through the dataset-drop handler.
// Reuses the DDL boundary driver and the request's real lazy transaction.
// Failed drops must roll back and only committed drops may be logged as dropped.
package runtime_grants_test

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants/granttest"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestDropDatasetCompletionAndCommittedLog(t *testing.T) {
	for _, failure := range []string{"none", "ACL inspection", "canceled after drop"} {
		t.Run(failure, func(t *testing.T) {
			granttest.ConfigureRoles(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			state := &ddlBoundaryState{t: t, aclFailure: failure == "ACL inspection"}
			if failure == "canceled after drop" {
				state.cancelAfterDrop = cancel
			}
			name := fmt.Sprintf("drop_completion_%d", atomic.AddInt64(&ddlBoundaryCounter, 1))
			sql.Register(name, ddlBoundaryDriver{state})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			// Isolate Finish's cancellation behavior from database/sql's
			// automatic rollback of a request-bound transaction.
			tx, err := lazy.Begin()
			if err != nil {
				t.Fatal(err)
			}
			var logs bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&logs)
			defer log.SetOutput(previous)
			req := httptest.NewRequest("POST", "/api/drop-dataset", strings.NewReader(`{"dataset_name":"source","confirm_dataset_name":"source"}`))
			req = req.WithContext(dbutils.SetLazyTx(ctx, lazy))
			rec := httptest.NewRecorder()
			drop.DropTableHandler(granttest.Recorder{ResponseRecorder: rec}, req)
			want := 200
			if failure != "none" {
				want = 500
			}
			if rec.Code != want {
				t.Fatalf("status=%d want %d: %s", rec.Code, want, rec.Body)
			}
			if failure != "none" {
				if !strings.Contains(rec.Body.String(), "permissions could not be saved") || state.pending != 0 || state.rolledBack == 0 {
					t.Fatal("permission failure did not roll back the drop", rec.Body, state)
				}
				if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
					t.Fatal("failed drop could still commit", err)
				}
			}
			if strings.Contains(logs.String(), "PostgreSQL table source dropped") {
				t.Fatal("uncommitted drop was reported as completed", logs.String())
			}
			if failure == "none" {
				if err := lazy.Commit(); err != nil {
					t.Fatal(err)
				}
				if state.committed == 0 || !strings.Contains(logs.String(), "PostgreSQL table source dropped") {
					t.Fatal("committed drop was not reported", logs.String(), state)
				}
			}
		})
	}
}

func TestDropDatasetHTTPResponseWaitsForPermissionCompletion(t *testing.T) {
	previousStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("drop-completion-unit-test-key"))
	defer func() { esessions.Store = previousStore }()
	for _, failure := range []bool{false, true} {
		t.Run(fmt.Sprintf("ACL failure=%t", failure), func(t *testing.T) {
			granttest.ConfigureRoles(t)
			state := &ddlBoundaryState{t: t, aclFailure: failure}
			name := fmt.Sprintf("drop_http_%d", atomic.AddInt64(&ddlBoundaryCounter, 1))
			sql.Register(name, ddlBoundaryDriver{state})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			previousDB, previousAdmin := backend.Db, backend.DbAdmin
			backend.Db, backend.DbAdmin = db, db
			defer func() { backend.Db, backend.DbAdmin = previousDB, previousAdmin }()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("POST", "/api/drop-dataset", strings.NewReader(`{"dataset_name":"source","confirm_dataset_name":"source"}`))
			req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(2, "admin")))
			middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				drop.DropTableHandler(w, r)
				if rec.Body.Len() != 0 {
					t.Fatal("HTTP output escaped before transaction completion")
				}
			})).ServeHTTP(rec, req)
			if failure {
				if rec.Code != 500 || state.committed != 0 || state.rolledBack == 0 || state.pending != 0 || !strings.Contains(rec.Body.String(), "permissions could not be saved") {
					t.Fatal("HTTP permission error left a partial drop", rec.Code, rec.Body, state)
				}
			} else if rec.Code != 200 || state.committed == 0 || !strings.Contains(rec.Body.String(), "Taulu source poistettu") {
				t.Fatal("committed drop did not deliver HTTP success", rec.Code, rec.Body, state)
			}
		})
	}
}
