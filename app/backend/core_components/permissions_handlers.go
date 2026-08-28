// permissions_handlers.go
// HTTP handlers for reading and managing user group permissions.
// Receives requests from the frontend permissions UI and interacts with the
// database to list, update, and validate group-level access rights.
package backend

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
		log.Printf("\033[31merror decoding data: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	type funcInfo struct {
		tableRelated bool
		uiOnly       bool
	}
	fCache := make(map[int]funcInfo)

	for _, perm := range payload.Permissions {
		info, ok := fCache[perm.FunctionID]
		if !ok {
			err := Db.QueryRow(
				"SELECT COALESCE(specific_table_related, true), COALESCE(ui_only, false) FROM system_functions WHERE id = $1",
				perm.FunctionID,
			).Scan(&info.tableRelated, &info.uiOnly)
			if err != nil {
				log.Printf("\033[31merror in function check: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error in function check")
				return
			}
			fCache[perm.FunctionID] = info
		}
		if !info.tableRelated && (perm.TargetTableUID != 0 || perm.TargetTableName != "") {
			log.Printf("\033[31merror: table-specific permissions not allowed for function %d\033[0m", perm.FunctionID)
			httpresponse.RespondWithError(w, http.StatusBadRequest, "error: table-specific permissions not allowed for this function")
			return
		}
	}

	if len(payload.Permissions) == 0 {
		schemaName := r.URL.Query().Get("schema")
		if schemaName == "" {
			schemaName = "public"
		}
		tableName := r.URL.Query().Get("dataset")
		tableUIDStr := r.URL.Query().Get("dataset_uid")
		if tableUIDStr == "" && tableName != "" {
			if uid, err := getTableUIDByName(tableName, Db); err == nil {
				tableUIDStr = fmt.Sprintf("%d", uid)
			}
		}
		if tableName == "" && tableUIDStr != "" {
			if scanErr := Db.QueryRow(`SELECT table_name FROM system_db_tables WHERE table_uid=$1`, tableUIDStr).Scan(&tableName); scanErr != nil {
				log.Printf("[DeletePermissions] warning: could not resolve table_name for uid %s: %v", tableUIDStr, scanErr)
			}
		}

		isTableless := tableUIDStr == "" && tableName == ""
		var uiDeleted int
		if isTableless {
			countQuery := `SELECT COUNT(*) FROM system_group_table_func_rights gf JOIN system_functions f ON gf.function_id = f.id WHERE gf.target_schema_name = $1 AND gf.target_table_uid IS NULL AND f.ui_only = true`
			if scanErr := Db.QueryRow(countQuery, schemaName).Scan(&uiDeleted); scanErr != nil {
				log.Printf("[DeletePermissions] warning: could not count UI-only rights: %v", scanErr)
			}
			delQuery := `DELETE FROM system_group_table_func_rights WHERE target_schema_name = $1 AND target_table_uid IS NULL`
			res, err := Db.Exec(delQuery, schemaName)
			if err != nil {
				log.Printf("\033[31merror deleting permissions: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error deleting permissions")
				return
			}
			rowsDeleted, _ := res.RowsAffected()
			log.Printf("Deleted %d tableless permissions from schema %s", rowsDeleted, schemaName)
		} else {
			countQuery := `SELECT COUNT(*) FROM system_group_table_func_rights gf JOIN system_functions f ON gf.function_id = f.id WHERE gf.target_schema_name = $1 AND gf.target_table_uid = $2 AND f.ui_only = true`
			if scanErr := Db.QueryRow(countQuery, schemaName, tableUIDStr).Scan(&uiDeleted); scanErr != nil {
				log.Printf("[DeletePermissions] warning: could not count UI-only rights for table %s: %v", tableUIDStr, scanErr)
			}
			delQuery := `DELETE FROM system_group_table_func_rights WHERE target_schema_name = $1 AND target_table_uid = $2`
			res, err := Db.Exec(delQuery, schemaName, tableUIDStr)
			if err != nil {
				log.Printf("\033[31merror deleting permissions: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error deleting permissions")
				return
			}
			rowsDeleted, _ := res.RowsAffected()
			log.Printf("Deleted %d permissions from table %s.%s", rowsDeleted, schemaName, tableName)
		}
		log.Printf("UI permissions deleted: %d", uiDeleted)

		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "permissions deleted"})
		return
	}

	tableName := payload.Permissions[0].TargetTableName
	schemaName := payload.Permissions[0].TargetSchemaName
	tableUID := payload.Permissions[0].TargetTableUID
	if schemaName == "" {
		schemaName = "public"
	}
	if tableName == "" && tableUID != 0 {
		if scanErr := Db.QueryRow(`SELECT table_name FROM system_db_tables WHERE table_uid = $1`, tableUID).Scan(&tableName); scanErr != nil {
			log.Printf("[SavePermissions] warning: could not resolve table_name for uid %d: %v", tableUID, scanErr)
		}
	}

	if tableUID == 0 && tableName == "" {
		// *** Tauluton tapaus => Poistetaan entiset "table_name = ''" -rivimme ja lisätään uudet
		deleteQuery := `
           DELETE FROM system_group_table_func_rights
           WHERE target_schema_name = $1
             AND target_table_uid IS NULL
       `
		res, err := Db.Exec(deleteQuery, schemaName)
		if err != nil {
			log.Printf("\033[31merror deleting old tableless permissions: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error deleting old tableless permissions")
			return
		}
		rowsDeleted, _ := res.RowsAffected()
		insertedCount := 0
		uiInserted := 0

		// Lisätään nyt uudet
		for _, perm := range payload.Permissions {
			if perm.TargetTableUID == 0 && perm.TargetTableName != "" {
				uid, err := getTableUIDByName(perm.TargetTableName, Db)
				if err == nil {
					perm.TargetTableUID = uid
				}
			}
			inserted, err := insertPermission(perm)
			if err != nil {
				log.Printf("\033[31merror saving permission: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving permission")
				return
			}
			if inserted {
				insertedCount++
				if fCache[perm.FunctionID].uiOnly {
					uiInserted++
				}
			}
		}
		uiDelQuery := `
                        SELECT COUNT(*) FROM system_group_table_func_rights gf
                        JOIN system_functions f ON gf.function_id = f.id
                        WHERE gf.target_schema_name = $1 AND gf.target_table_uid IS NULL AND f.ui_only = true`
		var uiDeleted int
		if scanErr := Db.QueryRow(uiDelQuery, schemaName).Scan(&uiDeleted); scanErr != nil {
			log.Printf("[SavePermissions] warning: could not count UI-only rights: %v", scanErr)
		}
		log.Printf("Deleted %d old tableless permissions from schema %s, inserted %d permissions", rowsDeleted, schemaName, insertedCount)
		log.Printf("UI permissions deleted: %d, inserted: %d", uiDeleted, uiInserted)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"message": "permissions saved (old deleted, new added)",
		})
		return

	} else {
		// *** Taulukohtainen tapaus
		countQuery := `
            SELECT COUNT(*) FROM system_group_table_func_rights
            WHERE target_schema_name = $1 AND target_table_uid = $2
        `
		var count int
		if err := Db.QueryRow(countQuery, schemaName, tableUID).Scan(&count); err != nil {
			log.Printf("\033[31merror counting existing permissions: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error counting existing permissions")
			return
		}

		rowsDeleted := int64(0)
		if count > 0 {
			delQuery := `
                DELETE FROM system_group_table_func_rights
                WHERE target_schema_name = $1 AND target_table_uid = $2
            `
			res, err := Db.Exec(delQuery, schemaName, tableUID)
			if err != nil {
				log.Printf("\033[31merror deleting old permissions: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error deleting old permissions")
				return
			}
			rowsDeleted, _ = res.RowsAffected()
		}

		insertedCount := 0
		uiInserted := 0
		for _, perm := range payload.Permissions {
			if perm.TargetTableUID == 0 && perm.TargetTableName != "" {
				uid, err := getTableUIDByName(perm.TargetTableName, Db)
				if err == nil {
					perm.TargetTableUID = uid
				}
			}
			inserted, err := insertPermission(perm)
			if err != nil {
				log.Printf("\033[31merror saving permission: %v\033[0m", err)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving permission")
				return
			}
			if inserted {
				insertedCount++
				if fCache[perm.FunctionID].uiOnly {
					uiInserted++
				}
			}
		}

		uiDelQuery := `
                        SELECT COUNT(*) FROM system_group_table_func_rights gf
                        JOIN system_functions f ON gf.function_id = f.id
                        WHERE gf.target_schema_name = $1 AND gf.target_table_uid = $2 AND f.ui_only = true`
		var uiDeleted int
		if scanErr := Db.QueryRow(uiDelQuery, schemaName, tableUID).Scan(&uiDeleted); scanErr != nil {
			log.Printf("[SavePermissions] warning: could not count UI-only rights: %v", scanErr)
		}

		log.Printf("Deleted %d old permissions from table %s.%s, inserted %d permissions", rowsDeleted, schemaName, tableName, insertedCount)
		log.Printf("UI permissions deleted: %d, inserted: %d", uiDeleted, uiInserted)

		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"message": "permissions saved successfully",
		})
	}
}

func patchPermissions(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Add    []Permission `json:"add"`
		Remove []Permission `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		log.Printf("\033[31merror decoding data: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	added := make(map[string]int)
	removed := make(map[string]int)
	for _, p := range payload.Add {
		resolvedPermission, err := resolveTableSpecificPermissionTarget(p, func(name string) (int, error) {
			return getTableUIDByName(name, Db)
		})
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
			return
		}
		p = resolvedPermission

		ok, err := insertPermission(p)
		if err != nil {
			log.Printf("\033[31merror inserting permission: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error inserting permission")
			return
		}
		if ok {
			key := fmt.Sprintf("%s.%s", p.TargetSchemaName, p.TargetTableName)
			added[key]++
		}
	}

	delQuery := `DELETE FROM system_group_table_func_rights
WHERE user_group_id=$1 AND function_id=$2 AND COALESCE(target_schema_name,'')=COALESCE($3,'') AND COALESCE(target_table_uid,0)=COALESCE($4,0)`
	for _, p := range payload.Remove {
		resolvedPermission, err := resolveTableSpecificPermissionTarget(p, func(name string) (int, error) {
			return getTableUIDByName(name, Db)
		})
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid target dataset")
			return
		}
		p = resolvedPermission
		var uid sql.NullInt64
		if p.TargetTableUID != 0 {
			uid = sql.NullInt64{Int64: int64(p.TargetTableUID), Valid: true}
		}
		res, err := Db.Exec(delQuery, p.AuthUserGroupID, p.FunctionID, sql.NullString{String: p.TargetSchemaName, Valid: p.TargetSchemaName != ""}, uid)
		if err != nil {
			log.Printf("\033[31merror removing permission: %v\033[0m", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error removing permission")
			return
		}
		count, _ := res.RowsAffected()
		if count > 0 {
			key := fmt.Sprintf("%s.%s", p.TargetSchemaName, p.TargetTableName)
			removed[key] += int(count)
		}
	}

	for tbl, cnt := range added {
		log.Printf("added %d permissions to table %s", cnt, tbl)
	}
	for tbl, cnt := range removed {
		log.Printf("removed %d permissions from table %s", cnt, tbl)
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "permissions updated"})
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
