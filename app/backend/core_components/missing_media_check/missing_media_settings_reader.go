// missing_media_settings_reader.go
// Reads and stores the administrator settings for the missing-media-files check.
// Between the system_config settings row, the migration that writes it and the check's runner and HTTP handler.
// Exists so the setting has one validated definition: DefaultSettings is what a new installation
// is born with, the migration is tested against it, and one table of ranges clamps every value.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// SettingsConfigKey is the system_config row that owns this check's settings.
const SettingsConfigKey = "missing_media_check"

// SettingsSchemaVersion 2 added sampling, run_after_update and exact_count_max_rows.
// A version 1 value keeps every key it stores and gains the new ones as defaults.
const SettingsSchemaVersion = 2

// settingsValueType 5 is the JSON editor of the settings view, so an administrator edits
// the whole object there and cannot save it as a string.
const settingsValueType = 5

// settingsCreationSpec is the description the settings view shows. The migration
// 20260929000004_add_missing_media_check_setting.sql writes the same text, and a test
// keeps the two equal.
const settingsCreationSpec = "Settings of the missing media files check, which reports pictures and attachments that rows use but storage no longer has. It only reports: it never repairs, moves or deletes anything. enabled switches the whole check off. It runs by itself once after an application or database update when run_after_update is true, and at every server start when run_on_startup is true, startup_delay_seconds after the start. max_total_rows_checked and max_run_seconds bound one run; min_rows_per_dataset is the smallest sample of each dataset; sampling is even or random. A dataset with more than exact_count_max_rows rows is estimated instead of counted and is never reported as fully checked. report_unused_files also lists stored files that no row uses; max_reported_missing and max_reported_unused_files bound the stored lists."

// Sampling methods for a dataset too large to check completely.
const (
	// SamplingEven spreads the sample evenly over the dataset's ids, oldest to newest.
	SamplingEven = "even"
	// SamplingRandom draws the sample at random; the run stores its seed.
	SamplingRandom = "random"
)

var samplingMethods = []string{SamplingEven, SamplingRandom}

// SamplingMethods lists the accepted sampling values, for the administration screen.
func SamplingMethods() []string {
	return append([]string(nil), samplingMethods...)
}

// Settings is the whole administrator-facing contract of the check.
type Settings struct {
	SchemaVersion int `json:"schema_version"`
	// Enabled turns the whole check off, including its automatic runs.
	Enabled bool `json:"enabled"`
	// MaxTotalRowsChecked is the upper bound of work for one run, shared between
	// datasets in proportion to their size.
	MaxTotalRowsChecked int `json:"max_total_rows_checked"`
	// MinRowsPerDataset keeps a small dataset from being reduced to a token sample.
	MinRowsPerDataset int `json:"min_rows_per_dataset"`
	// Sampling picks the rows of a dataset too large to check completely.
	Sampling string `json:"sampling"`
	// MaxRunSeconds stops a run on elapsed time as well as on rows read.
	MaxRunSeconds int `json:"max_run_seconds"`
	// RunOnStartup runs the check once in the background after every server start.
	RunOnStartup bool `json:"run_on_startup"`
	// RunAfterUpdate runs it once after the application or database version changed.
	RunAfterUpdate bool `json:"run_after_update"`
	// StartupDelaySeconds waits for the rest of startup maintenance to settle first.
	StartupDelaySeconds int `json:"startup_delay_seconds"`
	// ExactCountMaxRows is how many rows of one dataset are counted exactly; a larger
	// dataset is estimated, which keeps the count itself inside the run's bounds.
	ExactCountMaxRows int `json:"exact_count_max_rows"`
	// ReportUnusedFiles adds the opposite direction: stored files that no row uses.
	ReportUnusedFiles bool `json:"report_unused_files"`
	// MaxReportedMissing and MaxReportedUnusedFiles bound the size of the stored result.
	MaxReportedMissing     int `json:"max_reported_missing"`
	MaxReportedUnusedFiles int `json:"max_reported_unused_files"`
}

// DefaultSettings is the value a new installation is born with, and the value
// written when the settings row does not exist. The check runs by itself after an
// update, not at every start: a native development restart is not an update.
func DefaultSettings() Settings {
	return Settings{
		SchemaVersion:          SettingsSchemaVersion,
		Enabled:                true,
		MaxTotalRowsChecked:    10000,
		MinRowsPerDataset:      50,
		Sampling:               SamplingEven,
		MaxRunSeconds:          120,
		RunOnStartup:           false,
		RunAfterUpdate:         true,
		StartupDelaySeconds:    30,
		ExactCountMaxRows:      100000,
		ReportUnusedFiles:      false,
		MaxReportedMissing:     200,
		MaxReportedUnusedFiles: 200,
	}
}

// SettingLimit is the accepted range of one numeric setting.
type SettingLimit struct {
	Minimum int `json:"min"`
	Maximum int `json:"max"`
}

// settingLimits is the one table of accepted ranges. Sanitize clamps with it and the
// administration screen draws its number fields from it, so the two cannot disagree.
var settingLimits = map[string]SettingLimit{
	"max_total_rows_checked":    {Minimum: 1, Maximum: 5000000},
	"min_rows_per_dataset":      {Minimum: 1, Maximum: 100000},
	"max_run_seconds":           {Minimum: 1, Maximum: 3600},
	"startup_delay_seconds":     {Minimum: 0, Maximum: 3600},
	"exact_count_max_rows":      {Minimum: 1000, Maximum: 10000000},
	"max_reported_missing":      {Minimum: 1, Maximum: 5000},
	"max_reported_unused_files": {Minimum: 1, Maximum: 5000},
}

// SettingLimits returns a copy of the accepted ranges, keyed by the setting's JSON name.
func SettingLimits() map[string]SettingLimit {
	limits := make(map[string]SettingLimit, len(settingLimits))
	for name, limit := range settingLimits {
		limits[name] = limit
	}
	return limits
}

// Sanitize clamps stored or submitted values into a range the runner can honour.
// A value outside the range is corrected rather than rejected, so an old or
// hand-edited settings row can never make the check unbounded or useless.
func (settings Settings) Sanitize() Settings {
	defaults := DefaultSettings()
	settings.SchemaVersion = SettingsSchemaVersion
	settings.MaxTotalRowsChecked = clampSetting("max_total_rows_checked", settings.MaxTotalRowsChecked, defaults.MaxTotalRowsChecked)
	settings.MinRowsPerDataset = clampSetting("min_rows_per_dataset", settings.MinRowsPerDataset, defaults.MinRowsPerDataset)
	settings.MaxRunSeconds = clampSetting("max_run_seconds", settings.MaxRunSeconds, defaults.MaxRunSeconds)
	settings.StartupDelaySeconds = clampSetting("startup_delay_seconds", settings.StartupDelaySeconds, defaults.StartupDelaySeconds)
	settings.ExactCountMaxRows = clampSetting("exact_count_max_rows", settings.ExactCountMaxRows, defaults.ExactCountMaxRows)
	settings.MaxReportedMissing = clampSetting("max_reported_missing", settings.MaxReportedMissing, defaults.MaxReportedMissing)
	settings.MaxReportedUnusedFiles = clampSetting("max_reported_unused_files", settings.MaxReportedUnusedFiles, defaults.MaxReportedUnusedFiles)
	settings.Sampling = strings.ToLower(strings.TrimSpace(settings.Sampling))
	if !isSamplingMethod(settings.Sampling) {
		settings.Sampling = defaults.Sampling
	}
	return settings
}

func isSamplingMethod(value string) bool {
	for _, method := range samplingMethods {
		if value == method {
			return true
		}
	}
	return false
}

func clampSetting(name string, value, fallback int) int {
	limit := settingLimits[name]
	return clampInt(value, limit.Minimum, limit.Maximum, fallback)
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

// ErrSettingsProblem marks a stored settings value the check cannot read. The caller
// still receives the shipped defaults, to show them, but must not run the check on
// them: the administrator decided something the check can no longer see. Saving the
// settings from the check's screen replaces the unreadable value.
var ErrSettingsProblem = errors.New("the stored missing media check settings cannot be read")

const readSettingsSQL = `
	SELECT json_value::text
	FROM public.system_config
	WHERE key = $1`

// insertSettingsSQL creates the row only where the migration did not, for instance
// after an administrator deleted it; the migration is the normal author of the row.
const insertSettingsSQL = `
	INSERT INTO public.system_config (key, json_value, value_type, creation_spec)
	VALUES ($1, $2::jsonb, $3, $4)
	ON CONFLICT (key) DO NOTHING`

const updateSettingsSQL = `
	INSERT INTO public.system_config (key, json_value, value_type, creation_spec)
	VALUES ($1, $2::jsonb, $3, $4)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    value_type = EXCLUDED.value_type,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

// LoadSettings returns the stored settings laid over the defaults, so a stored value
// missing a newer key reads that key's default. It creates the default row when none
// exists. A stored value that is not a settings object returns the defaults with an
// error wrapping ErrSettingsProblem.
func LoadSettings(ctx context.Context, database *sql.DB) (Settings, error) {
	if database == nil {
		return DefaultSettings(), errors.New("missing media check: no database connection")
	}
	var raw sql.NullString
	err := database.QueryRowContext(ctx, readSettingsSQL, SettingsConfigKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return createDefaultSettings(ctx, database)
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("read missing media check settings: %w", err)
	}
	return decodeStoredSettings(raw)
}

func decodeStoredSettings(raw sql.NullString) (Settings, error) {
	if !raw.Valid {
		return DefaultSettings(), fmt.Errorf("%w: the stored value is empty", ErrSettingsProblem)
	}
	if !strings.HasPrefix(strings.TrimSpace(raw.String), "{") {
		return DefaultSettings(), fmt.Errorf("%w: the stored value is not a JSON object", ErrSettingsProblem)
	}
	settings := DefaultSettings()
	if err := json.Unmarshal([]byte(raw.String), &settings); err != nil {
		return DefaultSettings(), fmt.Errorf("%w: %v", ErrSettingsProblem, err)
	}
	return settings.Sanitize(), nil
}

// createDefaultSettings is the fallback for a missing row. It writes the same value,
// editor type and description as the migration, so the row looks the same whichever
// of the two created it.
func createDefaultSettings(ctx context.Context, database *sql.DB) (Settings, error) {
	settings := DefaultSettings()
	encoded, err := json.Marshal(settings)
	if err != nil {
		return settings, err
	}
	if _, err := database.ExecContext(ctx, insertSettingsSQL, SettingsConfigKey, encoded, settingsValueType, settingsCreationSpec); err != nil {
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
	if _, err := database.ExecContext(ctx, updateSettingsSQL, SettingsConfigKey, encoded, settingsValueType, settingsCreationSpec); err != nil {
		return sanitized, fmt.Errorf("save missing media check settings: %w", err)
	}
	return sanitized, nil
}
