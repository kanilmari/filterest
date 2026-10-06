// startup_reconciler_test.go
// Proves legacy uncertainty can protect revocations without losing known grants.
// Structural failures refuse the entire startup before any ACL write.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func TestStartupBlockersPreserveWritesAndKeepRequiredGrants(t *testing.T) {
	s := policyFixture()
	s.Objects[14] = Object{OID: 14, Kind: "table", Schema: "restricted", Name: "users_restricted", Columns: []Column{{Name: "id"}}}
	s.Rights = []Right{{2, 2, 1}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 12, When: Insert, Kind: "automation"}}
	checks, _, err := mutationPolicyChecks(s)
	if err != nil {
		t.Fatal(err)
	}
	findings := []Finding{{Kind: "trigger", Object: s.Objects[10].Identifier(), Finding: "blocker", Reason: "reviewed function owned by another trusted role"}, {Kind: "table", Finding: "blocker", Reason: "row id 999: missing table_uid=999"}}
	filtered, err := filterBlockedChecks(s, nil, nil, checks, findings, true)
	if err != nil {
		t.Fatal(err)
	}
	wanted := map[string]bool{}
	for _, check := range filtered {
		if check.Wanted {
			wanted[grantKey(check.Grant)] = true
		}
		if (check.ObjectOID == 10 || check.ObjectOID == 12) && check.Managed {
			t.Fatal("revocation remains on legacy dependency closure", check)
		}
	}
	for _, check := range checks {
		if check.Wanted && !wanted[grantKey(check.Grant)] {
			t.Fatal("startup excluded a required positive grant", check)
		}
	}
	for _, role := range []string{"readonly", "confidential"} {
		found := false
		for _, check := range filtered {
			if check.Role == role && check.Wanted {
				found = true
			}
		}
		if !found {
			t.Fatal("startup omitted former role contract", role)
		}
	}
}

func TestStartupRefusesStructuralConfigurationWithoutACLChanges(t *testing.T) {
	s := policyFixture()
	checks, _, err := mutationPolicyChecks(s)
	if err != nil {
		t.Fatal(err)
	}
	_, err = filterBlockedChecks(s, nil, nil, checks, []Finding{{Finding: "blocker", Reason: "runtime identity inherits rights"}}, true)
	if err == nil {
		t.Fatal("unsafe structural identity accepted")
	}
	db, state := granttestOpenMissingRole(t)
	defer db.Close()
	_, err = EnsureRuntimeRoleGrants(context.Background(), db, RoleConfiguration{Names: map[string]string{}})
	if err == nil || !strings.Contains(err.Error(), "basic") {
		t.Fatal("missing role not named", err)
	}
	for _, statement := range state.statements {
		if strings.Contains(statement, "GRANT ") || strings.Contains(statement, "REVOKE ") || strings.Contains(statement, "ALTER DEFAULT") {
			t.Fatal("partial ACL change before structural failure", statement)
		}
	}
}

func granttestOpenMissingRole(t *testing.T) (*sql.DB, *applierDriver) {
	t.Helper()
	state := &applierDriver{snapshot: policyFixture(), present: map[string]bool{}}
	db := sql.OpenDB(state)
	return db, state
}

func TestStartupUnsafeRoleRefusalNamesIdentityWithoutACLChanges(t *testing.T) {
	snapshot := policyFixture()
	config := RoleConfiguration{Names: map[string]string{}}
	for i, role := range snapshot.Roles {
		snapshot.Roles[i].Name = "configured_" + role.Label
		config.Names[role.Label] = snapshot.Roles[i].Name
	}
	state := &applierDriver{snapshot: snapshot, present: map[string]bool{}, unsafeRole: "confidential"}
	db := sql.OpenDB(state)
	defer db.Close()
	for _, validate := range []func() error{
		func() error { return ValidateStartupRoleConfiguration(context.Background(), db, config) },
		func() error { _, err := EnsureRuntimeRoleGrants(context.Background(), db, config); return err },
	} {
		if err := validate(); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%q", config.Names["confidential"])) {
			t.Fatalf("unsafe role was not named: %v", err)
		}
	}
	for _, statement := range state.statements {
		if strings.Contains(statement, "GRANT ") || strings.Contains(statement, "REVOKE ") || strings.Contains(statement, "ALTER DEFAULT") {
			t.Fatalf("unsafe identity changed ACLs: %s", statement)
		}
	}
}
