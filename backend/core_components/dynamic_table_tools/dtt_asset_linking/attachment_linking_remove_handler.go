// attachment_linking_remove_handler.go
// Destructively removes attachment-linking metadata and drops the shared asset table when safe.
// Bridges the first attachment admin endpoint and the future shared parent_assets cleanup path.
// Exists to let temporary attachment capability rollouts be undone cleanly during migration.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

// RemoveAttachmentLinkingHandler removes attachment-linking metadata and drops the asset table if no other profiles use it.
func RemoveAttachmentLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req removeAttachmentLinkingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	if !req.Confirm {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "destructive operation requires 'confirm': true — this will permanently delete all attachment rows for this table")
		return
	}

	parentTable, err := security.SanitizeIdentifier(req.ParentTable)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid parent table name: %v", err))
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	parentTableUID, err := LookupParentTableUID(tx, parentTable)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found", parentTable))
		return
	}

	status, err := FindFileUploadRelationStatusByProfile(tx, parentTableUID, AssetProfileAttachment)
	if err != nil {
		_ = tx.Rollback()
		if err == ErrFileUploadProfileNotFound {
			httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no attachment linking found for table '%s'", parentTable))
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to inspect attachment linking: %v", err))
		return
	}

	profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileAttachment)
	if !ok {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no attachment linking config found for table '%s'", parentTable))
		return
	}

	var childTableUID int64
	var childSchemaName string
	err = tx.QueryRow(
		"SELECT table_uid, schema_name FROM system_db_tables WHERE table_name = $1",
		status.ChildTable,
	).Scan(&childTableUID, &childSchemaName)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("child attachment table '%s' not found", status.ChildTable))
		return
	}

	if UsesSharedAssetRelation(status.UploadConfig) {
		assetKinds := assetKindsToStrings(profileConfig.AssetKinds)
		if len(assetKinds) == 0 {
			assetKinds = []string{
				string(AssetKindPDF),
				string(AssetKindDocument),
				string(AssetKindArchive),
			}
		}
		if _, err := tx.Exec(
			fmt.Sprintf("DELETE FROM %s WHERE asset_kind = ANY($1)", status.ChildTable),
			pq.Array(assetKinds),
		); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete attachment asset rows: %v", err))
			return
		}
	}

	updatedConfig, hasRemainingProfiles := RemoveProfileUploadConfig(status.UploadConfig, AssetProfileAttachment)
	droppedTable := false
	if hasRemainingProfiles {
		if err := SaveFileUploadConfigByRelationID(tx, status.RelationID, updatedConfig); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist shared asset config: %v", err))
			return
		}
	} else {
		if _, err := tx.Exec(`DELETE FROM system_foreign_key_relations_1_m WHERE id = $1`, status.RelationID); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to remove attachment relation: %v", err))
			return
		}
		if _, err := tx.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", status.ChildTable)); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to drop child table: %v", err))
			return
		}
		_ = dtt_3_table_delete.CleanupTableMetadata(tx, childTableUID, childSchemaName)
		droppedTable = true
	}

	_ = dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx)

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":       fmt.Sprintf("Attachment linking permanently removed for table '%s'", parentTable),
		"parent_table":  parentTable,
		"dropped_table": status.ChildTable,
		"table_dropped": droppedTable,
	})
}

func assetKindsToStrings(assetKinds []AssetKind) []string {
	if len(assetKinds) == 0 {
		return nil
	}

	values := make([]string, 0, len(assetKinds))
	for _, assetKind := range assetKinds {
		values = append(values, string(assetKind))
	}
	return values
}
