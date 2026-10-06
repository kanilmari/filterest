// route_classifier_test.go
// Proves reviewed development routes and complete unknown-route diagnostics.
// Connects real handler classifications to the pure policy and read-only audit.
// Prevents chat metadata and administrator probes from broadening runtime access.
package runtime_grants

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestRemainingActiveRouteClassifications(t *testing.T) {
	for _, test := range []struct {
		id        int64
		route     string
		operation Operation
	}{
		{72411, "/api/add_foreign_key", 0},
		{72413, "/api/foreign_keys", 0},
		{72556, "/api/update-table-folder", 0},
		{72587, "/api/app/ai-chat/capabilities", 0},
		{72588, "/api/app/ai-chat/query", 0},
		{72589, "/api/app/ai-chat/conversation", 0},
		{72602, "/api/app/ai-chat/codex-query", 0},
		{82986, "/api/app/ai-chat/site-assistant-approval", 0},
	} {
		t.Run(test.route, func(t *testing.T) {
			for _, disabled := range []*bool{nil, boolPointer(false), boolPointer(true)} {
				s := policyFixture()
				s.Functions[test.id] = Function{ID: test.id, Route: test.route, Disabled: disabled, TableRelated: true}
				s.Rights = []Right{{2, test.id, 1}, {3, test.id, 1}, {1, test.id, 1}}
				s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}}
				if findings := unclassifiedRouteFindings(s); len(findings) != 0 {
					t.Fatal("reviewed route blocked", findings)
				}
				wantRead := test.operation == Read && (disabled == nil || !*disabled)
				grants := grantsFor(t, s)
				for _, role := range []string{"basic", "guest"} {
					if containsGrant(grants, role, 10, "", "SELECT") != wantRead || containsGrant(grants, role, 11, "title", "SELECT") != wantRead {
						t.Fatalf("%s dataset/label read differs from handler classification", role)
					}
					for _, privilege := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
						if containsGrant(grants, role, 10, "", privilege) {
							t.Fatal("route conferred dataset writes", role, privilege)
						}
					}
				}
			}
		})
	}
}

func TestCodingAgentAdministratorPilotRead(t *testing.T) {
	const id = 72602
	for _, disabled := range []*bool{nil, boolPointer(false), boolPointer(true)} {
		for _, group := range []int64{1, 2, 3} {
			s := policyFixture()
			pilot := s.Objects[10]
			pilot.Name = "app_service_catalog"
			s.Objects[10] = pilot
			s.Functions[id] = Function{ID: id, Route: "/api/app/ai-chat/codex-query", Disabled: disabled, TableRelated: true}
			s.Rights = []Right{{group, id, 1}, {group, id, 2}}
			s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}}
			// An administrator may hold the route right through a custom group;
			// AdminProfile still refuses an ordinary or guest request actor.
			want := disabled == nil || !*disabled
			grants := grantsFor(t, s)
			if containsGrant(grants, "basic", 10, "", "SELECT") != want || containsGrant(grants, "basic", 11, "title", "SELECT") != want {
				t.Fatal("administrator pilot probe or its label dependency lost")
			}
			for _, g := range grants {
				if g.Role == "guest" || g.Role == "basic" && (g.Privilege != "SELECT" || g.ObjectOID == 11 && g.Kind == "table") {
					t.Fatal("administrator probe broadened runtime access", g)
				}
			}
			s.Rights = nil
			s.AdminRecovery = true
			s.Functions = map[int64]Function{id: s.Functions[id]}
			if containsGrant(grantsFor(t, s), "basic", 10, "", "SELECT") != (disabled == nil || !*disabled) {
				t.Fatal("pilot administrator recovery omitted active probe")
			}
		}
	}
}

func TestUnclassifiedRoutesReportedTogetherAndAuditContinues(t *testing.T) {
	for _, withRights := range []bool{false, true} {
		config, query := metadataSnapshotQueries(nil)
		compared, provenance := false, false
		db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
			columns, rows, err := query(sql, args)
			if strings.Contains(sql, "FROM public.system_functions ORDER BY id") {
				rows = append(rows,
					[]driver.Value{int64(8), "/api/unclassified-first", nil, false, true},
					[]driver.Value{int64(9), "/api/unclassified-second", false, false, true},
					[]driver.Value{int64(10), "/api/retired-unknown", true, false, true},
					[]driver.Value{int64(11), "/api/ui-unknown", false, true, true},
					[]driver.Value{int64(12), "/api/tableless-unknown", false, false, false})
			}
			if withRights && strings.Contains(sql, "FROM public.system_group_table_func_rights") {
				rows = append(rows, []driver.Value{int64(8), int64(2), int64(8), int64(1)}, []driver.Value{int64(9), int64(3), int64(9), int64(1)})
			}
			compared = compared || sql == effectivePrivilegesSQL
			provenance = provenance || sql == directACLsSQL
			return columns, rows, err
		})
		tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		snapshot, err := LoadGrantSnapshot(context.Background(), tx, config)
		tx.Rollback()
		if err != nil {
			t.Fatal(err)
		}
		for _, policy := range []func(GrantSnapshot) (GrantSet, error){DesiredRuntimeGrants, func(s GrantSnapshot) (GrantSet, error) { return DesiredDatasetRuntimeGrants(s, 1) }} {
			if grants, err := policy(snapshot); err == nil || grants != nil {
				t.Fatal("incomplete snapshot produced grants", grants, err)
			}
			unloaded := snapshot
			unloaded.Blockers = nil
			if grants, err := policy(unloaded); err == nil || grants != nil || !strings.Contains(err.Error(), "2 unclassified") {
				t.Fatal("pure input did not refuse both unknown routes", grants, err)
			}
		}
		unknown := unclassifiedRouteFindings(snapshot)
		if len(unknown) != 2 || unknown[0].FunctionID != 8 || unknown[0].Route != "/api/unclassified-first" || unknown[1].FunctionID != 9 || unknown[1].Route != "/api/unclassified-second" {
			t.Fatal("unknown route identities were lost", unknown)
		}
		findings, err := AuditRuntimeGrants(context.Background(), db, config)
		if err != nil {
			t.Fatal(err)
		}
		var actual []Finding
		for _, finding := range findings {
			if finding.Kind == "route" {
				actual = append(actual, finding)
			}
			if finding.Finding == "blocker" && strings.Contains(finding.Reason, "unclassified active data route") && finding.Kind != "route" {
				t.Fatal("audit repeated a generic route blocker", finding)
			}
		}
		if !reflect.DeepEqual(actual, unknown) || !compared || !provenance || !hasFinding(findings, "basic", "missing", "table", 10) || !hasFinding(findings, "basic", "excess_write", "table", 11) {
			t.Fatal("audit stopped or duplicated unknown routes", findings)
		}
		var output bytes.Buffer
		if err := WriteFindings(&output, actual); err != nil {
			t.Fatal(err)
		}
		decoder := json.NewDecoder(&output)
		for _, want := range unknown {
			var got Finding
			if err := decoder.Decode(&got); err != nil || got != want {
				t.Fatal("serialized finding lost function ID/route", got, err)
			}
		}
	}
}

func TestUnclassifiedFunctionsSharingRouteRemainSeparate(t *testing.T) {
	s := policyFixture()
	s.Functions[8] = Function{ID: 8, Route: "/api/unclassified", TableRelated: true}
	s.Functions[9] = Function{ID: 9, Route: "/api/unclassified", TableRelated: true}
	if findings := unclassifiedRouteFindings(s); len(findings) != 2 || findings[0].FunctionID == findings[1].FunctionID {
		t.Fatal("function rows were collapsed by route", findings)
	}
}
