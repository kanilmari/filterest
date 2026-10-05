// row_actor_writers_postgres_test.go
// Exercises all eight developer writers against the generated public package.
// Reuses the ordered-column tests' disposable PostgreSQL and bootstrap helpers.
// Exists because a pool/private-transaction writer cannot rely on request defaults:
// the requesting account must be stored in both columns, even with spoofed input.
package dtt_crud_workflows_test

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/agent_tools"
	"easelect/backend/core_components/dbutils"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/workline_observatory"
	"github.com/gorilla/sessions"
)

func TestDeveloperToolWriterActorsPostgres(t *testing.T) {
	db, _ := workflows.RegistrationDisposableDBForTest(t)
	workflows.LoadPublicBootstrapForTest(t, db)
	previousDB, previousStore, previousName := backend.Db, e_sessions.Store, e_sessions.SessionName
	backend.Db = db
	e_sessions.Store = sessions.NewCookieStore([]byte("developer-actor-test-session-key!"))
	e_sessions.SessionName = "actor_writer_test"
	t.Cleanup(func() { backend.Db, e_sessions.Store, e_sessions.SessionName = previousDB, previousStore, previousName })
	if _, err := db.Exec("INSERT INTO system_users(id,username) VALUES(74001,'writer_actor'),(74002,'spoofed_actor')"); err != nil {
		t.Fatal(err)
	}
	post := func(actor int, body, table string, handler http.HandlerFunc) int64 {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
		if err != nil {
			t.Fatal(err)
		}
		session.Values["user_id"], session.Values["authenticated"] = actor, true
		session.Values["user_role"] = "admin"
		lazy := dbutils.NewLazyTx(db)
		req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
		rec := httptest.NewRecorder()
		handler(rec, req)
		if rec.Code >= 400 {
			_ = lazy.Rollback()
			t.Fatalf("%s: %d %s", table, rec.Code, rec.Body)
		}
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		var id int64
		var creator, owner sql.NullInt64
		if err := db.QueryRow("SELECT id,created_by,owner_id FROM "+table+" ORDER BY id DESC LIMIT 1").Scan(&id, &creator, &owner); err != nil {
			t.Fatal(err)
		}
		if actor > 1 {
			if !creator.Valid || !owner.Valid || creator.Int64 != int64(actor) || owner.Int64 != int64(actor) {
				t.Fatalf("%s: creator=%v owner=%v, want requesting account %d", table, creator, owner, actor)
			}
		} else if creator.Valid || owner.Valid {
			t.Fatalf("%s: non-account actor %d persisted: %v/%v", table, actor, creator, owner)
		}
		return id
	}
	post(74001, `{"slug":"actor-writers","title":"Actors","created_by":74002,"owner_id":74002}`, "dev_agent_task_groups", agent_tools.TaskGroupsHandler)
	task := post(74001, `{"title":"Actor ticket","created_by":74002,"owner_id":74002}`, "dev_agent_tasks", agent_tools.CreateTaskHandler)
	post(74001, fmt.Sprintf(`{"task_id":%d,"todo_text":"Check actors","created_by":74002,"owner_id":74002}`, task), "dev_agent_task_todos", agent_tools.CreateTaskTodoHandler)
	workline := post(74001, `{"title":"Actor workline","status":"active","created_by":74002,"owner_id":74002}`, "dev_agent_worklines", agent_tools.WorklinesHandler)
	report := post(74001, fmt.Sprintf(`{"workline_id":%d,"title":"Actor report","phase_gate":"3-4","current_phase":4,
        "workline_status_snapshot":"active","changed_this_turn":true,"context":"Check the writer boundary.",
        "plain_language":"Both actors belong to the requester.","technical":"Pool and private transactions stamp explicitly.",
        "next_step":"Complete verification.","snapshot":{},"git_head_commit":"%s","git_worktree_state":"dirty",
        "git_has_other_changes":false,"git_workline_changed_paths":["backend/writers.go"],"created_by":74002,"owner_id":74002}`, workline, strings.Repeat("a", 40)), "dev_agent_workline_reports", agent_tools.WorklineReportsHandler)
	post(74001, fmt.Sprintf(`{"title":"Actor handover","items":[{"workline_id":%d,"workline_report_id":%d}],"created_by":74002,"owner_id":74002}`, workline, report), "dev_agent_handover_reports", agent_tools.HandoverReportsHandler)
	goal := post(74001, `{"identity_key":"actor-writers","version":1,"title":"Actors","outcome":"Both fields are recorded","created_by":74002,"owner_id":74002}`, "dev_agent_release_goals", workline_observatory.ReleaseGoalsHandler)
	post(74001, fmt.Sprintf(`{"release_goal_id":%d,"workline_id":%d,"completion_rule":"must_complete","created_by":74002,"owner_id":74002}`, goal, workline), "dev_agent_release_goal_contracts", workline_observatory.ReleaseContractsHandler)
	// Direct pool calls still map zero, negative and guest actors to NULL.
	// Authentication remains the surrounding route's independent responsibility.
	for _, actor := range []int{-7, 0, 1} {
		post(actor, fmt.Sprintf(`{"slug":"actor-boundary-%d","title":"Boundary"}`, actor), "dev_agent_task_groups", agent_tools.TaskGroupsHandler)
	}
}

// The role script and the real startup reconciliation functions must agree for
// installation-specific names as well as Docker's defaults. HTTP startup itself
// is not needed to verify these database protections.
func TestActorPackageRuntimeRoleChainPostgres(t *testing.T) {
	for _, prefix := range []string{"filterest", "custom_site"} {
		t.Run(prefix, func(t *testing.T) {
			db, connect := workflows.RegistrationDisposableDBForTest(t)
			workflows.LoadPublicBootstrapForTest(t, db)
			var socket, port, owner string
			if err := db.QueryRow("SELECT current_setting('unix_socket_directories'),current_setting('port'),current_user").Scan(&socket, &port, &owner); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PGHOST", socket)
			t.Setenv("PGPORT", port)
			t.Setenv("POSTGRES_USER", owner)
			t.Setenv("POSTGRES_DB", "postgres")
			t.Setenv("POSTGRES_PASSWORD", "disposable-only")
			t.Setenv("DB_ADMIN_USER", owner)
			t.Setenv("DB_USER", owner)
			t.Setenv("PATH", "/usr/lib/postgresql/16/bin:"+os.Getenv("PATH"))
			for _, role := range []string{"BASIC", "GUEST", "READONLY", "CONFIDENTIAL"} {
				t.Setenv("DB_"+role+"_USER", prefix+"_"+strings.ToLower(role))
				t.Setenv("DB_"+role+"_PASSWORD", "disposable-only")
			}
			command := exec.Command("bash", filepath.Join("..", "..", "..", "..", "server_tools", "db_init", "03_create_roles.sh"))
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("roles: %v: %s", err, output)
			}
			for _, reconcile := range []func(*sql.DB) error{backend.EnsureGuestAndPrivilegeViewWriteRevocations, backend.EnsureAccountTableWriteRevocations, backend.EnsureRowGroupRuntimeRolePermissions} {
				if err := reconcile(db); err != nil {
					t.Fatal(err)
				}
			}
			for _, suffix := range []string{"basic", "guest", "readonly", "confidential"} {
				runtime := connect(prefix + "_" + suffix)
				var count int
				if err := runtime.QueryRow("SELECT count(*) FROM system_row_actor_columns").Scan(&count); err != nil || count != 32 {
					t.Fatalf("%s marks: %d, %v", suffix, count, err)
				}
				if err := runtime.QueryRow("SELECT count(*) FROM system_data_repair_records").Scan(&count); err != nil || count != 0 {
					t.Fatalf("%s history: %d, %v", suffix, count, err)
				}
				// Runtime ACLs may reject before the guard; both boundaries must
				// keep this forged write out after startup has reconciled them.
				if _, err := runtime.Exec("UPDATE system_row_actor_columns SET column_name='bad' WHERE table_uid=7"); err == nil {
					t.Fatalf("%s changed actor marks", suffix)
				}
			}
			if _, err := db.Exec("ALTER ROLE " + prefix + "_confidential BYPASSRLS"); err != nil {
				t.Fatal(err)
			}
			if err := backend.EnsureGuestAndPrivilegeViewWriteRevocations(db); err == nil || !strings.Contains(err.Error(), prefix+"_confidential") {
				t.Fatalf("bypass role not named: %v", err)
			}
			if _, err := db.Exec("ALTER ROLE " + prefix + "_confidential NOBYPASSRLS"); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := db.QueryRow("SELECT count(*) FROM app_check_row_actor_marks()").Scan(&count); err != nil || count != 0 {
				t.Fatalf("final check: %d %v", count, err)
			}
		})
	}
}
