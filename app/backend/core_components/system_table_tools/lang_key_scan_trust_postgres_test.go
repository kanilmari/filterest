// lang_key_scan_trust_postgres_test.go
// Proves scan gates preserve actual evidence and persist the rolling code-key floor.
// Connects real population SQL to the opt-in disposable PostgreSQL fixture.
// Never uses an installation database; the fixture removes its cluster on exit.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

func scanTrustPostgresFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t) // Opt-in precedes cluster or SQL access.
	db.SetMaxOpenConns(2)                 // Dedicated advisory lock plus scanner statements.
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	root := t.TempDir()
	app := filepath.Join(root, "app")
	createLangKeySourceRoot(t, app, true)
	writeLangKeyReference(t, filepath.Join(app, "frontend", "view.js"), "scan_trust_key")
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, app))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	lastSourceScanMu.Lock()
	at, success, state, failures := lastSourceScan, lastSuccessfulSourceScan, lastSourceScanState, lastSourceScanFailures
	lastSourceScanMu.Unlock()
	t.Cleanup(func() {
		lastSourceScanMu.Lock()
		lastSourceScan, lastSuccessfulSourceScan, lastSourceScanState, lastSourceScanFailures = at, success, state, failures
		lastSourceScanMu.Unlock()
	})
	frontPageExec(t, db, `ALTER TABLE system_config ADD COLUMN value_type integer;
        CREATE TABLE system_lang_keys(id serial PRIMARY KEY,lang_key text UNIQUE,en text,lang_key_type integer);
        CREATE TABLE system_lang_key_translations(lang_key_id integer REFERENCES system_lang_keys(id),translation text);
        CREATE TABLE system_lang_key_sources(id serial PRIMARY KEY,
            lang_key_id integer REFERENCES system_lang_keys(id) ON DELETE CASCADE,
            source_type text,source_high text,source_low text,usage_explanation text,last_seen date,
            UNIQUE(lang_key_id,source_type,source_high));
        CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text);
        CREATE TABLE system_column_details(table_uid integer,column_name text,card_element text);
        CREATE TABLE system_table_views(name text);
        CREATE TABLE system_user_groups(name text);
        CREATE TABLE system_table_folders(folder_name text);
        INSERT INTO system_lang_keys VALUES(1,'scan_trust_key','Active',1),(2,'protected_key','Protected',1),(3,'old_unused_key','Unused',1);
        INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,last_seen) VALUES
            (1,'code','previous_file.js',CURRENT_DATE-8),
            (2,'orphan','consistency_scan',CURRENT_DATE-100),
            (3,'code','old_unused.js',CURRENT_DATE-8);`)
	markSourceScanDone()
	return db
}

func assertPostgresScanBlocked(t *testing.T, db *sql.DB, before *time.Time) {
	t.Helper()
	after, stale := sourceScanStatus()
	if !stale || SourceScanIsFresh() || after == nil || !after.Equal(*before) {
		t.Fatal("scan advanced trust", after, stale)
	}
	cleanupStaleLangKeySources()
	if a, b := MarkOrphanLangKeys(); a != 0 || b != 0 {
		t.Fatal(a, b)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_keys`) != 3 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE id IN (1,2,3)`) != 3 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_type='orphan'`) != 1 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_type='orphan' AND last_seen=CURRENT_DATE-100`) != 1 {
		t.Fatal("blocked maintenance changed original evidence, markers or keys")
	}
}

func TestLangKeyScanTrustPostgresPartialPreservesEvidence(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	before, _ := sourceScanStatus()
	frontPageExec(t, db, `ALTER TABLE system_table_views RENAME TO unavailable_views`)
	if _, err := PopulateLangKeySources(); err == nil {
		t.Fatal("missing view sub-scan accepted")
	}
	state, failed := sourceScanOutcome()
	if state != "partial" || len(failed) != 1 || failed[0] != "views" {
		t.Fatal(state, failed)
	}
	assertPostgresScanBlocked(t, db, before)
	if frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE key='lang_key_source_scan_history'`) != 0 {
		t.Fatal("partial scan wrote history")
	}
	frontPageExec(t, db, `ALTER TABLE unavailable_views RENAME TO system_table_views`)
	if count, err := PopulateLangKeySources(); err != nil || count != 2 || !SourceScanIsFresh() {
		t.Fatal(count, err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE id IN (1,3)`) != 0 {
		t.Fatal("normal cleanup no longer works")
	}
	if a, _ := MarkOrphanLangKeys(); a != 2 {
		t.Fatal("normal marking no longer works", a)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_keys`) != 3 {
		t.Fatal("J36 pause broken")
	}
}

func TestLangKeyScanTrustPostgresFloorPersistenceAndRecovery(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	now := timeNowUTC()
	// A missing row initializes identically on fresh and upgraded installations.
	for _, sample := range []codeSourceSample{{RuleVersion: langKeyScannerRuleVersion, At: now.Add(-6 * 24 * time.Hour), Count: 100}, {RuleVersion: langKeyScannerRuleVersion, At: now.Add(-time.Hour), Count: 95}} {
		if _, _, err := recordCodeSourceCount(db, sample.Count, sample.At); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := sourceScanStatus()
	// Simulate process trust being invalidated while retaining persisted history.
	markSourceScanFailed()
	if _, err := PopulateLangKeySources(); err != nil {
		t.Fatal(err)
	}
	state, _ := sourceScanOutcome()
	if state != "suspicious" {
		t.Fatal(state)
	}
	assertPostgresScanBlocked(t, db, before)
	// Exactly 90% is allowed and a lower recent sample cannot replace the peak.
	if suspicious, maximum, err := recordCodeSourceCount(db, 90, timeNowUTC()); err != nil || suspicious || maximum != 100 {
		t.Fatal(suspicious, maximum, err)
	}
	if suspicious, maximum, err := recordCodeSourceCount(db, 89, timeNowUTC()); err != nil || !suspicious || maximum != 100 {
		t.Fatal(suspicious, maximum, err)
	}
	// Age the fixture's history past seven days, then prove safe recovery.
	expired, _ := json.Marshal([]codeSourceSample{{RuleVersion: langKeyScannerRuleVersion, At: now.Add(-8 * 24 * time.Hour), Count: 100}})
	if _, err := db.Exec(`UPDATE system_config SET json_value=$1::jsonb WHERE key=$2`, string(expired), codeSourceHistoryKey); err != nil {
		t.Fatal(err)
	}
	if _, err := PopulateLangKeySources(); err != nil || !SourceScanIsFresh() {
		t.Fatal("expired peak blocked recovery", err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE id IN (1,3)`) != 0 {
		t.Fatal("recovered cleanup did not run")
	}
	var raw []byte
	if err := db.QueryRow(`SELECT json_value FROM system_config WHERE key=$1`, codeSourceHistoryKey).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var samples []codeSourceSample
	if err := json.Unmarshal(raw, &samples); err != nil || len(samples) != 1 || samples[0].Count != 1 {
		t.Fatal(string(raw), err)
	}
}

// TestLangKeyScanTrustPostgresRuleVersion proves upgrades accept intentional
// rule changes while the next same-version drop still uses persisted history.
func TestLangKeyScanTrustPostgresRuleVersion(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	now := timeNowUTC()
	old, _ := json.Marshal([]codeSourceSample{{At: now.Add(-time.Hour), Count: 100}})
	if _, err := db.Exec(`INSERT INTO system_config(key,json_value,value_type) VALUES($1,$2::jsonb,5)`, codeSourceHistoryKey, string(old)); err != nil {
		t.Fatal(err)
	}
	if count, err := PopulateLangKeySources(); err != nil || count != 2 || !SourceScanIsFresh() {
		t.Fatal(count, err)
	}
	var raw []byte
	if err := db.QueryRow(`SELECT json_value FROM system_config WHERE key=$1`, codeSourceHistoryKey).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var samples []codeSourceSample
	if err := json.Unmarshal(raw, &samples); err != nil || len(samples) != 2 || samples[1].RuleVersion != langKeyScannerRuleVersion {
		t.Fatal(string(raw), err)
	}
	// Establish a 100-key baseline using this scanner's actual persisted writer.
	if _, _, err := recordCodeSourceCount(db, 100, timeNowUTC()); err != nil {
		t.Fatal(err)
	}
	if suspicious, maximum, err := recordCodeSourceCount(db, 80, timeNowUTC()); err != nil || !suspicious || maximum != 100 {
		t.Fatal(suspicious, maximum, err)
	}
}

func TestLangKeyCodeLiteralPostgresExpiry(t *testing.T) {
	db := scanTrustPostgresFixture(t)
	frontPageExec(t, db, `INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,last_seen) VALUES
 (1,'code_literal','expired_literal.js',CURRENT_DATE-8),
 (1,'code_literal','boundary_literal.js',CURRENT_DATE-7),
 (1,'code_literal','recent_literal.js',CURRENT_DATE-6),
 (1,'unknown_evidence','persistent',CURRENT_DATE-8);`)
	markSourceScanFailed()
	if cleanupStaleLangKeySources() != 0 {
		t.Fatal("partial scan cleaned evidence")
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_type='code_literal'`) != 3 {
		t.Fatal("partial scan lost literals")
	}
	markSourceScanDone()
	cleanupStaleLangKeySources()
	if frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_type='code_literal'`) != 2 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_high='expired_literal.js'`) != 0 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_key_sources WHERE source_type='unknown_evidence'`) != 1 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_lang_keys`) != 3 {
		t.Fatal("expiry boundary, unknown evidence or key preservation failed")
	}
}
