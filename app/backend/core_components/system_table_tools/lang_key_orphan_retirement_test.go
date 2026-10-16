// lang_key_orphan_retirement_test.go
// Verifies the retained archive helper and the report-only pause description.
// Bridges archiveExpiredOrphans and translated consistency copy with a SQL mock.
// Protects usage guards without enabling an automatic archive caller.
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

func TestOrphanDescriptionReportsPauseWithoutCountdown(t *testing.T) {
	for _, row := range []langKeyRow{
		{id: 7, key: "orders_front_page"},
		{id: 7, key: "test_connection", hasLiveUsage: true},
	} {
		keys := orphanDescriptionLangKeys(row, map[int]int{7: 400})
		if !strings.HasSuffix(keys[0], "archiving_paused") || keys[1] != "consistency_orphan_age_days+400" {
			t.Fatalf("missing pause/age keys: %v", keys)
		}
		if row.hasLiveUsage && keys[2] != "consistency_lang_key_counting_source" {
			t.Fatalf("missing counting-source explanation: %v", keys)
		}
		if description := buildLangKeyConsistencyDescription(row, map[int]int{7: 400}); strings.Contains(description, "deleted") {
			t.Fatalf("report promises deletion: %q", description)
		}
	}
}
