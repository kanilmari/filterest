// dataset_appearance_classification_test.go
// Holds appearance storage to the private internal-table runtime catalogue.
// Connects classification and grant computation without a new route or read contract.
// Preserves the repository's operator readonly inspection contract only.
package runtime_grants

import "testing"

func TestDatasetAppearanceClassificationAndNoOrdinaryGrants(t *testing.T) {
	name := "system_dataset_appearance"
	class, err := ClassifyTable(Object{Schema: "public", Name: name})
	if err != nil || class != Dedicated || !productTables[name] || len(operationalPrivileges[name]) != 0 || len(operationalReadRoles[name]) != 0 {
		t.Fatal("private appearance storage acquired a runtime contract", class, err)
	}
	snapshot := policyFixture()
	object := snapshot.Objects[10]
	object.Name, object.DatasetUID = name, 0
	snapshot.Objects[10] = object
	for _, grant := range grantsFor(t, snapshot) {
		if grant.ObjectOID == 10 && (grant.Role != "readonly" || grant.Privilege != "SELECT") {
			t.Fatal("appearance storage acquired ordinary grants", grant)
		}
	}
}
