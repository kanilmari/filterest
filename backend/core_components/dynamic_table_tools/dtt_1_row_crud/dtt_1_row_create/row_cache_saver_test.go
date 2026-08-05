// row_cache_saver_test.go
// Unit tests for row_cache_saver.go.
// Tests updateFilenameInChildRow and updateCacheTargetsBase (via updateCacheTargetsNoTx) using the queue-based mock driver.
package dtt_1_row_create

import (
	"database/sql/driver"
	"encoding/json"
	"testing"
)

// ── updateFilenameInChildRow ─────────────────────────────────────────────────

func TestUpdateFilenameInChildRow(t *testing.T) {
	t.Cleanup(resetQueues)

	t.Run("exec succeeds", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushExec(queuedExec{rowsAffected: 1})

		if err := updateFilenameInChildRow(db, "attachments", 42, "photo.png"); err != nil {
			t.Fatalf("updateFilenameInChildRow() returned error: %v", err)
		}
	})

	t.Run("exec error is returned", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushExec(queuedExec{err: errMock("simulated exec error")})

		if err := updateFilenameInChildRow(db, "attachments", 1, "bad.png"); err == nil {
			t.Fatal("updateFilenameInChildRow() error = nil, want exec failure")
		}
	})
}

// errMock is a simple string error for test use.
type errMock string

func (e errMock) Error() string { return string(e) }

// ── updateCacheTargetsNoTx (exercises updateCacheTargetsBase) ────────────────

// buildFileUploadSpecs returns target_insert_specs JSON for a cache target.
func buildFileUploadSpecs(filenameColumn string, cacheTargets []map[string]string) string {
	targets := make([]interface{}, len(cacheTargets))
	for i, ct := range cacheTargets {
		targets[i] = map[string]interface{}{
			"table":  ct["table"],
			"column": ct["column"],
		}
	}
	spec := map[string]interface{}{
		"file_upload": map[string]interface{}{
			"filename_column": filenameColumn,
			"cache_targets":   targets,
		},
	}
	b, _ := json.Marshal(spec)
	return string(b)
}

func TestUpdateCacheTargetsNoTx(t *testing.T) {
	t.Cleanup(resetQueues)

	t.Run("no matching FK relation returns nil", func(t *testing.T) {
		// QueryRow returns no rows → function returns nil immediately.
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: nil, // no rows → sql.ErrNoRows
		})

		err := updateCacheTargetsNoTx(db, "source_table", "fk_col", map[string]interface{}{})
		if err != nil {
			t.Errorf("expected nil, got %v", err)
		}
	})

	t.Run("empty target_insert_specs returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{"", "tgt_table", "ref_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{})
		if err != nil {
			t.Errorf("expected nil for empty specs, got %v", err)
		}
	})

	t.Run("invalid JSON in specs returns error", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{"NOT-VALID-JSON", "tgt_table", "ref_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{})
		if err == nil {
			t.Error("expected error for invalid JSON, got nil")
		}
	})

	t.Run("no file_upload key in specs returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := `{"other_key": {}}`
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "ref_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{})
		if err != nil {
			t.Errorf("expected nil for missing file_upload key, got %v", err)
		}
	})

	t.Run("no filename_column in file_upload returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := `{"file_upload": {}}`
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "ref_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{})
		if err != nil {
			t.Errorf("expected nil for missing filename_column, got %v", err)
		}
	})

	t.Run("filename not present in childData returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_tbl", "column": "photo_path"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "ref_col"}},
		})

		// childData does NOT contain key "photo"
		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{
			"other_col": "value",
		})
		if err != nil {
			t.Errorf("expected nil when filename missing from childData, got %v", err)
		}
	})

	t.Run("empty filename string returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_tbl", "column": "photo_path"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "ref_col"}},
		})

		// childData has key but empty string value
		err := updateCacheTargetsNoTx(db, "src", "col", map[string]interface{}{
			"photo": "",
		})
		if err != nil {
			t.Errorf("expected nil for empty filename, got %v", err)
		}
	})

	t.Run("no cache_targets in file_upload returns nil", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := `{"file_upload": {"filename_column": "photo"}}`
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "ref_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "ref_col", map[string]interface{}{
			"photo":   "test.jpg",
			"ref_col": 99,
		})
		if err != nil {
			t.Errorf("expected nil for empty cache_targets, got %v", err)
		}
	})

	t.Run("no source column in childData returns nil", func(t *testing.T) {
		// referencingValue not found → early return nil
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_tbl", "column": "photo_path"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "fk_col"}},
		})

		// childData has the filename but NOT the sourceColumn "fk_col"
		err := updateCacheTargetsNoTx(db, "src", "fk_col", map[string]interface{}{
			"photo": "img.png",
			// "fk_col" intentionally absent
		})
		if err != nil {
			t.Errorf("expected nil when source column missing from childData, got %v", err)
		}
	})

	t.Run("full happy path executes update", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_tbl", "column": "photo_path"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "fk_col"}},
		})
		pushExec(queuedExec{rowsAffected: 1})

		err := updateCacheTargetsNoTx(db, "src", "fk_col", map[string]interface{}{
			"photo":  "avatar.png",
			"fk_col": int64(5),
		})
		if err != nil {
			t.Errorf("expected nil, got %v", err)
		}
	})

	t.Run("exec error on cache update returns error", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_tbl", "column": "photo_path"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "fk_col"}},
		})
		pushExec(queuedExec{err: errMock("db write failed")})

		err := updateCacheTargetsNoTx(db, "src", "fk_col", map[string]interface{}{
			"photo":  "avatar.png",
			"fk_col": int64(5),
		})
		if err == nil {
			t.Error("expected error when exec fails, got nil")
		}
	})

	t.Run("multiple cache targets all updated", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		specs := buildFileUploadSpecs("photo", []map[string]string{
			{"table": "cache_a", "column": "img_a"},
			{"table": "cache_b", "column": "img_b"},
		})
		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{specs, "tgt_table", "fk_col"}},
		})
		// Two exec calls expected — one per cache target
		pushExec(queuedExec{rowsAffected: 1})
		pushExec(queuedExec{rowsAffected: 1})

		err := updateCacheTargetsNoTx(db, "src", "fk_col", map[string]interface{}{
			"photo":  "multi.png",
			"fk_col": int64(7),
		})
		if err != nil {
			t.Errorf("expected nil for two cache targets, got %v", err)
		}
	})

	t.Run("cache target with missing table name is skipped", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		// One target is missing "table" key → skipped. No exec should happen.
		spec := map[string]interface{}{
			"file_upload": map[string]interface{}{
				"filename_column": "photo",
				"cache_targets": []interface{}{
					map[string]interface{}{"column": "img"}, // no "table"
				},
			},
		}
		specJSON, _ := json.Marshal(spec)

		pushQuery(queuedQuery{
			cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
			rows: [][]driver.Value{{string(specJSON), "tgt_table", "fk_col"}},
		})

		err := updateCacheTargetsNoTx(db, "src", "fk_col", map[string]interface{}{
			"photo":  "x.png",
			"fk_col": int64(3),
		})
		if err != nil {
			t.Errorf("expected nil when target has no table name, got %v", err)
		}
	})
}

// ── updateCacheTargets / updateCacheTargetsNoTx wrappers ────────────────────

// TestUpdateCacheTargets_IsWrapperForBase verifies the thin wrapper delegates
// correctly by exercising the same no-rows short-circuit path.
func TestUpdateCacheTargetsNoTx_DelegatesCorrectly(t *testing.T) {
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()

	pushQuery(queuedQuery{
		cols: []string{"target_insert_specs", "target_table_name", "target_column_name"},
		rows: nil, // no matching FK row
	})

	err := updateCacheTargetsNoTx(db, "any_table", "any_col", nil)
	if err != nil {
		t.Errorf("expected nil from wrapper delegation, got %v", err)
	}
}
