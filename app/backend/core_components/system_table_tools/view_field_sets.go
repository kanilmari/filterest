// view_field_sets.go
// Serves reusable dataset field collections and their per-view assignments.
// Bridges authenticated users, stable table-view keys, and column metadata.
// Exists so personal visibility can override a site default without becoming an authorization rule.
package system_table_tools

import (
	"net/http"
	"regexp"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

var stableViewKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

type viewFieldSet struct {
	ID             int64    `json:"id"`
	Name           string   `json:"name"`
	Scope          string   `json:"scope"`
	VisibleColumns []string `json:"visible_columns"`
}

type viewFieldSetColumn struct {
	ColumnUID  int    `json:"column_uid"`
	ColumnName string `json:"column_name"`
}

type viewFieldSetsResponse struct {
	Dataset            string                        `json:"dataset"`
	ViewKey            string                        `json:"view_key"`
	EffectiveScope     string                        `json:"effective_scope"`
	ActiveFieldSetID   *int64                        `json:"active_field_set_id,omitempty"`
	PersonalFieldSetID *int64                        `json:"personal_field_set_id,omitempty"`
	SiteFieldSetID     *int64                        `json:"site_default_field_set_id,omitempty"`
	AvailableColumns   []string                      `json:"available_columns"`
	AvailableDetails   []viewFieldSetColumn          `json:"available_column_details"`
	MetadataColumns    []string                      `json:"metadata_visible_columns"`
	VisibleColumns     []string                      `json:"visible_columns"`
	FieldSets          []viewFieldSet                `json:"field_sets"`
	GroupAssignments   []viewFieldSetGroupAssignment `json:"group_assignments"`
	CanEditPersonal    bool                          `json:"can_edit_personal"`
	CanEditSiteDefault bool                          `json:"can_edit_site_default"`
}

type viewFieldSetGroupAssignment struct {
	GroupID       int64  `json:"group_id"`
	GroupName     string `json:"group_name"`
	FieldSetID    *int64 `json:"field_set_id,omitempty"`
	GroupPriority int    `json:"group_priority"`
}

type saveViewFieldSetRequest struct {
	Dataset        string                         `json:"dataset"`
	ViewKey        string                         `json:"view_key"`
	FieldSetID     int64                          `json:"field_set_id,omitempty"`
	Name           string                         `json:"name"`
	VisibleColumns []string                       `json:"visible_columns"`
	TargetScope    string                         `json:"target_scope,omitempty"`
	TargetGroupIDs []int64                        `json:"target_group_ids,omitempty"`
	GroupPriority  int                            `json:"group_priority,omitempty"`
	ReplaceTargets bool                           `json:"replace_targets,omitempty"`
	GroupVariants  []saveViewFieldSetGroupVariant `json:"group_variants,omitempty"`
}

type saveViewFieldSetGroupVariant struct {
	GroupID        int64    `json:"group_id"`
	GroupPriority  int      `json:"group_priority"`
	VisibleColumns []string `json:"visible_columns"`
}

type savedViewFieldSetGroupVariant struct {
	GroupID        int64    `json:"group_id"`
	FieldSetID     int64    `json:"field_set_id"`
	GroupPriority  int      `json:"group_priority"`
	VisibleColumns []string `json:"visible_columns"`
}

type assignViewFieldSetRequest struct {
	Dataset        string  `json:"dataset"`
	ViewKey        string  `json:"view_key"`
	FieldSetID     int64   `json:"field_set_id"`
	TargetScope    string  `json:"target_scope,omitempty"`
	TargetGroupIDs []int64 `json:"target_group_ids,omitempty"`
	GroupPriority  int     `json:"group_priority,omitempty"`
}

type resetViewFieldSetRequest struct {
	Dataset string `json:"dataset"`
	ViewKey string `json:"view_key"`
}

type resetSharedViewFieldSetRequest struct {
	Dataset        string  `json:"dataset"`
	ViewKey        string  `json:"view_key"`
	TargetScope    string  `json:"target_scope"`
	TargetGroupIDs []int64 `json:"target_group_ids,omitempty"`
}

type deleteViewFieldSetRequest struct {
	FieldSetID int64 `json:"field_set_id"`
}

// GetViewFieldSetsHandler resolves personal > group > site > metadata defaults.
// Guest readers receive the applicable shared/default layer without personal data.
func GetViewFieldSetsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := readableViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	dataset, viewKey, err := validateViewFieldSetTarget(r.URL.Query().Get("dataset"), r.URL.Query().Get("view_key"))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tableUID, viewID, err := resolveViewFieldSetTarget(backend.Db, dataset, viewKey)
	if err != nil {
		respondViewFieldSetLookupError(w, err)
		return
	}
	if err := authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	sets, err := listAccessibleViewFieldSets(backend.Db, tableUID, int64(userID))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collections unavailable")
		return
	}
	allowedColumns, err := selectableViewFieldSetColumns(userID, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field permissions unavailable")
		return
	}
	sets = filterViewFieldSetsByPermission(sets, allowedColumns)
	availableDetails, err := orderedSelectableViewFieldSetColumnDetails(backend.Db, tableUID, allowedColumns)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field metadata unavailable")
		return
	}
	availableColumns := make([]string, 0, len(availableDetails))
	for _, column := range availableDetails {
		availableColumns = append(availableColumns, column.ColumnName)
	}
	metadataColumns, err := metadataVisibleViewFieldColumns(backend.Db, tableUID, viewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field metadata defaults unavailable")
		return
	}
	metadataColumns = filterViewFieldColumnNames(metadataColumns, allowedColumns)

	activeID, scope, visibleColumns, err := resolveEffectiveViewFieldSet(backend.Db, tableUID, viewID, int64(userID), viewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment unavailable")
		return
	}
	visibleColumns = filterViewFieldColumnNames(visibleColumns, allowedColumns)
	personalID, siteID, err := resolveViewFieldSetAssignments(backend.Db, tableUID, viewID, int64(userID))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignments unavailable")
		return
	}
	canEditSite, err := viewFieldSetUserIsAdmin(backend.Db, int64(userID))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "administrator status unavailable")
		return
	}
	groupAssignments := []viewFieldSetGroupAssignment{}
	if canEditSite {
		groupAssignments, err = listViewFieldSetGroupAssignments(backend.Db, tableUID, viewID)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "group field assignments unavailable")
			return
		}
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, viewFieldSetsResponse{
		Dataset: dataset, ViewKey: viewKey, EffectiveScope: scope,
		ActiveFieldSetID: activeID, PersonalFieldSetID: personalID,
		SiteFieldSetID: siteID, AvailableColumns: availableColumns,
		AvailableDetails: availableDetails,
		MetadataColumns:  metadataColumns, VisibleColumns: visibleColumns,
		FieldSets: sets, GroupAssignments: groupAssignments,
		CanEditPersonal: userID > 1, CanEditSiteDefault: canEditSite,
	})
}
