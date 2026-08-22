// view_field_sets.go
// Serves reusable dataset field collections and their per-view assignments.
// Bridges authenticated users, stable table-view keys, and column metadata.
// Exists so personal visibility can override a site default without becoming an authorization rule.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
)

var stableViewKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

type viewFieldSet struct {
	ID             int64    `json:"id"`
	Name           string   `json:"name"`
	Scope          string   `json:"scope"`
	VisibleColumns []string `json:"visible_columns"`
}

type viewFieldSetsResponse struct {
	Dataset            string         `json:"dataset"`
	ViewKey            string         `json:"view_key"`
	EffectiveScope     string         `json:"effective_scope"`
	ActiveFieldSetID   *int64         `json:"active_field_set_id,omitempty"`
	PersonalFieldSetID *int64         `json:"personal_field_set_id,omitempty"`
	SiteFieldSetID     *int64         `json:"site_default_field_set_id,omitempty"`
	AvailableColumns   []string       `json:"available_columns"`
	VisibleColumns     []string       `json:"visible_columns"`
	FieldSets          []viewFieldSet `json:"field_sets"`
	CanEditSiteDefault bool           `json:"can_edit_site_default"`
}

type saveViewFieldSetRequest struct {
	Dataset        string   `json:"dataset"`
	ViewKey        string   `json:"view_key"`
	Name           string   `json:"name"`
	VisibleColumns []string `json:"visible_columns"`
}

type assignViewFieldSetRequest struct {
	Dataset    string `json:"dataset"`
	ViewKey    string `json:"view_key"`
	FieldSetID int64  `json:"field_set_id"`
}

type resetViewFieldSetRequest struct {
	Dataset string `json:"dataset"`
	ViewKey string `json:"view_key"`
}

type deleteViewFieldSetRequest struct {
	FieldSetID int64 `json:"field_set_id"`
}

// GetViewFieldSetsHandler resolves personal > site > metadata defaults and lists
// the current user's own and shared reusable collections.
func GetViewFieldSetsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
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
	availableColumns, err := orderedSelectableViewFieldSetColumns(backend.Db, tableUID, allowedColumns)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field metadata unavailable")
		return
	}

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

	httpresponse.RespondWithJSON(w, http.StatusOK, viewFieldSetsResponse{
		Dataset: dataset, ViewKey: viewKey, EffectiveScope: scope,
		ActiveFieldSetID: activeID, PersonalFieldSetID: personalID,
		SiteFieldSetID: siteID, AvailableColumns: availableColumns, VisibleColumns: visibleColumns,
		FieldSets: sets, CanEditSiteDefault: canEditSite,
	})
}

// SavePersonalViewFieldSetHandler creates/updates a named personal collection
// and makes it active for the requested view. The owner always comes from session.
func SavePersonalViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	saveViewFieldSet(w, r, false)
}

// SaveSiteViewFieldSetHandler creates/updates a shared collection and assigns it
// as the site default. Its route is protected by the administrator pipeline.
func SaveSiteViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	saveViewFieldSet(w, r, true)
}

func saveViewFieldSet(w http.ResponseWriter, r *http.Request, siteDefault bool) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request saveViewFieldSetRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	dataset, viewKey, err := validateViewFieldSetTarget(request.Dataset, request.ViewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	if len(request.Name) == 0 || len([]rune(request.Name)) > 128 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "name must contain 1-128 characters")
		return
	}
	request.VisibleColumns, err = normalizeVisibleColumnNames(request.VisibleColumns)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	tableUID, viewID, err := resolveViewFieldSetTarget(tx, dataset, viewKey)
	if err != nil {
		respondViewFieldSetLookupError(w, err)
		return
	}
	if err := authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	allowedColumns, err := selectableViewFieldSetColumns(userID, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field permissions unavailable")
		return
	}
	for _, column := range request.VisibleColumns {
		if !allowedColumns[column] {
			httpresponse.RespondWithError(w, http.StatusForbidden, "visible column is not permitted")
			return
		}
	}
	columnUIDs, err := resolveVisibleColumnUIDs(tx, tableUID, request.VisibleColumns)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	var owner interface{} = int64(userID)
	if siteDefault {
		owner = nil
	}
	var fieldSetID int64
	err = tx.QueryRow(`
		INSERT INTO public.system_column_field_sets (table_uid, owner_user_id, name, created_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (table_uid, owner_user_id, name)
		DO UPDATE SET updated = now()
		RETURNING id`, tableUID, owner, request.Name, userID).Scan(&fieldSetID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection save failed")
		return
	}
	if _, err := tx.Exec(`DELETE FROM public.system_column_field_set_members WHERE field_set_id = $1`, fieldSetID); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection member reset failed")
		return
	}
	for index, columnUID := range columnUIDs {
		if _, err := tx.Exec(`
			INSERT INTO public.system_column_field_set_members
			    (field_set_id, table_uid, column_uid, sort_order)
			VALUES ($1, $2, $3, $4)`, fieldSetID, tableUID, columnUID, index+1); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection member save failed")
			return
		}
	}

	var assignmentUser interface{} = int64(userID)
	if siteDefault {
		assignmentUser = nil
	}
	if _, err := tx.Exec(`
		INSERT INTO public.system_view_field_set_assignments
		    (user_id, table_uid, view_id, field_set_id, created_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, table_uid, view_id)
		DO UPDATE SET field_set_id = EXCLUDED.field_set_id,
		              created_by = EXCLUDED.created_by,
		              updated = now()`, assignmentUser, tableUID, viewID, fieldSetID, userID); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment failed")
		return
	}

	dtt_1_row_read.InvalidateUserColumnSettingsCache(dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok", "field_set_id": fieldSetID,
		"scope": map[bool]string{true: "site", false: "personal"}[siteDefault],
	})
}

func AssignPersonalViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	assignViewFieldSet(w, r, false)
}

func AssignSiteViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	assignViewFieldSet(w, r, true)
}

func assignViewFieldSet(w http.ResponseWriter, r *http.Request, siteDefault bool) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request assignViewFieldSetRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.FieldSetID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "valid field_set_id is required")
		return
	}
	dataset, viewKey, err := validateViewFieldSetTarget(request.Dataset, request.ViewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	tableUID, viewID, err := resolveViewFieldSetTarget(tx, dataset, viewKey)
	if err != nil {
		respondViewFieldSetLookupError(w, err)
		return
	}
	if err := authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	var allowed bool
	if siteDefault {
		err = tx.QueryRow(`SELECT EXISTS (
			SELECT 1 FROM public.system_column_field_sets
			WHERE id = $1 AND table_uid = $2 AND owner_user_id IS NULL
		)`, request.FieldSetID, tableUID).Scan(&allowed)
	} else {
		err = tx.QueryRow(`SELECT EXISTS (
			SELECT 1 FROM public.system_column_field_sets
			WHERE id = $1 AND table_uid = $2
			  AND (owner_user_id = $3 OR owner_user_id IS NULL)
		)`, request.FieldSetID, tableUID, userID).Scan(&allowed)
	}
	if err != nil || !allowed {
		httpresponse.RespondWithError(w, http.StatusForbidden, "field collection is not assignable")
		return
	}
	var assignmentUser interface{} = int64(userID)
	if siteDefault {
		assignmentUser = nil
	}
	if _, err := tx.Exec(`
		INSERT INTO public.system_view_field_set_assignments
		    (user_id, table_uid, view_id, field_set_id, created_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, table_uid, view_id)
		DO UPDATE SET field_set_id = EXCLUDED.field_set_id,
		              created_by = EXCLUDED.created_by,
		              updated = now()`, assignmentUser, tableUID, viewID, request.FieldSetID, userID); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment failed")
		return
	}
	dtt_1_row_read.InvalidateUserColumnSettingsCache(dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ResetPersonalViewFieldSetHandler removes only the session user's assignment;
// the site default or metadata default becomes effective immediately.
func ResetPersonalViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request resetViewFieldSetRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	dataset, viewKey, err := validateViewFieldSetTarget(request.Dataset, request.ViewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	tableUID, viewID, err := resolveViewFieldSetTarget(tx, dataset, viewKey)
	if err != nil {
		respondViewFieldSetLookupError(w, err)
		return
	}
	if err := authorizeViewFieldSetDatasetRead(tableUID, userID); err != nil {
		respondViewFieldSetAuthorizationError(w, err)
		return
	}
	if _, err := tx.Exec(`
		DELETE FROM public.system_view_field_set_assignments
		WHERE user_id = $1 AND table_uid = $2 AND view_id = $3`, userID, tableUID, viewID); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "personal field selection reset failed")
		return
	}
	dtt_1_row_read.InvalidateUserColumnSettingsCache(dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func DeletePersonalViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	deleteViewFieldSet(w, r, false)
}

func DeleteSharedViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	deleteViewFieldSet(w, r, true)
}

func deleteViewFieldSet(w http.ResponseWriter, r *http.Request, shared bool) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request deleteViewFieldSetRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.FieldSetID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "valid field_set_id is required")
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction unavailable")
		return
	}
	var result sql.Result
	if shared {
		result, err = tx.Exec(`DELETE FROM public.system_column_field_sets WHERE id = $1 AND owner_user_id IS NULL`, request.FieldSetID)
	} else {
		result, err = tx.Exec(`DELETE FROM public.system_column_field_sets WHERE id = $1 AND owner_user_id = $2`, request.FieldSetID, userID)
	}
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection delete failed")
		return
	}
	deleted, _ := result.RowsAffected()
	if deleted == 0 {
		httpresponse.RespondWithError(w, http.StatusNotFound, "field collection not found")
		return
	}
	dtt_1_row_read.InvalidateUserColumnSettingsCache("", "")
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func authenticatedViewFieldSetUserID(r *http.Request) (int, error) {
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 1 {
		return 0, fmt.Errorf("authenticated user required")
	}
	return userID, nil
}

func validateViewFieldSetTarget(rawDataset, rawViewKey string) (string, string, error) {
	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(rawDataset))
	if err != nil {
		return "", "", fmt.Errorf("invalid dataset")
	}
	viewKey := strings.ToLower(strings.TrimSpace(rawViewKey))
	if !stableViewKeyPattern.MatchString(viewKey) {
		return "", "", fmt.Errorf("invalid view_key")
	}
	return dataset, viewKey, nil
}

func resolveViewFieldSetTarget(q dbutils.Querier, dataset, viewKey string) (int, int, error) {
	var tableUID, viewID int
	err := q.QueryRow(`
		SELECT tables.table_uid, views.id
		FROM public.system_db_tables AS tables
		CROSS JOIN public.system_table_views AS views
		WHERE tables.table_name = $1
		  AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
		  AND views.view_key = $2
		LIMIT 1`, dataset, viewKey).Scan(&tableUID, &viewID)
	return tableUID, viewID, err
}

func respondViewFieldSetLookupError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset or view not found")
		return
	}
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset/view lookup failed")
}

func normalizeVisibleColumnNames(columns []string) ([]string, error) {
	seen := make(map[string]bool, len(columns))
	result := make([]string, 0, len(columns))
	for _, raw := range columns {
		column, err := security.SanitizeIdentifier(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("invalid visible column")
		}
		if !seen[column] {
			seen[column] = true
			result = append(result, column)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("at least one visible column is required")
	}
	return result, nil
}

func resolveVisibleColumnUIDs(q dbutils.Querier, tableUID int, columns []string) ([]int, error) {
	columnUIDs := make([]int, 0, len(columns))
	for _, column := range columns {
		var columnUID int
		err := q.QueryRow(`
			SELECT column_uid
			FROM public.system_column_details
			WHERE table_uid = $1 AND column_name = $2
			  AND COALESCE(hide_everywhere, false) = false`, tableUID, column).Scan(&columnUID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("visible column is unavailable")
		}
		if err != nil {
			return nil, fmt.Errorf("visible column validation failed")
		}
		columnUIDs = append(columnUIDs, columnUID)
	}
	return columnUIDs, nil
}
