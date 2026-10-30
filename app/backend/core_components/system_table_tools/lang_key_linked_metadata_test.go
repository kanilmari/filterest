// lang_key_linked_metadata_test.go
// Proves linked-label metadata failures block population trust and maintenance.
// Uses the existing queued SQL driver through the real scanner and runtime readers.
// Distinguishes legitimate missing display columns from incomplete metadata reads.
package system_table_tools

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func linkedLabelMetadataQueries() []orphanQueuedQuery {
	return []orphanQueuedQuery{
		{cols: []string{"table_uid"}, rows: [][]driver.Value{{"tasks-uid"}}},
		{cols: []string{"source_table", "source_column", "target_table", "target_column", "cached", "name"}},
		{cols: []string{"referencing_column", "referenced_table", "referenced_column"}, rows: [][]driver.Value{{"reviewer_225_id", "app_people", "id"}}},
		{cols: []string{"fk_display_column"}, rows: [][]driver.Value{{"missing_override"}}},
		{cols: []string{"exists"}, rows: [][]driver.Value{{false}}},
		{cols: []string{"column_name"}, rows: [][]driver.Value{{"name"}}},
		{cols: []string{"column_name", "actor_role"}},
	}
}

func queueLinkedLabelPopulation(t *testing.T, metadata []orphanQueuedQuery, codeCount, previousCount int) {
	t.Helper()
	root := currentLangKeyRuntimePaths().ApplicationRoot
	declaration := `package example
// lang-key-declaration: {"schema":"linked_name","build":"return alias + \" (ln)\""}
func linkedLabel(alias string) string { return alias + " (ln)" }
`
	if err := os.WriteFile(filepath.Join(root, "backend", "linked.go"), []byte(declaration), 0600); err != nil {
		t.Fatal(err)
	}
	var source strings.Builder
	source.WriteString("const COPY = {\n")
	registry := orphanQueuedQuery{cols: []string{"id", "lang_key"}}
	for i := 1; i <= codeCount; i++ {
		key := fmt.Sprintf("linked_fixture_%d", i)
		fmt.Fprintf(&source, "%s: {fi: \"\", en: \"\"},\n", key)
		registry.rows = append(registry.rows, []driver.Value{int64(i), key})
		pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	}
	source.WriteString("};\n")
	if err := os.WriteFile(filepath.Join(root, "frontend", "view.js"), []byte(source.String()), 0600); err != nil {
		t.Fatal(err)
	}
	registry.rows = append(registry.rows, []driver.Value{int64(codeCount + 1), "reviewer_225_name (ln)"})
	pushOrphanQuery(registry)
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"column_name", "table_name"}, rows: [][]driver.Value{{"reviewer_225_id", "tasks"}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_name"}})
	for _, q := range metadata {
		pushOrphanQuery(q)
	}
	// All later stages succeed, including history above the unchanged 90% floor.
	for _, q := range emptySourceScanQueries()[3:] {
		pushOrphanQuery(q)
	}
	queueCodeSourceHistory([]codeSourceSample{{RuleVersion: langKeyScannerRuleVersion, At: timeNowUTC().Add(-time.Hour), Count: previousCount}})
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // Cleanup, only for a complete scan.
}

func assertLinkedLabelScanPartial(t *testing.T, before *time.Time, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("incomplete linked-label metadata accepted")
	}
	state, failed := sourceScanOutcome()
	if state != "partial" || len(failed) != 1 || failed[0] != "schema_linked_labels" {
		t.Fatalf("state=%s failed=%v err=%v", state, failed, err)
	}
	assertScanTrustBlocked(t, before)
	for _, call := range snapshotOrphanCalls() {
		if strings.Contains(call, "pg_advisory_xact_lock") && strings.Contains(call, "lang_key_source_scan_history") {
			t.Fatal("partial scan reached history/freshness stage")
		}
	}
}

func TestPopulateLinkedLabelDisplayReadFailureAboveFloor(t *testing.T) {
	scanTrustFixture(t)
	before, _ := sourceScanStatus()
	metadata := linkedLabelMetadataQueries()
	metadata[5].err = errors.New("injected display-column read failure")
	queueLinkedLabelPopulation(t, metadata, 999, 1000)
	count, err := populateLangKeySources(1)
	if count != 999 || err == nil || !strings.Contains(err.Error(), "injected display-column read failure") {
		t.Fatalf("count=%d err=%v", count, err)
	}
	assertLinkedLabelScanPartial(t, before, err)
}

func TestPopulateLinkedLabelMetadataFailuresStayPartial(t *testing.T) {
	for at, stage := range []string{"table identity", "relations", "foreign keys", "configured override", "override column exists", "text columns", "actor columns"} {
		for _, failure := range []string{"query", "scan", "iteration"} {
			t.Run(stage+"/"+failure, func(t *testing.T) {
				scanTrustFixture(t)
				before, _ := sourceScanStatus()
				metadata := linkedLabelMetadataQueries()
				message := "injected " + stage + " " + failure
				switch failure {
				case "query":
					metadata[at].err = errors.New(message)
				case "scan":
					metadata[at].rows = [][]driver.Value{make([]driver.Value, len(metadata[at].cols))}
					column := metadata[at].cols[0]
					if at == 6 {
						column = "actor_role" // The actor column itself permits NULL.
					}
					message = fmt.Sprintf("name %q", column)
				case "iteration":
					metadata[at].rowErr = errors.New(message)
					// QueryRow must encounter the error while obtaining its one row.
					if at == 0 || at == 3 || at == 4 {
						metadata[at].rows = nil
					}
				}
				queueLinkedLabelPopulation(t, metadata, 1, 1)
				_, err := populateLangKeySources(1)
				if err == nil || !strings.Contains(err.Error(), message) {
					t.Fatalf("metadata failure lost: want %q, got %v", message, err)
				}
				assertLinkedLabelScanPartial(t, before, err)
			})
		}
	}
}

func TestPopulateLinkedLabelNoTextColumnIsComplete(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(fmt.Sprint(configured), func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			metadata := linkedLabelMetadataQueries()
			metadata[5].rows = nil // No text/varchar column; no legacy exception.
			if !configured {
				metadata[3].rows = nil // sql.ErrNoRows is a legitimate missing override.
				metadata = append(metadata[:4], metadata[5:]...)
			}
			queueLinkedLabelPopulation(t, metadata, 1, 1)
			count, err := populateLangKeySources(1)
			state, failed := sourceScanOutcome()
			after, stale := sourceScanStatus()
			if err != nil || count != 1 || state != "complete" || len(failed) != 0 || stale || !SourceScanIsFresh() || !after.After(*before) {
				t.Fatalf("count=%d state=%s failed=%v stale=%v err=%v", count, state, failed, stale, err)
			}
			orphanQueueMu.Lock()
			defer orphanQueueMu.Unlock()
			if len(orphanQueryQueue) != 0 || len(orphanExecQueue) != 0 {
				t.Fatal("complete scan omitted a stage or emitted an alias", len(orphanQueryQueue), len(orphanExecQueue))
			}
		})
	}
}

func TestLinkedLabelRuntimeMetadataFallbackUnchanged(t *testing.T) {
	for _, failure := range []string{"override query", "exists query", "text query", "text scan", "text iteration", "no text column"} {
		t.Run(failure, func(t *testing.T) {
			scanTrustFixture(t)
			metadata := linkedLabelMetadataQueries()[2:6]
			want := ""
			switch failure {
			case "override query":
				metadata[1].err = errors.New("runtime override read failure")
				metadata = append(metadata[:2], metadata[3:]...)
				want = "name" // Optional override errors retain the heuristic fallback.
			case "exists query":
				metadata[2].err = errors.New("runtime column-exists failure")
				want = "name"
			case "text query":
				metadata[3].err = errors.New("runtime display-column read failure")
			case "text scan":
				metadata[3].rows = [][]driver.Value{{nil}}
			case "text iteration":
				metadata[3].rowErr = errors.New("runtime display-column iteration failure")
			case "no text column":
				metadata[3].rows = nil
			}
			for _, q := range metadata {
				pushOrphanQuery(q)
			}
			foreignKeys, err := dtt_utils.GetForeignKeysForTable("tasks")
			if err != nil || len(foreignKeys) != 1 || foreignKeys["reviewer_225_id"].NameColumn != want {
				t.Fatalf("runtime fallback changed: foreignKeys=%v err=%v", foreignKeys, err)
			}
		})
	}
}
