// image_asset_linking_remove_handler.go
// Destructively removes the current image asset capability from the shared asset_linking module.
// Bridges the image asset admin endpoint and the shared asset cleanup workflows.
// Exists to keep destructive image cleanup on the final asset-linking contract.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

// RemoveImageAssetLinkingHandler drops the image asset capability for one parent table.
func RemoveImageAssetLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req removeImageAssetLinkingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	if !req.Confirm {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "destructive operation requires 'confirm': true — this will permanently delete all image assets for this table")
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
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found", parentTable))
		return
	}

	status, err := FindFileUploadRelationStatusByProfile(tx, parentTableUID, AssetProfileImage)
	if err != nil {
		if err == ErrFileUploadProfileNotFound {
			httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no image assets found for table '%s'", parentTable))
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to inspect image asset config: %v", err))
		return
	}

	profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileImage)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no image asset config found for table '%s'", parentTable))
		return
	}

	if UsesSharedAssetRelation(status.UploadConfig) {
		assetKinds := assetKindsToStrings(profileConfig.AssetKinds)
		if len(assetKinds) == 0 {
			assetKinds = []string{string(AssetKindImage)}
		}

		if _, err := tx.Exec(
			fmt.Sprintf("DELETE FROM %s WHERE asset_kind = ANY($1)", status.ChildTable),
			pq.Array(assetKinds),
		); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete shared image asset rows: %v", err))
			return
		}

		updatedConfig, hasRemainingProfiles := RemoveProfileUploadConfig(status.UploadConfig, AssetProfileImage)
		tableDropped := false
		if hasRemainingProfiles {
			if err := SaveFileUploadConfigByRelationID(tx, status.RelationID, updatedConfig); err != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist shared asset config: %v", err))
				return
			}
		} else {
			var childTableUID int64
			var childSchemaName string
			if err := tx.QueryRow(
				"SELECT table_uid, schema_name FROM system_db_tables WHERE table_name = $1",
				status.ChildTable,
			).Scan(&childTableUID, &childSchemaName); err != nil {
				httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("child asset table '%s' not found", status.ChildTable))
				return
			}

			if _, err := tx.Exec(`DELETE FROM system_foreign_key_relations_1_m WHERE id = $1`, status.RelationID); err != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to remove shared asset relation: %v", err))
				return
			}
			if _, err := tx.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", status.ChildTable)); err != nil {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to drop shared asset table: %v", err))
				return
			}
			_ = dtt_3_table_delete.CleanupTableMetadata(tx, childTableUID, childSchemaName)
			tableDropped = true
		}

		_, _ = tx.Exec(fmt.Sprintf("UPDATE %s SET cached_image = NULL", parentTable))
		_, _ = tx.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS cached_image", parentTable))
		_ = dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx)

		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"message":       fmt.Sprintf("Image assets permanently removed for table '%s'", parentTable),
			"parent_table":  parentTable,
			"dropped_table": status.ChildTable,
			"table_dropped": tableDropped,
		})
		return
	}

	childTable := status.ChildTable
	if childTable == "" {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no configured image child table found for table '%s'", parentTable))
		return
	}

	var childTableUID int64
	var childSchemaName string
	err = tx.QueryRow(
		"SELECT table_uid, schema_name FROM system_db_tables WHERE table_name = $1",
		childTable,
	).Scan(&childTableUID, &childSchemaName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("child image table '%s' not found", childTable))
		return
	}

	if status.RelationID > 0 {
		_, _ = tx.Exec(`DELETE FROM system_foreign_key_relations_1_m WHERE id = $1`, status.RelationID)
	} else {
		_, _ = tx.Exec(
			`DELETE FROM system_foreign_key_relations_1_m
			 WHERE source_table_uid = $1 AND target_table_uid = $2`,
			childTableUID, parentTableUID,
		)
	}

	if _, err := tx.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", childTable)); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to drop child table: %v", err))
		return
	}

	_ = dtt_3_table_delete.CleanupTableMetadata(tx, childTableUID, childSchemaName)
	_, _ = tx.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS cached_image", parentTable))
	_ = dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx)

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":       fmt.Sprintf("Image assets permanently removed for table '%s'", parentTable),
		"parent_table":  parentTable,
		"dropped_table": childTable,
	})
}
