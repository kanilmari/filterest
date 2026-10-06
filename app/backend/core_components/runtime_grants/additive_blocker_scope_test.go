// additive_blocker_scope_test.go
// Guards application grants downstream of an unrelated unreviewed account trigger.
// Covers old dependencies, sequence grants and required-check/postcheck refusals.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

func TestIndirectBlockersRetainRequiredChecksAndSkipRevocations(t *testing.T) {
	for _, oldGraph := range []bool{false, true} {
		t.Run(map[bool]string{false: "current dependency", true: "removed dependency"}[oldGraph], func(t *testing.T) {
			s := policyFixture()
			s.Objects[90] = Object{OID: 90, Schema: "public", Name: "system_users", Kind: "table"}
			s.Objects[91] = Object{OID: 91, Schema: "public", Name: "fresh_dataset_id_seq", Kind: "sequence"}
			s.Sequences = []SequenceUse{{TableOID: 10, SequenceOID: 91, Column: "id", NextValue: true}}
			s.Rights = []Right{{2, 1, 1}, {2, 2, 1}}
			s.Blockers = []Finding{{Role: "policy", Kind: "trigger", ObjectOID: 999,
				Object: s.Objects[90].Identifier(), Finding: "blocker", Reason: "unreviewed trigger SQL side effects"}}
			dep := Dependency{SourceOID: 90, TargetOID: 10, Kind: "automation", When: Insert}
			var before *GrantSnapshot
			if oldGraph {
				old := s
				old.Dependencies = []Dependency{dep}
				before = &old
			} else {
				s.Dependencies = []Dependency{dep}
			}
			checks, _, err := reconciliationChecks(s, before, []int64{10})
			if err != nil {
				t.Fatal(err)
			}
			wanted := map[string]bool{}
			for _, check := range checks {
				if check.ObjectOID == 90 {
					t.Fatal("directly unknown object's ACL can change", check)
				}
				if check.ObjectOID == 10 || check.ObjectOID == 91 {
					if check.Managed {
						t.Fatal("uncertain requirement permits a revocation", check)
					}
					if check.Wanted {
						wanted[check.Privilege] = true
					}
				}
			}
			for _, privilege := range []string{"SELECT", "INSERT", "USAGE"} {
				if !wanted[privilege] {
					t.Fatal("required application grant disappeared", privilege)
				}
			}
		})
	}
}

type additiveScopeDriver struct{ applierDriver }
type additiveScopeConn struct{ applierConn }

func (d *additiveScopeDriver) Connect(context.Context) (driver.Conn, error) {
	return &additiveScopeConn{applierConn{&d.applierDriver}}, nil
}

func (c *additiveScopeConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "SELECT t.oid,t.tgrelid,md5"):
		return &metadataTestRows{columns: 4, rows: [][]driver.Value{{int64(999), int64(90), "unknown", false}}}, nil
	case strings.Contains(query, "SELECT id,source_table,target_table,action_values"):
		return &metadataTestRows{columns: 4, rows: [][]driver.Value{{int64(7), "system_users", "fresh_dataset", []byte(`{}`)}}}, nil
	}
	return c.applierConn.QueryContext(ctx, query, args)
}

func TestScopedApplierAddsKnownGrantsWithoutRevokingIndirectExcess(t *testing.T) {
	for _, ignore := range []bool{false, true} {
		t.Run(map[bool]string{false: "grants applied", true: "missing grants refuse"}[ignore], func(t *testing.T) {
			s := policyFixture()
			s.Objects[90] = Object{OID: 90, Schema: "public", Name: "system_users", Kind: "table"}
			s.Objects[92] = Object{OID: 92, Schema: "public", Name: "system_triggers", Kind: "table"}
			s.Rights = []Right{{2, 1, 1}, {2, 2, 1}}
			config := RoleConfiguration{Names: map[string]string{}}
			for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
				s.Roles[i].Name, s.Roles[i].OID = key, int64(i+1)
				config.Names[s.Roles[i].Label] = key
			}
			excess := Grant{Role: "basic", Kind: "table", ObjectOID: 10, Privilege: "DELETE"}
			state := &additiveScopeDriver{applierDriver{snapshot: s, present: map[string]bool{grantKey(excess): true}, ignoreWrites: ignore}}
			db := sql.OpenDB(state)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			before, err := LoadMutationSnapshot(context.Background(), tx, config)
			if err != nil {
				t.Fatal(err)
			}
			result, err := ReconcileHTTPRuntimeGrantsScoped(context.Background(), tx, config, &before, []int64{10})
			if ignore {
				var refused *ScopeBlocker
				if !errors.As(err, &refused) || len(result.RequestFindings) == 0 {
					t.Fatal("absent required grants were accepted or refusal was not logged", err, result)
				}
				return
			}
			if err != nil || result.Applied == 0 {
				t.Fatal(err, result)
			}
			for _, privilege := range []string{"SELECT", "INSERT", "DELETE"} {
				if !state.present[grantKey(Grant{Role: "basic", Kind: "table", ObjectOID: 10, Privilege: privilege})] {
					t.Fatal("required or preserved privilege absent", privilege, state.statements)
				}
			}
			for _, statement := range state.statements {
				if strings.HasPrefix(statement, "REVOKE ") && strings.Contains(statement, s.Objects[10].Identifier()) {
					t.Fatal("excluded dataset lost an excess write", statement)
				}
			}
			second, err := ReconcileHTTPRuntimeGrantsScoped(context.Background(), tx, config, &before, []int64{10})
			if err != nil || second.Applied != 0 {
				t.Fatal("additive reconciliation is not idempotent", second, err)
			}
		})
	}
}

func TestRequiredRequestGrantCheckCannotBeDropped(t *testing.T) {
	s := policyFixture()
	check := Check{Grant: Grant{Role: "basic", ObjectOID: 10, Kind: "table", Privilege: "INSERT"}, Wanted: true}
	var refused *ScopeBlocker
	if err := requireRequestGrantChecks(s, map[int64]bool{10: true}, []Check{check}, nil); !errors.As(err, &refused) {
		t.Fatal("request accepted with no required grant check", err)
	}
	if err := requireRequestGrantChecks(s, map[int64]bool{11: true}, []Check{check}, nil); err != nil {
		t.Fatal("outside required check refused unrelated request", err)
	}
}
