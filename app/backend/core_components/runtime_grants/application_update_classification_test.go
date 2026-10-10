// application_update_classification_test.go
// Keeps private update admission storage within the existing restricted contract.
// Connects explicit table classification to the pure runtime grant policy.
// Prevents ordinary dataset rights from exposing update intent or authentication evidence.
package runtime_grants

import "testing"

func TestApplicationUpdateTablesKeepRestrictedGrants(t *testing.T) {
	for _, name := range []string{
		"system_application_update_control",
		"system_application_update_jobs",
		"system_application_update_proofs",
		"system_application_update_decisions",
		"system_application_update_admissions",
		"system_application_update_events",
		"system_application_update_auth_attempts",
	} {
		t.Run(name, func(t *testing.T) {
			snapshot := policyFixture()
			object := snapshot.Objects[10]
			object.Schema, object.Name, object.DatasetUID = "restricted", name, 0
			snapshot.Objects[10] = object
			class, err := ClassifyTable(object)
			if err != nil || class != Restricted {
				t.Fatal("private update storage is not classified as restricted", class, err)
			}
			grants := grantsFor(t, snapshot)
			for _, role := range []string{"PUBLIC", "basic", "guest", "readonly", "confidential"} {
				for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
					if containsGrant(grants, role, 10, "", privilege) != (role == "confidential") {
						t.Fatal("private update storage escaped the restricted contract", role, privilege)
					}
				}
			}
			// Even an invalid generic registration cannot override the restricted boundary.
			object.DatasetUID = 1
			if class, err := ClassifyTable(object); err != nil || class != Restricted {
				t.Fatal("dataset registration bypassed restricted classification", class, err)
			}
			snapshot.Objects[10] = object
			snapshot.Rights = []Right{{2, 1, 1}, {2, 2, 1}, {2, 3, 1}, {2, 4, 1}, {3, 1, 1}}
			for _, grant := range grantsFor(t, snapshot) {
				if grant.ObjectOID == 10 && (grant.Role != "confidential" || grant.Column != "" || grant.Privilege != "SELECT" && grant.Privilege != "INSERT" && grant.Privilege != "UPDATE" && grant.Privilege != "DELETE") {
					t.Fatal("generic rights exposed private update storage", grant)
				}
			}
		})
	}
}
