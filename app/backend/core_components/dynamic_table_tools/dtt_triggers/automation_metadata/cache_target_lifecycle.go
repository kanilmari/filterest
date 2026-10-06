// cache_target_lifecycle.go
// Carries upload cache destinations through dataset renames and drops.
// Shared with automation endpoint maintenance in the caller's transaction.
// Updates both effective targets and profile copies while retaining other JSON fields.
package automation_metadata

import (
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"fmt"
)

func updateCacheTargetDatasets(q dbutils.Querier, oldName, newName string, droppedUID int64) error {
	rows, err := q.Query(`SELECT r.id,r.target_insert_specs,COALESCE((SELECT table_name FROM public.system_db_tables WHERE table_uid=$1),$2)
	 FROM public.system_foreign_key_relations_1_m r
	 WHERE r.target_insert_specs->'file_upload' IS NOT NULL
	 AND ($1::bigint=0 OR (r.source_table_uid<>$1 AND r.target_table_uid<>$1))
	 AND (jsonb_path_exists(r.target_insert_specs,
	   '$.file_upload.cache_targets[*] ? (@.table == $dataset)',
	   jsonb_build_object('dataset',COALESCE((SELECT table_name FROM public.system_db_tables WHERE table_uid=$1),$2)))
	 OR jsonb_path_exists(r.target_insert_specs,
	   '$.file_upload.profiles.*.cache_targets[*] ? (@.table == $dataset)',
	   jsonb_build_object('dataset',COALESCE((SELECT table_name FROM public.system_db_tables WHERE table_uid=$1),$2))))`, droppedUID, oldName)
	if err != nil {
		return fmt.Errorf("read dataset cache targets: %w", err)
	}
	type change struct {
		id    int64
		specs []byte
	}
	var changes []change
	for rows.Next() {
		var id int64
		var specs []byte
		var destinationName string
		if err := rows.Scan(&id, &specs, &destinationName); err != nil {
			rows.Close()
			return err
		}
		updated, changed, err := rewriteCacheTargetDatasets(specs, destinationName, newName)
		if err != nil {
			rows.Close()
			return fmt.Errorf("read relation %d cache targets: %w", id, err)
		}
		if changed {
			changes = append(changes, change{id, updated})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, change := range changes {
		if _, err := q.Exec(`UPDATE public.system_foreign_key_relations_1_m SET target_insert_specs=$1::jsonb WHERE id=$2`, string(change.specs), change.id); err != nil {
			return fmt.Errorf("write relation cache targets: %w", err)
		}
	}
	return nil
}

func rewriteCacheTargetDatasets(specs []byte, oldName, newName string) ([]byte, bool, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(specs, &envelope); err != nil {
		return nil, false, err
	}
	var upload map[string]json.RawMessage
	if err := json.Unmarshal(envelope["file_upload"], &upload); err != nil {
		return nil, false, err
	}
	if upload == nil {
		return specs, false, nil
	}
	rewrite := func(config map[string]json.RawMessage) (bool, error) {
		if len(config["cache_targets"]) == 0 {
			return false, nil
		}
		var targets []map[string]json.RawMessage
		if err := json.Unmarshal(config["cache_targets"], &targets); err != nil {
			return false, err
		}
		changed := false
		kept := make([]map[string]json.RawMessage, 0, len(targets))
		for _, target := range targets {
			var name string
			if err := json.Unmarshal(target["table"], &name); err != nil {
				kept = append(kept, target)
				continue
			}
			if name == oldName {
				changed = true
				if newName == "" {
					continue
				}
				target["table"], _ = json.Marshal(newName)
			}
			kept = append(kept, target)
		}
		if changed {
			config["cache_targets"], _ = json.Marshal(kept)
		}
		return changed, nil
	}
	changed, err := rewrite(upload)
	if err != nil {
		return nil, false, err
	}
	if len(upload["profiles"]) != 0 {
		var profiles map[string]map[string]json.RawMessage
		if err := json.Unmarshal(upload["profiles"], &profiles); err != nil {
			return nil, false, err
		}
		profileChanged := false
		for _, profile := range profiles {
			c, err := rewrite(profile)
			if err != nil {
				return nil, false, err
			}
			profileChanged = profileChanged || c
		}
		if profileChanged {
			upload["profiles"], _ = json.Marshal(profiles)
			changed = true
		}
	}
	if !changed {
		return specs, false, nil
	}
	envelope["file_upload"], _ = json.Marshal(upload)
	updated, err := json.Marshal(envelope)
	return updated, true, err
}
