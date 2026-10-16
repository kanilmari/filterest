// translation_scope_reader.go
// Restricts API translations to the current reader's object visibility.
// Connects source associations to existing dataset, column and tree permissions.
// Keeps pre-login copy public without treating missing authorization as a grant.
package lang

import (
	"context"
	"fmt"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/lang_key_naming"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline/access_control"
)

var translationSessionMatches = backend.AuthenticatedSessionMatches

type translationReadScope struct {
	admin    bool
	datasets map[int]bool
	folders  bool
}

// This public route skips pipeline authentication. Validate a signed identity
// using the same current admission, generation, revocation and deadline check.
func translationPrincipal(r *http.Request) (int, error) {
	session, err := e_sessions.Load(r)
	userID := 1
	if err == nil {
		if id, ok := session.Values["user_id"].(int); ok && id > 1 {
			matches, matchErr := translationSessionMatches(r.Context(), backend.DbConfidential, session, id)
			if matchErr != nil {
				return 0, matchErr
			}
			if matches {
				return id, nil
			}
		}
	}
	loginRequired, err := middlewares.CheckLoginToBrowse()
	if err != nil || loginRequired {
		return 0, err
	}
	return userID, nil
}

func readTranslationScope(db dbutils.Querier, userID int) (translationReadScope, error) {
	scope := translationReadScope{datasets: map[int]bool{}}
	if userID <= 0 {
		return scope, nil
	}
	err := db.QueryRow(`SELECT EXISTS (
		SELECT 1 FROM system_user_group_memberships WHERE user_id = $1 AND group_id = 1
	)`, userID).Scan(&scope.admin)
	if err != nil || scope.admin {
		return scope, err
	}
	scope.datasets, err = access_control.GetTablesReadableByUser(db, userID)
	if err != nil {
		return scope, err
	}
	// The tree route exposes folder nodes without a separate folder ACL. Use
	// that existing tableless read grant, rather than inventing a folder policy.
	scope.folders, err = permissions.CheckRouteTablePermission(db, "/api/tree_data", userID,
		permissions.RouteTableScope{}, permissions.AccessControlRouteTableOptions(false))
	return scope, err
}

// No response or permission cache is shared between requests. A lookup error
// discards even a partial map: without the associations no key is proven unbound.
func scopeTranslationMap(r *http.Request, values map[string]string) map[string]string {
	userID, err := translationPrincipal(r)
	if err == nil {
		var scope translationReadScope
		scope, err = readTranslationScope(dbutils.BindQueryContext(r.Context(), backend.Db), userID)
		if err == nil {
			var filtered map[string]string
			filtered, err = filterTranslationMap(r.Context(), values, scope)
			if err == nil {
				return filtered
			}
		}
	}
	log.Printf("\033[31merror: translation visibility unavailable; withholding map: %v\033[0m", err)
	return map[string]string{}
}

func filterTranslationMap(ctx context.Context, values map[string]string, scope translationReadScope) (map[string]string, error) {
	if scope.admin {
		return values, nil
	}
	rows, err := backend.Db.QueryContext(ctx, translationObjectSourcesQuery)
	if err != nil {
		return nil, fmt.Errorf("translation associations: %w", err)
	}
	defer rows.Close()
	bound, denied, derived := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for rows.Next() {
		var key, sourceType, dataset string
		var uid int
		var visible bool
		if err := rows.Scan(&key, &sourceType, &dataset, &uid, &visible); err != nil {
			return nil, err
		}
		if sourceType == "unresolved" {
			derived[key] = true
			continue
		}
		if sourceType == "foreign_key" && translationStorageTable(dataset) {
			// Existing scanner rows remain useful provenance, but storing a key
			// does not make that storage dataset an owner of the labelled object.
			continue
		}
		bound[key] = true
		allowed := scope.datasets[uid] && visible && backend.ShouldExposeCloudManagementDatasetName(dataset)
		if sourceType == "folder" {
			allowed = scope.folders && visible
		}
		// A generic code/manual source never overrides an unreadable object.
		if !allowed {
			denied[key] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	filtered := make(map[string]string, len(values))
	for key, value := range values {
		if !denied[key] && (bound[key] || (!derived[key] && !unresolvedObjectKey(key))) {
			filtered[key] = value
		}
	}
	return filtered, nil
}

// This reviewed catalogue covers translation storage and lookup/bookkeeping
// tables in public_bootstrap/schema.sql and runtime_grants/table_classifier.go.
// Only foreign-key VALUE references are excluded: labels OF these tables or
// their columns still require their own dataset rights. Unknown system tables
// remain restrictive; a name prefix cannot establish storage semantics.
// The migration's frozen report mirrors this list (guarded by the Python test).
func translationStorageTable(dataset string) bool {
	switch dataset {
	case "system_lang_keys", "system_lang_keys_archive", "system_lang_key_sources",
		"system_lang_key_translations", "system_lang_key_types", "system_languages":
		return true
	}
	return false
}

// Dataset-named leftovers cannot be made public by losing their source row.
// The migration lists these for repair; ordinary unbound interface copy survives.
func unresolvedObjectKey(key string) bool {
	if _, ok := lang_key_naming.TrimDynamicPrefix(key); ok {
		return true
	}
	_, ok := lang_key_naming.TrimDynamicSuffix(key)
	return ok
}

const translationObjectSourcesQuery = `
	SELECT keys.lang_key, sources.source_type, COALESCE(dataset.table_name,
	       CASE WHEN sources.source_type = 'foreign_key' AND split_part(sources.source_high, '.', 1) = 'public'
	            THEN split_part(sources.source_high, '.', 2) END, ''),
	       COALESCE(dataset.table_uid, 0),
	       CASE WHEN sources.source_type = 'folder' THEN EXISTS (
	           SELECT 1 FROM system_table_folders folder WHERE folder.folder_name = sources.source_high
	       ) ELSE dataset.table_uid IS NOT NULL AND (
	           sources.source_type NOT IN ('column', 'column_value', 'foreign_key') OR EXISTS (
	               SELECT 1 FROM system_column_details col
	               WHERE col.table_uid = dataset.table_uid AND col.column_name =
	                   CASE WHEN sources.source_type = 'column' THEN sources.source_low
	                        WHEN sources.source_type = 'column_value' THEN split_part(sources.source_high, '.', 2)
	                        ELSE split_part(sources.source_high, '.', 3) END
	                 AND (NOT COALESCE(col.hide_everywhere, false) OR col.column_name = 'id')
	                 AND COALESCE(col.client_delivery_mode, 'include') = 'include'
	                 AND col.column_name NOT IN ('embedding_vector', 'search_vector_simple')
	           )
	       ) END AS visible
	FROM system_lang_key_sources sources
	JOIN system_lang_keys keys ON keys.id = sources.lang_key_id
	LEFT JOIN public.system_db_tables dataset ON dataset.table_name =
	    CASE WHEN sources.source_type = 'dataset_header' THEN split_part(sources.source_high, ':', 1)
	         WHEN sources.source_type = 'column_value' THEN split_part(sources.source_high, '.', 1)
	         WHEN sources.source_type = 'foreign_key' AND split_part(sources.source_high, '.', 1) = 'public'
	             THEN split_part(sources.source_high, '.', 2)
	         WHEN sources.source_type IN ('table', 'column') THEN sources.source_high END
	    AND COALESCE(NULLIF(dataset.schema_name, ''), 'public') = 'public'
	WHERE sources.source_type IN ('table', 'column', 'folder', 'dataset_header', 'column_value', 'foreign_key')
	UNION ALL
	SELECT keys.lang_key, 'unresolved', '', 0, false
	FROM system_lang_keys keys
	WHERE keys.creation_spec = 'Interface label derived from dataset schema names.'
`
