// dataset_default_view_classification_test.go
// Proves that the saved-default route cannot grant dataset access to any runtime role.
// Connects its metadata classification with the existing pure grant-policy fixture.
// Even an accidentally configured ordinary-group right must confer no content privileges.
package runtime_grants

import "testing"

func TestDatasetDefaultViewRouteConfersNoGrants(t *testing.T) {
	snapshot := policyFixture()
	snapshot.Functions[99] = Function{ID: 99, Route: "/api/admin/dataset-default-view", TableRelated: true, Disabled: boolPointer(false)}
	snapshot.Rights = []Right{{2, 99, 1}, {3, 99, 1}}
	if findings := unclassifiedRouteFindings(snapshot); len(findings) != 0 {
		t.Fatal(findings)
	}
	for _, grant := range grantsFor(t, snapshot) {
		if (grant.Role == "basic" || grant.Role == "guest") && grant.ObjectOID == 10 {
			t.Fatal("default-view right became a content grant", grant)
		}
	}
}
