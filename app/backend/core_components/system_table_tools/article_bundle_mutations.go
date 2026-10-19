// article_bundle_mutations.go
// Adapts existing field-settings saves to target-owned article bundles.
// Connects permission-checked HTTP mutations to the shared transactional SQL service.
// Keeps sibling values and widths intact when a legacy editor changes one projection.
package system_table_tools

import (
	"fmt"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

func isArticleBundleView(key string) bool {
	return key == "article_view" || key == "image_first_view" || key == "image_first_page_view"
}

func saveArticleProjection(q dbutils.Querier, tableUID int, viewKey string, user, group interface{}, priority int, columns []int, name string, author int64, source interface{}) (int64, error) {
	var id int64
	// An absent label edits the active target; a named save keeps its own row.
	var label interface{} = name
	if name == "" {
		label = nil
	}
	err := q.QueryRow(`SELECT public.app_save_article_projection($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		tableUID, viewKey, user, group, priority, pq.Array(columns), label, author, source).Scan(&id)
	return id, err
}

func saveArticleProjectionTargets(q dbutils.Querier, tableUID int, viewKey string, userID int64, site bool, groups []int64, priority int, columns []int, name string, source interface{}) (int64, string, error) {
	if !site {
		id, err := saveArticleProjection(q, tableUID, viewKey, userID, nil, 0, columns, name, userID, source)
		return id, "personal", err
	}
	if len(groups) == 0 {
		id, err := saveArticleProjection(q, tableUID, viewKey, nil, nil, 0, columns, name, userID, source)
		return id, "site", err
	}
	var first int64
	for _, group := range groups {
		id, err := saveArticleProjection(q, tableUID, viewKey, nil, group, priority, columns, name, userID, source)
		if err != nil {
			return 0, "", err
		}
		if first == 0 {
			first = id
		}
	}
	return first, "group", nil
}

func respondArticleProjectionSave(w http.ResponseWriter, r *http.Request, q dbutils.Querier, tableUID, viewID int, viewKey, dataset string, userID int64, site bool, request saveViewFieldSetRequest, columns []int) {
	// A saved legacy collection is copied into the target bundle, never converted
	// or edited in place: table/card and other targets retain their own settings.
	name := request.Name
	if request.FieldSetID > 0 {
		var currentName string
		err := q.QueryRow(`SELECT name FROM public.system_column_field_sets WHERE id=$1 AND table_uid=$2
		 AND (owner_user_id=$3 OR ($4 AND owner_user_id IS NULL))`, request.FieldSetID, tableUID, userID, site).Scan(&currentName)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusForbidden, "field collection is not editable")
			return
		}
		if name == currentName {
			name = ""
		}
	}
	id, scope, err := saveArticleProjectionTargets(q, tableUID, viewKey, userID, site, request.TargetGroupIDs, request.GroupPriority, columns, name, nil)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusConflict, "article projection save failed")
		return
	}
	groups, err := listViewFieldSetGroupAssignments(q, tableUID, viewID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "article projection readback failed")
		return
	}
	// Uniform saves still own distinct bundles. Return each committed identity so
	// the existing editor can verify exact targets after its ordinary GET readback.
	variants := []savedViewFieldSetGroupVariant{}
	for _, group := range groups {
		for _, selected := range request.TargetGroupIDs {
			if group.GroupID == selected && group.FieldSetID != nil {
				variants = append(variants, savedViewFieldSetGroupVariant{GroupID: selected, FieldSetID: *group.FieldSetID, GroupPriority: group.GroupPriority, VisibleColumns: request.VisibleColumns})
			}
		}
	}
	_, siteID, err := resolveViewFieldSetAssignments(q, tableUID, viewID, userID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "article site assignment readback failed")
		return
	}
	scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok", "field_set_id": id, "scope": scope, "target_group_ids": request.TargetGroupIDs,
		"visible_columns": request.VisibleColumns, "group_assignments": groups,
		"site_default_field_set_id": siteID,
		"group_variants":            variants,
	})
}

func resetArticleTarget(q dbutils.Querier, tableUID int, user, group interface{}) error {
	if user == nil && group == nil {
		return fmt.Errorf("article site bundle requires explicit values; save or restore defaults")
	}
	_, err := q.Exec(`SELECT public.app_reset_article_target($1,$2,$3)`, tableUID, user, group)
	if err != nil {
		return err
	}
	// Reset removes the preference, keeping named choices available in the picker.
	return nil
}

func restoreArticleSiteProjection(q dbutils.Querier, tableUID int, viewKey string, author int64) error {
	columns, err := metadataVisibleViewFieldColumns(q, tableUID, viewKey)
	if err != nil {
		return err
	}
	uids, err := resolveVisibleColumnUIDs(q, tableUID, columns)
	if err != nil {
		return err
	}
	_, err = saveArticleProjection(q, tableUID, viewKey, nil, nil, 0, uids, "", author, nil)
	return err
}
