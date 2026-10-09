// migration_evidence_saver_test.go
// Checks byte identity and truthful ledger writes without a PostgreSQL server.
// Connects the runner's legacy transition to its transaction/error boundaries.
// Complements disposable PostgreSQL tests with deterministic driver failures.
package migrations

import (
	"crypto/sha256"
	"database/sql/driver"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationEvidenceRecognizesSelfManagedHeaders(t *testing.T) {
	for _, content := range []string{"begin; SELECT 1; commit;", "-- header\n START TRANSACTION; SELECT 1; COMMIT;", "/* header /* nested */ */\nBegin;", "START /* comment */ TRANSACTION;"} {
		if !startsWithSelfManagedBegin(content) {
			t.Fatalf("self-managed transaction was hidden by its header: %s", content)
		}
	}
	for _, content := range []string{"DO $$ BEGIN SELECT 1; END $$;", "-- header", "/* incomplete", "BEGINNING", "SELECT 1;"} {
		if startsWithSelfManagedBegin(content) {
			t.Fatalf("ordinary SQL was classified as self-managed: %s", content)
		}
	}
}

func TestMigrationEvidenceHashesExactExecutedBytes(t *testing.T) {
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	dir := t.TempDir()
	content := "-- bytes include CRLF and UTF-8: ä\r\nSELECT 1;\r\n"
	writeMigrationFile(t, dir, "001_bytes.sql", content)
	db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true})
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.txExecCalls[0].query != content {
		t.Fatal("executed bytes were transformed")
	}
	insert := state.txExecCalls[1]
	wantHash := fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
	if len(insert.args) != 3 || insert.args[1].Value != wantHash || insert.args[2].Value != outcomeApplied {
		t.Fatalf("ledger arguments = %v", insert.args)
	}
	if !strings.Contains(insert.query, "'runner'") || state.commitCount != 1 {
		t.Fatal("execution evidence did not share the migration transaction")
	}
}

func TestMigrationEvidenceDefersOnlyThisRunsObservedBytes(t *testing.T) {
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_historical.sql", "SELECT 'changed since execution';")
	writeMigrationFile(t, dir, "002_success.sql", "SELECT 2;")
	writeMigrationFile(t, dir, "003_optional.sql", "-- skip-on-error\nSELECT broken;")
	writeMigrationFile(t, dir, "004_extension.sql", "ALTER TABLE system_schema_migrations ADD COLUMN IF NOT EXISTS content_sha256 text;")
	db, state := openMigrationMockDB(t, migrationMockConfig{
		existing:  map[string]bool{"001_historical.sql": true},
		execRules: []migrationExecRule{{contains: "SELECT broken;", inTx: true, err: fmt.Errorf("forced")}},
	})
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	updates := map[string]string{}
	for _, call := range state.txExecCalls {
		if strings.Contains(call.query, "UPDATE system_schema_migrations") {
			updates[fmt.Sprint(call.args[0].Value)] = fmt.Sprint(call.args[2].Value)
		}
	}
	if len(updates) != 2 || updates["002_success.sql"] != outcomeApplied || updates["003_optional.sql"] != outcomeOptionalFailureSkipped {
		t.Fatalf("deferred outcomes = %v", updates)
	}
	if _, found := state.outcomes["001_historical.sql"]; found {
		t.Fatal("historical row was given evidence")
	}
}

func TestMigrationEvidenceOptionalTrackingFailureStopsRun(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_optional.sql", "-- skip-on-error\nSELECT broken;")
	db, _ := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true,
		execRules: []migrationExecRule{
			{contains: "SELECT broken;", inTx: true, err: fmt.Errorf("forced")},
			{contains: "INSERT INTO system_schema_migrations", inTx: false, err: fmt.Errorf("ledger unavailable")},
		},
	})
	if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "tracking insert failed") {
		t.Fatalf("error = %v; lost optional evidence must fail", err)
	}
}

func TestMigrationEvidenceSelfManagedOutcomes(t *testing.T) {
	for _, optional := range []bool{false, true} {
		t.Run(fmt.Sprint(optional), func(t *testing.T) {
			dir := t.TempDir()
			content := "BEGIN; SELECT broken; COMMIT;"
			if optional {
				content = "-- skip-on-error\n" + content
			}
			writeMigrationFile(t, dir, "001_self.sql", content)
			writeMigrationFile(t, dir, "002_after.sql", "SELECT 2;")
			db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true,
				execRules: []migrationExecRule{{contains: "SELECT broken;", err: fmt.Errorf("forced")}},
			})
			err := RunMigrations(db, dir)
			if (err == nil) != optional {
				t.Fatalf("optional=%v error=%v", optional, err)
			}
			want := outcomeFailedSelfManaged
			if optional {
				want = outcomeOptionalFailureSkipped
			}
			if state.outcomes["001_self.sql"] != want {
				t.Fatal("self-managed outcome is inaccurate")
			}
			if state.existing["002_after.sql"] != optional {
				t.Fatal("self-managed failure did not stop this run, or optional failure stopped it")
			}
			if !optional {
				if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "README.md#reconcile-a-self-managed-migration") || !strings.Contains(err.Error(), "001_self.sql") {
					t.Fatalf("repeat error = %v", err)
				}
			}
		})
	}
}

func TestMigrationEvidenceSelfManagedOpenTransactionIsUnresolved(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_self.sql", "BEGIN; SELECT 1;")
	db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true})
	if err := RunMigrations(db, dir); err == nil {
		t.Fatal("an open self-managed transaction was accepted")
	}
	if state.outcomes["001_self.sql"] != outcomeFailedSelfManaged {
		t.Fatal("observed open transaction was not recorded as failed after rollback")
	}
}

func TestMigrationEvidenceLegacySelfManagedFailureRetriesCorrectedFile(t *testing.T) {
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	dir := t.TempDir()
	filename := "001_self.sql"
	broken := "BEGIN; SELECT broken; COMMIT;"
	writeMigrationFile(t, dir, filename, broken)
	db, state := openMigrationMockDB(t, migrationMockConfig{
		execRules: []migrationExecRule{{contains: "SELECT broken;", err: fmt.Errorf("forced failure")}},
	})
	for attempt := 0; attempt < 2; attempt++ {
		if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "forced failure") {
			t.Fatalf("legacy failed attempt = %v", err)
		}
		if state.existing[filename] {
			t.Fatal("failed legacy self-managed migration acquired a filename row")
		}
	}
	corrected := "BEGIN; SELECT 1; COMMIT;"
	writeMigrationFile(t, dir, filename, corrected)
	writeMigrationFile(t, dir, "002_extension.sql", "ALTER TABLE system_schema_migrations ADD COLUMN IF NOT EXISTS content_sha256 text;")
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
	if !state.existing[filename] || state.outcomes[filename] != outcomeApplied {
		t.Fatal("corrected legacy file did not persist its evidence with the later extension")
	}
	wantHash := fmt.Sprintf("%x", sha256.Sum256([]byte(corrected)))
	for _, call := range state.txExecCalls {
		if strings.Contains(call.query, "UPDATE system_schema_migrations") && call.args[0].Value == filename {
			if call.args[1].Value != wantHash {
				t.Fatal("retry persisted the failed source hash instead of the corrected bytes")
			}
			return
		}
	}
	t.Fatal("corrected file evidence was not deferred into the extension transaction")
}

func TestMigrationEvidenceLegacySelfManagedAcceptance(t *testing.T) {
	for _, optional := range []bool{false, true} {
		for _, extend := range []bool{false, true} {
			t.Run(fmt.Sprintf("optional=%v/extension=%v", optional, extend), func(t *testing.T) {
				t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
				dir := t.TempDir()
				content, wantOutcome := "BEGIN; SELECT 1; COMMIT;", outcomeApplied
				if optional {
					content, wantOutcome = "-- skip-on-error\nBEGIN; SELECT broken; COMMIT;", outcomeOptionalFailureSkipped
				}
				writeMigrationFile(t, dir, "001_self.sql", content)
				if extend {
					writeMigrationFile(t, dir, "002_extension.sql", "ALTER TABLE system_schema_migrations ADD COLUMN IF NOT EXISTS content_sha256 text;")
				}
				db, state := openMigrationMockDB(t, migrationMockConfig{
					execRules: []migrationExecRule{{contains: "SELECT broken;", err: fmt.Errorf("optional failure")}},
				})
				if err := RunMigrations(db, dir); err != nil {
					t.Fatal(err)
				}
				if !state.existing["001_self.sql"] {
					t.Fatal("accepted legacy migration was not recorded")
				}
				calls := state.directExecCalls
				insertIndex := -1
				for i, call := range calls {
					if strings.Contains(call.query, "INSERT INTO system_schema_migrations") {
						insertIndex = i
						if len(call.args) != 1 {
							t.Fatal("legacy row was not bare")
						}
					}
				}
				if insertIndex <= 1 || calls[1].query != content {
					t.Fatal("legacy ledger row preceded SQL execution")
				}
				if extend && state.outcomes["001_self.sql"] != wantOutcome {
					t.Fatal("accepted legacy attempt lost its evidence at the later extension")
				}
				if !extend && state.outcomes["001_self.sql"] != "" {
					t.Fatal("legacy row acquired unsupported evidence")
				}
			})
		}
	}
}

func TestMigrationEvidenceUnconfirmedCleanupKeepsInterruptedMarker(t *testing.T) {
	for _, failure := range []string{"ROLLBACK", "SAVEPOINT", "UPDATE system_schema_migrations"} {
		t.Run(failure, func(t *testing.T) {
			dir := t.TempDir()
			writeMigrationFile(t, dir, "001_self.sql", "BEGIN; SELECT broken; COMMIT;")
			db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true,
				execRules: []migrationExecRule{
					{contains: "SELECT broken;", err: fmt.Errorf("observed error")},
					{contains: failure, err: fmt.Errorf("cannot confirm completion")},
				},
			})
			if err := RunMigrations(db, dir); err == nil {
				t.Fatal("failed cleanup or failed evidence update was accepted")
			}
			if state.outcomes["001_self.sql"] != outcomeInterruptedSelfManaged {
				t.Fatal("unknown durable completion became a known failure")
			}
			if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "reconcile_self_managed_migration.sql") {
				t.Fatalf("interrupted repeat lacks recovery procedure: %v", err)
			}
		})
	}
}

// unresolvedMigrationSources puts pending work before a marker's filename and
// varies its visibility without changing the ledger; PostgreSQL uses it too.
func unresolvedMigrationSources(t *testing.T, scenario, filename string) []string {
	t.Helper()
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	public, private := t.TempDir(), t.TempDir()
	writeMigrationFile(t, public, "001_pending.sql", "INSERT INTO execution_trace VALUES (1);")
	writeMigrationFile(t, public, filename, "BEGIN; INSERT INTO execution_trace VALUES (2); COMMIT;")
	source := filepath.Join(public, filename)
	var err error
	switch scenario {
	case "absent":
		err = os.Remove(source)
	case "renamed":
		err = os.Rename(source, filepath.Join(public, "003_renamed.sql"))
	case "allowlist":
		t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "001_pending.sql")
	case "private source removed":
		err = os.Rename(source, filepath.Join(private, filename))
	case "visible later":
	default:
		t.Fatalf("unknown unresolved migration scenario: %s", scenario)
	}
	if err != nil {
		t.Fatal(err)
	}
	return []string{public} // The private directory still exists but is no longer configured.
}

func assertUnresolvedMigrationRefusal(t *testing.T, err error, filename, outcome string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("migration %s has %s execution", filename, outcome)) ||
		!strings.Contains(err.Error(), "operator reconciliation required: "+selfManagedReconciliationProcedure) {
		t.Fatalf("missing unresolved filename, outcome or reconciliation procedure: %v", err)
	}
}

func TestMigrationEvidenceUnresolvedPreflight(t *testing.T) {
	for _, outcome := range []string{outcomeFailedSelfManaged, outcomeInterruptedSelfManaged} {
		for _, scenario := range []string{"absent", "renamed", "allowlist", "private source removed", "visible later"} {
			t.Run(outcome+"/"+scenario, func(t *testing.T) {
				filename := "002_unresolved.sql"
				directories := unresolvedMigrationSources(t, scenario, filename)
				db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true})
				state.existing[filename], state.outcomes[filename] = true, outcome
				assertUnresolvedMigrationRefusal(t, RunMigrationsFromDirectories(db, directories), filename, outcome)
				if len(state.txExecCalls) != 0 || len(state.directExecCalls) != 1 ||
					!strings.Contains(state.directExecCalls[0].query, "CREATE TABLE IF NOT EXISTS system_schema_migrations") ||
					len(state.existsChecks) != 0 || state.existing["001_pending.sql"] || len(state.existing) != 1 || state.unresolvedChecks != 1 {
					t.Fatal("refusal followed migration SQL, a ledger change or filename selection")
				}
			})
		}
	}
}

func TestMigrationEvidenceUnresolvedPreflightNamesEveryMarker(t *testing.T) {
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	dir := t.TempDir() // No marker file is present, and the directory has no pending files.
	db, state := openMigrationMockDB(t, migrationMockConfig{evidenceAvailable: true})
	state.existing["002_failed.sql"], state.outcomes["002_failed.sql"] = true, outcomeFailedSelfManaged
	state.existing["003_interrupted.sql"], state.outcomes["003_interrupted.sql"] = true, outcomeInterruptedSelfManaged
	state.existing["001_applied.sql"], state.outcomes["001_applied.sql"] = true, outcomeApplied
	err := RunMigrations(db, dir)
	assertUnresolvedMigrationRefusal(t, err, "002_failed.sql", outcomeFailedSelfManaged)
	assertUnresolvedMigrationRefusal(t, err, "003_interrupted.sql", outcomeInterruptedSelfManaged)
	if strings.Contains(err.Error(), "001_applied.sql") || strings.Index(err.Error(), "002_failed.sql") > strings.Index(err.Error(), "003_interrupted.sql") {
		t.Fatal("refusal included a resolved row or lost deterministic filename order")
	}
}

func TestMigrationEvidenceUnresolvedPreflightReadErrorsStopRun(t *testing.T) {
	for name, cfg := range map[string]migrationMockConfig{
		"query":     {unresolvedQueryErr: fmt.Errorf("ledger unavailable")},
		"scan":      {unresolvedRows: [][]driver.Value{{nil, outcomeFailedSelfManaged}}},
		"iteration": {unresolvedRows: [][]driver.Value{{"002_failed.sql", outcomeFailedSelfManaged}}, unresolvedRowsErr: fmt.Errorf("ledger interrupted")},
	} {
		t.Run(name, func(t *testing.T) {
			cfg.evidenceAvailable = true
			dir := t.TempDir()
			writeMigrationFile(t, dir, "001_pending.sql", "SELECT 1;")
			db, state := openMigrationMockDB(t, cfg)
			if err := RunMigrations(db, dir); err == nil || !strings.Contains(err.Error(), "read unresolved self-managed migrations") {
				t.Fatalf("ledger read failure did not refuse: %v", err)
			}
			if len(state.txExecCalls) != 0 || len(state.directExecCalls) != 1 || len(state.existsChecks) != 0 || len(state.existing) != 0 {
				t.Fatal("migration executed before the ledger could be fully read")
			}
		})
	}
}

func TestMigrationEvidenceUnresolvedPreflightPreservesLegacyAndExtensionOrdering(t *testing.T) {
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_success.sql", "SELECT 1;")
	writeMigrationFile(t, dir, "002_extension.sql", "ALTER TABLE system_schema_migrations ADD COLUMN IF NOT EXISTS content_sha256 text;")
	writeMigrationFile(t, dir, "003_success.sql", "SELECT 3;")
	db, state := openMigrationMockDB(t, migrationMockConfig{})
	if err := RunMigrations(db, dir); err != nil {
		t.Fatal(err)
	}
	if state.unresolvedChecks != 0 || strings.Join(state.existsChecks, ",") != "001_success.sql,002_extension.sql,003_success.sql" {
		t.Fatal("legacy execution or mid-run extension added an unresolved preflight")
	}
	if err := RunMigrations(db, dir); err != nil || state.unresolvedChecks != 1 {
		t.Fatalf("next evidence-aware run did not preflight once: %v", err)
	}
}
