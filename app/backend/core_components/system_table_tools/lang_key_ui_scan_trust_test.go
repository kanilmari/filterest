// lang_key_ui_scan_trust_test.go
// Tests committed attempt ordering and cleanup/result failures without a database.
// Keeps lifecycle SQL separate from existing B2 evidence queues.
// A blocked attempt logs one error and never publishes completed trust.
package system_table_tools

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestUILiteralAttemptFirstWriteAndMarkerPersistence(t *testing.T) {
	scanTrustFixture(t)
	path := filepath.Join(currentLangKeyRuntimePaths().ApplicationRoot, "frontend", "view.js")
	if err := os.WriteFile(path, []byte(`getTranslationForKey('scan_trust_key'); const COPY={scan_trust_key:{en:""}};`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, q := range emptySourceScanQueries() {
		pushOrphanQuery(q)
	}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 2}) // Merged code and code_literal share a chunk.
	queueCodeSourceHistory(nil)
	pushOrphanExec(orphanQueuedExec{}) // Cleanup.
	if _, err := PopulateLangKeySources(); err != nil {
		t.Fatal(err)
	}
	firstWrite := -1
	beginAt := -1
	cleanupAt := -1
	completeAt := -1
	generation := ""
	markers := 0
	for i, query := range snapshotOrphanCalls() {
		if strings.HasPrefix(strings.TrimSpace(query), "INSERT") || strings.HasPrefix(strings.TrimSpace(query), "UPDATE") || strings.HasPrefix(strings.TrimSpace(query), "DELETE") || strings.Contains(query, "WITH saved AS (") {
			if firstWrite < 0 {
				firstWrite = i
			}
		}
		args := orphanCallArguments[i]
		if strings.Contains(query, "INSERT INTO public.system_config") && strings.Contains(query, "'lang_key_ui_scan'") {
			beginAt = i
			generation = args[0].(string)
		}
		if strings.Contains(query, "INSERT INTO system_lang_key_sources") {
			types, lows := sourceChunkTextArgument(t, args[1]), sourceChunkTextArgument(t, args[3])
			for row, sourceType := range types {
				if sourceType == "code" {
					markers++
					if lows[row] != uiLiteralScanner+":"+generation {
						t.Fatal("marker lost", args)
					}
				}
			}
		}
		if strings.Contains(query, "DELETE FROM system_lang_key_sources") {
			cleanupAt = i
		}
		if strings.Contains(query, "UPDATE public.system_config") && strings.Contains(query, "'lang_key_ui_scan'") && args[1] == "complete" {
			completeAt = i
		}
	}
	if firstWrite != beginAt || beginAt < 0 || markers != 1 || completeAt <= cleanupAt || cleanupAt <= beginAt {
		t.Fatal(firstWrite, beginAt, markers, cleanupAt, completeAt)
	}
}

func TestUILiteralCleanupErrorsFailTrustAndLogOnce(t *testing.T) {
	for _, resultError := range []bool{false, true} {
		t.Run(map[bool]string{false: "execution", true: "result"}[resultError], func(t *testing.T) {
			scanTrustFixture(t)
			for _, q := range emptySourceScanQueries() {
				pushOrphanQuery(q)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			queueCodeSourceHistory(nil)
			failure := orphanQueuedExec{err: errors.New("cleanup execution failed")}
			if resultError {
				failure = orphanQueuedExec{resultErr: errors.New("cleanup result failed")}
			}
			pushOrphanExec(failure)
			var output bytes.Buffer
			old := log.Writer()
			log.SetOutput(&output)
			defer log.SetOutput(old)
			if _, err := PopulateLangKeySources(); err == nil || !strings.Contains(err.Error(), "cleanup") {
				t.Fatal(err)
			}
			if SourceScanIsFresh() {
				t.Fatal("cleanup failure trusted")
			}
			failed := 0
			for i, query := range snapshotOrphanCalls() {
				if strings.Contains(query, "UPDATE public.system_config") && strings.Contains(query, "'lang_key_ui_scan'") {
					if orphanCallArguments[i][1] != "failed" {
						t.Fatal("published completion after cleanup failure")
					}
					failed++
				}
			}
			if failed != 1 || strings.Count(output.String(), "ERROR [PopulateLangKeySources]") != 1 {
				t.Fatal(failed, output.String())
			}
		})
	}
}

func TestUILiteralCompletionCASDroppedAndFailureErrors(t *testing.T) {
	for _, tc := range []struct {
		complete bool
		rows     int64
		err      error
	}{{true, 0, nil}, {false, 0, nil}, {true, 0, errors.New("trust write failed")}} {
		scanTrustFixture(t)
		orphanUIExecQueue = []orphanQueuedExec{{rowsAffected: tc.rows, err: tc.err}}
		updated, err := (uiLiteralScanAttempt{generation: "1", fingerprint: "old-code"}).finish(backend.Db, tc.complete)
		if updated || (err != nil) != (tc.err != nil) {
			t.Fatal(updated, err)
		}
		call := snapshotOrphanCalls()[0]
		if !strings.Contains(call, "WHERE key='lang_key_ui_scan' AND json_value #>> '{attempt,generation}'=$1::text") {
			t.Fatal("missing generation CAS", call)
		}
	}
}
