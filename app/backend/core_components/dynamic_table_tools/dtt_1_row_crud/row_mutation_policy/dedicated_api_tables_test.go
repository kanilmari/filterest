// dedicated_api_tables_test.go
// Verifies private report history cannot fall back to generic row mutation routes.
// Bridges the protected-table registry with representative Agent Tools and ordinary datasets.
// Exists so future schema additions cannot silently weaken report secret screening.
package row_mutation_policy

import "testing"

func TestRequiresDedicatedMutationAPI(t *testing.T) {
	for _, tableName := range []string{
		"dev_agent_worklines",
		"dev_agent_workline_reports",
		"dev_agent_workline_tasks",
		"dev_agent_handover_reports",
		"dev_agent_handover_report_items",
		"dev_agent_release_goals",
		"dev_agent_release_goal_contracts",
		"system_column_field_sets",
		"system_column_field_set_members",
		"system_view_field_set_assignments",
		"system_permission_categories",
		"system_permission_actions",
		"system_row_access_rules",
		"system_row_access_rule_events",
		"system_user_visual_preferences",
	} {
		if !RequiresDedicatedMutationAPI(tableName) {
			t.Fatalf("%s must reject generic mutations", tableName)
		}
	}
	if RequiresDedicatedMutationAPI("customer_records") {
		t.Fatal("ordinary application datasets must retain generic CRUD")
	}
	if !RequiresDedicatedMutationAPI("  SYSTEM_COLUMN_FIELD_SETS  ") {
		t.Fatal("protected-table matching must ignore case and surrounding whitespace")
	}
}
