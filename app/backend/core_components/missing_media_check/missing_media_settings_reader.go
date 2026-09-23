// missing_media_settings_reader.go
// Reads and stores the administrator settings for the missing-media-files check.
// Between the system_config settings table and the check's runner and HTTP handler.
// Exists so the setting has one validated definition that the application creates on
// first use, instead of a schema migration or a hardcoded constant in the scan.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// SettingsConfigKey is the system_config row that owns this check's settings.
const SettingsConfigKey = "missing_media_check"

// SettingsSchemaVersion lets a later release recognise and upgrade stored values.
const SettingsSchemaVersion = 1

const settingsCreationSpec = "Administrator-managed check that verifies media files referenced by rows still exist in storage. Reports only; never deletes or repairs."

// Settings is the whole administrator-facing contract of the check.
type Settings struct {
	SchemaVersion int `json:"schema_version"`
	// Enabled turns the whole check off, including its startup run.
	Enabled bool `json:"enabled"`
	// MaxTotalRowsChecked is the upper bound of work for one run, shared between
	// datasets in proportion to their size.
	MaxTotalRowsChecked int `json:"max_total_rows_checked"`
	// MinRowsPerDataset keeps a small dataset from being reduced to a token sample.
	MinRowsPerDataset int `json:"min_rows_per_dataset"`
	// MaxRunSeconds stops a run on elapsed time as well as on rows read.
	MaxRunSeconds int `json:"max_run_seconds"`
	// RunOnStartup runs the check once in the background after the server starts.
	RunOnStartup bool `json:"run_on_startup"`
	// StartupDelaySeconds waits for the rest of startup maintenance to settle first.
	StartupDelaySeconds int `json:"startup_delay_seconds"`
	// ReportUnusedFiles adds the opposite direction: stored files that no row uses.
	ReportUnusedFiles bool `json:"report_unused_files"`
	// MaxReportedMissing and MaxReportedUnusedFiles bound the size of the stored result.
	MaxReportedMissing     int `json:"max_reported_missing"`
	MaxReportedUnusedFiles int `json:"max_reported_unused_files"`
}

// DefaultSettings is the value written when the settings row does not exist yet.
func DefaultSettings() Settings {
	return Settings{
		SchemaVersion:          SettingsSchemaVersion,
		Enabled:                true,
		MaxTotalRowsChecked:    10000,
		MinRowsPerDataset:      50,
		MaxRunSeconds:          120,
		RunOnStartup:           true,
		StartupDelaySeconds:    30,
		ReportUnusedFiles:      false,
		MaxReportedMissing:     200,
		MaxReportedUnusedFiles: 200,
	}
}

// Sanitize clamps stored or submitted values into a range the runner can honour.
// A value outside the range is corrected rather than rejected, so an old or
// hand-edited settings row can never make the check unbounded or useless.
func (settings Settings) Sanitize() Settings {
	defaults := DefaultSettings()
	settings.SchemaVersion = SettingsSchemaVersion
	settings.MaxTotalRowsChecked = clampInt(settings.MaxTotalRowsChecked, 1, 5000000, defaults.MaxTotalRowsChecked)
	settings.MinRowsPerDataset = clampInt(settings.MinRowsPerDataset, 1, 100000, defaults.MinRowsPerDataset)
	settings.MaxRunSeconds = clampInt(settings.MaxRunSeconds, 1, 3600, defaults.MaxRunSeconds)
	settings.StartupDelaySeconds = clampInt(settings.StartupDelaySeconds, 0, 3600, defaults.StartupDelaySeconds)
	settings.MaxReportedMissing = clampInt(settings.MaxReportedMissing, 1, 5000, defaults.MaxReportedMissing)
	settings.MaxReportedUnusedFiles = clampInt(settings.MaxReportedUnusedFiles, 1, 5000, defaults.MaxReportedUnusedFiles)
	return settings
}

func clampInt(value, lowest, highest, fallback int) int {
	if value == 0 && lowest > 0 {
		return fallback
	}
	if value < lowest {
		return lowest
	}
	if value > highest {
		return highest
	}
	return value
}

const readSettingsSQL = `
	SELECT json_value::text
	FROM public.system_config
	WHERE key = $1`

// insertSettingsSQL creates the settings row the first time the check runs.
// It follows the existing application-owned settings pattern: no migration owns
// this row, and an installation that never runs the check never grows one.
const insertSettingsSQL = `
	INSERT INTO public.system_config (key, json_value, creation_spec)
	VALUES ($1, $2::jsonb, $3)
	ON CONFLICT (key) DO NOTHING`

const updateSettingsSQL = `
	INSERT INTO public.system_config (key, json_value, creation_spec)
	VALUES ($1, $2::jsonb, $3)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

// LoadSettings returns the stored settings, creating the default row on first use.
func LoadSettings(ctx context.Context, database *sql.DB) (Settings, error) {
	if database == nil {
		return DefaultSettings(), errors.New("missing media check: no database connection")
	}
	var raw string
	err := database.QueryRowContext(ctx, readSettingsSQL, SettingsConfigKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return createDefaultSettings(ctx, database)
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("read missing media check settings: %w", err)
	}
	settings := DefaultSettings()
	if unmarshalErr := json.Unmarshal([]byte(raw), &settings); unmarshalErr != nil {
		return DefaultSettings(), fmt.Errorf("decode missing media check settings: %w", unmarshalErr)
	}
	return settings.Sanitize(), nil
}

func createDefaultSettings(ctx context.Context, database *sql.DB) (Settings, error) {
	settings := DefaultSettings()
	encoded, err := json.Marshal(settings)
	if err != nil {
		return settings, err
	}
	if _, err := database.ExecContext(ctx, insertSettingsSQL, SettingsConfigKey, encoded, settingsCreationSpec); err != nil {
		return settings, fmt.Errorf("create missing media check settings: %w", err)
	}
	return settings, nil
}

// SaveSettings stores administrator-edited settings after clamping them.
func SaveSettings(ctx context.Context, database *sql.DB, settings Settings) (Settings, error) {
	if database == nil {
		return settings, errors.New("missing media check: no database connection")
	}
	sanitized := settings.Sanitize()
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		return sanitized, err
	}
	if _, err := database.ExecContext(ctx, updateSettingsSQL, SettingsConfigKey, encoded, settingsCreationSpec); err != nil {
		return sanitized, fmt.Errorf("save missing media check settings: %w", err)
	}
	return sanitized, nil
}
