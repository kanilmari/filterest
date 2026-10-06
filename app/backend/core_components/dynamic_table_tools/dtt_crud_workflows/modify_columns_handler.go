// modify_columns_handler.go
// Saves a dataset definition and its runtime grants in one request transaction.
// Connects existing column workflows, metadata and the shared grant boundary.
// Keeps column mutations separate from the dataset creation completion boundary.
package dtt_crud_workflows

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grant_mutations"
	"easelect/backend/core_components/security"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
)

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

	mutation, err := runtime_grant_mutations.Begin(r.Context(), w)
	if err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	tx := mutation.Tx
	mutation.IncludeTables(sanitizedTableName)

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
	if len(req.ColumnCardRoles) > 0 {
		marks, err := row_mutation_policy.ReadRowActorColumns(tx, strings.ToLower(sanitizedTableName))
		if err == nil {
			err = marks.ValidateCardRoles(req.ColumnCardRoles)
		}
		if err != nil {
			var refusal *httpresponse.Refusal
			if errors.As(err, &refusal) {
				httpresponse.RespondWithRefusal(w, refusal)
				return
			}
			httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	// 1) Poistetut sarakkeet
	if removeErr := RemoveColumnsWithBridge(
		tx, sanitizedTableName, req.RemovedCols,
	); removeErr != nil {
		_ = tx.Rollback()
		var refusal *httpresponse.Refusal
		if errors.As(removeErr, &refusal) {
			httpresponse.RespondWithRefusal(w, refusal)
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error removing columns: %v", removeErr))
		return
	}

	// 2) Muokatut sarakkeet (nyt bridge-funktion kautta)
	if updateErr := UpdateColumnsWithBridge(
		tx, sanitizedTableName, req.ModifiedCols,
	); updateErr != nil {
		_ = tx.Rollback()
		var refusal *httpresponse.Refusal
		if errors.As(updateErr, &refusal) {
			httpresponse.RespondWithRefusal(w, refusal)
			return
		}
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

	if err := mutation.Finish(r.Context()); err != nil {
		runtime_grant_mutations.RespondError(w, err)
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
