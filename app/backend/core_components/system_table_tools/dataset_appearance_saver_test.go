// dataset_appearance_saver_test.go
// Exercises read/refusal branches independently of a PostgreSQL socket.
// Connects the existing SQL queue fixture with revision and merged validation boundaries.
// Supplements the real transaction tests; a queue cannot prove concurrent lock behavior.
package system_table_tools

import (
	"database/sql/driver"
	appearance "easelect/frontend/shared/dataset_appearance"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDatasetAppearanceReadAbsentExistingAndDeleted(t *testing.T) {
	tabRaw, _ := json.Marshal(appearance.Rules().DefaultsForPlace(appearance.TabOnly))
	for _, tc := range []struct {
		name     string
		rows     [][]driver.Value
		revision string
		missing  bool
	}{
		{"absent overrides", [][]driver.Value{{nil, nil, nil, nil}}, "none", false},
		{"empty retained row", [][]driver.Value{{int64(2), tabRaw, []byte(`{}`), "3"}}, "3", false},
		{"deleted dataset", nil, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetOrphanQueues()
			defer resetOrphanQueues()
			db := newSystemTableToolsTestDB(t)
			defer db.Close()
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"schema_version", "tab_values", "overrides", "revision"}, rows: tc.rows})
			state, err := ReadDatasetAppearance(db, 42, false)
			if tc.missing {
				if !errors.Is(err, ErrDatasetAppearanceNotFound) {
					t.Fatal("deleted dataset was confused with no overrides", err)
				}
			} else if err != nil || state.Revision != tc.revision || state.SchemaVersion != 2 || len(state.TabValues) != 28 || len(state.Overrides) != 0 {
				t.Fatal(state, err)
			}
		})
	}
}

func TestDatasetAppearancePatchInputRefusedBeforeTransaction(t *testing.T) {
	for _, patch := range []DatasetAppearancePatch{
		{Set: map[string]any{"light.image_blur": nil}}, {Unset: []string{"shared.image_blur"}},
		{Set: map[string]any{"shared.card_detail_columns": 2}, Unset: []string{"shared.card_detail_columns"}},
	} {
		_, err := SaveDatasetAppearance(nil, 42, patch, "none", "none", false)
		assertDatasetAppearanceRefusal(t, err, 400)
	}
}

func TestDatasetAppearanceStaleAndCompetingInitialRefusals(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "competing first insert", true: "stale existing row"}[existing], func(t *testing.T) {
			resetOrphanQueues()
			defer resetOrphanQueues()
			db := newSystemTableToolsTestDB(t)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			pushOrphanExec(orphanQueuedExec{})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"json_value", "updated"}})
			pushOrphanExec(orphanQueuedExec{})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}})
			current := orphanQueuedQuery{cols: []string{"schema_version", "tab_values", "overrides", "revision"}}
			if existing {
				tabRaw, _ := json.Marshal(appearance.Rules().DefaultsForPlace(appearance.TabOnly))
				current.rows = [][]driver.Value{{int64(2), tabRaw, []byte(`{}`), "3"}}
			}
			pushOrphanQuery(current)
			if !existing {
				// ON CONFLICT DO NOTHING returns no row when another writer has
				// created it after our initial read, even without our advisory lock.
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"revision"}})
			}
			_, err = SaveDatasetAppearance(tx, 42, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 2}}, "none", "none", false)
			assertDatasetAppearanceRefusal(t, err, 409)
			if !errors.Is(err, ErrDatasetAppearanceConflict) {
				t.Fatal("conflict lost its stable identity", err)
			}
		})
	}
}

func TestDatasetAppearanceUnsetMaskRefusedBeforeTransaction(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	_, err := SaveDatasetAppearance(nil, 42, DatasetAppearancePatch{Unset: []string{"light.mid_opacity"}}, "3", "none", false)
	assertDatasetAppearanceRefusal(t, err, 400)
	if len(snapshotOrphanCalls()) != 0 {
		t.Fatal("mask removal reached transaction work")
	}
}

func TestDatasetAppearanceCardOnlyFirstSaveMaterializesCompleteTabValues(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	pushOrphanExec(orphanQueuedExec{})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"json_value", "updated"}})
	pushOrphanExec(orphanQueuedExec{})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"schema_version", "tab_values", "overrides", "revision"}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"revision"}, rows: [][]driver.Value{{"1"}}})
	result, err := SaveDatasetAppearance(tx, 42, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 2}}, "none", "none", false)
	if err != nil || result.Revision != "1" || len(result.TabValues) != 28 || result.SchemaVersion != 2 || result.Overrides["shared.card_detail_columns"] != float64(2) {
		t.Fatal(result, err)
	}
	calls := snapshotOrphanCalls()
	if len(calls) != 6 || !strings.Contains(calls[5], "overrides,tab_values") {
		t.Fatal("first insert must persist both maps", calls)
	}
}

func TestDatasetAppearanceInvalidTabMaskRefusedBeforePersistence(t *testing.T) {
	for _, theme := range []string{"light", "dark"} {
		t.Run(theme, func(t *testing.T) {
			resetOrphanQueues()
			defer resetOrphanQueues()
			db := newSystemTableToolsTestDB(t)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			pushOrphanExec(orphanQueuedExec{})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"json_value", "updated"}})
			pushOrphanExec(orphanQueuedExec{})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(42)}}})
			tab, _ := json.Marshal(appearance.Rules().DefaultsForPlace(appearance.TabOnly))
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"schema_version", "tab_values", "overrides", "revision"}, rows: [][]driver.Value{{int64(2), tab, []byte(`{}`), "3"}}})
			_, err = SaveDatasetAppearance(tx, 42, DatasetAppearancePatch{TabSet: map[string]any{theme + ".center_stop": 90}}, "3", "none", false)
			assertDatasetAppearanceRefusal(t, err, 400)
			for _, call := range snapshotOrphanCalls() {
				if strings.Contains(call, "UPDATE public.system_dataset_appearance") || strings.Contains(call, "INSERT INTO public.system_dataset_appearance") {
					t.Fatal("invalid mask reached persistence", call)
				}
			}
		})
	}
}
