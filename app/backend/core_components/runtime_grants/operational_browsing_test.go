// operational_browsing_test.go
// Asserts browsing metadata receives explicit reads without dataset rights.
// Uses the pure grant policy so a fresh-install omission fails in the sandbox.
// These new contracts must never provide writes or restricted reads.
package runtime_grants

import "testing"

func TestBrowsingMetadataContractsWithoutDatasetRights(t *testing.T) {
	s := policyFixture()
	s.Rights = nil
	names := []string{"system_db_tables", "system_config", "system_column_details", "system_table_views", "system_table_folders", "system_column_control", "system_column_supported_views", "system_column_view_presets", "system_dataset_view_settings", "system_child_tab_config", "system_dataset_media", "system_foreign_key_relations_1_m", "system_foreign_key_relations_m_m", "system_languages", "system_lang_keys", "system_lang_key_translations", "system_functions", "system_group_table_func_rights", "system_user_group_memberships", "system_user_groups", "system_row_groups", "system_row_group_memberships"}
	for i, name := range names {
		oid := int64(500 + i)
		s.Objects[oid] = Object{OID: oid, Schema: "public", Name: name, Kind: "table"}
	}
	grants, err := DesiredRuntimeGrants(s)
	if err != nil {
		t.Fatal(err)
	}
	for i, name := range names {
		oid := int64(500 + i)
		for _, role := range []string{"basic", "guest"} {
			if !containsGrant(grants, role, oid, "", "SELECT") {
				t.Fatalf("%s cannot read browsing metadata %s", role, name)
			}
			for _, priv := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
				if containsGrant(grants, role, oid, "", priv) {
					t.Fatalf("browsing contract grants %s %s on %s", role, priv, name)
				}
			}
		}
	}
}
