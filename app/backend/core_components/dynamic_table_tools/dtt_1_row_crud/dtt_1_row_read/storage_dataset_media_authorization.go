// storage_dataset_media_authorization.go
// Authorizes dataset-level cover and background reads against their registry entry.
// Keeps presentation-media access separate from row-scoped storage authorization.
package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
)

// DatasetMediaStorageReadRequest is the canonical identity encoded in a
// dataset-level cover or background path. Unlike row media, presentation media
// belongs to the dataset itself and therefore has no parent-row identifier.
type DatasetMediaStorageReadRequest struct {
	TableUID string
	Role     string
	Variant  string
	Filename string
}

// AuthorizeDatasetMediaStorageRead proves that the requested presentation image
// is the exact registry-backed file for a dataset the actor may read. This keeps
// cover and background delivery inside the normal dataset permission model.
func AuthorizeDatasetMediaStorageRead(
	permissionDB dbutils.Querier,
	actor dbutils.RequestActorContext,
	request DatasetMediaStorageReadRequest,
) (StorageReadDecision, error) {
	if permissionDB == nil {
		return StorageReadNotFound, fmt.Errorf("dataset media authorization database unavailable")
	}
	if !validDatasetMediaStorageReadRequest(request) {
		return StorageReadNotFound, nil
	}

	storageKey := strings.Join([]string{
		request.TableUID,
		"dataset_media",
		request.Role,
		request.Variant,
		request.Filename,
	}, "/")
	var tableName string
	err := permissionDB.QueryRow(`
		SELECT tables.table_name
		FROM public.system_dataset_media AS media
		JOIN public.system_db_tables AS tables ON tables.table_uid = media.table_uid
		WHERE tables.table_uid = $1
		  AND tables.schema_name = 'public'
		  AND media.media_role = $2
		  AND media.storage_key = $3
	`, request.TableUID, request.Role, storageKey).Scan(&tableName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return StorageReadNotFound, nil
		}
		return StorageReadNotFound, fmt.Errorf("resolve dataset media registry entry: %w", err)
	}

	canRead, err := storageActorCanReadTable(permissionDB, actor.UserID, strings.TrimSpace(tableName))
	if err != nil {
		return StorageReadNotFound, err
	}
	if !canRead {
		return StorageReadForbidden, nil
	}
	return StorageReadAllowed, nil
}

func validDatasetMediaStorageReadRequest(request DatasetMediaStorageReadRequest) bool {
	if !isCanonicalPositiveID(request.TableUID) || request.Variant != "original" {
		return false
	}
	if request.Role != "cover" && request.Role != "background" {
		return false
	}
	filename := strings.TrimSpace(request.Filename)
	return filename != "" && filename == request.Filename &&
		!strings.ContainsAny(filename, `/\\`) && filename != "." && filename != ".."
}
