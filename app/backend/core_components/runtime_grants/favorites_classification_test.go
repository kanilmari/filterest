// favorites_classification_test.go
// Keeps the new account-owned table and administrator API within reviewed policy boundaries.
// Verifies operational favorites writes never turn into generic dataset grants.
package runtime_grants

import "testing"

func TestFavoritesClassification(t *testing.T) {
	class, err := ClassifyTable(Object{Schema: "public", Name: "system_favorites", DatasetUID: 1})
	if err != nil || class != Dedicated {
		t.Fatal(class, err)
	}
	privileges := operationalPrivileges["system_favorites"]
	if len(privileges) != 3 || privileges[0] != "SELECT" || privileges[1] != "INSERT" || privileges[2] != "DELETE" {
		t.Fatal(privileges)
	}
	snapshot := policyFixture()
	snapshot.Functions[99] = Function{ID: 99, Route: "/api/favorites", TableRelated: true, Disabled: boolPointer(false)}
	snapshot.Rights = []Right{{2, 99, 1}, {3, 99, 1}, {1, 99, 1}}
	if findings := unclassifiedRouteFindings(snapshot); len(findings) > 0 {
		t.Fatal(findings)
	}
	for _, grant := range grantsFor(t, snapshot) {
		if (grant.Role == "basic" || grant.Role == "guest") && grant.ObjectOID == 10 {
			t.Fatal("favorites route granted dataset access", grant)
		}
	}
}

func TestFavoritesOperationalGrantsCannotBecomeGenericWrites(t *testing.T) {
	snapshot := policyFixture()
	object := snapshot.Objects[10]
	object.Name = "system_favorites"
	snapshot.Objects[10] = object
	for _, id := range []int64{1, 2, 3, 4} {
		snapshot.Rights = append(snapshot.Rights, Right{2, id, 1}, Right{3, id, 1})
	}
	grants := grantsFor(t, snapshot)
	for _, privilege := range []string{"SELECT", "INSERT", "DELETE"} {
		if !containsGrant(grants, "basic", 10, "", privilege) {
			t.Fatal("operational contract missing", privilege)
		}
	}
	for _, role := range []string{"basic", "guest", "readonly", "confidential", "PUBLIC"} {
		for _, privilege := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
			want := role == "basic" && (privilege == "INSERT" || privilege == "DELETE")
			if containsGrant(grants, role, 10, "", privilege) != want {
				t.Fatal("generic route escaped dedicated API boundary", role, privilege)
			}
		}
	}
}
