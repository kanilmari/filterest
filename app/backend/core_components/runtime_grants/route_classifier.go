// route_classifier.go
// Names known metadata and purpose-built routes that confer no generic content grant.
// Complements the explicit data route matrix in dataset_grant_policy.go.
// New active dataset routes must receive a reviewed classification.
package runtime_grants

import (
	"fmt"
	"sort"
)

// The coding-agent probe is administrator-only. Ordinary datasets use DbAdmin;
// the existing app_service_catalog request-pool exception can use DbBasic.
// filterbar_ai_coding_agent_backend_context.go:124-134 delegates that row read;
// database_role_router.go:44-47 and rls_pilot_read.go:69-78 select its transaction.
var adminPilotRouteOperations = map[string]Operation{
	"/api/app/ai-chat/codex-query": Read,
}

var metadataRoutes = map[string]bool{
	// filterbar_ai_facade_handler.go:240,335 separately authorizes the canonical
	// read route. The facade right alone adds no dataset/label/embedding reads.
	"/api/app/ai-chat/query":                                  true,
	"/api/get-columns":                                        true,
	"/api/get-metadata":                                       true,
	"/api/get-1m-relations":                                   true,
	"/api/get-add-row-metadata":                               true,
	"/api/get-many-to-many":                                   true,
	"/api/dataset-columns/":                                   true,
	"/api/geocode-address":                                    true,
	"/api/comments":                                           true,
	"/api/comments/create":                                    true,
	"/api/comments/delete":                                    true,
	"/api/comment-counts":                                     true,
	"/api/task-todo-progress":                                 true,
	"/api/view-field-sets":                                    true,
	"/api/view-field-settings/article-section-defaults":       true,
	"/api/admin/view-field-settings/article-section-defaults": true,
	"/api/view-field-sets/personal/save":                      true,
	"/api/view-field-sets/personal/assign":                    true,
	"/api/view-field-sets/personal/reset":                     true,
	"/api/view-field-sets/personal/delete":                    true,
	"/api/admin/view-field-sets/site/save":                    true,
	"/api/admin/view-field-sets/site/assign":                  true,
	"/api/admin/view-field-sets/shared/reset":                 true,
	"/api/admin/view-field-sets/shared/delete":                true,
	"/api/dataset-sort-default":                               true,
	"/api/dataset-sort-default/personal":                      true,
	"/api/admin/dataset-sort-default":                         true,
	"/api/card-visibility/":                                   true,
	"/api/card-visibility/update":                             true,
	"/api/dataset-header-config/":                             true,
	"/api/dataset-header-config/save":                         true,
	"/api/child-tab-config/":                                  true,
	"/api/child-tab-config/save":                              true,
	"/api/system_triggers/list":                               true,
	"/api/system_triggers/create":                             true,
	"/api/modify-columns":                                     true,
	"/api/delete_foreign_key":                                 true, // AdminProfile; DeleteForeignKeyHandler drops a constraint, no row DML.
	// foreign_keys.go:59-91,113,130,242: administrator DDL/catalogue reads.
	"/api/add_foreign_key": true,
	"/api/foreign_keys":    true,
	// update_table_folders.go:86,120,283: Db reads folders/registry and updates registry.folder_id.
	"/api/update-table-folder": true,
	// filterbar_ai_facade_handler.go:123,133,734 and read_update_columns.go:85,95: Db metadata only.
	"/api/app/ai-chat/capabilities": true,
	// ai_chat_conversation_handler.go:176,207: Db reads/upserts ai_chat_conversations, not dataset rows.
	"/api/app/ai-chat/conversation": true,
	// filterbar_ai_site_assistant_approval.go:69,87,99: socket and in-memory delegation;
	// approved API calls run separately as the asking administrator.
	"/api/app/ai-chat/site-assistant-approval": true,
	"/api/drop-dataset":                        true,
	"/api/set-comments":                        true,
	"/api/create-indexes":                      true,
	"/api/embedding_stream_handler":            true,
	"/api/refresh-lang-embeddings":             true,
	"/api/count-lang-embeddings":               true,
	"/api/text-index-status":                   true,
	"/api/rebuild-search-vectors":              true,
}

// Collect every unknown active table route, even without any current rights.
// Function IDs are metadata row keys, distinct from PostgreSQL object OIDs.
func unclassifiedRouteFindings(snapshot GrantSnapshot) []Finding {
	var findings []Finding
	for _, function := range snapshot.Functions {
		if function.UIOnly || !function.TableRelated || function.Disabled != nil && *function.Disabled {
			continue
		}
		if _, known := routeOperations[function.Route]; known || metadataRoutes[function.Route] || adminPilotRouteOperations[function.Route] != 0 {
			continue
		}
		findings = append(findings, Finding{Role: "policy", Kind: "route",
			Object:     (Object{Schema: "public", Name: "system_functions"}).Identifier(),
			FunctionID: function.ID, Route: function.Route, Finding: "blocker",
			Reason: fmt.Sprintf("system_functions row id %d: unclassified active data route", function.ID)})
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].FunctionID < findings[j].FunctionID })
	return findings
}
