// dataset_presentation_media.go
// Reads dataset-level cover and background image paths for ordinary result views.
// Bridges the canonical media registry and the permission-checked get-results response.
// Exists so presentation images never depend on access to the admin navigation tree.
package dtt_1_row_read

import (
	"fmt"

	"easelect/backend/core_components/dbutils"
)

// DatasetPresentationMedia is safe presentation metadata for a dataset whose
// rows the current request has already proved it may read. Storage delivery
// still performs its own registry and dataset-read authorization.
type DatasetPresentationMedia struct {
	CoverImagePath      string `json:"cover_image_path"`
	BackgroundImagePath string `json:"background_image_path"`
}

func fetchDatasetPresentationMedia(db dbutils.Querier, tableName string) (DatasetPresentationMedia, error) {
	var media DatasetPresentationMedia
	err := db.QueryRow(`
		SELECT
			COALESCE(MAX('/storage/' || dataset_media.storage_key)
				FILTER (WHERE dataset_media.media_role = 'cover'), ''),
			COALESCE(MAX('/storage/' || dataset_media.storage_key)
				FILTER (WHERE dataset_media.media_role = 'background'), '')
		FROM public.system_db_tables AS tables
		LEFT JOIN public.system_dataset_media AS dataset_media
			ON dataset_media.table_uid = tables.table_uid
		WHERE tables.table_name = $1
		  AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
	`, tableName).Scan(&media.CoverImagePath, &media.BackgroundImagePath)
	if err != nil {
		return DatasetPresentationMedia{}, fmt.Errorf("fetch dataset presentation media: %w", err)
	}
	return media, nil
}
