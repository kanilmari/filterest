// front_page_classification_test.go
// Holds the new table and facade routes to classification entries only.
// Dataset permissions continue to come from the canonical results route.
package runtime_grants

import "testing"

func TestFrontPageClassification(t *testing.T) {
	class, err := ClassifyTable(Object{Schema: "public", Name: "system_front_page_blocks", DatasetUID: 1})
	if err != nil || class != Dedicated {
		t.Fatal(class, err)
	}
	if privileges := operationalPrivileges["system_front_page_blocks"]; len(privileges) != 1 || privileges[0] != "SELECT" {
		t.Fatal(privileges)
	}
	class, err = ClassifyTable(Object{Schema: "public", Name: "system_front_page_revisions"})
	if err != nil || class != Dedicated || len(operationalPrivileges["system_front_page_revisions"]) != 0 {
		t.Fatal("private revisions acquired runtime privileges", class, err)
	}
	for _, route := range []string{"/api/front-page", "/api/admin/front-page", "/api/admin/front-page/background"} {
		snapshot := policyFixture()
		snapshot.Functions[99] = Function{ID: 99, Route: route, TableRelated: true, Disabled: boolPointer(false)}
		snapshot.Rights = []Right{{2, 99, 1}, {3, 99, 1}}
		if findings := unclassifiedRouteFindings(snapshot); len(findings) > 0 {
			t.Fatal(findings)
		}
		for _, grant := range grantsFor(t, snapshot) {
			if (grant.Role == "basic" || grant.Role == "guest") && grant.ObjectOID == 10 {
				t.Fatal("facade right became a dataset grant", grant)
			}
		}
	}
}
