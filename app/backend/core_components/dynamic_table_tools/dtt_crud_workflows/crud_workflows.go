// crud_workflows.go
// HTTP handlers and orchestration logic for table and column CRUD operations.
// Includes CreateTableHandler, ModifyColumnsHandler, and bridging helpers that
// coordinate column add/remove/update with OID and metadata refresh.

package dtt_crud_workflows

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_create"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
)

type CreateTableRequest struct {
	TableName       string            `json:"dataset_name"`
	Columns         map[string]string `json:"columns"`
	ColumnCardRoles map[string]string `json:"column_card_roles,omitempty"`
	ForeignKeys     []ForeignKeyDef   `json:"foreign_keys"`
	GrantUsersRead  bool              `json:"grant_users_read"`
	GrantGuestsRead bool              `json:"grant_guests_read"`
	PreventDeletion bool              `json:"prevent_deletion"`
	// NewColumnsMultilingual sets the dataset's own text-language default, the
	// same choice the editing form offers, so a dataset can be born
	// multilingual instead of having to be corrected right afterwards.
	NewColumnsMultilingual *bool            `json:"new_columns_multilingual,omitempty"`
	FolderID               *int             `json:"folder_id"`
	CreateFolder           *CreateFolderDef `json:"create_folder"`
}

type CreateFolderDef struct {
	FolderName string `json:"folder_name"`
	ParentID   *int   `json:"parent_id"`
}

type ForeignKeyDef struct {
	ReferencingColumn string `json:"referencing_column"`
	ReferencedTable   string `json:"referenced_dataset"`
	ReferencedColumn  string `json:"referenced_column"`
}

// allowedExactTypes matches types with no parameters (e.g. TEXT, BOOLEAN).
// allowedParamTypes matches types that accept a parenthesized parameter (e.g. VARCHAR(255)).
var allowedExactTypes = map[string]bool{
	"SERIAL":                   true,
	"BIGSERIAL":                true,
	"INTEGER":                  true,
	"BIGINT":                   true,
	"SMALLINT":                 true,
	"TEXT":                     true,
	"BOOLEAN":                  true,
	"DATE":                     true,
	"TIMESTAMP":                true,
	"TIMESTAMPTZ":              true,
	"TIMESTAMP WITH TIME ZONE": true,
	"JSONB":                    true,
	"JSON":                     true,
}

var allowedParamTypes = map[string]bool{
	"VARCHAR":   true,
	"CHAR":      true,
	"NUMERIC":   true,
	"DECIMAL":   true,
	"TIMESTAMP": true,
}

func isAllowedDataType(colType string) bool {
	baseType, suffix, ok := splitAllowedBaseType(colType)
	if !ok {
		return false
	}

	// Exact match (no parentheses)
	if allowedExactTypes[baseType] || allowedParamTypes[baseType] {
		return isAllowedTypeSuffix(suffix)
	}

	return false
}

// splitAllowedBaseType extracts the allowlisted base type and leaves any trailing
// inline constraints for separate validation.
func splitAllowedBaseType(colType string) (string, string, bool) {
	c := normalizeTypeDefinition(colType)

	// Direct types are checked longest-first; VARCHAR also allows an omitted length.
	for _, exactType := range []string{"TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ", "BIGSERIAL", "SMALLINT", "INTEGER", "BIGINT", "BOOLEAN", "TIMESTAMP", "SERIAL", "TEXT", "DATE", "JSONB", "JSON", "VARCHAR"} {
		if c == exactType {
			return exactType, "", true
		}
		if strings.HasPrefix(c, exactType+" ") {
			suffix := strings.TrimSpace(strings.TrimPrefix(c, exactType))
			if exactType == "VARCHAR" && strings.HasPrefix(suffix, "(") {
				continue // Preserve the parameterized VARCHAR (length) spelling below.
			}
			return exactType, suffix, true
		}
	}

	// Parameterized match: extract base type before '('
	if parenIdx := strings.Index(c, "("); parenIdx != -1 {
		closeParenIdx := strings.Index(c[parenIdx:], ")")
		if closeParenIdx == -1 {
			return "", "", false // malformed: opening paren without closing
		}
		closeParenIdx += parenIdx

		base := strings.TrimSpace(c[:parenIdx])
		params := strings.TrimSpace(c[parenIdx+1 : closeParenIdx])
		if params == "" || strings.Contains(params, "(") || strings.Contains(params, ")") {
			return "", "", false
		}
		if !allowedParamTypes[base] {
			return "", "", false
		}

		return base, strings.TrimSpace(c[closeParenIdx+1:]), true
	}

	return "", "", false
}

func normalizeTypeDefinition(colType string) string {
	return strings.Join(strings.Fields(strings.ToUpper(strings.TrimSpace(colType))), " ")
}

// isAllowedTypeSuffix validates safe inline constraints after the base type.
func isAllowedTypeSuffix(suffix string) bool {
	remaining := strings.TrimSpace(suffix)
	if remaining == "" {
		return true
	}

	if strings.HasPrefix(remaining, "NOT NULL") {
		remaining = strings.TrimSpace(strings.TrimPrefix(remaining, "NOT NULL"))
	} else if strings.HasPrefix(remaining, "NULL") {
		remaining = strings.TrimSpace(strings.TrimPrefix(remaining, "NULL"))
	}

	if remaining == "" {
		return true
	}

	if strings.HasPrefix(remaining, "DEFAULT ") {
		return isAllowedDefaultExpression(strings.TrimSpace(strings.TrimPrefix(remaining, "DEFAULT ")))
	}

	return false
}

func isAllowedDefaultExpression(expr string) bool {
	switch strings.TrimSpace(expr) {
	case "NOW()", "CURRENT_TIMESTAMP", "CURRENT_DATE", "TRUE", "FALSE", "NULL":
		return true
	}

	return isSimpleNumericLiteral(expr)
}

func isSimpleNumericLiteral(expr string) bool {
	value := strings.TrimSpace(expr)
	if value == "" {
		return false
	}

	digitSeen := false
	dotSeen := false
	for idx, r := range value {
		switch {
		case (r == '+' || r == '-') && idx == 0:
			continue
		case r >= '0' && r <= '9':
			digitSeen = true
		case r == '.' && !dotSeen:
			dotSeen = true
		default:
			return false
		}
	}

	return digitSeen
}

func CreateTableHandler(w http.ResponseWriter, r *http.Request) {

	var req CreateTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid input: %w", err).Error())
		return
	}

	tableName, err := security.SanitizeIdentifier(req.TableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if len(req.Columns) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "at least one column is required")
		return
	}

	sanitizedColumns := make(map[string]string)
	for colName, colType := range req.Columns {
		sColName, err := security.SanitizeIdentifier(colName)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid column name: %s", colName))
			return
		}
		if !isAllowedDataType(colType) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("column '%s' uses a forbidden data type '%s'", colName, colType))
			return
		}
		sanitizedColumns[sColName] = colType
	}

	if err := validateCreationCardRoles(req.ColumnCardRoles, sanitizedColumns); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	var sanitizedForeignKeys []dtt_3_table_create.ForeignKeyDefinition
	for _, fk := range req.ForeignKeys {
		sRefCol, err := security.SanitizeIdentifier(fk.ReferencingColumn)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid FK referencing column: %s", fk.ReferencingColumn))
			return
		}
		sRefTable, err := security.SanitizeIdentifier(fk.ReferencedTable)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid referenced table: %s", fk.ReferencedTable))
			return
		}
		sRefColumn, err := security.SanitizeIdentifier(fk.ReferencedColumn)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid referenced column: %s", fk.ReferencedColumn))
			return
		}

		sanitizedForeignKeys = append(sanitizedForeignKeys, dtt_3_table_create.ForeignKeyDefinition{
			ReferencingColumn: sRefCol,
			ReferencedTable:   sRefTable,
			ReferencedColumn:  sRefColumn,
		})
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction not available")
		return
	}

	if err := dataset_routes.ValidateDatasetRouteAvailability(tx, tableName, 0); err != nil {
		var conflictErr *dataset_routes.RouteConflictError
		if errors.As(err, &conflictErr) {
			httpresponse.RespondWithError(w, http.StatusConflict, conflictErr.Error())
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error validating dataset route availability: %v", err))
		return
	}

	targetFolderID, err := resolveCreateTableFolderID(tx, req)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	err = dtt_3_table_create.CreateNewTableInDatabase(tx, tableName, sanitizedColumns, sanitizedForeignKeys)
	if err != nil {
		_ = tx.Rollback()
		if writeCreateTableLangKeyError(w, err) {
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error creating table: %w", err).Error())
		return
	}

	// Päivitetään OID-arvot
	err = UpdateOidsAndTableNamesWithBridge(tx)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error updating OID values and table names: %v", err))
		return
	}

	if metaErr := dtt_2_column_update.UpdateColumnMetadata(tx); metaErr != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [CreateTableHandler] metadata refresh failed for %s: %v\033[0m", tableName, metaErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("table created but metadata refresh failed: %v", metaErr))
		return
	}

	if err := applyColumnCardRoles(tx, tableName, req.ColumnCardRoles); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "card role assignment failed")
		return
	}

	// The dataset's text-language default belongs to its definition, so the
	// creation form owns it too. A request that stays silent about languages
	// leaves the metadata default untouched.
	if req.NewColumnsMultilingual != nil {
		if err := configureNewColumnDefaults(
			tx, tableName, createdColumnsForLanguageDefaults(sanitizedColumns), req.NewColumnsMultilingual,
		); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	if _, err := tx.Exec("UPDATE system_db_tables SET folder_id = $1 WHERE table_name = $2", targetFolderID, tableName); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("table created but folder assignment failed: %v", err))
		return
	}

	dtt_1_row_read.InvalidateSchemaCache(tableName)
	dtt_1_row_read.InvalidateDatasetExistsCache(tableName)

	// --- Update is_removable flag ---
	if req.PreventDeletion {
		_, err = tx.Exec("UPDATE system_db_tables SET is_removable = FALSE WHERE table_name = $1", tableName)
		if err != nil {
			log.Printf("\033[31merror: failed to set is_removable flag for table %s: %v\033[0m", tableName, err)
		}
	}

	// --- Oikeuksien asettaminen ---
	if err := ensureTablePermissions(tx, tableName, req.GrantUsersRead, req.GrantGuestsRead); err != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [ensureTablePermissions] failed to set permissions for table %s: %v\033[0m", tableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("table created but permission setup failed: %v", err))
		return
	}

	// Say where the dataset went. The description is read inside the same
	// transaction, so a failure here is reported instead of a success that
	// could not be committed.
	created, err := describeCreatedDataset(tx, tableName, targetFolderID)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("table created but its placement could not be read: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

// Bridge functions delegate to the underlying column CRUD packages.
func RemoveColumnsWithBridge(
	tx *sql.Tx,
	sanitized_table_name string,
	removed_columns []string,
) error {
	return dtt_2_column_delete.RemoveColumns(tx, sanitized_table_name, removed_columns)
}

func AddNewColumnsWithBridge(
	tx *sql.Tx,
	sanitized_table_name string,
	added_columns []dtt_2_column_crud.ModifiedCol,
) error {
	return dtt_2_column_create.AddNewColumns(tx, sanitized_table_name, added_columns)
}

type ModifyColumnsRequest struct {
	TableName              string                          `json:"dataset_name"`
	ModifiedCols           []dtt_2_column_crud.ModifiedCol `json:"modified_columns"`
	AddedCols              []dtt_2_column_crud.ModifiedCol `json:"added_columns"`
	RemovedCols            []string                        `json:"removed_columns"`
	NewColumnsMultilingual *bool                           `json:"new_columns_multilingual,omitempty"`
	// ColumnCardRoles sets how each named column is presented on a card, the
	// same choice the creation form offers, so both forms describe a dataset
	// with one vocabulary.
	ColumnCardRoles map[string]string `json:"column_card_roles,omitempty"`
	// PreventDeletion carries the deletion-protection switch the creation form
	// already offers. An omitted switch leaves the dataset's protection alone.
	PreventDeletion *bool `json:"prevent_deletion,omitempty"`
}

func ModifyColumnsHandler(w http.ResponseWriter, r *http.Request) {
	// A read of this route reports the dataset-level settings it can write, so
	// the editing form can show them before offering a change.
	if r.Method == http.MethodGet {
		respondDatasetSettings(w, r)
		return
	}

	var req ModifyColumnsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("\033[31merror decoding data: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	if req.TableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table name is missing")
		return
	}

	sanitizedTableName, err := security.SanitizeIdentifier(req.TableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	// Validate data types for added and modified columns
	for _, col := range req.AddedCols {
		if col.DataType != "" && !isAllowedDataType(col.DataType) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("added column '%s' uses a forbidden data type '%s'", col.NewName, col.DataType))
			return
		}
	}
	for _, col := range req.ModifiedCols {
		if col.DataType != "" && !isAllowedDataType(col.DataType) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("modified column '%s' uses a forbidden data type '%s'", col.OriginalName, col.DataType))
			return
		}
	}

	if err := validateNewColumnLanguages(req.AddedCols); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := validateCardRoleValues(req.ColumnCardRoles); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	// 1) Poistetut sarakkeet
	if removeErr := RemoveColumnsWithBridge(
		tx, sanitizedTableName, req.RemovedCols,
	); removeErr != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error removing columns: %v", removeErr))
		return
	}

	// 2) Muokatut sarakkeet (nyt bridge-funktion kautta)
	if updateErr := UpdateColumnsWithBridge(
		tx, sanitizedTableName, req.ModifiedCols,
	); updateErr != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error updating columns: %v", updateErr))
		return
	}

	// 3) Lisätyt sarakkeet
	if addErr := AddNewColumnsWithBridge(
		tx, sanitizedTableName, req.AddedCols,
	); addErr != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error adding columns: %v", addErr))
		return
	}

	if pkErr := dtt_2_column_crud.EnsureTableHasPrimaryKey(tx, sanitizedTableName); pkErr != nil {
		_ = tx.Rollback()
		var missingPKErr *dtt_2_column_crud.ErrTableMissingPrimaryKey
		if errors.As(pkErr, &missingPKErr) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, pkErr.Error())
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error validating primary key: %v", pkErr))
		return
	}

	// 4) Päivitetään OID-arvot & nimilinkit
	if oidErr := UpdateOidsAndTableNamesWithBridge(tx); oidErr != nil {
		_ = tx.Rollback()
		err = oidErr
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error updating OID values: Table %s: %v", sanitizedTableName, oidErr))
		return
	}

	if metaErr := dtt_2_column_update.UpdateColumnMetadata(tx); metaErr != nil {
		_ = tx.Rollback()
		err = metaErr
		log.Printf("\033[31merror updating column metadata: %v\033[0m", metaErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error updating column metadata: %v", metaErr))
		return
	}

	// Card roles are applied after the column metadata exists for every column,
	// including the ones this request just added.
	if err := applyColumnCardRoles(tx, sanitizedTableName, req.ColumnCardRoles); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// DDL, metadata defaults and existing view memberships share this transaction.
	if err := configureNewColumnDefaults(tx, sanitizedTableName, req.AddedCols, req.NewColumnsMultilingual); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Deletion protection travels with the rest of the dataset's definition, so
	// a refused schema change never leaves the switch half-applied.
	if err := applyDatasetDeletionProtection(tx, sanitizedTableName, req.PreventDeletion); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	names := make([]string, 0, len(req.AddedCols))
	for _, column := range req.AddedCols {
		names = append(names, column.NewName)
	}
	if err := dtt_2_column_update.AppendNewColumnsToFieldSets(tx, sanitizedTableName, names); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Readers must not refill a cache from the old schema before this commit.
	invalidate := func() {
		dtt_1_row_read.InvalidateSchemaCache(sanitizedTableName)
		dtt_1_row_read.InvalidateDatasetExistsCache(sanitizedTableName)
		dtt_1_row_read.InvalidateUserColumnSettingsCache(sanitizedTableName, "")
		dtt_1_row_read.InvalidatePermissionsCache(sanitizedTableName)
	}
	if !dbutils.RegisterAfterCommitHook(r.Context(), invalidate) {
		invalidate()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Muutokset tallennettu onnistuneesti"})
}

type SimpleCreateTableRequest struct {
	Name    string                   `json:"name"`
	Columns []map[string]interface{} `json:"columns"` // [{"name": "col1", "type": "varchar(255)"}]
}

func SimpleCreateTableHandler(w http.ResponseWriter, r *http.Request) {

	// Tarkista autentikointi: vaadi kirjautuminen
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session error")
		return
	}
	userID := session.Values["user_id"]
	if userID == nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "login required")
		return
	}

	var req SimpleCreateTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid input: %w", err).Error())
		return
	}

	tableName, err := security.SanitizeIdentifier(req.Name)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if len(req.Columns) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "at least one column is required")
		return
	}

	sanitizedColumns := make(map[string]string)
	for _, col := range req.Columns {
		colName, ok := col["name"].(string)
		if !ok {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "column requires 'name'")
			return
		}
		colType, ok := col["type"].(string)
		if !ok {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "column requires 'type'")
			return
		}

		sColName, err := security.SanitizeIdentifier(colName)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid column name: %s", colName))
			return
		}
		if !isAllowedDataType(colType) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("column '%s' uses a forbidden data type '%s'", colName, colType))
			return
		}
		sanitizedColumns[sColName] = colType
	}

	// Auto-inject system columns — reject if user already supplied them
	for _, reserved := range []string{"id", "created", "updated"} {
		if _, exists := sanitizedColumns[reserved]; exists {
			httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("column '%s' is reserved and auto-generated", reserved))
			return
		}
	}
	sanitizedColumns["id"] = "serial"
	sanitizedColumns["created"] = "timestamp default now()"
	sanitizedColumns["updated"] = "timestamp default now()"

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction not available")
		return
	}

	err = dtt_3_table_create.CreateNewTableInDatabase(tx, tableName, sanitizedColumns, nil) // Ei foreign keys
	if err != nil {
		_ = tx.Rollback()
		if writeCreateTableLangKeyError(w, err) {
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error creating table: %w", err).Error())
		return
	}

	// Päivitä OID:t
	err = UpdateOidsAndTableNamesWithBridge(tx)
	if err != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [SimpleCreateTableHandler] OID update failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to update OID values")
		return
	}

	if metaErr := dtt_2_column_update.UpdateColumnMetadata(tx); metaErr != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [SimpleCreateTableHandler] metadata refresh failed for %s: %v\033[0m", tableName, metaErr)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to refresh column metadata")
		return
	}

	dtt_1_row_read.InvalidateSchemaCache(tableName)
	dtt_1_row_read.InvalidateDatasetExistsCache(tableName)

	// Myönnä oikeudet — API:n kautta luoduille tauluille admin saa täydet oikeudet,
	// users ja guests saavat lukuoikeudet oletuksena
	if err := ensureTablePermissions(tx, tableName, true, false); err != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [SimpleCreateTableHandler] permission setup failed for %s: %v\033[0m", tableName, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("table created but permission setup failed: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Taulu luotu onnistuneesti", "table": tableName})
}

type SimpleQueryTableRequest struct {
	Table string `json:"table"`
	Limit int    `json:"limit,omitempty"`
}

func SimpleQueryTableHandler(w http.ResponseWriter, r *http.Request) {

	var req SimpleQueryTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid input: %w", err).Error())
		return
	}

	tableName, err := security.SanitizeIdentifier(req.Table)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Oletus limit 100, jos ei annettu
	limit := req.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	// Suorita kysely
	query := fmt.Sprintf("SELECT * FROM %s LIMIT %d", tableName, limit)
	rows, err := backend.Db.Query(query)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error executing query: %w", err).Error())
		return
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error fetching columns: %w", err).Error())
		return
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error reading row: %w", err).Error())
			return
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			row[col] = val
		}
		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error processing rows: %w", err).Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"table": tableName,
		"rows":  results,
		"count": len(results),
	})
}

// writeCreateTableLangKeyError tarkistaa onko virhe ErrMissingPrimaryKey-tyyppiä
// ja palauttaa JSON-vastauksen kieliavaimella frontendille. Palauttaa true, jos virhe käsiteltiin.
func writeCreateTableLangKeyError(w http.ResponseWriter, err error) bool {
	var pkErr *dtt_3_table_create.ErrMissingPrimaryKey
	if errors.As(err, &pkErr) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error_lang_key": pkErr.LangKey,
			"error_message":  pkErr.Message,
		})
		return true
	}
	return false
}
