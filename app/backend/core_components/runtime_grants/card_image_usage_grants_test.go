// card_image_usage_grants_test.go
// Proves typed image-use storage follows the existing dataset route matrix.
// Connects parent and gallery rights to independent runtime content grants.
// Reading cards alone never grants permission to update their presentation.
package runtime_grants

import "testing"

func TestCardImageUsageStorageRequiresExistingUpdateRoute(t *testing.T) {
	snapshot := policyFixture()
	child := snapshot.Objects[11]
	for _, name := range []string{"card_image_presentation", "card_image_focal_x", "card_image_focal_y"} {
		child.Columns = append(child.Columns, Column{Name: name})
	}
	snapshot.Objects[11] = child
	snapshot.Rights = []Right{{GroupID: 2, FunctionID: 1, DatasetUID: 1}, {GroupID: 2, FunctionID: 1, DatasetUID: 2},
		{GroupID: 3, FunctionID: 1, DatasetUID: 2}, {GroupID: 2, FunctionID: 3, DatasetUID: 1}}
	grants := grantsFor(t, snapshot)
	if !containsGrant(grants, "basic", 11, "", "SELECT") || containsGrant(grants, "basic", 11, "", "UPDATE") {
		t.Fatal("parent editing conferred a gallery update right")
	}
	snapshot.Rights = append(snapshot.Rights, Right{GroupID: 2, FunctionID: 3, DatasetUID: 2})
	grants = grantsFor(t, snapshot)
	if !containsGrant(grants, "basic", 11, "", "UPDATE") || containsGrant(grants, "guest", 11, "", "UPDATE") {
		t.Fatal("image update grants escaped the existing route policy")
	}
	if routeOperations["/api/update-row"] != Update || routeOperations["/api/add-row-multipart"] != Insert {
		t.Fatal("image-use writes lost the reviewed route classification")
	}
}
