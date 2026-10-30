// lang_key_source_vacuum_postgres_test.go
// Proves public scans VACUUM only their source table after successful large writes.
// Connects real PostgreSQL maintenance statistics, pool limits and scan outcomes.
// Uses disposable clusters only, including real statement failure and late stats.
package system_table_tools

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"
)

func sourceLastVacuum(t *testing.T, db *sql.DB) sql.NullTime {
	t.Helper()
	var at sql.NullTime
	if err := db.QueryRow(`SELECT last_vacuum FROM pg_stat_user_tables
 WHERE relid='public.system_lang_key_sources'::regclass`).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

// PostgreSQL publishes maintenance statistics asynchronously after VACUUM.
func sourceVacuumPoll(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("VACUUM statistics did not arrive within three seconds")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func requireSourceVacuumUnchanged(t *testing.T, db *sql.DB, before sql.NullTime) {
	t.Helper()
	// PostgreSQL can publish maintenance statistics only after the backend idles.
	deadline := time.Now().Add(1500 * time.Millisecond)
	for {
		if after := sourceLastVacuum(t, db); after != before {
			t.Fatal("unexpected VACUUM", before, after)
		}
		if time.Now().After(deadline) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func requireCompleteSourceScan(t *testing.T) {
	t.Helper()
	count, err := PopulateLangKeySources()
	state, failures := sourceScanOutcome()
	if err != nil || count != 2 || state != "complete" || len(failures) != 0 || !SourceScanIsFresh() {
		t.Fatal(count, err, state, failures)
	}
}

func TestLangKeySourceVacuumPostgresInsertedUpdatedAndUnchanged(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	output := sourceVacuumTestConfig(t, 2) // Exact inserted + updated boundary.
	if sourceLastVacuum(t, db).Valid {
		t.Fatal("fresh fixture already vacuumed")
	}
	requireCompleteSourceScan(t)
	sourceVacuumPoll(t, func() bool { return sourceLastVacuum(t, db).Valid })
	before := sourceLastVacuum(t, db)
	if !strings.Contains(output.String(), "inserted=2 updated=0") || !strings.Contains(output.String(), "vacuum=ok ") {
		t.Fatal(output.String())
	}
	output.Reset()
	requireCompleteSourceScan(t) // Same seen count, zero physical source writes.
	requireSourceVacuumUnchanged(t, db, before)
	if !strings.Contains(output.String(), "inserted=0 updated=0") || !strings.Contains(output.String(), "vacuum=skipped ") {
		t.Fatal(output.String())
	}
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET last_seen=CURRENT_DATE-1
 WHERE source_type IN ('code','code_literal')`)
	output.Reset()
	requireCompleteSourceScan(t)
	sourceVacuumPoll(t, func() bool { return sourceLastVacuum(t, db) != before })
	if !strings.Contains(output.String(), "inserted=0 updated=2") || !strings.Contains(output.String(), "vacuum=ok ") {
		t.Fatal(output.String())
	}
}

func TestLangKeySourceVacuumPostgresBelowThreshold(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	output := sourceVacuumTestConfig(t, 3)
	before := sourceLastVacuum(t, db)
	requireCompleteSourceScan(t)
	requireSourceVacuumUnchanged(t, db, before)
	if !strings.Contains(output.String(), "vacuum=skipped vacuum_milliseconds=0") {
		t.Fatal(output.String())
	}
}

func TestLangKeySourceVacuumPostgresFailurePreservesScan(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	output := sourceVacuumTestConfig(t, 2)
	runLangKeySourceVacuum = func(db *sql.DB) error {
		_, err := db.Exec(`VACUUM (ANALYZE, invalid_test_option) system_lang_key_sources`)
		return err
	}
	before := sourceLastVacuum(t, db)
	requireCompleteSourceScan(t)
	requireSourceVacuumUnchanged(t, db, before)
	if !strings.Contains(output.String(), "WARNING [PopulateLangKeySources] source VACUUM failed") ||
		!strings.Contains(output.String(), "vacuum=failed vacuum_milliseconds=") ||
		strings.Contains(output.String(), "scan_trust_key") {
		t.Fatal(output.String())
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE id IN (1,3)`) != 0 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key='lang_key_source_scan_history'`) != 1 {
		t.Fatal("VACUUM failure changed scan cleanup or history")
	}
}

func TestLangKeySourceVacuumPostgresBlockedScansSkip(t *testing.T) {
	for _, scenario := range []string{"partial", "suspicious"} {
		t.Run(scenario, func(t *testing.T) {
			db := scanTrustPostgresFixture(t)
			output := sourceVacuumTestConfig(t, 1)
			if scenario == "partial" {
				frontPageExec(t, db, `ALTER TABLE system_table_views RENAME TO unavailable_views`)
			} else if _, _, err := recordCodeSourceCount(db, 100, timeNowUTC()); err != nil {
				t.Fatal(err)
			}
			before := sourceLastVacuum(t, db)
			count, err := PopulateLangKeySources()
			state, _ := sourceScanOutcome()
			if count != 2 || (err != nil) != (scenario == "partial") || state != scenario || SourceScanIsFresh() {
				t.Fatal(count, err, state)
			}
			requireSourceVacuumUnchanged(t, db, before)
			if !strings.Contains(output.String(), "vacuum=skipped ") {
				t.Fatal(output.String())
			}
		})
	}
}

func TestLangKeySourceVacuumPostgresSingleConnectionAfterLockRelease(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	output := sourceVacuumTestConfig(t, 2)
	runLangKeySourceVacuum = func(db *sql.DB) error {
		// Discovery needs a dedicated advisory-lock connection plus a worker.
		// At the maintenance boundary both must have returned to the pool.
		if inUse := db.Stats().InUse; inUse != 0 {
			t.Errorf("VACUUM started with %d scan connections still in use", inUse)
		}
		db.SetMaxOpenConns(1)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := db.ExecContext(ctx, "VACUUM (ANALYZE) system_lang_key_sources")
		return err
	}
	requireCompleteSourceScan(t)
	sourceVacuumPoll(t, func() bool { return sourceLastVacuum(t, db).Valid })
	if !strings.Contains(output.String(), "vacuum=ok ") || db.Stats().MaxOpenConnections != 1 {
		t.Fatal(output.String(), db.Stats())
	}
}
