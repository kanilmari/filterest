// legacy_trigger_side_effects_test.go
// Proves reachable legacy triggers receive only their narrow dependencies.
// Uses the shared pure policy and existing metadata driver, without private SQL.
// Account and privilege-view writers remain outside limited-pool grants.
package runtime_grants

import (
	"context"
	"crypto/md5"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestReviewedLegacySideEffectsAreConditionalAndRecursive(t *testing.T) {
	for _, operation := range []Operation{0, Read, Insert, Update, Delete} {
		s := policyFixture()
		s.Rights = nil
		s.Objects[10] = Object{OID: 10, DatasetUID: 1, Schema: "public", Name: "app_service_locations", Kind: "table", Columns: []Column{{Name: "id"}, {Name: "service_id"}, {Name: "title"}, {Name: "street"}, {Name: "city"}, {Name: "state"}}}
		delete(s.Objects, 11)
		s.Objects[20] = Object{OID: 20, DatasetUID: 2, Schema: "public", Name: "app_service_catalog", Kind: "table", Columns: []Column{{Name: "id"}, {Name: "updated"}}}
		s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 20, Kind: "trigger_update", When: Insert | Update | Delete, Columns: []string{"updated"}, ReadColumns: []string{"id"}},
			{SourceOID: 20, TargetOID: 10, Kind: "trigger_read", When: Insert | Update, Columns: []string{"service_id", "title", "street", "city", "state"}}}
		for id, fn := range s.Functions {
			if routeOperations[fn.Route] == operation && operation != 0 {
				s.Rights = append(s.Rights, Right{2, id, 1})
				break
			}
		}
		grants, err := DesiredRuntimeGrants(s)
		if err != nil {
			t.Fatal(err)
		}
		reachable := operation&(Insert|Update|Delete) != 0
		if containsGrant(grants, "basic", 20, "updated", "UPDATE") != reachable || containsGrant(grants, "basic", 20, "id", "SELECT") != reachable {
			t.Fatalf("operation %v: %v", operation, grants)
		}
		if containsGrant(grants, "basic", 20, "", "UPDATE") || containsGrant(grants, "guest", 20, "updated", "UPDATE") {
			t.Fatal("trigger widened parent grants", grants)
		}
	}
}

// Read the public creator's own template, not another private SQL copy.
func publicTimestampDefinition(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("../dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create/create_table.go")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile("(?s)trigger_func := fmt.Sprintf\\(`(.*?)`, sanitizedTableName\\)")
	match := pattern.FindSubmatch(data)
	if len(match) != 2 {
		t.Fatal("public dataset timestamp template missing")
	}
	return fmt.Sprintf(string(match[1]), "service_catalog")
}

func TestLegacyParentTimestampMatchesPublicReviewedBody(t *testing.T) {
	definition := publicTimestampDefinition(t)
	parts := strings.Split(definition, "$$")
	if len(parts) != 3 {
		t.Fatal("timestamp dollar quotes missing")
	}
	digest := fmt.Sprintf("%x", md5.Sum([]byte(parts[1])))
	if digest != "bd0a0b3593213d52cad42ba53ae32e5c" || !reviewedTriggerBodies[digest] {
		t.Fatal("parent timestamp needs fresh review", digest)
	}
}

func TestLegacyParentRecursionFollowsAuxiliaryLocationUpdate(t *testing.T) {
	s := policyFixture()
	locations := s.Objects[10]
	locations.Name = "app_service_locations"
	locations.Columns = append(locations.Columns, Column{Name: "service_id"}, Column{Name: "street"}, Column{Name: "city"}, Column{Name: "state"})
	s.Objects[10] = locations
	parent := s.Objects[11]
	parent.Name = "app_service_catalog"
	parent.Columns = append(parent.Columns, Column{Name: "updated"})
	s.Objects[11] = parent
	s.Rights = []Right{{2, 2, 3}} // Only a bridge insert, no location or parent right.
	s.Dependencies = []Dependency{
		{SourceOID: 12, TargetOID: 10, Kind: "cache", When: Insert, Columns: []string{"title"}},
		{SourceOID: 10, TargetOID: 11, Kind: "trigger_update", When: Insert | Update | Delete, Columns: []string{"updated"}, ReadColumns: []string{"id"}},
		{SourceOID: 11, TargetOID: 10, Kind: "trigger_read", When: Insert | Update, Columns: []string{"service_id", "title", "street", "city", "state"}},
	}
	grants := grantsFor(t, s)
	for _, column := range []string{"service_id", "street", "city", "state"} {
		if !containsGrant(grants, "basic", 10, column, "SELECT") {
			t.Fatal("parent trigger recursion missed location read", column, grants)
		}
	}
	if !containsGrant(grants, "basic", 11, "updated", "UPDATE") || containsGrant(grants, "basic", 10, "", "SELECT") || containsGrant(grants, "basic", 11, "", "UPDATE") {
		t.Fatal("auxiliary recursion widened privileges", grants)
	}
}

func TestLegacyRecognitionRefusesChangedIdentityAndNoPrivilegesForProtectedSources(t *testing.T) {
	for digest, identity := range reviewedLegacyTriggers {
		for _, accepted := range []bool{false, true} {
			db := metadataTestDB(t, func(query string, _ []driver.NamedValue) (int, [][]driver.Value, error) {
				if strings.HasPrefix(query, "SELECT t.tgtype,") {
					return 2, [][]driver.Value{{int64(28), "{}"}}, nil
				}
				if !strings.HasPrefix(query, "SELECT EXISTS(") {
					t.Fatal(query)
				}
				return 1, [][]driver.Value{{accepted}}, nil
			})
			tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			s := policyFixture()
			s.Objects[10] = Object{OID: 10, Schema: "public", Name: identity.table, Kind: "table"}
			ok, err := readReviewedLegacyTrigger(context.Background(), tx, &s, 70, 10, digest, identity.definer)
			_ = tx.Rollback()
			if err != nil || ok != accepted {
				t.Fatal(ok, err)
			}
			if identity.name == "fn_sync_cached_username" || identity.definer {
				if len(s.Dependencies) != 0 {
					t.Fatal("protected writer added a limited-pool dependency")
				}
			}
		}
	}
}
