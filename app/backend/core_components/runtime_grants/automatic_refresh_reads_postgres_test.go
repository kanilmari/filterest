// automatic_refresh_reads_postgres_test.go
// Exercises no-op bootstrap refresh and real drift under an unavailable lock.
// Reuses real HTTP maintenance/creation and disposable PostgreSQL metadata.
// Proves the drift SELECT skips only a no-op and real writes keep bounded refusal.
package runtime_grants_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/system_table_tools"
)

func TestAutomaticRefreshReadsDuringHeldPolicyLockPostgres(t *testing.T) {
	fixture := newMutationHooksFixture(t)
	// This fixture imports bootstrap without installing the optional PostGIS
	// and payments relations. Scoped creation deliberately leaves their legacy
	// registry rows alone; explicit maintenance refuses their affected blockers.
	// Establish a valid catalogue BEFORE capturing any mutation snapshot, so
	// the test reaches the held-lock read rather than testing that refusal.
	runtime_grants.FixtureExec(t, fixture.owner, `DELETE FROM system_db_tables
 WHERE table_name IN ('spatial_ref_sys','payments') AND schema_name='public'
 AND to_regclass(format('%I.%I',schema_name,table_name)) IS NULL`)
	uid := fixture.create("refresh_probe", "")
	fixture.request(system_table_tools.HandleUpdateOidsAndTableNames, "", http.StatusOK)
	runtime_grants.SetPolicyLockWaitForTest(t, 2*time.Second)
	holder, err := fixture.owner.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if err := runtime_grants.LockRuntimeGrantPolicy(context.Background(), holder); err != nil {
		t.Fatal(err)
	}
	for _, changed := range []bool{false, true} {
		if changed {
			runtime_grants.FixtureExec(t, fixture.owner, `UPDATE system_column_details SET data_type='drift'
 WHERE table_uid=$1 AND column_name='title'`, uid)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		request := concurrentAdminRequest(t, ctx, "/api/update-oids?only_if_changed=true", "")
		response := httptest.NewRecorder()
		started := time.Now()
		middlewares.WithLazyTransaction(http.HandlerFunc(system_table_tools.HandleUpdateOidsAndTableNames)).ServeHTTP(response, request)
		cancel()
		elapsed := time.Since(started)
		if !changed && (response.Code != http.StatusOK || elapsed >= time.Second) {
			t.Fatalf("no-op refresh waited on held policy lock: %s HTTP %d %s", elapsed, response.Code, response.Body)
		}
		if changed && (response.Code != http.StatusServiceUnavailable || elapsed < 2*time.Second || !strings.Contains(response.Body.String(), "error_runtime_grant_policy_busy")) {
			t.Fatalf("real drift bypassed bounded mutation refusal: %s HTTP %d %s", elapsed, response.Code, response.Body)
		}
		t.Logf("catalogue changed=%t: HTTP %d in %s with policy lock held", changed, response.Code, elapsed)
	}
}
