// dataset_deletion_protection.go
// Reads and writes one dataset's protection against deletion.
// Bridges the deletion-protection switch in both dataset forms with the
// is_removable flag that the drop handler already obeys.
// Exists so the switch offered while a dataset is created can be corrected
// afterwards, through the route that already edits the dataset's definition.
package dtt_crud_workflows

import (
	"fmt"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// datasetSettings carries the dataset-level choices that the editing form must
// know before it can offer to change them.
type datasetSettings struct {
	DatasetName     string `json:"dataset_name"`
	PreventDeletion bool   `json:"prevent_deletion"`
}

// readDatasetDeletionProtection reports whether the dataset currently refuses
// deletion. A missing flag counts as removable, exactly as the drop handler
// reads it.
func readDatasetDeletionProtection(q dbutils.Querier, tableName string) (bool, error) {
	var removable bool
	err := q.QueryRow(`
        SELECT COALESCE(is_removable, TRUE)
        FROM system_db_tables
        WHERE schema_name = current_schema() AND table_name = $1
    `, strings.ToLower(tableName)).Scan(&removable)
	if err != nil {
		return false, fmt.Errorf("read deletion protection: %w", err)
	}
	return !removable, nil
}

// applyDatasetDeletionProtection writes the choice when one was sent. An
// omitted choice leaves the dataset exactly as it was.
func applyDatasetDeletionProtection(q dbutils.Querier, tableName string, prevent *bool) error {
	if prevent == nil {
		return nil
	}
	result, err := q.Exec(`
        UPDATE system_db_tables
        SET is_removable = $1, updated = NOW()
        WHERE schema_name = current_schema() AND table_name = $2
    `, !*prevent, strings.ToLower(tableName))
	if err != nil {
		return fmt.Errorf("save deletion protection: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return fmt.Errorf("deletion protection must match one dataset: %q", tableName)
	}
	return nil
}

// respondDatasetSettings answers a read of the same route that writes these
// settings, so the editing form can show them before offering a change.
func respondDatasetSettings(w http.ResponseWriter, r *http.Request) {
	datasetName := strings.TrimSpace(r.URL.Query().Get("dataset_name"))
	if datasetName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset_name is required")
		return
	}
	sanitizedName, err := security.SanitizeIdentifier(datasetName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset_name")
		return
	}

	preventDeletion, err := readDatasetDeletionProtection(
		dbutils.GetQuerier(r.Context(), backend.Db), sanitizedName,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		return
	}

	// The form must never show a stale switch after someone else changed it.
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, datasetSettings{
		DatasetName:     sanitizedName,
		PreventDeletion: preventDeletion,
	})
}
