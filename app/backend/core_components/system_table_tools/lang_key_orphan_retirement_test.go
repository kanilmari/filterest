// lang_key_orphan_retirement_test.go
// Verifies that an aged orphan language key is retired, and only when nothing
// in code or schema still refers to it.
// Bridges archiveExpiredOrphans and the consistency-check wording with the
// package-local SQL mock driver.
// Exists because retirement deletes translated copy: it must be visible in
// advance and must never take a key the interface still asks for.
package system_table_tools

import (
	"database/sql/driver"
	"strings"
	"testing"
)

func TestArchiveExpiredOrphansRetiresAnAgedOrphan(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)

	db := newSystemTableToolsTestDB(t)
	defer db.Close()

	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"lang_key_id", "last_seen"},
		rows: [][]driver.Value{{int64(42), "2026-01-01"}},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // copy into the archive
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // remove the key itself

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin() error = %v", err)
	}
	defer tx.Rollback()

	if archived := archiveExpiredOrphans(tx); archived != 1 {
		t.Fatalf("archiveExpiredOrphans() = %d, want 1 retired key", archived)
	}

	calls := snapshotOrphanCalls()
	if len(calls) != 3 {
		t.Fatalf("expected candidate query, archive insert and delete, got %d calls (%v)", len(calls), calls)
	}
	if !strings.Contains(calls[0], "CURRENT_DATE - INTERVAL '90 days'") {
		t.Fatalf("retirement should use the 90-day age, got %q", calls[0])
	}
	for _, index := range []int{0, 2} {
		if !strings.Contains(calls[index], "source_type NOT IN ('orphan', 'manual_crud')") {
			t.Fatalf("call %d should refuse a key that still has usage, got %q", index, calls[index])
		}
	}
	if !strings.Contains(calls[1], "INSERT INTO system_lang_keys_archive") {
		t.Fatalf("a retired key should be archived before deletion, got %q", calls[1])
	}
}

func TestArchiveExpiredOrphansAbortsWhenTheKeyRegainedUsage(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)

	db := newSystemTableToolsTestDB(t)
	defer db.Close()

	pushOrphanQuery(orphanQueuedQuery{
		cols: []string{"lang_key_id", "last_seen"},
		rows: [][]driver.Value{{int64(42), "2026-01-01"}},
	})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // copy into the archive
	pushOrphanExec(orphanQueuedExec{rowsAffected: 0}) // the guarded delete refuses

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin() error = %v", err)
	}
	defer tx.Rollback()

	if archived := archiveExpiredOrphans(tx); archived != -1 {
		t.Fatalf("archiveExpiredOrphans() = %d, want -1 so the caller rolls the batch back", archived)
	}
}

func TestOrphanDescriptionPromisesRetirementOnlyWhenItWillHappen(t *testing.T) {
	retiring := buildLangKeyConsistencyDescription(
		langKeyRow{id: 7, key: "orders_front_page", en: "Orders", langKeyType: "ui"},
		map[int]int{7: 84},
	)
	if !strings.Contains(retiring, "orphan for 84 days, will be archived and deleted in 6 day(s)") {
		t.Fatalf("an administrator should see the retirement countdown, got %q", retiring)
	}

	kept := buildLangKeyConsistencyDescription(
		langKeyRow{id: 8, key: "test_connection", en: "Test connection", langKeyType: "ui", hasLiveUsage: true},
		map[int]int{8: 400},
	)
	if strings.Contains(kept, "will be archived and deleted") {
		t.Fatalf("a key that code still uses must not be announced for deletion, got %q", kept)
	}
	if !strings.Contains(kept, "kept because code or schema still uses it") {
		t.Fatalf("the reason a key is kept should be stated, got %q", kept)
	}
}
