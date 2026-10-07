// surviving_sign_in_grants_test.go
// Keeps the survivor identity under the existing restricted credential grants.
// Connects the new private columns to the same runtime policy as password state.
// Prevents dataset rights from exposing or editing survivor records in limited pools.
package runtime_grants

import "testing"

func TestSurvivingSignInColumnsKeepRestrictedGrants(t *testing.T) {
	snapshot := policyFixture()
	object := snapshot.Objects[10]
	object.Schema, object.Name = "restricted", "users_restricted"
	object.Columns = []Column{{Name: "id"}, {Name: "authentication_generation"},
		{Name: "surviving_sign_in_id", Text: true}, {Name: "surviving_sign_in_generation"}}
	snapshot.Objects[10] = object
	// Even generic read/write rights cannot override the credential boundary.
	snapshot.Rights = []Right{{2, 1, 1}, {2, 2, 1}, {2, 3, 1}, {3, 1, 1}}
	grants := grantsFor(t, snapshot)
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
		if !containsGrant(grants, "confidential", 10, "", privilege) {
			t.Fatal("confidential credential grant missing", privilege)
		}
	}
	for _, grant := range grants {
		if grant.ObjectOID == 10 && grant.Role != "confidential" {
			t.Fatal("private survivor column escaped the restricted table boundary", grant)
		}
	}
}
