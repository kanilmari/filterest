// permissions_handlers.go
// HTTP handlers for reading and managing user group permissions.
// Receives requests from the frontend permissions UI and interacts with the
// database to list, update, and validate group-level access rights.
package backend

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grant_mutations"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

func PermissionsHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("PermissionsHandler %s %s", r.Method, r.URL.Path)
	switch r.Method {
	case http.MethodGet:
		getPermissions(w, r)
	case http.MethodPost:
		createPermissions(w, r)
	case http.MethodPatch:
		patchPermissions(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func getPermissions(w http.ResponseWriter, _ *http.Request) {
	query := `
       SELECT agr.user_group_id,
              agr.function_id,
              agr.target_schema_name,
              sdt.table_name AS target_table_name,
              COALESCE(agr.target_table_uid, 0) as target_table_uid
       FROM system_group_table_func_rights agr
       JOIN system_functions f ON f.id = agr.function_id AND f.disabled = false
       LEFT JOIN system_db_tables sdt ON sdt.table_uid = agr.target_table_uid
   `
	rows, err := Db.Query(query)
	if err != nil {
		log.Printf("\033[31merror fetching permissions: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching permissions")
		return
	}
	defer rows.Close()

	var permissions []Permission
	for rows.Next() {
		var (
			authUserGroupID int
			functionID      int
			targetSchema    sql.NullString
			targetTable     sql.NullString
			targetUID       int
		)
		if err := rows.Scan(&authUserGroupID,
			&functionID,
			&targetSchema,
			&targetTable,
			&targetUID); err != nil {
			log.Printf("\033[31merror reading row: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading row")
			return
		}
		p := Permission{
			AuthUserGroupID: authUserGroupID,
			FunctionID:      functionID,
			TargetTableUID:  targetUID,
		}
		if targetSchema.Valid {
			p.TargetSchemaName = targetSchema.String
		}
		if targetTable.Valid {
			p.TargetTableName = targetTable.String
		}
		permissions = append(permissions, p)
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(permissions); err != nil {
		log.Printf("\033[31merror encoding response: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding response")
	}
}

func createPermissions(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Permissions []Permission `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}
	mutation, err := runtime_grant_mutations.Begin(r.Context(), w)
	if err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	tx := mutation.Tx
	schema := r.URL.Query().Get("schema")
	if schema == "" {
		schema = "public"
	}
	var uid int64
	if len(payload.Permissions) > 0 {
		schema = payload.Permissions[0].TargetSchemaName
		if schema == "" {
			schema = "public"
		}
		for i, permission := range payload.Permissions {
			var tableRelated bool
			if err := tx.QueryRow(`SELECT COALESCE(specific_table_related,true) FROM system_functions WHERE id=$1`, permission.FunctionID).Scan(&tableRelated); err != nil {
				runtime_grant_mutations.RespondError(w, err)
				return
			}
			if !tableRelated && (permission.TargetTableUID != 0 || permission.TargetTableName != "") {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "table-specific permissions not allowed for this function")
				return
			}
			if permission.TargetTableUID == 0 && permission.TargetTableName != "" {
				resolved, err := getTableUIDByName(permission.TargetTableName, tx)
				if err != nil {
					httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
					return
				}
				permission.TargetTableUID = resolved
			}
			if permission.TargetSchemaName == "" {
				permission.TargetSchemaName = schema
			}
			if i > 0 && (permission.TargetSchemaName != schema || permission.TargetTableUID != payload.Permissions[0].TargetTableUID) {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "permission replacement must name one dataset")
				return
			}
			payload.Permissions[i] = permission
		}
		uid = int64(payload.Permissions[0].TargetTableUID)
	} else {
		if value := r.URL.Query().Get("dataset_uid"); value != "" {
			uid, err = strconv.ParseInt(value, 10, 64)
			if err != nil || uid <= 0 {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
				return
			}
		} else if name := r.URL.Query().Get("dataset"); name != "" {
			resolved, err := getTableUIDByName(name, tx)
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
				return
			}
			uid = int64(resolved)
		}
	}
	// Begin captured old targets before replacement, including an empty save.
	var target sql.NullInt64
	if uid != 0 {
		target = sql.NullInt64{Int64: uid, Valid: true}
	}
	if _, err := tx.Exec(`DELETE FROM system_group_table_func_rights WHERE target_schema_name=$1 AND target_table_uid IS NOT DISTINCT FROM $2`, schema, target); err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	for _, permission := range payload.Permissions {
		if _, err := insertPermission(tx, permission); err != nil {
			runtime_grant_mutations.RespondError(w, err)
			return
		}
	}
	if err := mutation.Finish(r.Context(), uid); err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusCreated, map[string]string{"message": "permissions saved successfully"})
}

func patchPermissions(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Add    []Permission `json:"add"`
		Remove []Permission `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}
	mutation, err := runtime_grant_mutations.Begin(r.Context(), w)
	if err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	tx := mutation.Tx
	var targets []int64
	for _, batch := range []struct {
		permissions []Permission
		remove      bool
	}{{payload.Add, false}, {payload.Remove, true}} {
		for _, permission := range batch.permissions {
			resolved, err := resolveTableSpecificPermissionTarget(permission, func(name string) (int, error) { return getTableUIDByName(name, tx) })
			if err != nil {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
				return
			}
			permission = resolved
			targets = append(targets, int64(permission.TargetTableUID))
			if batch.remove {
				_, err = tx.Exec(`DELETE FROM system_group_table_func_rights WHERE user_group_id=$1 AND function_id=$2 AND COALESCE(NULLIF(target_schema_name,''),'public')=COALESCE(NULLIF($3,''),'public') AND COALESCE(target_table_uid,0)=$4`, permission.AuthUserGroupID, permission.FunctionID, permission.TargetSchemaName, permission.TargetTableUID)
			} else {
				_, err = insertPermission(tx, permission)
			}
			if err != nil {
				runtime_grant_mutations.RespondError(w, err)
				return
			}
		}
	}
	if err := mutation.Finish(r.Context(), targets...); err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{"message": "permissions updated"})
}

func resolveTableSpecificPermissionTarget(p Permission, lookup func(string) (int, error)) (Permission, error) {
	if p.TargetTableUID != 0 {
		return p, nil
	}
	if p.TargetTableName == "" {
		return p, fmt.Errorf("missing target dataset name")
	}

	uid, err := lookup(p.TargetTableName)
	if err != nil {
		return p, fmt.Errorf("resolve target dataset %q: %w", p.TargetTableName, err)
	}
	p.TargetTableUID = uid
	return p, nil
}
