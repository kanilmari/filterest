// dataset_grant_policy_test.go
// Proves route unions, hard denials, dependencies and additive-read audit scope.
// Supplies metadata fixtures without connections or old ACLs.
// Guards the pure policy before any grant-changing caller is introduced.
package runtime_grants

import (
	"reflect"
	"testing"
)

func boolPointer(value bool) *bool { return &value }

func policyFixture() GrantSnapshot {
	s := GrantSnapshot{Objects: map[int64]Object{}, Functions: map[int64]Function{}, Groups: map[int64]bool{1: true, 2: true, 3: true, 4: true, 5: true}, GuestGroups: map[int64]bool{3: true}, GuestGroupID: 3, Roles: []Role{{Label: "basic", OID: 101}, {Label: "guest", OID: 102}, {Label: "readonly", OID: 103}, {Label: "confidential", OID: 104}}}
	s.Objects[10] = Object{OID: 10, Schema: "public", Name: "fresh_dataset", Kind: "table", DatasetUID: 1, Columns: []Column{{Name: "id"}, {Name: "title", Text: true}, {Name: "private"}, {Name: "search_vector_simple"}}}
	s.Objects[11] = Object{OID: 11, Schema: "public", Name: "fresh_target", Kind: "table", DatasetUID: 2, Columns: []Column{{Name: "id"}, {Name: "title", Text: true}, {Name: "private"}}}
	s.Objects[12] = Object{OID: 12, Schema: "public", Name: "fresh_bridge", Kind: "table", DatasetUID: 3, Columns: []Column{{Name: "id"}, {Name: "filename"}, {Name: "parent_id"}}}
	for id, route := range []string{"/api/get-results", "/api/add-row-multipart", "/api/update-row", "/api/delete-rows"} {
		s.Functions[int64(id+1)] = Function{ID: int64(id + 1), Route: route, Disabled: boolPointer(false), TableRelated: true}
	}
	return s
}

func grantsFor(t *testing.T, s GrantSnapshot) GrantSet {
	t.Helper()
	grants, err := DesiredRuntimeGrants(s)
	if err != nil {
		t.Fatal(err)
	}
	return grants
}

func containsGrant(grants GrantSet, role string, oid int64, column, privilege string) bool {
	kind := "table"
	if column != "" {
		kind = "column"
	}
	for _, grant := range grants {
		if grant.Role == role && grant.ObjectOID == oid && grant.Column == column && grant.Privilege == privilege && (grant.Kind == kind || grant.Kind == "sequence" || grant.Kind == "schema") {
			return true
		}
	}
	return false
}

func TestEveryDataRouteMatrix(t *testing.T) {
	for route, operation := range routeOperations {
		t.Run(route, func(t *testing.T) {
			for _, disabled := range []*bool{nil, boolPointer(false), boolPointer(true)} {
				s := policyFixture()
				s.Functions[9] = Function{ID: 9, Route: route, Disabled: disabled, TableRelated: true}
				s.Rights = []Right{{GroupID: 2, FunctionID: 9, DatasetUID: 1}, {GroupID: 3, FunctionID: 9, DatasetUID: 1}}
				grants := grantsFor(t, s)
				active := disabled == nil || !*disabled
				for _, entry := range []struct {
					role, privilege string
					want            bool
				}{{"basic", "SELECT", active}, {"basic", "INSERT", active && operation == Insert}, {"basic", "UPDATE", active && operation == Update}, {"basic", "DELETE", active && operation == Delete}, {"guest", "SELECT", active && operation == Read}, {"guest", "INSERT", false}, {"guest", "UPDATE", false}, {"guest", "DELETE", false}} {
					if got := containsGrant(grants, entry.role, 10, "", entry.privilege); got != entry.want {
						t.Fatalf("%s %s got %v want %v", entry.role, entry.privilege, got, entry.want)
					}
				}
			}
		})
	}
}

func TestEmptyGroupUnionGuestIdentityAndMetadata(t *testing.T) {
	s := policyFixture()
	s.Rights = []Right{{4, 2, 1}, {5, 3, 1}, {3, 1, 1}, {1, 4, 1}}
	grants := grantsFor(t, s)
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE"} {
		if !containsGrant(grants, "basic", 10, "", privilege) {
			t.Fatal("empty declared group lost", privilege)
		}
	}
	if containsGrant(grants, "basic", 10, "", "DELETE") {
		t.Fatal("administrator rights leaked into ordinary pool")
	}
	if !containsGrant(grants, "guest", 10, "", "SELECT") {
		t.Fatal("canonical guest read missing")
	}
	s.Rights = []Right{{5, 1, 1}}
	s.GuestGroups[5] = true
	if !containsGrant(grantsFor(t, s), "guest", 10, "", "SELECT") {
		t.Fatal("guest identity group read missing")
	}
	s.Functions[9] = Function{ID: 9, Route: "/api/get-columns", TableRelated: true}
	s.Rights = []Right{{2, 9, 1}, {2, 2, 0}}
	if containsGrant(grantsFor(t, s), "basic", 10, "", "SELECT") {
		t.Fatal("metadata/tableless right granted content")
	}
	f := s.Functions[9]
	f.Route = "/api/unreviewed"
	f.UIOnly = true
	s.Functions[9] = f
	if _, err := DesiredRuntimeGrants(s); err != nil {
		t.Fatal("UI-only route blocked", err)
	}
	f.UIOnly = false
	s.Functions[9] = f
	if _, err := DesiredRuntimeGrants(s); err == nil {
		t.Fatal("unknown active data route was guessed")
	}
	s.Rights = nil
	if _, err := DesiredRuntimeGrants(s); err == nil {
		t.Fatal("unknown active data route without current rights was guessed")
	}
	f.Disabled = boolPointer(true)
	s.Functions[9] = f
	if _, err := DesiredRuntimeGrants(s); err != nil {
		t.Fatal("retired route blocked", err)
	}
}

func TestNeverCasesAndOperationalContracts(t *testing.T) {
	names := []string{"system_users", "system_user_groups", "system_user_group_memberships", "system_group_table_func_rights", "system_functions", "account_view", "systemview_privileges", "system_row_actor_columns", "system_data_repair_records", "dev_agent_worklines", "system_permission_actions", "ai_chat_conversations", "payments", "content_lang_embeddings", "system_media_assets", "system_media_asset_usages", "system_row_groups", "system_db_tables"}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			s := policyFixture()
			object := s.Objects[10]
			object.Name = name
			object.Protected = name == "account_view"
			object.Columns = append(object.Columns, Column{Name: "created"}, Column{Name: "enabled"})
			s.Objects[10] = object
			for _, id := range []int64{1, 2, 3, 4} {
				s.Rights = append(s.Rights, Right{2, id, 1}, Right{3, id, 1})
			}
			grants := grantsFor(t, s)
			for _, grant := range grants {
				if grant.ObjectOID != 10 {
					continue
				}
				if grant.Privilege == "SELECT" {
					continue
				}
				if grant.Role != "basic" {
					t.Fatal("runtime hard denial failed", grant)
				}
				if len(operationalPrivileges[name]) == 0 {
					t.Fatal("generic right bypassed hard denial", grant)
				}
			}
			for _, role := range []string{"basic", "guest", "readonly", "confidential", "PUBLIC"} {
				for _, privilege := range []string{"TRUNCATE", "REFERENCES", "TRIGGER"} {
					if containsGrant(grants, role, 10, "", privilege) {
						t.Fatal("dangerous privilege granted")
					}
				}
			}
		})
	}
	s := policyFixture()
	o := s.Objects[10]
	o.Schema = "restricted"
	o.Name = "users_restricted"
	s.Objects[10] = o
	s.Rights = []Right{{2, 2, 1}, {3, 1, 1}}
	grants := grantsFor(t, s)
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
		if !containsGrant(grants, "confidential", 10, "", privilege) {
			t.Fatal("restricted contract missing", privilege)
		}
	}
	for _, role := range []string{"basic", "guest", "readonly"} {
		if containsGrant(grants, role, 10, "", "SELECT") || containsGrant(grants, role, 10, "", "INSERT") {
			t.Fatal("restricted contract escaped")
		}
	}
	s = policyFixture()
	o = s.Objects[10]
	o.Name = "system_new_unclassified"
	s.Objects[10] = o
	if _, err := DesiredRuntimeGrants(s); err == nil {
		t.Fatal("unknown product table fell through to content")
	}
	o.Name = "dev_agent_new_unclassified"
	s.Objects[10] = o
	if _, err := DesiredRuntimeGrants(s); err == nil {
		t.Fatal("unknown dev table fell through to content")
	}
}

func TestLabelsEmbeddingsAndSharedInboundReads(t *testing.T) {
	s := policyFixture()
	s.Objects[13] = Object{OID: 13, Schema: "public", Name: "fresh_dataset_lang_embeddings", Kind: "table"}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}, {SourceOID: 12, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}, {SourceOID: 10, TargetOID: 13, Kind: "embedding", When: Read}}
	s.Rights = []Right{{2, 1, 1}, {3, 1, 1}, {4, 1, 3}}
	for _, role := range []string{"basic", "guest"} {
		grants := grantsFor(t, s)
		for _, column := range []string{"id", "title"} {
			if !containsGrant(grants, role, 11, column, "SELECT") {
				t.Fatal("label dependency missing")
			}
		}
		if containsGrant(grants, role, 11, "", "SELECT") || containsGrant(grants, role, 11, "private", "SELECT") {
			t.Fatal("label disclosed other columns")
		}
		if !containsGrant(grants, role, 13, "", "SELECT") {
			t.Fatal("embedding dependency missing")
		}
	}
	s.Rights = s.Rights[2:]
	grants, err := DesiredDatasetRuntimeGrants(s, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !containsGrant(grants, "basic", 11, "title", "SELECT") {
		t.Fatal("shared label consumer was removed")
	}
	before := policyFixture()
	_ = grantsFor(t, before)
	if !reflect.DeepEqual(before, policyFixture()) {
		t.Fatal("pure policy mutated input")
	}
}

func TestSequencesAndLockConsumerRemoval(t *testing.T) {
	s := policyFixture()
	for oid := int64(20); oid <= 23; oid++ {
		s.Objects[oid] = Object{OID: oid, Schema: "public", Name: "test_seq", Kind: "sequence", Protected: oid == 23}
	}
	s.Sequences = []SequenceUse{{10, 20, "id", true}, {10, 21, "id", false}, {10, 22, "id", true}, {10, 23, "id", true}}
	s.Rights = []Right{{2, 2, 1}, {4, 1, 2}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "lock", When: Insert | Update, Requires: Read, Columns: []string{"id"}}}
	grants := grantsFor(t, s)
	for _, oid := range []int64{20, 22} {
		if !containsGrant(grants, "basic", oid, "", "USAGE") {
			t.Fatal("serial/legacy default needs USAGE")
		}
	}
	for _, oid := range []int64{21, 23} {
		if containsGrant(grants, "basic", oid, "", "USAGE") {
			t.Fatal("identity/protected sequence acquired USAGE")
		}
	}
	if !containsGrant(grants, "basic", 11, "id", "UPDATE") || containsGrant(grants, "basic", 11, "", "UPDATE") {
		t.Fatal("row lock was not narrowed to id")
	}
	s.Rights = s.Rights[1:]
	if containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
		t.Fatal("leftover read retained mutation lock")
	}
	s.Rights = []Right{{2, 2, 1}, {4, 1, 2}}
	f := s.Functions[1]
	f.Disabled = nil
	s.Functions[1] = f
	if containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
		t.Fatal("strict related read accepted NULL-disabled")
	}
	f.Disabled = boolPointer(false)
	f.Route = "/api/get-filter-options"
	s.Functions[1] = f
	if containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
		t.Fatal("filter-options right replaced canonical related-row authorization")
	}
}

func TestChildrenBridgeAndAutomation(t *testing.T) {
	s := policyFixture()
	s.Rights = []Right{{2, 2, 1}, {4, 2, 3}, {5, 1, 2}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 12, RelatedOID: 11, Kind: "bridge", When: Insert, Requires: Insert}, {SourceOID: 10, TargetOID: 11, RelatedOID: 12, Kind: "lock", When: Insert, Requires: Read, Columns: []string{"id"}}, {SourceOID: 10, TargetOID: 12, Kind: "child", When: Insert, Requires: Insert}}
	if !containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
		t.Fatal("cross-group bridge capability lost")
	}
	s.Rights = s.Rights[1:]
	if !containsGrant(grantsFor(t, s), "basic", 12, "", "INSERT") {
		t.Fatal("parent removal erased child's stored right")
	}
	s.Rights = []Right{{2, 2, 1}, {5, 1, 2}}
	if containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
		t.Fatal("bridge lock survived last bridge add right")
	}
	s = policyFixture()
	s.Rights = []Right{{2, 2, 1}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "automation", When: Insert}, {SourceOID: 11, TargetOID: 12, Kind: "automation", When: Insert}}
	if containsGrant(grantsFor(t, s), "basic", 12, "", "INSERT") {
		t.Fatal("physical automation insert dispatched a phantom second automation")
	}
	s.Dependencies = append(s.Dependencies, Dependency{SourceOID: 12, TargetOID: 10, Kind: "automation", When: Insert})
	if _, err := DesiredRuntimeGrants(s); err != nil {
		t.Fatal("non-dispatched automation metadata cycle invented recursion", err)
	}
	s.Dependencies = s.Dependencies[:1]
	o := s.Objects[11]
	o.Name = "system_users"
	s.Objects[11] = o
	if _, err := DesiredRuntimeGrants(s); err == nil {
		t.Fatal("automation protected destination accepted")
	}
}

func TestCacheGalleryAuxiliaryWritesEndWithTheirConsumer(t *testing.T) {
	s := policyFixture()
	source := s.Objects[10]
	source.Columns = append(source.Columns, Column{Name: "filename"})
	s.Objects[10] = source
	parent := s.Objects[11]
	parent.Columns = append(parent.Columns, Column{Name: "cached_image"})
	s.Objects[11] = parent
	s.Rights = []Right{{2, 2, 1}, {3, 1, 1}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "gallery", When: Insert | Update | Delete, Columns: []string{"cached_image"}}, {SourceOID: 10, TargetOID: 11, Kind: "cache", When: Insert, Columns: []string{"title"}}, {SourceOID: 10, TargetOID: 10, Kind: "cache", When: Insert, Columns: []string{"filename"}}}
	grants := grantsFor(t, s)
	for _, column := range []string{"cached_image", "title"} {
		if !containsGrant(grants, "basic", 11, column, "UPDATE") {
			t.Fatal("required auxiliary write missing", column)
		}
	}
	if !containsGrant(grants, "basic", 10, "filename", "UPDATE") || containsGrant(grants, "basic", 11, "", "UPDATE") {
		t.Fatal("auxiliary update widened or omitted")
	}
	for _, grant := range grants {
		if grant.Role == "guest" && grant.Privilege != "SELECT" {
			t.Fatal("gallery/cache gave guest writes")
		}
	}
	s.Rights = []Right{{2, 1, 1}}
	grants = grantsFor(t, s)
	for _, column := range []string{"cached_image", "title"} {
		if containsGrant(grants, "basic", 11, column, "UPDATE") {
			t.Fatal("leftover source read retained auxiliary write")
		}
	}
}

func TestPilotAndReadOnlyAuditUniverse(t *testing.T) {
	s := policyFixture()
	o := s.Objects[10]
	o.Name = "app_service_catalog"
	s.Objects[10] = o
	s.Rights = []Right{{1, 3, 1}, {4, 2, 1}}
	grants := grantsFor(t, s)
	if !containsGrant(grants, "basic", 10, "", "UPDATE") || !containsGrant(grants, "basic", 10, "", "INSERT") {
		t.Fatal("pilot exception dropped admin or ordinary union")
	}
	s.Rights = []Right{{1, 2, 1}, {1, 1, 2}, {1, 2, 3}}
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "lock", When: Insert, Requires: Read, Columns: []string{"id"}}, {SourceOID: 10, TargetOID: 12, Kind: "child", When: Insert, Requires: Insert}}
	grants = grantsFor(t, s)
	if !containsGrant(grants, "basic", 11, "id", "UPDATE") || !containsGrant(grants, "basic", 12, "", "INSERT") {
		t.Fatal("pilot administrator target dependencies did not use basic")
	}
	s.Dependencies = nil
	grants = grantsFor(t, s)
	if containsGrant(grants, "basic", 11, "", "SELECT") || containsGrant(grants, "basic", 12, "", "INSERT") {
		t.Fatal("unrelated administrator rights entered basic")
	}
	s.Rights = nil
	s.AdminRecovery = true
	if !containsGrant(grantsFor(t, s), "basic", 10, "", "DELETE") {
		t.Fatal("configured pilot recovery not reachable")
	}
	s = policyFixture()
	s.Rights = []Right{{2, 2, 1}}
	checks, err := BuildGrantChecks(s, grantsFor(t, s))
	if err != nil {
		t.Fatal(err)
	}
	for _, check := range checks {
		if check.ObjectOID == 10 && check.Role == "basic" && check.Privilege == "INSERT" && !check.Wanted {
			t.Fatal("table implication lost")
		}
	}
	if compareFinding(false, true, true, "SELECT") != "excess_read_reported" {
		t.Fatal("excess read would be revoked")
	}
	if compareFinding(false, true, false, "SELECT") != "preserved_outside_scope" {
		t.Fatal("operational read scope narrowed")
	}
}
