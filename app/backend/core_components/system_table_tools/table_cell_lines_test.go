// table_cell_lines_test.go
// Proves public defaults, typed-write boundaries and transactional readback.
// Connects the presentation endpoint to its separate system_config integer row.
// Uses disposable PostgreSQL only when the native runner explicitly enables it.
package system_table_tools

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func TestTableCellLinesTypedPatchRange(t *testing.T) {
	if defaultSitePresentationSettings().TableCellMaxLines != 3 {
		t.Fatal("default must be three")
	}
	for _, value := range []string{"1", "3", "30", "0", "31", "-1", "3.5", "null", "true", `"3"`} {
		_, err := decodeSitePresentationSettings(strings.NewReader(`{"schema_version":2,"set":{},"table_cell_max_lines":` + value + `}`))
		valid := value == "1" || value == "3" || value == "30"
		if (err == nil) != valid {
			t.Fatalf("%s: %v", value, err)
		}
	}
}

func TestTableCellLinesPersistenceAndFallbackPostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	read := func() SitePresentationSettingsResponse {
		t.Helper()
		settings, err := readSitePresentationSettingsWith(db)
		if err != nil {
			t.Fatal(err)
		}
		return settings
	}
	if read().TableCellMaxLines != 3 {
		t.Fatal("missing setting must default to three")
	}
	for _, value := range []int{1, 3, 30} {
		current := read()
		lazy := dbutils.NewLazyTx(db)
		request := httptest.NewRequest("POST", "/", nil)
		patch := SitePresentationSettingsPatch{SchemaVersion: 2, Version: current.Version, Set: map[string]any{}, TableCellMaxLines: &value}
		saved, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)), patch)
		if err != nil {
			lazy.Rollback()
			t.Fatal(err)
		}
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		if saved.TableCellMaxLines != value || read().TableCellMaxLines != value {
			t.Fatal("save/read mismatch")
		}
		raw, _ := json.Marshal(read())
		if !strings.Contains(string(raw), `"table_cell_max_lines":`) {
			t.Fatal("public setting absent")
		}
	}
	// Only synthetic disposable storage: old corrupt rows must remain safe to read.
	if _, err := db.Exec(`UPDATE system_config SET int_value=31 WHERE key='table_cell_max_lines'`); err != nil {
		t.Fatal(err)
	}
	if read().TableCellMaxLines != 3 {
		t.Fatal("invalid saved value must default to three")
	}
}
