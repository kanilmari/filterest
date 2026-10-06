// grant_reconciler_test.go
// Exercises delta application, identifier escaping, postcheck and scoped refusals.
// Uses a catalogue driver to test transaction SQL without database/network access.
// Real privilege semantics are covered by the opt-in PostgreSQL suite.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants/granttest"
)

func TestGrantStatementsQuoteEveryIdentifier(t *testing.T) {
	s := policyFixture()
	s.Roles[0].Name = `role "quoted"; SELECT 1`
	s.Objects[10] = Object{OID: 10, Kind: "table", Schema: `schema "a"`, Name: `table; "b"`, DatasetUID: 1, Columns: []Column{{Name: `column "c"`}}}
	f := Finding{Role: "basic", Kind: "column", ObjectOID: 10, Column: `column "c"`, Privilege: "UPDATE"}
	got, err := grantStatement(s, f, false)
	want := `GRANT UPDATE ("column ""c""") ON TABLE "schema ""a"""."table; ""b""" TO "role ""quoted""; SELECT 1"`
	if err != nil || got != want {
		t.Fatalf("%s %v", got, err)
	}
	f.Privilege = "UPDATE; DROP TABLE x"
	if _, err := grantStatement(s, f, false); err == nil {
		t.Fatal("unvalidated privilege accepted")
	}
	f.Privilege = "SELECT"
	if _, err := grantStatement(s, f, true); err == nil {
		t.Fatal("read revocation accepted")
	}
	f.Role = "readonly"
	if _, err := grantStatement(s, f, false); err == nil {
		t.Fatal("readonly ACL mutation accepted")
	}
}

func TestMutationBlockersStayWithOwnDependencyClosure(t *testing.T) {
	for _, kind := range []string{"table", "trigger", "route", "metadata"} {
		t.Run(kind, func(t *testing.T) {
			s := policyFixture()
			s.Rights = []Right{{2, 1, 1}}
			finding := Finding{Role: "policy", ObjectOID: 12, Kind: "table", Object: s.Objects[12].Identifier(), Finding: "blocker", Reason: "unreviewed object"}
			switch kind {
			case "trigger":
				finding.Kind = "trigger"
				finding.ObjectOID = 999
			case "route":
				s.Functions[9] = Function{ID: 9, Route: "/api/unknown-write", TableRelated: true}
				s.Rights = append(s.Rights, Right{2, 9, 3})
				finding = unclassifiedRouteFindings(s)[0]
			case "metadata":
				finding.ObjectOID = 999
				finding.Object = "public.system_foreign_key_relations_1_m"
				finding.ScopeOIDs = [3]int64{12}
			}
			s.Blockers = []Finding{finding}
			checks, findings, err := reconciliationChecks(s, nil, []int64{10})
			if err != nil || !HasBlockers(findings) {
				t.Fatal("outside blocker refused unrelated save", err, findings)
			}
			for _, check := range checks {
				if check.ObjectOID == 12 {
					t.Fatal("blocked object's ACL remains mutable")
				}
			}
			s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 12, Kind: "label", When: Read, Columns: []string{"id"}}}
			_, _, err = reconciliationChecks(s, nil, []int64{10})
			var blocked *ScopeBlocker
			if !errors.As(err, &blocked) {
				t.Fatal("inside blocker accepted", err)
			}
		})
	}
	before := policyFixture()
	before.Rights = []Right{{2, 2, 1}}
	after := before
	after.Rights = nil
	if changed := ChangedDatasetOIDs(before, after); len(changed) != 1 || changed[0] != 10 {
		t.Fatal("last removed target lost", changed)
	}
}

type applierDriver struct {
	snapshot     GrantSnapshot
	present      map[string]bool
	statements   []string
	ignoreWrites bool
	unsafeRole   string
}
type applierConn struct{ state *applierDriver }
type applierTx struct{}

func (d *applierDriver) Open(string) (driver.Conn, error)             { return &applierConn{d}, nil }
func (d *applierDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d *applierDriver) Driver() driver.Driver                        { return d }
func (*applierConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*applierConn) Close() error              { return nil }
func (*applierConn) Begin() (driver.Tx, error) { return applierTx{}, nil }
func (applierTx) Commit() error                { return nil }
func (applierTx) Rollback() error              { return nil }
func (c *applierConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	s := c.state.snapshot
	result := &metadataTestRows{}
	switch {
	case strings.Contains(query, "FROM pg_roles WHERE rolname=$1"):
		result.columns = 2
		for _, role := range s.Roles {
			if args[0].Value == role.Name {
				result.rows = [][]driver.Value{{role.OID, role.Label == c.state.unsafeRole}}
			}
		}
	case query == effectivePrivilegesSQL:
		result.columns = 9
		var checks []Check
		if err := json.Unmarshal([]byte(args[1].Value.(string)), &checks); err != nil {
			return nil, err
		}
		for _, check := range checks {
			present := c.state.present[grantKey(check.Grant)]
			if check.Kind == "column" {
				present = present || c.state.present[grantKey(Grant{Role: check.Role, Kind: "table", ObjectOID: check.ObjectOID, Privilege: check.Privilege})]
			}
			if present != check.Wanted {
				result.rows = append(result.rows, []driver.Value{check.Role, check.Kind, check.ObjectOID, check.Column, check.Privilege, check.Wanted, present, check.Managed, check.Reason})
			}
		}
	case strings.HasPrefix(query, "SELECT COALESCE(string_agg(row_to_json"):
		result.columns = 1
		result.rows = [][]driver.Value{{"outside ACLs"}}
	case query == directACLsSQL:
		result.columns = 10
	case query == defaultACLsSQL:
		result.columns = 8
	case strings.Contains(query, "SELECT c.oid,c.conrelid"):
		result.columns = 5
		if _, ok := s.Objects[11]; ok {
			result.rows = [][]driver.Value{{int64(20), int64(10), int64(11), "id", "id"}}
		}
	case query == objectsSQL:
		result.columns = 6
		for _, o := range s.Objects {
			result.rows = append(result.rows, []driver.Value{o.OID, o.Schema, o.Name, o.Kind, o.Protected, o.Extension})
		}
	case strings.Contains(query, "SELECT a.attrelid,a.attname"):
		result.columns = 4
		for _, o := range s.Objects {
			for _, column := range o.Columns {
				result.rows = append(result.rows, []driver.Value{o.OID, column.Name, column.Text, column.Identity})
			}
		}
	case strings.Contains(query, "FROM public.system_db_tables d ORDER BY d.id"):
		result.columns = 6
		for _, o := range s.Objects {
			if o.DatasetUID > 0 {
				result.rows = append(result.rows, []driver.Value{o.OID, o.DatasetUID, o.Schema, o.Name, o.OID, o.DisplayColumn})
			}
		}
	case strings.Contains(query, "FROM public.system_functions ORDER BY id"):
		result.columns = 5
		for _, f := range s.Functions {
			result.rows = append(result.rows, []driver.Value{f.ID, f.Route, false, f.UIOnly, f.TableRelated})
		}
	case strings.Contains(query, "SELECT id,user_group_id,function_id,target_table_uid"):
		result.columns = 4
		for i, r := range s.Rights {
			result.rows = append(result.rows, []driver.Value{int64(i + 1), r.GroupID, r.FunctionID, r.DatasetUID})
		}
	default:
		if rows, ok := granttest.SnapshotQuery(query, args); ok {
			return rows, nil
		}
		return nil, errors.New("unexpected catalogue query: " + query)
	}
	return result, nil
}
func (c *applierConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.state.statements = append(c.state.statements, query)
	if !c.state.ignoreWrites {
		for _, role := range c.state.snapshot.Roles {
			for _, object := range c.state.snapshot.Objects {
				for _, kind := range []string{"table", "column"} {
					for _, column := range append([]Column{{}}, object.Columns...) {
						for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "TRIGGER", "TRUNCATE"} {
							if kind == "table" && column.Name != "" || kind == "column" && column.Name == "" {
								continue
							}
							f := Finding{Role: role.Label, Kind: kind, ObjectOID: object.OID, Column: column.Name, Privilege: privilege}
							for _, revoke := range []bool{true, false} {
								expected, err := grantStatement(c.state.snapshot, f, revoke)
								if err == nil && expected == query {
									c.state.present[grantKey(Grant{Role: f.Role, Kind: f.Kind, ObjectOID: f.ObjectOID, Column: f.Column, Privilege: f.Privilege})] = !revoke
								}
							}
						}
					}
				}
			}
		}
	}
	return driver.RowsAffected(0), nil
}

func TestApplierRevokesThenRestoresColumnsAndPostchecks(t *testing.T) {
	for _, ignoreWrites := range []bool{false, true} {
		t.Run(map[bool]string{false: "apply-and-idempotence", true: "failed-postcheck"}[ignoreWrites], func(t *testing.T) {
			s := policyFixture()
			s.Objects = map[int64]Object{10: s.Objects[10], 11: s.Objects[11]}
			s.Rights = []Right{{2, 2, 1}, {2, 1, 2}}
			config := RoleConfiguration{Names: map[string]string{}}
			for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
				s.Roles[i].Name = key
				config.Names[s.Roles[i].Label] = key
				s.Roles[i].OID = int64(i + 1)
			}
			state := &applierDriver{snapshot: s, present: map[string]bool{}, ignoreWrites: ignoreWrites}
			state.present[grantKey(Grant{Role: "basic", Kind: "table", ObjectOID: 11, Privilege: "UPDATE"})] = true
			db := sql.OpenDB(state)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			result, err := ReconcileRuntimeGrants(context.Background(), tx, config)
			if ignoreWrites {
				if err == nil || !strings.Contains(err.Error(), "postcheck failed") {
					t.Fatal("surviving managed delta accepted", err)
				}
				return
			}
			if err != nil || result.Applied == 0 {
				t.Fatal(result, err)
			}
			if !strings.HasPrefix(state.statements[0], "REVOKE UPDATE") {
				t.Fatal("writes were not revoked first", state.statements)
			}
			if !state.present[grantKey(Grant{Role: "basic", Kind: "column", ObjectOID: 11, Column: "id", Privilege: "UPDATE"})] {
				t.Fatal("table revoke lost desired column UPDATE", state.statements)
			}
			second, err := ReconcileRuntimeGrants(context.Background(), tx, config)
			if err != nil || second.Applied != 0 {
				t.Fatal("second pass had delta", second, err)
			}
		})
	}
}

func TestPolicyLockTimeoutPrecedesBarrierAndObservesCancellation(t *testing.T) {
	state := &applierDriver{snapshot: GrantSnapshot{}, present: map[string]bool{}}
	db := sql.OpenDB(state)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := LockRuntimeGrantPolicy(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(state.statements) != 4 || !strings.Contains(state.statements[1], "pg_advisory_xact_lock_shared") || !strings.Contains(state.statements[3], "filterest.runtime_role_write_revocations") || state.statements[0] != `SET LOCAL lock_timeout = '5s'` || !strings.Contains(state.statements[1], "pg_advisory_xact_lock") {
		t.Fatal(state.statements)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := LockRuntimeGrantPolicy(ctx, tx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled request entered barrier", err)
	}
}

func TestApplierReportsRetainedOperationalReads(t *testing.T) {
	snapshot := policyFixture()
	grant := Grant{Role: "basic", Kind: "table", ObjectOID: 10, Privilege: "SELECT"}
	state := &applierDriver{snapshot: snapshot, present: map[string]bool{grantKey(grant): true}}
	db := sql.OpenDB(state)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	findings, err := effectiveDifferences(context.Background(), tx, snapshot, []Check{{Grant: grant, Wanted: false, Managed: false}})
	if err != nil || len(findings) != 1 || findings[0].Finding != "excess_read_reported" || managedDelta(findings[0]) {
		t.Fatal("retained operational read was omitted from the excess-read report", findings, err)
	}
}

func (c *applierConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) { return c.Begin() }
