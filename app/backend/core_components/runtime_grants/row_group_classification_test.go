// row_group_classification_test.go
// Verifies headings and row-group values share the SELECT-only runtime contract.
// Generic dataset rights must never add writes or sequence use to administrator metadata.
package runtime_grants

import "testing"

func TestAllRowGroupTablesAreDedicatedAndReadOnlyForRuntimeRoles(t *testing.T) {
	for _, name := range []string{"system_row_groups", "system_row_group_memberships", "system_row_group_classifications"} {
		t.Run(name, func(t *testing.T) {
			snapshot := policyFixture()
			object := snapshot.Objects[10]
			object.Name = name
			snapshot.Objects[10] = object
			class, err := ClassifyTable(object)
			if err != nil || class != Dedicated {
				t.Fatalf("classification=%s err=%v", class, err)
			}
			snapshot.Objects[20] = Object{OID: 20, Schema: "public", Name: name + "_id_seq", Kind: "sequence"}
			// Identity/default nextval derivation must not grant sequence use:
			// these metadata tables never gain INSERT through dataset rights.
			snapshot.Sequences = []SequenceUse{{10, 20, "id", true}}
			for _, id := range []int64{1, 2, 3, 4} {
				snapshot.Rights = append(snapshot.Rights, Right{2, id, 1}, Right{3, id, 1}, Right{1, id, 1})
			}
			grants := grantsFor(t, snapshot)
			for _, role := range []string{"basic", "guest", "readonly"} {
				if !containsGrant(grants, role, 10, "", "SELECT") {
					t.Fatalf("missing %s SELECT", role)
				}
				for _, privilege := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
					if containsGrant(grants, role, 10, "", privilege) {
						t.Fatalf("%s gained %s", role, privilege)
					}
				}
				for _, privilege := range []string{"USAGE", "UPDATE"} {
					if containsGrant(grants, role, 20, "", privilege) {
						t.Fatalf("%s gained sequence %s", role, privilege)
					}
				}
			}
			snapshot.Rights = nil
			grants = grantsFor(t, snapshot)
			for _, role := range []string{"basic", "guest", "readonly"} {
				if !containsGrant(grants, role, 10, "", "SELECT") {
					t.Fatalf("row visibility metadata needs %s SELECT without dataset grants", role)
				}
			}
		})
	}
}
