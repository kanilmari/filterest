// missing_media_settings_reader_test.go
// Verifies the settings contract: shipped defaults, safe clamping and the off switch.
// Between the stored settings row and the runner that decides whether to scan at all.
// Exists so switching the check off really stops it, at startup as well as on demand.
package missing_media_check

import (
	"encoding/json"
	"testing"
)

func TestDefaultSettingsAreTheShippedContract(t *testing.T) {
	encoded, err := json.Marshal(DefaultSettings())
	if err != nil {
		t.Fatalf("marshal defaults: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode defaults: %v", err)
	}
	expected := map[string]interface{}{
		"schema_version":            float64(1),
		"enabled":                   true,
		"max_total_rows_checked":    float64(10000),
		"min_rows_per_dataset":      float64(50),
		"max_run_seconds":           float64(120),
		"run_on_startup":            true,
		"startup_delay_seconds":     float64(30),
		"report_unused_files":       false,
		"max_reported_missing":      float64(200),
		"max_reported_unused_files": float64(200),
	}
	if len(decoded) != len(expected) {
		t.Fatalf("default settings keys = %v, want exactly %v", decoded, expected)
	}
	for key, want := range expected {
		if decoded[key] != want {
			t.Fatalf("default %s = %v, want %v", key, decoded[key], want)
		}
	}
}

func TestSanitizeClampsUnusableValues(t *testing.T) {
	sanitized := Settings{
		Enabled:                true,
		MaxTotalRowsChecked:    -5,
		MinRowsPerDataset:      0,
		MaxRunSeconds:          99999,
		StartupDelaySeconds:    -1,
		MaxReportedMissing:     0,
		MaxReportedUnusedFiles: 999999,
	}.Sanitize()

	if sanitized.MaxTotalRowsChecked != 1 {
		t.Fatalf("negative row limit = %d, want the lowest usable value", sanitized.MaxTotalRowsChecked)
	}
	if sanitized.MinRowsPerDataset != DefaultSettings().MinRowsPerDataset {
		t.Fatalf("zero minimum = %d, want the shipped default", sanitized.MinRowsPerDataset)
	}
	if sanitized.MaxRunSeconds != 3600 {
		t.Fatalf("time limit = %d, want it clamped to one hour", sanitized.MaxRunSeconds)
	}
	if sanitized.StartupDelaySeconds != 0 {
		t.Fatalf("startup delay = %d, want 0", sanitized.StartupDelaySeconds)
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
}

func TestRunAllowedRespectsTheOffSwitch(t *testing.T) {
	off := DefaultSettings()
	off.Enabled = false
	if RunAllowed(off, TriggerStartup) {
		t.Fatal("a switched-off check must not run at startup")
	}
	if RunAllowed(off, TriggerManual) {
		t.Fatal("a switched-off check must not run on demand either")
	}

	startupOnlyOff := DefaultSettings()
	startupOnlyOff.RunOnStartup = false
	if RunAllowed(startupOnlyOff, TriggerStartup) {
		t.Fatal("the startup run must follow its own setting")
	}
	if !RunAllowed(startupOnlyOff, TriggerManual) {
		t.Fatal("an administrator can still start the check on demand")
	}

	if !RunAllowed(DefaultSettings(), TriggerStartup) {
		t.Fatal("the shipped defaults run the check once after startup")
	}
}

func TestStoredSettingsOverrideDefaults(t *testing.T) {
	settings := DefaultSettings()
	stored := `{"enabled":false,"max_total_rows_checked":250,"report_unused_files":true}`
	if err := json.Unmarshal([]byte(stored), &settings); err != nil {
		t.Fatalf("decode stored settings: %v", err)
	}
	settings = settings.Sanitize()

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
