// dedicated_api_tables.go
// Identifies private workflow tables whose writes require purpose-built API validation.
// Bridges generic row mutation handlers with security-sensitive Agent Tools persistence.
// Exists so generic CRUD cannot bypass secret screening or immutable history contracts.
package row_mutation_policy

import "strings"

var dedicatedMutationAPITables = map[string]struct{}{
	"dev_agent_worklines":               {},
	"dev_agent_workline_reports":        {},
	"dev_agent_workline_tasks":          {},
	"dev_agent_handover_reports":        {},
	"dev_agent_handover_report_items":   {},
	"dev_agent_release_goals":           {},
	"dev_agent_release_goal_contracts":  {},
	"system_column_field_sets":          {},
	"system_column_field_set_members":   {},
	"system_view_field_set_assignments": {},
}

// RequiresDedicatedMutationAPI reports whether generic row writes are forbidden.
// Between: resolved dataset names and add/update/delete handlers.
// Why: these tables depend on validation that column editability alone cannot enforce.
func RequiresDedicatedMutationAPI(tableName string) bool {
	_, protected := dedicatedMutationAPITables[strings.ToLower(strings.TrimSpace(tableName))]
	return protected
}
