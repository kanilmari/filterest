// dataset_lifecycle.go
// Keeps automation endpoints and upload cache targets aligned with dataset lifecycle.
// Shared by both rename routes and the table metadata cleanup, without handler imports.
// Runs in the caller's transaction before grant reconciliation; public installs may lack this table.
package automation_metadata

import (
	"fmt"

	"easelect/backend/core_components/dbutils"
)

// RenameDataset carries automation endpoints and stored upload cache destinations.
// The caller owns the transaction, so metadata failure rolls back the rename too.
func RenameDataset(q dbutils.Querier, oldName, newName string) error {
	if oldName == newName {
		return nil
	}
	present, err := tablePresent(q)
	if err != nil {
		return err
	}
	if present {
		_, err = q.Exec(`UPDATE public.system_triggers
		SET source_table = CASE WHEN source_table = $1 THEN $2 ELSE source_table END,
		    target_table = CASE WHEN target_table = $1 THEN $2 ELSE target_table END
		WHERE source_table = $1 OR target_table = $1`, oldName, newName)
		if err != nil {
			return fmt.Errorf("rename dataset automation endpoints: %w", err)
		}
	}
	return updateCacheTargetDatasets(q, oldName, newName, 0)
}

// DeleteDataset removes automations and surviving upload cache entries naming the dataset.
// UID lookup uses the still-present registry, even after the physical table is dropped.
func DeleteDataset(q dbutils.Querier, tableUID int64) error {
	present, err := tablePresent(q)
	if err != nil {
		return err
	}
	if present {
		_, err = q.Exec(`DELETE FROM public.system_triggers
		WHERE source_table IN (SELECT table_name FROM public.system_db_tables WHERE table_uid = $1)
		   OR target_table IN (SELECT table_name FROM public.system_db_tables WHERE table_uid = $1)`, tableUID)
		if err != nil {
			return fmt.Errorf("delete dataset automations: %w", err)
		}
	}
	return updateCacheTargetDatasets(q, "", "", tableUID)
}

func tablePresent(q dbutils.Querier) (bool, error) {
	var present bool
	if err := q.QueryRow(`SELECT to_regclass('public.system_triggers') IS NOT NULL`).Scan(&present); err != nil {
		return false, fmt.Errorf("check legacy automation metadata: %w", err)
	}
	return present, nil
}
