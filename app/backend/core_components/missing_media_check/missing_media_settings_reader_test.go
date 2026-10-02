// missing_media_settings_reader_test.go
// Verifies the settings contract: shipped defaults, the migration that writes them, safe clamping
// and the treatment of a stored value the check cannot read.
// Between the stored settings row, its migration and the runner that decides whether to scan at all.
// Exists so a new installation, an upgraded one and the application's own fallback all start from
// the same settings, and an unreadable value is shown and reported instead of breaking the screen.
package missing_media_check

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

const settingMigrationPath = "../../../server_tools/migrations/20260929000004_add_missing_media_check_setting.sql"

func encodedAsMap(t *testing.T, value interface{}) map[string]interface{} {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return decoded
}

func TestDefaultSettingsAreTheShippedContract(t *testing.T) {
	expected := map[string]interface{}{
		"schema_version":            float64(2),
		"enabled":                   true,
		"max_total_rows_checked":    float64(10000),
		"min_rows_per_dataset":      float64(50),
		"sampling":                  "even",
		"max_run_seconds":           float64(120),
		"run_on_startup":            false,
		"run_after_update":          true,
		"startup_delay_seconds":     float64(30),
		"exact_count_max_rows":      float64(100000),
		"report_unused_files":       false,
		"max_reported_missing":      float64(200),
		"max_reported_unused_files": float64(200),
	}
	if decoded := encodedAsMap(t, DefaultSettings()); !reflect.DeepEqual(decoded, expected) {
		t.Fatalf("default settings = %v, want exactly %v", decoded, expected)
	}
}

// The migration seeds a new installation and upgrades an old one; the application
// writes the same row when it is missing. Nothing but this test makes the three agree.
func TestTheMigrationWritesTheApplicationDefaultsAndDescription(t *testing.T) {
	migration, err := os.ReadFile(settingMigrationPath)
	if err != nil {
		t.Fatalf("read the setting migration: %v", err)
	}
	defaults := regexp.MustCompile(`(?s)WITH defaults\(value, description\) AS \(\s*VALUES \(\s*'(\{[^']*\})'::jsonb,\s*'((?:[^']|'')*)'\s*\)`).FindSubmatch(migration)
	if defaults == nil {
		t.Fatal("the migration no longer states its defaults and description where this test reads them")
	}
	var seeded map[string]interface{}
	if err := json.Unmarshal(defaults[1], &seeded); err != nil {
		t.Fatalf("the seeded defaults are not JSON: %v", err)
	}
	if want := encodedAsMap(t, DefaultSettings()); !reflect.DeepEqual(seeded, want) {
		t.Fatalf("migration defaults = %v, want DefaultSettings() = %v", seeded, want)
	}
	if description := strings.ReplaceAll(string(defaults[2]), "''", "'"); description != settingsCreationSpec {
		t.Fatalf("migration description = %q, want settingsCreationSpec %q", description, settingsCreationSpec)
	}
	// The stamp merged last decides what an upgraded site keeps. It must be the same in the
	// value and in the condition, or a second run would write again, and it holds the run
	// choices of the defaults, so every site runs the check after an update only (K122).
	stamps := regexp.MustCompile(`json_value \|\| '(\{[^']*\})'::jsonb`).FindAllSubmatch(migration, -1)
	if len(stamps) != 2 || string(stamps[0][1]) != string(stamps[1][1]) {
		t.Fatalf("the migration must merge one identical stamp in its value and its condition, found %d", len(stamps))
	}
	var stamp map[string]interface{}
	if err := json.Unmarshal(stamps[0][1], &stamp); err != nil {
		t.Fatalf("the stamp is not JSON: %v", err)
	}
	shipped := encodedAsMap(t, DefaultSettings())
	wantStamp := map[string]interface{}{
		"schema_version":   float64(SettingsSchemaVersion),
		"run_on_startup":   shipped["run_on_startup"],
		"run_after_update": shipped["run_after_update"],
	}
	if !reflect.DeepEqual(stamp, wantStamp) {
		t.Fatalf("upgrade stamp = %v, want the schema version and the shipped run choices %v", stamp, wantStamp)
	}
}

func TestEveryNumericSettingHasOneRangeThatHoldsItsDefault(t *testing.T) {
	defaults := reflect.ValueOf(DefaultSettings())
	settingsType := defaults.Type()
	numeric := map[string]bool{}
	for index := 0; index < settingsType.NumField(); index++ {
		field := settingsType.Field(index)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if field.Type.Kind() != reflect.Int || name == "schema_version" {
			continue
		}
		numeric[name] = true
		limit, ok := settingLimits[name]
		if !ok {
			t.Fatalf("setting %s has no range, so neither Sanitize nor the screen can bound it", name)
		}
		value := int(defaults.Field(index).Int())
		if value < limit.Minimum || value > limit.Maximum {
			t.Fatalf("default %s = %d lies outside its range %d..%d", name, value, limit.Minimum, limit.Maximum)
		}
	}
	for name := range settingLimits {
		if !numeric[name] {
			t.Fatalf("range %s names no numeric setting", name)
		}
	}
	copied := SettingLimits()
	copied["max_run_seconds"] = SettingLimit{Minimum: 0, Maximum: 0}
	if settingLimits["max_run_seconds"].Maximum == 0 {
		t.Fatal("SettingLimits must hand out a copy, not the table Sanitize uses")
	}
}

func TestSanitizeClampsUnusableValues(t *testing.T) {
	sanitized := Settings{
		Enabled:                true,
		MaxTotalRowsChecked:    -5,
		MinRowsPerDataset:      0,
		Sampling:               " RANDOM ",
		MaxRunSeconds:          99999,
		StartupDelaySeconds:    -1,
		ExactCountMaxRows:      5,
		MaxReportedMissing:     0,
		MaxReportedUnusedFiles: 999999,
	}.Sanitize()

	if sanitized.MaxTotalRowsChecked != 1 {
		t.Fatalf("negative row limit = %d, want the lowest usable value", sanitized.MaxTotalRowsChecked)
	}
	if sanitized.MinRowsPerDataset != DefaultSettings().MinRowsPerDataset {
		t.Fatalf("zero minimum = %d, want the shipped default", sanitized.MinRowsPerDataset)
	}
	if sanitized.Sampling != SamplingRandom {
		t.Fatalf("sampling = %q, want the written method read case-insensitively", sanitized.Sampling)
	}
	if sanitized.MaxRunSeconds != 3600 {
		t.Fatalf("time limit = %d, want it clamped to one hour", sanitized.MaxRunSeconds)
	}
	if sanitized.StartupDelaySeconds != 0 {
		t.Fatalf("startup delay = %d, want 0", sanitized.StartupDelaySeconds)
	}
	if sanitized.ExactCountMaxRows != settingLimits["exact_count_max_rows"].Minimum {
		t.Fatalf("exact count bound = %d, want its lowest usable value", sanitized.ExactCountMaxRows)
	}
	if sanitized.MaxReportedMissing != DefaultSettings().MaxReportedMissing {
		t.Fatalf("report limit = %d, want the shipped default", sanitized.MaxReportedMissing)
	}
	if sanitized.MaxReportedUnusedFiles != 5000 {
		t.Fatalf("unused-file report limit = %d, want it clamped", sanitized.MaxReportedUnusedFiles)
	}
	if sanitized.SchemaVersion != SettingsSchemaVersion {
		t.Fatalf("schema version = %d, want %d", sanitized.SchemaVersion, SettingsSchemaVersion)
	}
	if unknown := (Settings{Sampling: "every third row"}).Sanitize(); unknown.Sampling != SamplingEven {
		t.Fatalf("unknown sampling = %q, want the shipped even sampling", unknown.Sampling)
	}
}

func TestStoredSettingsOverrideDefaults(t *testing.T) {
	settings, err := decodeStoredSettings(sql.NullString{
		Valid:  true,
		String: `{"enabled":false,"max_total_rows_checked":250,"report_unused_files":true}`,
	})
	if err != nil {
		t.Fatalf("decode stored settings: %v", err)
	}
	if settings.Enabled {
		t.Fatal("a stored false must switch the check off")
	}
	if settings.MaxTotalRowsChecked != 250 {
		t.Fatalf("stored row limit = %d, want 250", settings.MaxTotalRowsChecked)
	}
	if !settings.ReportUnusedFiles {
		t.Fatal("the unused-file direction must follow its stored flag")
	}
	if settings.MaxRunSeconds != DefaultSettings().MaxRunSeconds {
		t.Fatal("an omitted value must keep its shipped default")
	}
}

// Reading keeps every stored choice and gives the new keys their defaults. Moving an
// upgraded site's run choices to after-update only is the 9.9.2 migration's work (K122),
// never the reader's, so a site that later chooses every start again is obeyed.
func TestAFirstShapeValueKeepsItsChoicesAndReadsTheNewKeysAsDefaults(t *testing.T) {
	settings, err := decodeStoredSettings(sql.NullString{
		Valid: true,
		String: `{"enabled": true, "run_on_startup": true, "schema_version": 1, "max_run_seconds": 120,
			"report_unused_files": false, "max_reported_missing": 200, "min_rows_per_dataset": 50,
			"startup_delay_seconds": 30, "max_total_rows_checked": 10000, "max_reported_unused_files": 200}`,
	})
	if err != nil {
		t.Fatalf("decode a first-shape value: %v", err)
	}
	if !settings.RunOnStartup {
		t.Fatal("a stored run_on_startup must survive the new default")
	}
	defaults := DefaultSettings()
	if settings.RunAfterUpdate != defaults.RunAfterUpdate || settings.Sampling != defaults.Sampling ||
		settings.ExactCountMaxRows != defaults.ExactCountMaxRows {
		t.Fatalf("new keys = %+v, want their defaults", settings)
	}
	if settings.SchemaVersion != SettingsSchemaVersion {
		t.Fatalf("schema version = %d, want %d once read", settings.SchemaVersion, SettingsSchemaVersion)
	}
}

func TestAStoredValueTheCheckCannotReadGivesDefaultsAndAProblem(t *testing.T) {
	for name, raw := range map[string]sql.NullString{
		"empty":        {},
		"not json":     {Valid: true, String: "{enabled: yes"},
		"an array":     {Valid: true, String: "[1, 2]"},
		"a string":     {Valid: true, String: `"check everything"`},
		"a json null":  {Valid: true, String: "null"},
		"a wrong type": {Valid: true, String: `{"enabled": "yes"}`},
	} {
		t.Run(name, func(t *testing.T) {
			settings, err := decodeStoredSettings(raw)
			if !errors.Is(err, ErrSettingsProblem) {
				t.Fatalf("error = %v, want ErrSettingsProblem", err)
			}
			if !reflect.DeepEqual(settings, DefaultSettings()) {
				t.Fatalf("settings = %+v, want the shipped defaults to show", settings)
			}
		})
	}
}
