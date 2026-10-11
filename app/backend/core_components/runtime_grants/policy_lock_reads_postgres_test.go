// policy_lock_reads_postgres_test.go
// Calls actual folder and permission GET handlers during a held policy lock.
// Reuses the disposable bootstrap, session and request transaction middleware.
// Checks that ordinary reads finish while the writer still owns its lock.
package runtime_grants_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/reusable_components/vanilla_tree"
)

func TestPolicyLockDoesNotBlockFolderAndPermissionReadsPostgres(t *testing.T) {
	fixture := newMutationHooksFixture(t)
	holder, err := fixture.owner.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if err := runtime_grants.LockRuntimeGrantPolicy(context.Background(), holder); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, path string
		handler    http.HandlerFunc
	}{
		{"folders", "/api/tree_data", vanilla_tree.GetTreeDataHandler},
		{"permissions", "/api/permissions", backend.PermissionsHandler},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			request := concurrentAdminRequest(t, ctx, test.path, "")
			request.Method = http.MethodGet
			response := httptest.NewRecorder()
			started := time.Now()
			middlewares.WithLazyTransaction(test.handler).ServeHTTP(response, request)
			if response.Code != http.StatusOK || time.Since(started) >= 2*time.Second {
				t.Fatalf("read did not finish during held policy lock: %s HTTP %d %s", time.Since(started), response.Code, response.Body)
			}
			if test.name == "folders" {
				var body struct {
					Nodes []vanilla_tree.TreeNode `json:"nodes"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				folders := 0
				for _, node := range body.Nodes {
					if len(node.ID) > 2 && node.ID[:2] == "f_" {
						folders++
					}
				}
				if folders == 0 {
					t.Fatal("read returned no folder choices")
				}
			}
			t.Logf("read completed in %s while writer retained policy lock", time.Since(started))
		})
	}
}
