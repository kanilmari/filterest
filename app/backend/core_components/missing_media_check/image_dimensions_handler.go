// image_dimensions_handler.go
// Exposes an explicit administrator-only dimension backfill, never a startup task.
// Connects request validation and count-only results to the audited pipeline.
// Reports skipped targets without exposing schema names or row values.
package missing_media_check

import (
	"encoding/json"
	"io"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtimepaths"
)

type imageDimensionsRequest struct {
	DryRun  bool `json:"dry_run"`
	MaxRows int  `json:"max_rows"`
}

type ImageDimensionsCounts struct {
	Galleries                  int `json:"galleries"`
	RowsSeen                   int `json:"rows_seen"`
	WouldWrite                 int `json:"would_write"`
	Written                    int `json:"written"`
	AlreadySized               int `json:"already_sized"`
	SkippedNoFile              int `json:"skipped_no_file"`
	SkippedUnresolvedReference int `json:"skipped_unresolved_reference"`
	SkippedNonObjectMetadata   int `json:"skipped_non_object_metadata"`
	SkippedNotJSONB            int `json:"skipped_not_jsonb"`
	SkippedNoMetadataColumn    int `json:"skipped_no_metadata_column"`
	SkippedUnsupportedGallery  int `json:"skipped_unsupported_gallery"`
	OriginalsRotatedByTag      int `json:"originals_rotated_by_tag"`
	Failed                     int `json:"failed"`
}

// AdminImageDimensionsBackfillHandler measures stored pictures on demand and
// merges dimensions in independently committed batches; dry_run defaults to true.
func AdminImageDimensionsBackfillHandler(w http.ResponseWriter, r *http.Request) {
	actor := dbutils.RequestActorContextFromRequest(r)
	if !actor.IsAdmin {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator required")
		return
	}
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	input := imageDimensionsRequest{DryRun: true, MaxRows: 200}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&input)
	if err != nil && err != io.EOF {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid image dimensions request")
		return
	}
	if err == nil {
		var extra interface{}
		err = decoder.Decode(&extra)
	}
	if err != io.EOF || input.MaxRows < 1 || input.MaxRows > 1000 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid image dimensions request")
		return
	}
	counts := runImageDimensionsBackfill(r.Context(), backend.Db, runtimepaths.Current().StorageRoot, actor, input)
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, counts)
}
