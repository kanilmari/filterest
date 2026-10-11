// concurrent_dataset_mutations_postgres_test.go
// Overlaps real dataset create/drop handlers at their transaction commit boundary.
// Reuses the disposable PostgreSQL bootstrap and production mutation middleware.
// Proves bounded policy waits preserve reconciliation and roll back refusals.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
	esessions "easelect/backend/core_components/sessions"
)

// Both calls go through Begin, BeginTx, Finish and the real commit buffer.
// Holding the first response just before middleware commit models a slow
// mutation while avoiding catalogue-size or machine-speed dependent timing.
// The second is observed in pg_locks before the six-second hold starts. Main
// 5591a1c fails at its five-second advisory lock timeout with HTTP 500.
func TestConcurrentDatasetMutationsWaitForPolicyCommitPostgres(t *testing.T) {
	for _, actions := range [][2]string{{"create", "create"}, {"create", "drop"}, {"drop", "create"}} {
		t.Run(actions[0]+"_"+actions[1], func(t *testing.T) {
			fixture := newMutationHooksFixture(t) // skips before starting PG unless explicitly opted in
			names := [2]string{"concurrent_first", "concurrent_second"}
			for i, action := range actions {
				if action == "drop" {
					fixture.create(names[i], "")
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			requests := [2]*http.Request{}
			handlers := [2]http.HandlerFunc{}
			statuses := [2]int{}
			for i, action := range actions {
				path := "/api/create_dataset"
				body := fmt.Sprintf(`{"dataset_name":%q,"folder_id":4,"grant_users_read":true,
 "column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`, names[i])
				handlers[i], statuses[i] = workflows.CreateTableHandler, http.StatusCreated
				if action == "drop" {
					path = "/api/drop-dataset"
					body = fmt.Sprintf(`{"dataset_name":%q,"confirm_dataset_name":%q}`, names[i], names[i])
					handlers[i], statuses[i] = drop.DropTableHandler, http.StatusOK
				}
				requests[i] = concurrentAdminRequest(t, ctx, path, body)
			}

			release := make(chan struct{})
			var releaseOnce sync.Once
			releaseFirst := func() { releaseOnce.Do(func() { close(release) }) }
			staged := make(chan int, 1)
			firstDone, secondDone := make(chan struct{}), make(chan struct{})
			firstResponse, secondResponse := httptest.NewRecorder(), httptest.NewRecorder()
			var workers sync.WaitGroup
			// Release and cancel before fixture cleanup, including on assertion failure.
			defer func() { releaseFirst(); cancel(); workers.Wait() }()
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer close(firstDone)
				middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					handlers[0](w, r)
					staged <- w.(interface{ StatusCode() int }).StatusCode()
					select {
					case <-release:
					case <-r.Context().Done():
					}
				})).ServeHTTP(firstResponse, requests[0])
			}()
			select {
			case status := <-staged:
				if status != statuses[0] {
					releaseFirst()
					<-firstDone
					t.Fatalf("first mutation failed before overlap: %d %s", status, firstResponse.Body)
				}
			case <-ctx.Done():
				t.Fatal("first mutation never reached its commit boundary", ctx.Err())
			}

			workers.Add(1)
			go func() {
				defer workers.Done()
				defer close(secondDone)
				middlewares.WithLazyTransaction(handlers[1]).ServeHTTP(secondResponse, requests[1])
			}()
			if err := awaitPolicyLockWaiter(ctx, fixture.owner, secondDone); err != nil {
				t.Fatal(err)
			}
			waitingSince := time.Now()
			hold := time.NewTimer(6 * time.Second)
			defer hold.Stop()
			select {
			case <-secondDone:
				t.Errorf("queued mutation returned before the first committed: %d %s", secondResponse.Code, secondResponse.Body)
			case <-hold.C:
			case <-ctx.Done():
				t.Fatal("overlap exceeded the request budget", ctx.Err())
			}
			releaseFirst()
			for _, done := range []chan struct{}{firstDone, secondDone} {
				select {
				case <-done:
				case <-ctx.Done():
					t.Fatal("overlapping mutations did not complete within 30 seconds", ctx.Err())
				}
			}
			t.Logf("second mutation waited for policy commit and completed in %s", time.Since(waitingSince))
			for i, response := range []*httptest.ResponseRecorder{firstResponse, secondResponse} {
				if response.Code != statuses[i] {
					t.Fatalf("%s %s: status=%d want=%d: %s", actions[i], names[i], response.Code, statuses[i], response.Body)
				}
				var physical, registered bool
				if err := fixture.owner.QueryRow(`SELECT to_regclass($1) IS NOT NULL,
 EXISTS(SELECT 1 FROM system_db_tables WHERE table_name=$1)`, names[i]).Scan(&physical, &registered); err != nil {
					t.Fatal(err)
				}
				wantExists := actions[i] == "create"
				if physical != wantExists || registered != wantExists {
					t.Fatalf("%s %s did not commit both DDL and metadata: physical=%v registered=%v", actions[i], names[i], physical, registered)
				}
				if wantExists {
					// The HTTP success must include actual runtime grant completion,
					// not merely a CREATE followed by a skipped reconciliation.
					fixture.privilege(names[i], "", "SELECT", true)
					fixture.privilege(names[i], "", "INSERT", false)
					fixture.privilege(names[i], "", "DELETE", false)
				}
			}
		})
	}
}

// A stuck holder must not retain the second request's transaction or connection
// indefinitely. Keep it locked through the refusal and all rollback assertions.
func TestConcurrentDatasetMutationPolicyLockTimeoutRollsBackPostgres(t *testing.T) {
	fixture := newMutationHooksFixture(t)
	runtime_grants.SetPolicyLockWaitForTest(t, 2*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	holder, err := fixture.owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if err := runtime_grants.LockRuntimeGrantPolicy(ctx, holder); err != nil {
		t.Fatal(err)
	}
	beforeACL := runtime_grants.ACLFingerprint(t, fixture.owner)
	var beforeRights int
	if err := fixture.owner.QueryRowContext(ctx, `SELECT count(*) FROM system_group_table_func_rights`).Scan(&beforeRights); err != nil {
		t.Fatal(err)
	}
	const name = "concurrent_policy_timeout"
	body := fmt.Sprintf(`{"dataset_name":%q,"folder_id":4,"grant_users_read":true,
 "column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`, name)
	request := concurrentAdminRequest(t, ctx, "/api/create_dataset", body)
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	// On assertion failure, cancel and join before fixture/global-state cleanup.
	defer func() { cancel(); <-finished }()
	started := time.Now()
	go func() {
		defer close(finished)
		middlewares.WithLazyTransaction(http.HandlerFunc(workflows.CreateTableHandler)).ServeHTTP(response, request)
	}()
	if err := awaitPolicyLockWaiter(ctx, fixture.owner, finished); err != nil {
		t.Fatal(err)
	}
	waitBudget := time.NewTimer(4 * time.Second)
	defer waitBudget.Stop()
	select {
	case <-finished:
	case <-waitBudget.C:
		t.Fatal("queued mutation exceeded the two-second test bound plus scheduling allowance")
	case <-ctx.Done():
		t.Fatal("queued mutation did not return at the policy wait bound", ctx.Err())
	}
	var refusal struct {
		Code    int    `json:"code"`
		Error   string `json:"error"`
		LangKey string `json:"error_lang_key"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &refusal); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusServiceUnavailable || refusal.Code != http.StatusServiceUnavailable || refusal.LangKey != "error_runtime_grant_policy_busy" || refusal.Error != "Another permission change is still being saved. Try again in a moment." {
		t.Fatalf("policy wait refusal: status=%d body=%s", response.Code, response.Body)
	}
	if elapsed := time.Since(started); elapsed < 2*time.Second {
		t.Fatalf("refused before the two-second wait expired: %s", elapsed)
	}
	var physical, registered bool
	var afterRights int
	if err := fixture.owner.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL,
 EXISTS(SELECT 1 FROM system_db_tables WHERE table_name=$1),
 (SELECT count(*) FROM system_group_table_func_rights)`, name).Scan(&physical, &registered, &afterRights); err != nil {
		t.Fatal(err)
	}
	if physical || registered || afterRights != beforeRights || runtime_grants.ACLFingerprint(t, fixture.owner) != beforeACL {
		t.Fatalf("refused creation leaked table, registry, rights or grants: physical=%v registered=%v rights=%d want=%d", physical, registered, afterRights, beforeRights)
	}
	// Only the deliberately held transaction may remain in use after middleware
	// rolls the request back; no waiter keeps a pooled connection or transaction.
	if inUse := fixture.owner.Stats().InUse; inUse != 1 {
		t.Fatalf("refused request retained a pooled connection: in-use=%d want=1", inUse)
	}
	if err := holder.Rollback(); err != nil {
		t.Fatal(err)
	}
	// A retry on the same pool must complete after the holder ends.
	fixture.create(name, "")
	fixture.privilege(name, "", "SELECT", true)
}

func concurrentAdminRequest(t *testing.T, ctx context.Context, path, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req = req.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin")))
	session, err := esessions.Load(req)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"], session.Values["user_role"] = 2, "admin"
	return req
}

// Observe the exact production policy lock in this database, not a guessed
// sleep after goroutine launch. No fixture connection may hold a second lock.
func awaitPolicyLockWaiter(ctx context.Context, db *sql.DB, finished <-chan struct{}) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks
 WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND classid=((hashtext('filterest.runtime_role_write_revocations')::bigint >> 32) & 4294967295)::oid
 AND objid=(hashtext('filterest.runtime_role_write_revocations')::bigint & 4294967295)::oid
 AND objsubid=1 AND mode='ExclusiveLock' AND NOT granted)`).Scan(&waiting); err != nil {
			return err
		}
		if waiting {
			return nil
		}
		select {
		case <-finished:
			return fmt.Errorf("second mutation ended without queuing on the first policy transaction")
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
