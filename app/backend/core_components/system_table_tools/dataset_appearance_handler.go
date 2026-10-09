// dataset_appearance_handler.go
// Saves administrator-owned dataset appearance patches with both loaded revisions.
// Connects the standard admin/CSRF/permission pipeline to shared persistence.
// Returns persisted values and sources, including translated actionable refusals.
package system_table_tools

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

type datasetAppearanceRequest struct {
	DatasetUID    int            `json:"dataset_uid"`
	Set           map[string]any `json:"set"`
	Unset         []string       `json:"unset"`
	SharedVersion string         `json:"shared_version"`
	Version       string         `json:"version"`
}

// AdminDatasetAppearanceHandler patches only the selected dataset.
// POST /api/admin/dataset-appearance
// Request: {dataset_uid,set,unset,shared_version,version}. All leaves are canonical.
func AdminDatasetAppearanceHandler(w http.ResponseWriter, r *http.Request) {
	var input datasetAppearanceRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || rejectTrailingJSON(decoder) != nil || input.DatasetUID <= 0 {
		respondDatasetAppearanceError(w, &httpresponse.Refusal{Status: 400, LangKey: "dataset_appearance_invalid", Message: "invalid dataset appearance request"})
		return
	}
	patch := store.DatasetAppearancePatch{Set: input.Set, Unset: input.Unset}
	if err := store.ValidateDatasetAppearancePatch(patch); err != nil {
		respondDatasetAppearanceError(w, err)
		return
	}
	if input.Version == "" || input.SharedVersion == "" {
		respondDatasetAppearanceError(w, store.ErrDatasetAppearanceConflict)
		return
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, 500, "transaction unavailable")
		return
	}
	result, err := store.SaveAppearance(tx, input.DatasetUID, patch, input.SharedVersion, input.Version, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		respondDatasetAppearanceError(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, 200, result)
}

func respondDatasetAppearanceError(w http.ResponseWriter, err error) {
	var refusal *httpresponse.Refusal
	if errors.As(err, &refusal) {
		httpresponse.RespondWithRefusal(w, refusal)
		return
	}
	httpresponse.RespondWithError(w, 500, "dataset appearance unavailable")
}
