// blocker_scope_identity_test.go
// Proves diagnostic drift cannot turn an unrelated metadata save into a refusal.
// Loads an old two-missing-column automation through the real scoped reconciler.
// Canonical endpoint sets ignore order/duplicates but still detect real changes.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type blockerScopeDriver struct {
	applierDriver
	target string
}
type blockerScopeConn struct {
	applierConn
	fixture *blockerScopeDriver
}

func (d *blockerScopeDriver) Connect(context.Context) (driver.Conn, error) {
	return &blockerScopeConn{applierConn{&d.applierDriver}, d}, nil
}

func (c *blockerScopeConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT id,source_table,target_table,action_values"):
		return &metadataTestRows{columns: 4, rows: [][]driver.Value{{int64(7), "fresh_dataset", c.fixture.target, []byte(`{"missing_z":1,"missing_a":2}`)}}}, nil
	case strings.Contains(query, "SELECT source_table,target_table FROM public.system_triggers WHERE id="):
		return &metadataTestRows{columns: 2, rows: [][]driver.Value{{"fresh_dataset", c.fixture.target}}}, nil
	}
	return c.applierConn.QueryContext(ctx, query, args)
}

func TestScopedReconcilerIgnoresBlockerReasonDriftButDetectsEndpointChanges(t *testing.T) {
	for _, changeEndpoint := range []bool{false, true} {
		t.Run(map[bool]string{false: "reason only", true: "real endpoint change"}[changeEndpoint], func(t *testing.T) {
			snapshot := policyFixture()
			snapshot.Objects[90] = Object{OID: 90, Schema: "public", Name: "system_triggers", Kind: "table"}
			config := RoleConfiguration{Names: map[string]string{}}
			for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
				snapshot.Roles[i].Name, snapshot.Roles[i].OID = key, int64(i+1)
				config.Names[snapshot.Roles[i].Label] = key
			}
			state := &blockerScopeDriver{applierDriver: applierDriver{snapshot: snapshot, present: map[string]bool{}}, target: "fresh_target"}
			db := sql.OpenDB(state)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			before, err := LoadMutationSnapshot(context.Background(), tx, config)
			if err != nil || len(before.Blockers) != 1 {
				t.Fatal(before.Blockers, err)
			}
			if before.Blockers[0].Reason != "row id 7: missing automation destination column missing_a" {
				t.Fatal("automation diagnostic was not deterministic", before.Blockers)
			}
			// Simulate the former map-order wording drift independently of sorting
			// in the reader. Also prove resolved endpoint ordering is immaterial.
			before.Blockers[0].Reason = "row id 7: missing automation destination column missing_z"
			before.Blockers[0].ScopeOIDs = [3]int64{11, 10, 11}
			if changeEndpoint {
				state.target = "fresh_bridge"
			}
			after, err := LoadMutationSnapshot(context.Background(), tx, config)
			if err != nil {
				t.Fatal(err)
			}
			changed := ChangedDatasetOIDs(before, after)
			sort.Slice(changed, func(i, j int) bool { return changed[i] < changed[j] })
			if changeEndpoint && !reflect.DeepEqual(changed, []int64{10, 11, 12}) || !changeEndpoint && len(changed) != 0 {
				t.Fatal("incorrect blocker scope change", changed)
			}
			for _, reconcile := range []func(context.Context, *sql.Tx, RoleConfiguration, *GrantSnapshot, []int64) (ReconcileResult, error){ReconcileRuntimeGrantsScoped, ReconcileHTTPRuntimeGrantsScoped} {
				result, err := reconcile(context.Background(), tx, config, &before, []int64{})
				var blocked *ScopeBlocker
				if errors.As(err, &blocked) != changeEndpoint || err != nil && !changeEndpoint || !HasBlockers(result.Findings) {
					t.Fatal("generic request locality or diagnostics changed", result, err)
				}
			}
		})
	}
}

func TestBlockerScopeIdentityUsesCanonicalResolvedEndpoints(t *testing.T) {
	snapshot := policyFixture()
	old := Finding{Finding: "blocker", Kind: "table", ObjectOID: 90, Object: `"public"."system_triggers"`, ScopeOIDs: [3]int64{10, 11}, Reason: "row id 7: old wording"}
	before := snapshot
	before.Blockers = []Finding{old}
	for _, test := range []struct {
		name      string
		endpoints [3]int64
		changed   bool
	}{
		{"order and duplicates", [3]int64{11, 10, 10}, false},
		{"added endpoint", [3]int64{10, 11, 12}, true},
		{"removed endpoint", [3]int64{10}, true},
		{"replaced endpoint", [3]int64{10, 12}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := old
			current.Reason, current.ScopeOIDs = "row id 7: new wording", test.endpoints
			after := snapshot
			after.Blockers = []Finding{current}
			if got := ChangedDatasetOIDs(before, after); (len(got) != 0) != test.changed {
				t.Fatal(got)
			}
		})
	}
}
