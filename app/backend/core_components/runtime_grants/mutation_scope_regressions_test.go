// mutation_scope_regressions_test.go
// Guards creation scope and independent users/guests provisioning after PostgreSQL review.
// Exercises registry row identities and the real reconciler with the catalogue driver.
// Keeps global diagnostics and generic metadata refusals alongside explicit request roots.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestRegistryRowBlockersUseDatasetEndpoints(t *testing.T) {
	s := policyFixture()
	s.Objects[30] = Object{OID: 30, Schema: "public", Name: "system_db_tables", Kind: "table"}
	s.Rights = []Right{{2, 1, 1}}
	s.Blockers = []Finding{{Role: "policy", Kind: "table", ObjectOID: 30,
		Object: s.Objects[30].Identifier(), Finding: "blocker",
		Reason: `row id 209: missing snapshot identity table_uid=209 ("public"."spatial_ref_sys")`}}
	checks, findings, err := reconciliationChecks(s, nil, []int64{10, 30})
	if err != nil || !HasBlockers(findings) || len(checks) == 0 {
		t.Fatal("unrelated registry row blocked dataset or disappeared from diagnostics", err, findings)
	}
	// The absent table has no physical OID, but explicitly changing its own
	// metadata must still refuse, without making the whole registry its scope.
	_, _, err = reconciliationChecks(s, nil, []int64{DatasetScopeIdentity(s, 209)})
	var blocked *ScopeBlocker
	if !errors.As(err, &blocked) {
		t.Fatal("request targeting the dangling dataset was accepted", err)
	}
	// A damaged relation row still refuses requests reaching a valid endpoint.
	s.Blockers[0].ScopeOIDs = [3]int64{12}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 12, Kind: "label", When: Read, Columns: []string{"id"}}}
	_, _, err = reconciliationChecks(s, nil, []int64{10})
	if !errors.As(err, &blocked) {
		t.Fatal("damaged metadata inside the dependency closure was accepted", err)
	}
}

func TestExplicitMutationScopeDoesNotAdoptIncidentalRegistryChanges(t *testing.T) {
	for _, test := range []struct {
		name  string
		scope []int64
		block bool
	}{{"own dataset", []int64{10}, false}, {"generic metadata changes", []int64{}, true}, {"whole catalogue", nil, true}} {
		t.Run(test.name, func(t *testing.T) {
			after := policyFixture()
			outside := after.Objects[12]
			outside.Name = "system_unclassified_fixture"
			after.Objects[12] = outside
			before := policyFixture()
			outside.DatasetUID = 0 // a shared registration refresh discovered it
			before.Objects[12] = outside
			config := RoleConfiguration{Names: map[string]string{}}
			for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
				after.Roles[i].Name, after.Roles[i].OID = key, int64(i+1)
				config.Names[after.Roles[i].Label] = key
			}
			state := &applierDriver{snapshot: after, present: map[string]bool{}}
			db := sql.OpenDB(state)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			result, err := ReconcileRuntimeGrantsScoped(context.Background(), tx, config, &before, test.scope)
			var blocked *ScopeBlocker
			if errors.As(err, &blocked) != test.block || err != nil && !test.block || !HasBlockers(result.Findings) {
				t.Fatal("request roots or global diagnostics changed", err, result.Findings)
			}
		})
	}
}

func TestNamedGuestRightsDoNotProvisionBasicPool(t *testing.T) {
	for _, guestGroupID := range []int64{3, 4} {
		s := policyFixture()
		s.GuestGroupID = guestGroupID
		s.GuestGroups = map[int64]bool{guestGroupID: true, 5: true}
		s.Rights = []Right{{guestGroupID, 1, 1}, {5, 1, 2}}
		grants := grantsFor(t, s)
		if containsGrant(grants, "basic", 10, "", "SELECT") || !containsGrant(grants, "guest", 10, "", "SELECT") {
			t.Fatal("guest-only read provisioned the ordinary pool", guestGroupID, grants)
		}
		if !containsGrant(grants, "basic", 11, "", "SELECT") || !containsGrant(grants, "guest", 11, "", "SELECT") {
			t.Fatal("shared ordinary/anonymous group lost its union read", grants)
		}
	}
}

func TestIncidentalRegistrationPreservesPreviouslyUnclassifiedACL(t *testing.T) {
	after := policyFixture()
	before := policyFixture()
	outside := before.Objects[12]
	outside.DatasetUID = 0
	before.Objects[12] = outside
	checks, findings, err := reconciliationChecks(after, &before, []int64{10})
	if err != nil || !HasBlockers(findings) {
		t.Fatal("old unclassified object was lost from the request's diagnostics", err, findings)
	}
	for _, check := range checks {
		if check.ObjectOID == 12 {
			t.Fatal("incidental registration allowed mutation of an unknown object's ACL")
		}
	}
}

func TestActorRowBlockersUseDatasetIdentityWithoutAnIDColumn(t *testing.T) {
	s := policyFixture()
	s.Objects[30] = Object{OID: 30, Schema: "public", Name: "system_row_actor_columns", Kind: "table"}
	s.Blockers = []Finding{{Role: "policy", Kind: "table", ObjectOID: 30,
		Object: s.Objects[30].Identifier(), Finding: "blocker",
		Reason: "row (table_uid=3, actor_role=creator): missing actor column on snapshot table"}}
	_, findings, err := reconciliationChecks(s, nil, []int64{10, 30})
	if err != nil || !HasBlockers(findings) {
		t.Fatal("unrelated actor row refused a registry writer", err, findings)
	}
	_, _, err = reconciliationChecks(s, nil, []int64{12})
	var blocked *ScopeBlocker
	if !errors.As(err, &blocked) {
		t.Fatal("own actor mark with no id column did not refuse", err)
	}
}
