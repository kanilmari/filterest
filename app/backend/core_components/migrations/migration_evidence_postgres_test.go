// migration_evidence_postgres_test.go
// Verifies migration evidence against opt-in disposable PostgreSQL clusters.
// Connects real transaction commits, legacy upgrades and fresh public bootstrap.
// Never reads installation credentials or connects to an existing database.
package migrations

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const evidenceMigrationName = "20261009000020_add_migration_execution_evidence.sql"
const evidenceVersionOwner = "20261009000099_record_database_release_9_10_2.sql"
const evidenceLegacySchema = `CREATE TABLE system_schema_migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE system_data_repair_records(migration text, action text);
CREATE TABLE system_db_version(version text, description text);
INSERT INTO system_db_version VALUES ('9.10.1', 'synthetic older installation');
CREATE TABLE execution_trace(id integer PRIMARY KEY);`

func migrationEvidenceDisposableDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
	}
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root, err := os.MkdirTemp("", "wl157-pg-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		_, _ = exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"),
		"-o", "-h '' -k '"+socket+"' -p 15497", "-w", "start")
	dsn := fmt.Sprintf("host=%s port=15497 user=test_owner dbname=postgres sslmode=disable connect_timeout=5", socket)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, dsn
}

func evidenceSQL(t *testing.T, db *sql.DB, sqlText string) {
	t.Helper()
	if _, err := db.Exec(sqlText); err != nil {
		t.Fatal(err)
	}
}

func evidenceSource(t *testing.T, subdirectory, filename string) []byte {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", subdirectory, filename))
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func copyEvidenceExtension(t *testing.T, dir string) {
	t.Helper()
	writeMigrationFile(t, dir, evidenceMigrationName, string(evidenceSource(t, "migrations", evidenceMigrationName)))
}

func assertMigrationEvidence(t *testing.T, db *sql.DB, filename, content, outcome, provenance string) {
	t.Helper()
	var hash, gotOutcome, gotProvenance sql.NullString
	if err := db.QueryRow(`SELECT content_sha256, outcome, provenance FROM system_schema_migrations WHERE filename=$1`, filename).
		Scan(&hash, &gotOutcome, &gotProvenance); err != nil {
		t.Fatal(err)
	}
	if outcome == "" {
		if hash.Valid || gotOutcome.Valid || gotProvenance.Valid {
			t.Fatalf("historical migration %s acquired evidence it never executed", filename)
		}
		return
	}
	wantHash := fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
	if hash.String != wantHash || gotOutcome.String != outcome || gotProvenance.String != provenance {
		t.Fatalf("%s evidence = %v/%v/%v, want %s/%s/%s", filename, hash, gotOutcome, gotProvenance, wantHash, outcome, provenance)
	}
}

func TestMigrationEvidenceUpgradePostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	evidenceSQL(t, db, evidenceLegacySchema)
	evidenceSQL(t, db, `INSERT INTO system_schema_migrations(filename) VALUES ('001_historical.sql'), ('002_historical_optional.sql')`)
	public, private := t.TempDir(), t.TempDir()
	files := map[string]string{
		"001_historical.sql":          "SELECT 'today cannot prove history';",
		"002_historical_optional.sql": "-- skip-on-error\nSELECT 'today cannot prove success';",
		"20261009000003_success.sql":  "-- exact UTF-8 ä\r\nINSERT INTO execution_trace VALUES (1);\r\n",
		"20261009000004_optional.sql": "-- skip-on-error\nINSERT INTO execution_trace VALUES (2); SELECT nonexistent;",
		"20261009000005_self.sql":     "BEGIN; INSERT INTO execution_trace VALUES (3); COMMIT;",
		"20261009000030_after.sql":    "INSERT INTO execution_trace VALUES (5);",
	}
	for name, content := range files {
		writeMigrationFile(t, public, name, content)
	}
	privateName, privateContent := "20261009000006_private.sql", "INSERT INTO execution_trace VALUES (4);"
	writeMigrationFile(t, private, privateName, privateContent)
	copyEvidenceExtension(t, public)
	writeMigrationFile(t, public, evidenceVersionOwner, string(evidenceSource(t, "migrations", evidenceVersionOwner)))
	// A release row may only appear after all earlier migrations; the extension
	// is not promoted to the front of the globally merged public/private order.
	evidenceSQL(t, db, `CREATE FUNCTION check_release_order() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN IF NEW.version='9.10.2' AND (SELECT count(*) FROM execution_trace) <> 4
		THEN RAISE EXCEPTION 'version owner ran too early'; END IF; RETURN NEW; END $$;
		CREATE TRIGGER release_order BEFORE INSERT ON system_db_version FOR EACH ROW EXECUTE FUNCTION check_release_order()`)
	for run := 0; run < 2; run++ {
		if err := RunMigrationsFromDirectories(db, []string{private, public}); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range files {
		outcome := outcomeApplied
		if strings.Contains(name, "historical") {
			outcome = ""
		} else if strings.Contains(name, "optional") {
			outcome = outcomeOptionalFailureSkipped
		}
		assertMigrationEvidence(t, db, name, content, outcome, "runner")
	}
	assertMigrationEvidence(t, db, privateName, privateContent, outcomeApplied, "runner")
	assertMigrationEvidence(t, db, evidenceMigrationName, string(evidenceSource(t, "migrations", evidenceMigrationName)), outcomeApplied, "runner")
	assertMigrationEvidence(t, db, evidenceVersionOwner, string(evidenceSource(t, "migrations", evidenceVersionOwner)), outcomeApplied, "runner")
	// Changing today's files never overwrites the already recorded execution hash.
	writeMigrationFile(t, public, "20261009000003_success.sql", "SELECT 'edited later';")
	if err := RunMigrationsFromDirectories(db, []string{public, private}); err != nil {
		t.Fatal(err)
	}
	assertMigrationEvidence(t, db, "20261009000003_success.sql", files["20261009000003_success.sql"], outcomeApplied, "runner")
}

func TestMigrationEvidenceAtomicityPostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	evidenceSQL(t, db, evidenceLegacySchema)
	evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
	evidenceSQL(t, db, `ALTER TABLE system_schema_migrations ADD CONSTRAINT forced_tracking_failure CHECK (filename <> '001_blocked.sql')`)
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_blocked.sql", "INSERT INTO execution_trace VALUES (1);")
	if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "tracking insert failed") {
		t.Fatalf("expected atomic tracking failure, got %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT (SELECT count(*) FROM execution_trace) + (SELECT count(*) FROM system_schema_migrations)`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed ledger insertion committed effects: count=%d error=%v", count, err)
	}
}

func TestMigrationEvidenceExtensionRollbackPostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	evidenceSQL(t, db, evidenceLegacySchema)
	evidenceSQL(t, db, `ALTER TABLE system_schema_migrations ADD CONSTRAINT reject_extension
		CHECK (filename <> '20261009000020_add_migration_execution_evidence.sql')`)
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_before.sql", "INSERT INTO execution_trace VALUES (1);")
	copyEvidenceExtension(t, dir)
	if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "tracking insert failed") {
		t.Fatalf("extension's ledger write should fail: %v", err)
	}
	available, err := migrationEvidenceAvailable(db)
	if err != nil || available {
		t.Fatalf("failed extension committed its DDL: available=%v error=%v", available, err)
	}
	// On a new invocation earlier SQL is historical. Even a same-process retry
	// cannot infer hashes that never crossed the extension's commit boundary.
	evidenceSQL(t, db, `ALTER TABLE system_schema_migrations DROP CONSTRAINT reject_extension`)
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
	assertMigrationEvidence(t, db, "001_before.sql", "", "", "")
	assertMigrationEvidence(t, db, evidenceMigrationName, string(evidenceSource(t, "migrations", evidenceMigrationName)), outcomeApplied, "runner")
}

func TestMigrationEvidenceOptionalAndSelfManagedPostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	db.SetMaxOpenConns(1) // An aborted self-managed transaction must never poison this connection.
	evidenceSQL(t, db, evidenceLegacySchema)
	evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
	dir := t.TempDir()
	files := map[string]string{
		"001_success.sql":       "INSERT INTO execution_trace VALUES (1);",
		"002_optional.sql":      "-- skip-on-error\nINSERT INTO execution_trace VALUES (2); SELECT nonexistent;",
		"003_self.sql":          "BEGIN; INSERT INTO execution_trace VALUES (3); COMMIT;",
		"004_self_optional.sql": "-- skip-on-error\nBEGIN; INSERT INTO execution_trace VALUES (4); COMMIT; BEGIN; SELECT nonexistent; COMMIT;",
		"005_after.sql":         "INSERT INTO execution_trace VALUES (5);",
	}
	for name, content := range files {
		writeMigrationFile(t, dir, name, content)
	}
	for run := 0; run < 2; run++ {
		if err := RunMigrations(db, dir); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range files {
		outcome := outcomeApplied
		if strings.Contains(name, "optional") {
			outcome = outcomeOptionalFailureSkipped
		}
		assertMigrationEvidence(t, db, name, content, outcome, "runner")
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM execution_trace WHERE id IN (1,3,4,5)`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("self-managed partial commit or following migration lost: %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM execution_trace WHERE id=2`).Scan(&count); err != nil || count != 0 {
		t.Fatal("ordinary optional failure retained rolled-back writes")
	}
	for _, content := range []string{"BEGIN; INSERT INTO execution_trace VALUES (6); SELECT nonexistent; COMMIT;", "BEGIN; INSERT INTO execution_trace VALUES (6);"} {
		t.Run(content, func(t *testing.T) {
			dir := t.TempDir()
			writeMigrationFile(t, dir, "006_unresolved.sql", content)
			evidenceSQL(t, db, `DELETE FROM system_schema_migrations WHERE filename='006_unresolved.sql'`)
			if err := RunMigrations(db, dir); err == nil {
				t.Fatal("unresolved execution was accepted")
			}
			assertMigrationEvidence(t, db, "006_unresolved.sql", content, outcomeFailedSelfManaged, "runner")
			if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "reconciliation required") {
				t.Fatalf("unresolved repeat was skipped or retried: %v", err)
			}
			if err := db.QueryRow(`SELECT count(*) FROM execution_trace WHERE id=6`).Scan(&count); err != nil || count != 0 {
				t.Fatal("aborted/open transaction survived cleanup")
			}
		})
	}
}

// TestMigrationEvidenceInterruptionWorker is a subprocess entrypoint used only
// with the connection string of the parent's newly created disposable cluster.
func TestMigrationEvidenceInterruptionWorker(t *testing.T) {
	dir := os.Getenv("WL157_TEST_MIGRATION_DIRECTORY")
	if dir == "" {
		t.Skip("subprocess entrypoint")
	}
	db, err := sql.Open("postgres", os.Getenv("WL157_TEST_CLUSTER_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
}

func TestMigrationEvidenceInterruptionPostgres(t *testing.T) {
	for _, extended := range []bool{false, true} {
		t.Run(fmt.Sprint(extended), func(t *testing.T) {
			db, dsn := migrationEvidenceDisposableDB(t)
			evidenceSQL(t, db, evidenceLegacySchema)
			if extended {
				evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
			}
			dir := t.TempDir()
			writeMigrationFile(t, dir, "001_before.sql", "INSERT INTO execution_trace VALUES (1);")
			content := "BEGIN; INSERT INTO execution_trace VALUES (2); COMMIT; SELECT pg_sleep(60);"
			writeMigrationFile(t, dir, "002_interrupted.sql", content)
			copyEvidenceExtension(t, dir)
			command := exec.Command(os.Args[0], "-test.run=^TestMigrationEvidenceInterruptionWorker$", "-test.timeout=90s")
			command.Env = append(os.Environ(), "WL157_TEST_MIGRATION_DIRECTORY="+dir, "WL157_TEST_CLUSTER_DSN="+dsn)
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { command.Process.Kill(); command.Wait() }()
			deadline := time.Now().Add(10 * time.Second)
			for {
				var committed bool
				if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM execution_trace WHERE id=2)`).Scan(&committed); err != nil {
					t.Fatal(err)
				}
				if committed {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("worker did not reach a partial self-managed commit")
				}
				time.Sleep(20 * time.Millisecond)
			}
			if err := command.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			command.Wait()
			err := RunMigrations(db, dir)
			if extended {
				if err == nil || !strings.Contains(err.Error(), "reconciliation required") {
					t.Fatalf("interruption was skipped: %v", err)
				}
				assertMigrationEvidence(t, db, "002_interrupted.sql", content, outcomeInterruptedSelfManaged, "runner")
			} else {
				// The legacy contract retries incomplete execution, including partial
				// commits; the operator must correct a non-idempotent file first.
				if err == nil {
					t.Fatal("legacy interruption should retry and hit the earlier committed row")
				}
				var count int
				if err := db.QueryRow(`SELECT count(*) FROM system_schema_migrations WHERE filename='002_interrupted.sql'`).Scan(&count); err != nil || count != 0 {
					t.Fatalf("failed legacy retry acquired a row: %d %v", count, err)
				}
				corrected := "BEGIN; INSERT INTO execution_trace SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM execution_trace WHERE id=2); COMMIT;"
				writeMigrationFile(t, dir, "002_interrupted.sql", corrected)
				if err := RunMigrations(db, dir); err != nil {
					t.Fatal(err)
				}
				// A restarted process has no right to infer the lost in-memory hashes.
				assertMigrationEvidence(t, db, "001_before.sql", "", "", "")
				assertMigrationEvidence(t, db, "002_interrupted.sql", corrected, outcomeApplied, "runner")
			}
		})
	}
}

func TestMigrationEvidenceLegacySelfManagedPostgres(t *testing.T) {
	t.Run("failure retries corrected file before extension", func(t *testing.T) {
		db, _ := migrationEvidenceDisposableDB(t)
		db.SetMaxOpenConns(1)
		evidenceSQL(t, db, evidenceLegacySchema)
		dir := t.TempDir()
		name := "20261009000003_retry.sql"
		writeMigrationFile(t, dir, name, "BEGIN; INSERT INTO execution_trace VALUES (1); SELECT nonexistent; COMMIT;")
		copyEvidenceExtension(t, dir)
		for attempt := 0; attempt < 2; attempt++ {
			if err := RunMigrations(db, dir); err == nil {
				t.Fatal("legacy non-optional error was accepted")
			}
			var count int
			if err := db.QueryRow(`SELECT (SELECT count(*) FROM system_schema_migrations) + (SELECT count(*) FROM execution_trace)`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed legacy attempt left a row or effects: %d %v", count, err)
			}
			if available, err := migrationEvidenceAvailable(db); err != nil || available {
				t.Fatalf("extension ran after a failed migration: %v %v", available, err)
			}
		}
		corrected := "BEGIN; INSERT INTO execution_trace VALUES (1); COMMIT;"
		writeMigrationFile(t, dir, name, corrected)
		optionalName := "20261009000004_optional.sql"
		optional := "-- skip-on-error\nBEGIN; INSERT INTO execution_trace VALUES (2); SELECT nonexistent; COMMIT;"
		writeMigrationFile(t, dir, optionalName, optional)
		if err := RunMigrations(db, dir); err != nil {
			t.Fatal(err)
		}
		assertMigrationEvidence(t, db, name, corrected, outcomeApplied, "runner")
		assertMigrationEvidence(t, db, optionalName, optional, outcomeOptionalFailureSkipped, "runner")
		if err := RunMigrations(db, dir); err != nil {
			t.Fatal(err)
		}
	})
	for _, optional := range []bool{false, true} {
		t.Run(fmt.Sprintf("bare acceptance optional=%v", optional), func(t *testing.T) {
			db, _ := migrationEvidenceDisposableDB(t)
			evidenceSQL(t, db, evidenceLegacySchema)
			dir := t.TempDir()
			content := "BEGIN; INSERT INTO execution_trace VALUES (1); COMMIT;"
			if optional {
				content = "-- skip-on-error\nBEGIN; INSERT INTO execution_trace VALUES (1); SELECT nonexistent; COMMIT;"
			}
			writeMigrationFile(t, dir, "001_self.sql", content)
			if err := RunMigrations(db, dir); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := db.QueryRow(`SELECT count(*) FROM system_schema_migrations WHERE filename='001_self.sql'`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("accepted legacy attempt lacks bare row: %d %v", count, err)
			}
			if available, err := migrationEvidenceAvailable(db); err != nil || available {
				t.Fatalf("legacy fixture gained unexpected columns: %v %v", available, err)
			}
			// A later invocation cannot manufacture execution evidence for this row.
			copyEvidenceExtension(t, dir)
			if err := RunMigrations(db, dir); err != nil {
				t.Fatal(err)
			}
			assertMigrationEvidence(t, db, "001_self.sql", "", "", "")
		})
	}
}

func runEvidenceReconciliation(t *testing.T, dsn, filename, hash, outcome, decision string) error {
	t.Helper()
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	script := filepath.Join("..", "..", "..", "server_tools", "scripts", "reconcile_self_managed_migration.sql")
	output, err := exec.Command(filepath.Join(bin, "psql"), "-X", "--dbname="+dsn,
		"--set=filename="+filename, "--set=expected_hash="+hash, "--set=expected_outcome="+outcome,
		"--set=decision="+decision, "--file="+script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("reconciliation: %w: %s", err, output)
	}
	return nil
}

func TestMigrationEvidenceSelfManagedReconciliationPostgres(t *testing.T) {
	for _, outcome := range []string{outcomeFailedSelfManaged, outcomeInterruptedSelfManaged} {
		for _, decision := range []string{"applied", "retry"} {
			t.Run(outcome+"/"+decision, func(t *testing.T) {
				db, dsn := migrationEvidenceDisposableDB(t)
				evidenceSQL(t, db, evidenceLegacySchema)
				evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
				dir := t.TempDir()
				name := "001_self.sql"
				content := "BEGIN; INSERT INTO execution_trace VALUES (1); COMMIT; BEGIN; SELECT nonexistent; COMMIT;"
				writeMigrationFile(t, dir, name, content)
				if outcome == outcomeFailedSelfManaged {
					if err := RunMigrations(db, dir); err == nil {
						t.Fatal("non-optional partial failure was accepted")
					}
				} else {
					// A durable pre-submission marker can also survive an interruption
					// before any effects. The killed-process test proves partial commits.
					if err := insertMigrationEvidence(db, migrationEvidence{name, fmt.Sprintf("%x", sha256.Sum256([]byte(content))), outcome}, true); err != nil {
						t.Fatal(err)
					}
				}
				assertMigrationEvidence(t, db, name, content, outcome, "runner")
				corrected := "BEGIN; INSERT INTO execution_trace SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM execution_trace WHERE id=1); COMMIT;"
				writeMigrationFile(t, dir, name, corrected)
				if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), name) || !strings.Contains(err.Error(), "reconcile_self_managed_migration.sql") {
					t.Fatalf("corrected file bypassed unresolved refusal or lacks procedure: %v", err)
				}
				digest := fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
				for _, wrong := range []struct{ filename, hash, outcome, decision string }{
					{"missing.sql", digest, outcome, decision},
					{name, strings.Repeat("0", 64), outcome, decision},
					{name, digest, "applied", decision},
					{name, digest, outcome, "unknown"},
					{name, digest, map[string]string{outcomeFailedSelfManaged: outcomeInterruptedSelfManaged, outcomeInterruptedSelfManaged: outcomeFailedSelfManaged}[outcome], decision},
				} {
					if err := runEvidenceReconciliation(t, dsn, wrong.filename, wrong.hash, wrong.outcome, wrong.decision); err == nil {
						t.Fatal("unguarded reconciliation was accepted")
					}
					assertMigrationEvidence(t, db, name, content, outcome, "runner")
				}
				if decision == "applied" {
					// Operator inspection determines the intended effects are complete.
					evidenceSQL(t, db, `INSERT INTO execution_trace SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM execution_trace WHERE id=1)`)
				}
				if err := runEvidenceReconciliation(t, dsn, name, digest, outcome, decision); err != nil {
					t.Fatal(err)
				}
				if decision == "applied" {
					assertMigrationEvidence(t, db, name, "", "", "")
				} else {
					var exists bool
					if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_schema_migrations WHERE filename=$1)`, name).Scan(&exists); err != nil || exists {
						t.Fatalf("retry retained the marker: %v %v", exists, err)
					}
				}
				if err := runEvidenceReconciliation(t, dsn, name, digest, outcome, decision); err == nil {
					t.Fatal("stale operator decision was accepted twice")
				}
				if err := RunMigrations(db, dir); err != nil {
					t.Fatal(err)
				}
				if decision == "retry" {
					assertMigrationEvidence(t, db, name, corrected, outcomeApplied, "runner")
				} else {
					assertMigrationEvidence(t, db, name, "", "", "")
				}
				var count int
				if err := db.QueryRow(`SELECT count(*) FROM execution_trace WHERE id=1`).Scan(&count); err != nil || count != 1 {
					t.Fatalf("resolved migration's intended effects are missing or duplicated: %d %v", count, err)
				}
				if err := runEvidenceReconciliation(t, dsn, name, digest, outcome, decision); err == nil {
					t.Fatal("resolved history or successful retry was reconciled again")
				}
			})
		}
	}
}

func TestMigrationEvidenceFreshBootstrapPostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	evidenceSQL(t, db, string(evidenceSource(t, "public_bootstrap", "schema.sql")))
	evidenceSQL(t, db, string(evidenceSource(t, "public_bootstrap", "seed_data.sql")))
	publicDirectory := filepath.Join("..", "..", "..", "server_tools", "migrations")
	files, err := collectMigrationFiles([]string{publicDirectory})
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		assertMigrationEvidence(t, db, file.filename, string(evidenceSource(t, "migrations", file.filename)), "bootstrap_baseline", "bootstrap")
	}
	for run := 0; run < 2; run++ {
		if err := RunMigrations(db, publicDirectory); err != nil {
			t.Fatal(err)
		}
	}
	// New migrations after a fresh baseline use runner provenance.
	private := t.TempDir()
	content := "CREATE TABLE fresh_runner_effect(id integer);"
	writeMigrationFile(t, private, "20990101000001_new.sql", content)
	if err := RunMigrationsFromDirectories(db, []string{publicDirectory, private}); err != nil {
		t.Fatal(err)
	}
	assertMigrationEvidence(t, db, "20990101000001_new.sql", content, outcomeApplied, "runner")
}

func TestMigrationEvidenceUnresolvedPreflightPostgres(t *testing.T) {
	for _, outcome := range []string{outcomeFailedSelfManaged, outcomeInterruptedSelfManaged} {
		for _, scenario := range []string{"absent", "renamed", "allowlist", "private source removed", "visible later"} {
			t.Run(outcome+"/"+scenario, func(t *testing.T) {
				db, _ := migrationEvidenceDisposableDB(t)
				db.SetMaxOpenConns(1)
				evidenceSQL(t, db, evidenceLegacySchema)
				evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
				filename := "002_unresolved.sql"
				original := "BEGIN; INSERT INTO execution_trace VALUES (99); COMMIT; BEGIN; SELECT nonexistent; COMMIT;"
				// Model committed work left by the unresolved attempt. Existing tests
				// prove observed failures and killed processes produce these markers.
				evidenceSQL(t, db, `INSERT INTO execution_trace VALUES (99)`)
				if err := insertMigrationEvidence(db, migrationEvidence{filename, fmt.Sprintf("%x", sha256.Sum256([]byte(original))), outcome}, true); err != nil {
					t.Fatal(err)
				}
				var appliedAt time.Time
				if err := db.QueryRow(`SELECT applied_at FROM system_schema_migrations WHERE filename=$1`, filename).Scan(&appliedAt); err != nil {
					t.Fatal(err)
				}
				directories := unresolvedMigrationSources(t, scenario, filename)
				assertUnresolvedMigrationRefusal(t, RunMigrationsFromDirectories(db, directories), filename, outcome)
				var pendingEffects, pendingRows, totalEffects, totalRows int
				if err := db.QueryRow(`SELECT
					(SELECT count(*) FROM execution_trace WHERE id IN (1,2)),
					(SELECT count(*) FROM system_schema_migrations WHERE filename='001_pending.sql'),
					(SELECT count(*) FROM execution_trace), (SELECT count(*) FROM system_schema_migrations)`).
					Scan(&pendingEffects, &pendingRows, &totalEffects, &totalRows); err != nil {
					t.Fatal(err)
				}
				if pendingEffects != 0 || pendingRows != 0 || totalEffects != 1 || totalRows != 1 {
					t.Fatalf("migration executed before refusal or unresolved effects changed: effects=%d rows=%d totals=%d/%d", pendingEffects, pendingRows, totalEffects, totalRows)
				}
				assertMigrationEvidence(t, db, filename, original, outcome, "runner")
				var retainedAppliedAt time.Time
				if err := db.QueryRow(`SELECT applied_at FROM system_schema_migrations WHERE filename=$1`, filename).Scan(&retainedAppliedAt); err != nil || !retainedAppliedAt.Equal(appliedAt) {
					t.Fatalf("refusal changed the unresolved attempt timestamp: %v", err)
				}
			})
		}
	}
}

func TestMigrationEvidenceUnresolvedPreflightNamesEveryMarkerPostgres(t *testing.T) {
	db, _ := migrationEvidenceDisposableDB(t)
	evidenceSQL(t, db, evidenceLegacySchema)
	evidenceSQL(t, db, string(evidenceSource(t, "migrations", evidenceMigrationName)))
	for filename, outcome := range map[string]string{
		"002_failed.sql": outcomeFailedSelfManaged, "003_interrupted.sql": outcomeInterruptedSelfManaged,
		"004_failed.sql": outcomeFailedSelfManaged, "005_interrupted.sql": outcomeInterruptedSelfManaged,
		"001_applied.sql": outcomeApplied, "006_optional.sql": outcomeOptionalFailureSkipped,
	} {
		if err := insertMigrationEvidence(db, migrationEvidence{filename, strings.Repeat("a", 64), outcome}, true); err != nil {
			t.Fatal(err)
		}
	}
	evidenceSQL(t, db, `INSERT INTO system_schema_migrations(filename) VALUES ('007_historical.sql')`)
	err := RunMigrations(db, t.TempDir()) // No current migration files.
	for _, filename := range []string{"002_failed.sql", "003_interrupted.sql", "004_failed.sql", "005_interrupted.sql"} {
		outcome := outcomeFailedSelfManaged
		if strings.Contains(filename, "interrupted") {
			outcome = outcomeInterruptedSelfManaged
		}
		assertUnresolvedMigrationRefusal(t, err, filename, outcome)
	}
	for _, filename := range []string{"001_applied.sql", "006_optional.sql", "007_historical.sql"} {
		if strings.Contains(err.Error(), filename) {
			t.Fatalf("refusal included resolved/unverified history: %v", err)
		}
	}
}
