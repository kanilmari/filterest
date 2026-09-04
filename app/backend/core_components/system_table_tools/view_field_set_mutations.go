// view_field_set_mutations.go
// Saves, assigns, resets, and deletes personal or administrator-owned field collections.
// Bridges validated field-set requests with transaction-scoped persistence and cache invalidation.
// Exists so all write endpoints share the same target, permission, and post-commit behavior.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
)

// scheduleViewFieldSetCacheInvalidation clears effective field selections only
// after a successful request commit. This prevents an immediate read from
// repopulating the cache with the pre-commit assignment or member list.
func scheduleViewFieldSetCacheInvalidation(
	ctx context.Context,
	dataset string,
	viewKey string,
) {
	hook := func() {
		dtt_1_row_read.InvalidateUserColumnSettingsCache(dataset, viewKey)
	}
	if !dbutils.RegisterAfterCommitHook(ctx, hook) {
		hook()
	}
}

// SavePersonalViewFieldSetHandler creates/updates a named personal collection
// and makes it active for the requested view. The owner always comes from session.
func SavePersonalViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	saveViewFieldSet(w, r, false)
}

// SaveSiteViewFieldSetHandler creates or updates a shared collection and assigns
// it to an exact site/group target. The administrator pipeline protects the route.
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
	if request.FieldSetID < 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "field_set_id cannot be negative")
		return
	}
	if request.ReplaceTargets && !siteDefault {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "personal field collections cannot replace shared targets")
		return
	}
	request.TargetGroupIDs, err = normalizeViewFieldSetGroupTargets(request.TargetGroupIDs, request.GroupPriority)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.TargetScope, err = normalizeViewFieldSetTargetScope(siteDefault, request.TargetScope, request.TargetGroupIDs)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !siteDefault && len(request.TargetGroupIDs) > 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "personal field collections cannot target groups")
		return
	}
	hasGroupVariants := len(request.GroupVariants) > 0
	if hasGroupVariants {
		if !siteDefault || request.TargetScope != "groups" || !request.ReplaceTargets || request.FieldSetID != 0 {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "group variants require an exact administrator group replacement")
			return
		}
		request.GroupVariants, err = normalizeViewFieldSetGroupVariants(
			request.GroupVariants,
			request.TargetGroupIDs,
		)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		request.VisibleColumns, err = normalizeVisibleColumnNames(request.VisibleColumns)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
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
	if siteDefault {
		if err := validateViewFieldSetGroupTargets(tx, request.TargetGroupIDs); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	allowedColumns, err := selectableViewFieldSetColumns(userID, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field permissions unavailable")
		return
	}
	if hasGroupVariants {
		columnUIDsByGroup := make(map[int64][]int, len(request.GroupVariants))
		for _, variant := range request.GroupVariants {
			for _, column := range variant.VisibleColumns {
				if !allowedColumns[column] {
					httpresponse.RespondWithError(w, http.StatusForbidden, "visible column is not permitted")
					return
				}
			}
			columnUIDsByGroup[variant.GroupID], err = resolveVisibleColumnUIDs(
				tx,
				tableUID,
				variant.VisibleColumns,
			)
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		savedVariants, saveErr := saveViewFieldSetGroupVariants(
			tx,
			tableUID,
			viewID,
			int64(userID),
			request.Name,
			request.GroupVariants,
			columnUIDsByGroup,
		)
		if saveErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "group field variants save failed")
			return
		}
		scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"status":           "ok",
			"scope":            "group_variants",
			"target_group_ids": request.TargetGroupIDs,
			"group_variants":   savedVariants,
		})
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
	fieldSetID := request.FieldSetID
	if fieldSetID > 0 {
		var editable bool
		err = tx.QueryRow(`SELECT EXISTS (
			SELECT 1
			FROM public.system_column_field_sets
			WHERE id = $1 AND table_uid = $2
			  AND owner_user_id IS NOT DISTINCT FROM $3
		)`, fieldSetID, tableUID, owner).Scan(&editable)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection validation failed")
			return
		}
		if !editable {
			httpresponse.RespondWithError(w, http.StatusForbidden, "field collection is not editable")
			return
		}
		if _, err := tx.Exec(`
			UPDATE public.system_column_field_sets
			SET name = $1, updated = now()
			WHERE id = $2`, request.Name, fieldSetID); err != nil {
			httpresponse.RespondWithError(w, http.StatusConflict, "field collection name is already in use")
			return
		}
	} else {
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

	if siteDefault && request.ReplaceTargets {
		if err := replaceSharedViewFieldSetAssignmentTargets(
			tx,
			tableUID,
			viewID,
			fieldSetID,
		); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection target replacement failed")
			return
		}
	}

	assignmentScope, err := saveViewFieldSetAssignments(
		tx,
		int64(userID),
		tableUID,
		viewID,
		fieldSetID,
		siteDefault,
		request.TargetGroupIDs,
		request.GroupPriority,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment failed")
		return
	}

	response := map[string]interface{}{
		"status": "ok", "field_set_id": fieldSetID,
		"scope":            assignmentScope,
		"target_group_ids": request.TargetGroupIDs,
		"visible_columns":  request.VisibleColumns,
	}
	if siteDefault {
		_, siteFieldSetID, readbackErr := resolveViewFieldSetAssignments(
			tx,
			tableUID,
			viewID,
			int64(userID),
		)
		if readbackErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment readback failed")
			return
		}
		groupAssignments, readbackErr := listViewFieldSetGroupAssignments(tx, tableUID, viewID)
		if readbackErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "group field assignment readback failed")
			return
		}
		if request.ReplaceTargets && !viewFieldSetTargetReadbackMatches(
			fieldSetID,
			assignmentScope,
			request.TargetGroupIDs,
			siteFieldSetID,
			groupAssignments,
		) {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection target readback mismatch")
			return
		}
		response["site_default_field_set_id"] = siteFieldSetID
		response["group_assignments"] = groupAssignments
	}
	scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
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
	request.TargetGroupIDs, err = normalizeViewFieldSetGroupTargets(request.TargetGroupIDs, request.GroupPriority)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.TargetScope, err = normalizeViewFieldSetTargetScope(siteDefault, request.TargetScope, request.TargetGroupIDs)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !siteDefault && len(request.TargetGroupIDs) > 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "personal field collections cannot target groups")
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
	if siteDefault {
		if err := validateViewFieldSetGroupTargets(tx, request.TargetGroupIDs); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
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
	assignmentScope, err := saveViewFieldSetAssignments(
		tx,
		int64(userID),
		tableUID,
		viewID,
		request.FieldSetID,
		siteDefault,
		request.TargetGroupIDs,
		request.GroupPriority,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "field collection assignment failed")
		return
	}
	scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok", "scope": assignmentScope,
		"target_group_ids": request.TargetGroupIDs,
	})
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
	scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ResetSharedViewFieldSetHandler removes only the administrator-selected site
// or group assignments. It leaves reusable field collections and every other
// target intact so an override can be removed without deleting shared content.
func ResetSharedViewFieldSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := authenticatedViewFieldSetUserID(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request resetSharedViewFieldSetRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	dataset, viewKey, err := validateViewFieldSetTarget(request.Dataset, request.ViewKey)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.TargetGroupIDs, err = normalizeViewFieldSetGroupTargets(request.TargetGroupIDs, 0)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	request.TargetScope, err = normalizeViewFieldSetTargetScope(
		true,
		request.TargetScope,
		request.TargetGroupIDs,
	)
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
	if err := validateViewFieldSetGroupTargets(tx, request.TargetGroupIDs); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	removedAssignments := int64(0)
	if request.TargetScope == "site" {
		result, deleteErr := tx.Exec(`
			DELETE FROM public.system_view_field_set_assignments
			WHERE table_uid = $1 AND view_id = $2
			  AND user_id IS NULL AND group_id IS NULL`, tableUID, viewID)
		if deleteErr != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "site field assignment reset failed")
			return
		}
		removedAssignments, _ = result.RowsAffected()
	} else {
		for _, groupID := range request.TargetGroupIDs {
			result, deleteErr := tx.Exec(`
				DELETE FROM public.system_view_field_set_assignments
				WHERE table_uid = $1 AND view_id = $2
				  AND user_id IS NULL AND group_id = $3`, tableUID, viewID, groupID)
			if deleteErr != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "group field assignment reset failed")
				return
			}
			removed, _ := result.RowsAffected()
			removedAssignments += removed
		}
	}

	scheduleViewFieldSetCacheInvalidation(r.Context(), dataset, viewKey)
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status":              "ok",
		"scope":               request.TargetScope,
		"target_group_ids":    request.TargetGroupIDs,
		"removed_assignments": removedAssignments,
	})
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
	scheduleViewFieldSetCacheInvalidation(r.Context(), "", "")
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
