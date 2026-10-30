// lang_key_source_vacuum_test.go
// Checks maintenance thresholds and warning-only failures on the public scan path.
// Connects queued scan writes and trust outcomes to the post-lock VACUUM step.
// Keeps failure and skip regressions executable without PostgreSQL.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"errors"
	"log"
	"strings"
	"testing"
)

func sourceVacuumTestConfig(t *testing.T, threshold int64) *bytes.Buffer {
	t.Helper()
	previousThreshold, previousRun := langKeySourceVacuumThreshold, runLangKeySourceVacuum
	previousLog := log.Writer()
	t.Cleanup(func() {
		langKeySourceVacuumThreshold, runLangKeySourceVacuum = previousThreshold, previousRun
		log.SetOutput(previousLog)
	})
	langKeySourceVacuumThreshold = threshold
	output := new(bytes.Buffer)
	log.SetOutput(output)
	return output
}

func TestLangKeySourceVacuumPublicScanOutcomes(t *testing.T) {
	for _, scenario := range []string{"ok", "below_threshold", "failed", "partial", "suspicious"} {
		t.Run(scenario, func(t *testing.T) {
			scanTrustFixture(t)
			output := sourceVacuumTestConfig(t, 1)
			if scenario == "below_threshold" {
				langKeySourceVacuumThreshold = 2
			}
			queries := emptySourceScanQueries()
			if scenario == "partial" {
				queries[1].err = errors.New("forced schema read failure")
			}
			for _, query := range queries {
				pushOrphanQuery(query)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			if scenario != "partial" {
				var history []codeSourceSample
				if scenario == "suspicious" {
					history = []codeSourceSample{{RuleVersion: langKeyScannerRuleVersion, At: timeNowUTC(), Count: 100}}
				}
				queueCodeSourceHistory(history)
				if scenario != "suspicious" {
					pushOrphanExec(orphanQueuedExec{}) // Existing stale-source cleanup.
				}
			}
			calls := 0
			runLangKeySourceVacuum = func(db *sql.DB) error {
				calls++
				if db.Stats().InUse != 0 {
					t.Error("VACUUM reached before the scan-lock connection was released")
				}
				if scenario == "failed" {
					return errors.New("forced VACUUM failure")
				}
				return nil
			}
			count, err := PopulateLangKeySources()
			if count != 1 || (err != nil) != (scenario == "partial") {
				t.Fatal(count, err)
			}
			wantState, wantVacuum, wantCalls := "complete", "skipped", 0
			switch scenario {
			case "ok", "failed":
				wantVacuum, wantCalls = scenario, 1
			case "partial", "suspicious":
				wantState = scenario
			}
			state, failures := sourceScanOutcome()
			if state != wantState || calls != wantCalls || SourceScanIsFresh() != (wantState == "complete") ||
				(wantState == "complete" && len(failures) != 0) {
				t.Fatal(state, failures, calls)
			}
			logs := output.String()
			if !strings.Contains(logs, "vacuum="+wantVacuum+" vacuum_milliseconds=") ||
				strings.Contains(logs, "scan_trust_key") || strings.Contains(logs, "view.js") ||
				strings.Contains(logs, "WARNING [PopulateLangKeySources] source VACUUM failed") != (scenario == "failed") {
				t.Fatal(logs)
			}
		})
	}
}
