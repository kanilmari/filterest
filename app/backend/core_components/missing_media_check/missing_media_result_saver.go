// missing_media_result_saver.go
// Keeps the latest missing-media result so an administrator can read it without re-running.
// Between one completed check run and the administration screen that shows the last answer.
// Exists because the scan is bounded work an installation should not repeat merely to
// see what it found the last time it ran.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// LastResultConfigKey is the system_config row that holds the latest result.
const LastResultConfigKey = "missing_media_check_last_result"

const lastResultCreationSpec = "Latest result of the missing media files check: when it ran, how much was checked, what was missing, and whether a budget stopped it."

const readLastResultSQL = `
	SELECT json_value::text
	FROM public.system_config
	WHERE key = $1`

const saveLastResultSQL = `
	INSERT INTO public.system_config (key, json_value, creation_spec)
	VALUES ($1, $2::jsonb, $3)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

// LoadLastResult returns the stored result, or ok=false when the check has never run.
func LoadLastResult(ctx context.Context, database *sql.DB) (Result, bool, error) {
	if database == nil {
		return Result{}, false, errors.New("missing media check: no database connection")
	}
	var raw string
	err := database.QueryRowContext(ctx, readLastResultSQL, LastResultConfigKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, fmt.Errorf("read missing media check result: %w", err)
	}
	var result Result
	if unmarshalErr := json.Unmarshal([]byte(raw), &result); unmarshalErr != nil {
		return Result{}, false, fmt.Errorf("decode missing media check result: %w", unmarshalErr)
	}
	return result, true, nil
}

// SaveLastResult replaces the stored result with the run that just finished.
func SaveLastResult(ctx context.Context, database *sql.DB, result Result) error {
	if database == nil {
		return errors.New("missing media check: no database connection")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if _, err := database.ExecContext(ctx, saveLastResultSQL, LastResultConfigKey, encoded, lastResultCreationSpec); err != nil {
		return fmt.Errorf("save missing media check result: %w", err)
	}
	return nil
}
