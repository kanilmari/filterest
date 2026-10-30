// lang_key_source_writer_postgres_test.go
// Proves source scans avoid physical rewrites while preserving daily evidence.
// Connects bounded writes, scan trust and cleanup to disposable PostgreSQL only.
// Checks tuple identities as well as values, including concurrent source writers.
package system_table_tools

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"github.com/lib/pq"
)

func sourceTupleVersions(t *testing.T, db *sql.DB) map[int64]string {
	t.Helper()
	rows, err := db.Query(`SELECT id, xmin::text || '/' || ctid::text FROM system_lang_key_sources ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	versions := map[int64]string{}
	for rows.Next() {
		var id int64
		var version string
		if err := rows.Scan(&id, &version); err != nil {
			t.Fatal(err)
		}
		versions[id] = version
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return versions
}

func sourcePostgresWriter(t *testing.T, chunkRows int) *langKeySourceWriter {
	t.Helper()
	w, err := newLangKeySourceWriter(chunkRows)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func requireSourceFlush(t *testing.T, w *langKeySourceWriter) {
	t.Helper()
	if err := w.flush(); err != nil {
		t.Fatal(err)
	}
}

func TestLangKeySourceWriterPostgresSecondScanDoesNotRewriteAnyTuple(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	first, err := PopulateLangKeySources()
	if err != nil || first != 2 {
		t.Fatal(first, err)
	}
	before := sourceTupleVersions(t, db)
	second, err := PopulateLangKeySources()
	if err != nil || second != first || !SourceScanIsFresh() {
		t.Fatal(first, second, err)
	}
	after := sourceTupleVersions(t, db)
	if len(before) == 0 || !reflect.DeepEqual(before, after) {
		t.Fatal("unchanged same-day scan rewrote tuples", before, after)
	}
}

func TestLangKeySourceWriterPostgresChangesDailyRefreshAndUnseenExpiry(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	if _, err := PopulateLangKeySources(); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET source_low='changed outside scan'
        WHERE source_type='code' AND lang_key_id=1;
        UPDATE system_lang_key_sources SET last_seen=CURRENT_DATE-1 WHERE source_type='code_literal' AND lang_key_id=1;
        INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen) VALUES
        (1,'code','no_longer_seen.js','keep',CURRENT_DATE-7),
        (1,'code','expired_unseen.js','keep',CURRENT_DATE-8);`)
	before := sourceTupleVersions(t, db)
	writeLangKeyReference(t, filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "frontend", "new.js"), "protected_key")
	if count, err := PopulateLangKeySources(); err != nil || count != 4 {
		t.Fatal(count, err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE lang_key_id=1
        AND source_high='app/frontend/view.js' AND source_low='' AND last_seen=CURRENT_DATE`) != 2 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE lang_key_id=2 AND source_high='app/frontend/new.js'
        AND last_seen=CURRENT_DATE`) != 2 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='no_longer_seen.js'
        AND source_low='keep' AND last_seen=CURRENT_DATE-7`) != 1 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='expired_unseen.js'`) != 0 {
		t.Fatal("changed/new/daily/unseen source state diverged")
	}
	var unseenID int64
	if err := db.QueryRow(`SELECT id FROM system_lang_key_sources WHERE source_high='no_longer_seen.js'`).Scan(&unseenID); err != nil {
		t.Fatal(err)
	}
	if after := sourceTupleVersions(t, db); after[unseenID] != before[unseenID] {
		t.Fatal("unseen boundary row was rewritten")
	}
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET last_seen=CURRENT_DATE-8 WHERE source_high='no_longer_seen.js'`)
	if count := cleanupStaleLangKeySources(); count != 1 {
		t.Fatal("unchanged seven-day cleanup did not expire unseen evidence", count)
	}
}

func TestLangKeySourceWriterPostgresLastWriteWinsWithinAndAcrossChunks(t *testing.T) {
	for _, chunkRows := range []int{2, langKeySourceChunkRows} {
		t.Run(strconv.Itoa(chunkRows), func(t *testing.T) {
			db := scanTrustPostgresFixture(t)
			db.SetMaxOpenConns(1) // Snapshot reader must close before any write.
			w := sourcePostgresWriter(t, chunkRows)
			for _, save := range []struct{ high, low string }{
				{"repeat", "first"}, {"repeat", "second"}, {"boundary", "other"}, {"repeat", "third"},
			} {
				if err := w.upsertSource(1, "column", save.high, save.low); err != nil {
					t.Fatal(err)
				}
				if len(w.pending) >= chunkRows || len(w.explanations) >= chunkRows {
					t.Fatal("chunk bound exceeded")
				}
			}
			requireSourceFlush(t, w)
			if w.stats.seen != 4 || frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources
                WHERE source_type='column' AND source_high='repeat' AND source_low='third' AND last_seen=CURRENT_DATE`) != 1 {
				t.Fatal("last write lost", w.stats)
			}
			if chunkRows == 2 && (w.stats.inserted != 2 || w.stats.updated != 1 || w.stats.chunks != 2) {
				t.Fatal("chunk boundary not exercised", w.stats)
			}
		})
	}
}

func TestLangKeySourceWriterPostgresExplanationsAreEmptyOnly(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	db.SetMaxOpenConns(1)
	frontPageExec(t, db, `INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
        VALUES(1,'table','null','same',CURRENT_DATE,NULL),(1,'table','empty','same',CURRENT_DATE,''),
        (1,'table','authored','same',CURRENT_DATE,'authored'),(1,'table','spaces','same',CURRENT_DATE,' '),
        (1,'table','blank_offer','same',CURRENT_DATE,NULL),(1,'table','concurrent','same',CURRENT_DATE,NULL);`)
	before := sourceTupleVersions(t, db)
	w := sourcePostgresWriter(t, 2)
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET usage_explanation='concurrent author' WHERE source_high='concurrent'`)
	for _, high := range []string{"null", "empty", "authored", "spaces", "concurrent", "new"} {
		for _, explanation := range []string{" first ", "second"} {
			if err := w.saveExplainedSource(1, "table", high, "same", explanation); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := w.saveExplainedSource(1, "table", "blank_offer", "same", " \t\n"); err != nil {
		t.Fatal(err)
	}
	requireSourceFlush(t, w)
	if w.stats.inserted != 1 || w.stats.updated != 0 || w.stats.explanations != 3 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high IN ('null','empty','new') AND usage_explanation=' first '`) != 3 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='concurrent' AND usage_explanation='concurrent author'`) != 1 {
		t.Fatal("explanation semantics changed", w.stats)
	}
	rows, err := db.Query(`SELECT id FROM system_lang_key_sources WHERE source_high IN ('authored','spaces','blank_offer')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var unchanged []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		unchanged = append(unchanged, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	after := sourceTupleVersions(t, db)
	for _, id := range unchanged {
		if after[id] != before[id] {
			t.Fatal("nonempty explanation or blank offer caused a write", id)
		}
	}
}

func TestLangKeySourceWriterPostgresConcurrentWritesConverge(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	frontPageExec(t, db, `INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
        VALUES(1,'column','concurrent','scanned',CURRENT_DATE)`)
	w := sourcePostgresWriter(t, 2)
	frontPageExec(t, db, `UPDATE system_lang_key_sources SET source_low='other writer' WHERE source_high='concurrent';
        INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
        VALUES(1,'column','new_after_snapshot','other writer',CURRENT_DATE,'authored')`)
	if err := w.upsertSource(1, "column", "concurrent", "scanned"); err != nil {
		t.Fatal(err)
	}
	if err := w.saveExplainedSource(1, "column", "new_after_snapshot", "scanned", "generic"); err != nil {
		t.Fatal(err)
	}
	requireSourceFlush(t, w)
	if w.stats.inserted != 0 || w.stats.updated != 1 || w.stats.explanations != 0 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='concurrent' AND source_low='other writer'`) != 1 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='new_after_snapshot' AND source_low='scanned' AND usage_explanation='authored'`) != 1 {
		t.Fatal("concurrent conflict or skip behavior changed", w.stats)
	}
	next := sourcePostgresWriter(t, 2)
	if err := next.upsertSource(1, "column", "concurrent", "scanned"); err != nil {
		t.Fatal(err)
	}
	requireSourceFlush(t, next)
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='concurrent' AND source_low='scanned'`) != 1 {
		t.Fatal("next scan did not converge")
	}
}

func TestLangKeySourceWriterPostgresFailedChunkBlocksMaintenance(t *testing.T) {
	for _, stage := range []string{"code", "folders"} {
		t.Run(stage, func(t *testing.T) {
			db := scanTrustPostgresFixture(t)
			before, _ := sourceScanStatus()
			if stage == "code" {
				frontPageExec(t, db, `ALTER TABLE system_lang_key_sources ADD CONSTRAINT forced_chunk_failure CHECK(source_high<>'app/frontend/view.js')`)
			} else {
				frontPageExec(t, db, `INSERT INTO system_table_folders VALUES('scan_trust_key');
                    ALTER TABLE system_lang_key_sources ADD CONSTRAINT forced_chunk_failure CHECK(usage_explanation IS NULL)`)
			}
			if _, err := PopulateLangKeySources(); err == nil {
				t.Fatal("failing chunk accepted")
			}
			state, failures := sourceScanOutcome()
			if state != "partial" || len(failures) != 1 || failures[0] != stage {
				t.Fatal(state, failures)
			}
			assertPostgresScanBlocked(t, db, before)
			if frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key='lang_key_source_scan_history'`) != 0 {
				t.Fatal("failed chunk reached history")
			}
		})
	}
}

func TestLangKeySourceWriterPostgresLaterColumnReadSeesEarlierSave(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	frontPageExec(t, db, `CREATE TABLE app_values(label text);
        INSERT INTO app_values VALUES('protected_key');
        INSERT INTO system_db_tables VALUES(1,'app_values'),(2,'system_lang_key_sources');
        INSERT INTO system_column_details VALUES(1,'label','lang_key'),(2,'source_low','lang_key');`)
	// Column metadata is read in dataset/column order, so source_low is second.
	// No earlier evidence contains protected_key in source_low.
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_low='protected_key'`) != 0 {
		t.Fatal("fixture already contains the dependent value")
	}
	if count, err := PopulateLangKeySources(); err != nil || count != 4 || !SourceScanIsFresh() {
		t.Fatal(count, err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE lang_key_id=2
        AND source_type='column_value' AND source_low='protected_key'
        AND source_high IN ('app_values.label','system_lang_key_sources.source_low')`) != 2 {
		t.Fatal("later source-table read missed the earlier buffered save")
	}
}

func TestLangKeySourceWriterPostgresRefreshesDateBetweenChunks(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	db.SetMaxOpenConns(1)
	// One session's time zone is the test seam for advancing PostgreSQL's date;
	// the writer still reads CURRENT_DATE and never consults a Go calendar.
	frontPageExec(t, db, `SET TIME ZONE INTERVAL '-12 hours';
        INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
        VALUES(1,'column','unchanged','same',CURRENT_DATE)`)
	w := sourcePostgresWriter(t, 1)
	before := sourceTupleVersions(t, db)
	previousDate := w.today
	if err := w.upsertSource(1, "column", "first chunk", "value"); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, `SET TIME ZONE INTERVAL '+14 hours'`)
	if err := w.upsertSource(1, "column", "second chunk", "value"); err != nil {
		t.Fatal(err)
	}
	if w.today <= previousDate {
		t.Fatal("database date did not advance", previousDate, w.today)
	}
	if err := w.upsertSource(1, "column", "unchanged", "same"); err != nil {
		t.Fatal(err)
	}
	requireSourceFlush(t, w)
	var id int64
	if err := db.QueryRow(`SELECT id FROM system_lang_key_sources
        WHERE source_type='column' AND source_high='unchanged' AND last_seen=CURRENT_DATE`).Scan(&id); err != nil {
		t.Fatal("later unchanged row kept the earlier date", err)
	}
	if sourceTupleVersions(t, db)[id] == before[id] || w.stats.updated != 1 {
		t.Fatal("unchanged row was not refreshed after the date advanced", w.stats)
	}
}

func TestLangKeySourceWriterPostgresDeadlockRetryAndExhaustion(t *testing.T) {
	for _, exhaust := range []bool{false, true} {
		t.Run(fmt.Sprint(exhaust), func(t *testing.T) {
			db := scanTrustPostgresFixture(t)
			before, _ := sourceScanStatus()
			failures := 1
			if exhaust {
				failures = langKeySourceDeadlockRetries + 1
			}
			// Sequences survive statement rollback. Fail on the second source
			// row to prove that a retry repeats a wholly rolled-back chunk.
			frontPageExec(t, db, fmt.Sprintf(`CREATE SEQUENCE forced_source_deadlocks;
                CREATE FUNCTION force_source_deadlock() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.source_type='code_literal' THEN
                        IF nextval('forced_source_deadlocks') <= %d THEN
                            RAISE EXCEPTION 'forced source chunk deadlock' USING ERRCODE='40P01';
                        END IF;
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER force_source_deadlock BEFORE INSERT ON system_lang_key_sources
                FOR EACH ROW EXECUTE FUNCTION force_source_deadlock();`, failures))
			count, err := PopulateLangKeySources()
			if count != 2 || (err != nil) != exhaust {
				t.Fatal(count, err)
			}
			if exhaust {
				var pgErr *pq.Error
				state, failed := sourceScanOutcome()
				if !errors.As(err, &pgErr) || pgErr.Code != "40P01" || state != "partial" || !reflect.DeepEqual(failed, []string{"code"}) {
					t.Fatal(err, state, failed)
				}
				assertPostgresScanBlocked(t, db, before)
				if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='app/frontend/view.js'`) != 0 ||
					frontPageCount(t, db, `SELECT last_value FROM forced_source_deadlocks`) != 4 {
					t.Fatal("exhausted chunk committed partially or exceeded the retry limit")
				}
			} else if !SourceScanIsFresh() ||
				frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='app/frontend/view.js'`) != 2 ||
				frontPageCount(t, db, `SELECT last_value FROM forced_source_deadlocks`) != 2 {
				t.Fatal("retry did not save exactly one successful chunk")
			}
		})
	}
}
