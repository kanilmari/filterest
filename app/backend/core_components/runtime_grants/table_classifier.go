// table_classifier.go
// Enumerates product tables before considering registered content datasets.
// Reuses generic mutation guards and the internal-registry boundary.
// Unknown product names fail closed instead of acquiring dataset writes.
package runtime_grants

import (
	"fmt"
	"strings"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
)

type TableClass string

const (
	Content    TableClass = "content"
	Product    TableClass = "product"
	Protected  TableClass = "protected"
	Dedicated  TableClass = "dedicated"
	Embedding  TableClass = "embedding"
	Restricted TableClass = "restricted"
	Extension  TableClass = "extension"
)

var productTables = map[string]bool{
	"agent_messages":                    true,
	"ai_chat_conversations":             true,
	"ai_usage_logs":                     true,
	"deletion_log":                      true,
	"dev_agent_handover_report_items":   true,
	"dev_agent_handover_reports":        true,
	"dev_agent_release_goal_contracts":  true,
	"dev_agent_release_goals":           true,
	"dev_agent_task_group_relations":    true,
	"dev_agent_task_groups":             true,
	"dev_agent_task_queues":             true,
	"dev_agent_task_runs":               true,
	"dev_agent_task_statuses":           true,
	"dev_agent_task_todo_statuses":      true,
	"dev_agent_task_todos":              true,
	"dev_agent_tasks":                   true,
	"dev_agent_tasks_assets":            true,
	"dev_agent_workline_reports":        true,
	"dev_agent_workline_tasks":          true,
	"dev_agent_worklines":               true,
	"mcp_query_log":                     true,
	"payments":                          true,
	"system_about":                      true,
	"system_app_db_compatibility":       true, // Private 20260330 migration; startup mirrors the manifest.
	"system_audit_log":                  true,
	"system_child_tab_config":           true,
	"system_column_control":             true,
	"system_column_details":             true,
	"system_column_field_set_members":   true,
	"system_column_field_sets":          true,
	"system_column_supported_views":     true,
	"system_column_view_presets":        true,
	"system_comments":                   true,
	"system_config":                     true,
	"system_config_value_data_types":    true, // Legacy config FK labels; private bootstrap lookup.
	"system_database_identity":          true, // Private 20260426000001 migration; native setup/dev_status.
	"system_data_repair_records":        true,
	"system_dataset_media":              true,
	"system_dataset_sort_defaults":      true,
	"system_dataset_view_settings":      true,
	"system_db_table_aliases":           true,
	"system_db_tables":                  true,
	"system_db_version":                 true,
	"system_embedding_refresh_jobs":     true,
	"system_foreign_key_relations_1_m":  true,
	"system_foreign_key_relations_m_m":  true,
	"system_fk_cache_triggers":          true, // Private 20260301 migration; administrator cache tools.
	"system_front_page_blocks":          true,
	"system_front_page_revisions":       true,
	"system_favorites":                  true,
	"system_functions":                  true,
	"system_group_table_func_rights":    true,
	"system_lang_key_sources":           true,
	"system_lang_key_translations":      true,
	"system_lang_keys":                  true,
	"system_lang_keys_archive":          true,
	"system_lang_key_types":             true, // Legacy system_lang_keys FK lookup.
	"system_languages":                  true,
	"system_log":                        true, // Legacy log; administrator retention still reads/deletes it.
	"system_log_types":                  true, // Legacy system_log FK labels use this lookup.
	"system_media_asset_usages":         true,
	"system_media_assets":               true,
	"system_permission_actions":         true,
	"system_permission_categories":      true,
	"system_revoked_sign_ins":           true,
	"system_row_access_rule_events":     true,
	"system_row_access_rules":           true,
	"system_row_actor_columns":          true,
	"system_row_group_memberships":      true,
	"system_row_group_classifications":  true,
	"system_row_groups":                 true,
	"system_schema_migrations":          true,
	"system_table_folders":              true,
	"system_table_row_view_counts":      true,
	"system_table_views":                true,
	"system_transaction_log":            true,
	"system_triggers":                   true,
	"system_user_group_memberships":     true,
	"system_user_groups":                true,
	"system_user_visual_preferences":    true,
	"system_users":                      true,
	"system_view_field_set_assignments": true,
}

var accountTables = map[string]bool{
	"system_users": true, "system_user_groups": true, "system_user_group_memberships": true,
	"system_group_table_func_rights": true, "system_functions": true,
}

// These development-era tables survive in Easelect's db-7.0.21 snapshot, but
// have no current application consumer. Protected denies every runtime write;
// the policy also omits basic/guest grants even if obsolete rights remain.
// V1's readonly public SELECT contract and V2's preservation of old reads stay.
var retiredProductTables = map[string]bool{
	"system_ai_chatbot_instructions": true, // Former SQL assistant; removed in Easelect cb2503ef.
	"system_column_types_for_mgmt":   true,
	"system_file_structure":          true, // Former source inventory; bootstrap only excludes it.
	"system_log_classes":             true,
	"system_row_views":               true,
	"system_styles":                  true,
}

// ClassifyTable gives protected and dedicated boundaries precedence over registry
// membership. Adding a product table requires an explicit catalogue entry.
func ClassifyTable(object Object) (TableClass, error) {
	name := strings.ToLower(object.Name)
	if object.Protected || (object.Schema == "public" && (accountTables[name] || retiredProductTables[name])) {
		return Protected, nil
	}
	if object.Extension {
		return Extension, nil
	}
	if strings.HasPrefix(name, "systemview_") {
		return Protected, nil
	}
	if strings.HasSuffix(name, "_lang_embeddings") {
		return Embedding, nil
	}
	if object.Schema == "restricted" {
		switch name {
		case "users_restricted", "verification_codes", "otp_send_events":
			return Restricted, nil
		}
		return "", fmt.Errorf("unclassified restricted object %s", object.Identifier())
	}
	if row_mutation_policy.RequiresDedicatedMutationAPI(name) || row_mutation_policy.IsInternalRegistryTable(name) {
		return Dedicated, nil
	}
	if productTables[name] {
		return Product, nil
	}
	// Private 20260415000001 creates this child; EnsureSharedAssetRelation can
	// also create it. Like registered starter asset children, its independent
	// dataset rights supply grants. Never generalize this to any system_* suffix.
	if object.Schema == "public" && name == "system_about_assets" && object.DatasetUID > 0 {
		return Content, nil
	}
	if strings.HasPrefix(name, "system_") || strings.HasPrefix(name, "dev_agent_") {
		return "", fmt.Errorf("unclassified product object %s", object.Identifier())
	}
	if object.DatasetUID > 0 {
		return Content, nil
	}
	return "", fmt.Errorf("unclassified object %s", object.Identifier())
}

var operationalPrivileges = map[string][]string{
	"system_column_field_sets":          {"SELECT", "INSERT", "UPDATE", "DELETE"},
	"system_column_field_set_members":   {"SELECT", "INSERT", "DELETE"},
	"system_view_field_set_assignments": {"SELECT", "INSERT", "UPDATE", "DELETE"},
	"system_dataset_sort_defaults":      {"SELECT", "INSERT", "UPDATE"},
	"system_front_page_blocks":          {"SELECT"},
	"system_favorites":                  {"SELECT", "INSERT", "DELETE"},
	"system_user_visual_preferences":    {"SELECT", "INSERT", "UPDATE", "DELETE"},
	"system_media_assets":               {"SELECT", "INSERT"},
	"system_media_asset_usages":         {"SELECT", "INSERT", "DELETE"},
	"deletion_log":                      {"SELECT", "INSERT"},
	"system_embedding_refresh_jobs":     {"SELECT", "INSERT", "UPDATE"},
}
