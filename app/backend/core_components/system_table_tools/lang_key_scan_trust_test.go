// lang_key_scan_trust_test.go
// Exercises partial scans and the code-source sanity floor without PostgreSQL.
// Connects real population and maintenance entry points to queued SQL failures.
// Prevents incomplete evidence from authorizing marking, cleanup or freshness.
package system_table_tools

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

func scanTrustFixture(t *testing.T) {
	t.Helper()
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	root := t.TempDir()
	app := filepath.Join(root, "app")
	createLangKeySourceRoot(t, app, true)
	writeLangKeyReference(t, filepath.Join(app, "frontend", "view.js"), "scan_trust_key")
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, app))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	db := newSystemTableToolsTestDB(t)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old; db.Close() })
	lastSourceScanMu.Lock()
	previous, success := lastSourceScan, lastSuccessfulSourceScan
	state, failures := lastSourceScanState, lastSourceScanFailures
	lastSourceScanMu.Unlock()
	t.Cleanup(func() {
		lastSourceScanMu.Lock()
		lastSourceScan, lastSuccessfulSourceScan = previous, success
		lastSourceScanState, lastSourceScanFailures = state, failures
		lastSourceScanMu.Unlock()
	})
	markSourceScanDone()
}

func emptySourceScanQueries() []orphanQueuedQuery {
	return []orphanQueuedQuery{
		{cols: []string{"id", "lang_key"}, rows: [][]driver.Value{{int64(1), "scan_trust_key"}}},
		{cols: []string{"column_name", "table_name"}},
		{cols: []string{"table_name"}},
		{cols: []string{"name"}},
		{cols: []string{"name"}},
		{cols: []string{"folder_name"}},
		{cols: []string{"schema", "table", "column"}},
		{cols: []string{"column_name", "table_name"}},
	}
}

func assertScanTrustBlocked(t *testing.T, before *time.Time) {
	t.Helper()
	after, stale := sourceScanStatus()
	if !stale || SourceScanIsFresh() || after == nil || !after.Equal(*before) {
		t.Fatalf("unsafe freshness: before=%v after=%v stale=%v", before, after, stale)
	}
	calls := len(snapshotOrphanCalls())
	if cleanupStaleLangKeySources() != 0 {
		t.Fatal("unsafe cleanup")
	}
	if a, b := MarkOrphanLangKeys(); a != 0 || b != 0 {
		t.Fatal("unsafe marking")
	}
	if len(snapshotOrphanCalls()) != calls {
		t.Fatal("blocked maintenance reached SQL")
	}
	for _, call := range snapshotOrphanCalls() {
		if strings.Contains(strings.ToUpper(call), "DELETE FROM") {
			t.Fatalf("partial scan deleted rows: %s", call)
		}
	}
}

func TestPopulateLangKeySourcesRejectsPartialScans(t *testing.T) {
	for i, stage := range []string{"registry", "schema_columns", "schema_tables", "views", "groups", "folders", "foreign_keys", "column_values"} {
		t.Run(stage, func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			queries := emptySourceScanQueries()
			queries[i].err = errors.New("injected " + stage + " failure")
			for _, q := range queries {
				pushOrphanQuery(q)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			_, err := PopulateLangKeySources()
			if err == nil || !strings.Contains(err.Error(), stage) {
				t.Fatalf("missing %s failure: %v", stage, err)
			}
			state, failures := sourceScanOutcome()
			if state != "partial" || len(failures) != 1 || failures[0] != stage {
				t.Fatal(state, failures)
			}
			assertScanTrustBlocked(t, before)
		})
	}
}

func queueCodeSourceHistory(samples []codeSourceSample) {
	q := orphanQueuedQuery{cols: []string{"json_value"}}
	if samples != nil {
		raw, _ := json.Marshal(samples)
		q.rows = [][]driver.Value{{string(raw)}}
	}
	pushOrphanQuery(q)
	pushOrphanExec(orphanQueuedExec{})                // Lock.
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1}) // Save history.
}

func TestPopulateLangKeySourcesFloorAndNormalScan(t *testing.T) {
	for _, suspicious := range []bool{true, false} {
		t.Run(fmt.Sprint(suspicious), func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			for _, q := range emptySourceScanQueries() {
				pushOrphanQuery(q)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			var samples []codeSourceSample
			if suspicious {
				samples = []codeSourceSample{{At: timeNowUTC().Add(-time.Hour), Count: 2}}
			}
			queueCodeSourceHistory(samples)
			if !suspicious {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			count, err := PopulateLangKeySources()
			if err != nil || count != 1 {
				t.Fatalf("count=%d err=%v", count, err)
			}
			state, failures := sourceScanOutcome()
			if len(failures) != 0 {
				t.Fatal(failures)
			}
			if suspicious {
				if state != "suspicious" {
					t.Fatal(state)
				}
				assertScanTrustBlocked(t, before)
			} else {
				if state != "complete" || !SourceScanIsFresh() {
					t.Fatal(state)
				}
				after, stale := sourceScanStatus()
				if stale || !after.After(*before) {
					t.Fatal("normal scan did not advance freshness")
				}
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "key", "en", "type", "live"}, rows: [][]driver.Value{{int64(2), "orphan_key", "Copy", "ui", false}}})
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				if marked, unmarked := MarkOrphanLangKeys(); marked != 1 || unmarked != 1 {
					t.Fatalf("normal marking=%d/%d", marked, unmarked)
				}
			}
		})
	}
}

func TestCodeSourceFloorBoundaryAndSevenDayHistory(t *testing.T) {
	now := timeNowUTC()
	for _, test := range []struct {
		name  string
		count int
		age   time.Duration
		want  bool
	}{
		{"below", 89, time.Hour, true}, {"exactly90", 90, time.Hour, false},
		{"above", 91, time.Hour, false}, {"almost7days", 89, 7*24*time.Hour - time.Nanosecond, true},
		{"exactly7days", 89, 7 * 24 * time.Hour, false}, {"expired", 89, 8 * 24 * time.Hour, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			scanTrustFixture(t)
			queueCodeSourceHistory([]codeSourceSample{{At: now.Add(-test.age), Count: 100}})
			got, _, err := recordCodeSourceCount(backend.Db, test.count, now)
			if err != nil || got != test.want {
				t.Fatalf("suspicious=%v err=%v", got, err)
			}
		})
	}
	samples, maximum, err := retainCodeSourcePeaks([]codeSourceSample{{At: now.Add(-2 * time.Hour), Count: 100}, {At: now.Add(-time.Hour), Count: 80}}, 90, now)
	if err != nil || maximum != 100 || len(samples) != 2 || samples[1].Count != 90 {
		t.Fatal(samples, maximum, err)
	}
	samples, maximum, err = retainCodeSourcePeaks(samples, 101, now.Add(time.Minute))
	if err != nil || maximum != 101 || len(samples) != 1 {
		t.Fatal(samples, maximum, err)
	}
}

func TestPartialSourceScanRowFailures(t *testing.T) {
	for i, stage := range []string{"registry", "schema_columns", "schema_tables", "views", "groups", "folders", "foreign_keys", "column_values"} {
		for _, conversion := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/conversion=%v", stage, conversion), func(t *testing.T) {
				scanTrustFixture(t)
				before, _ := sourceScanStatus()
				queries := emptySourceScanQueries()
				if conversion {
					queries[i].rows = [][]driver.Value{{nil}}
				} else {
					queries[i].rowErr = errors.New("late iteration failure")
				}
				for _, q := range queries {
					pushOrphanQuery(q)
				}
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				if _, err := PopulateLangKeySources(); err == nil {
					t.Fatal("row error swallowed")
				}
				assertScanTrustBlocked(t, before)
			})
		}
	}
}

func TestPartialSourceScanWritesAndValueReads(t *testing.T) {
	for _, stage := range []string{"code", "schema", "views", "groups", "folders", "foreign_keys", "column_values"} {
		for _, failure := range []string{"write", "explanation", "query", "iteration", "conversion"} {
			if (failure == "explanation" && stage != "schema" && stage != "folders" && stage != "foreign_keys" && stage != "column_values") ||
				((failure == "query" || failure == "iteration" || failure == "conversion") && stage != "foreign_keys" && stage != "column_values") {
				continue
			}
			t.Run(stage+"/"+failure, func(t *testing.T) {
				scanTrustFixture(t)
				before, _ := sourceScanStatus()
				qs := emptySourceScanQueries()
				switch stage {
				case "schema":
					qs[1].rows = [][]driver.Value{{"scan_trust_key", "app_rows"}}
				case "views":
					qs[3].rows = [][]driver.Value{{"scan_trust_key"}}
				case "groups":
					qs[4].rows = [][]driver.Value{{"scan_trust_key"}}
				case "folders":
					qs[5].rows = [][]driver.Value{{"scan_trust_key"}}
				case "foreign_keys":
					qs[6].rows = [][]driver.Value{{"public", "app_rows", "title"}}
					qs = append(qs[:7], append([]orphanQueuedQuery{{cols: []string{"id"}, rows: [][]driver.Value{{int64(1)}}}}, qs[7:]...)...)
				case "column_values":
					qs[7].rows = [][]driver.Value{{"title", "app_rows"}}
					qs = append(qs, orphanQueuedQuery{cols: []string{"value"}, rows: [][]driver.Value{{"scan_trust_key"}}})
				}
				at := 7
				if stage == "column_values" {
					at = 8
				}
				switch failure {
				case "query":
					qs[at].err = errors.New("injected value query failure")
				case "iteration":
					qs[at].rowErr = errors.New("injected value iteration failure")
				case "conversion":
					qs[at].rows = [][]driver.Value{{nil}}
				}
				for _, q := range qs {
					pushOrphanQuery(q)
				}
				if stage != "code" {
					pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				}
				if failure == "explanation" {
					pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				}
				pushOrphanExec(orphanQueuedExec{err: errors.New("injected source write failure")})
				if _, err := PopulateLangKeySources(); err == nil {
					t.Fatal("sub-scan failure swallowed")
				}
				assertScanTrustBlocked(t, before)
			})
		}
	}
}

func TestScanTrustReportRemainsReadOnly(t *testing.T) {
	for _, state := range []string{"partial", "suspicious"} {
		t.Run(state, func(t *testing.T) {
			_, dbState := pauseTestDB(t)
			markSourceScanDone()
			recordSourceScanOutcome(state, []string{"schema"})
			w := httptest.NewRecorder()
			CheckDatabaseConsistencyHandler(w, httptest.NewRequest("GET", "/api/check-db-consistency", nil))
			var report ConsistencyCheckResult
			if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
				t.Fatal(err)
			}
			cat := report.Categories[7]
			if cat.SourceScanState != state || !cat.SourceScanStale || cat.SourceScanAt == nil {
				t.Fatal(cat)
			}
			if state == "partial" && (len(cat.SourceScanFailures) != 1 || cat.SourceScanFailures[0] != "schema") {
				t.Fatal(cat)
			}
			for _, q := range dbState.calls {
				if !strings.HasPrefix(strings.TrimSpace(q), "SELECT") {
					t.Fatal(q)
				}
			}
		})
	}
}

func TestSourceScanHistoryFailuresRemainPartial(t *testing.T) {
	for _, failure := range []string{"lock", "read", "invalid", "write"} {
		t.Run(failure, func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			for _, q := range emptySourceScanQueries() {
				pushOrphanQuery(q)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			q := orphanQueuedQuery{cols: []string{"json_value"}}
			if failure == "read" {
				q.err = errors.New("history read failed")
			}
			if failure == "invalid" {
				q.rows = [][]driver.Value{{"broken JSON"}}
			}
			pushOrphanQuery(q)
			if failure == "lock" {
				pushOrphanExec(orphanQueuedExec{err: errors.New("history lock failed")})
			} else {
				pushOrphanExec(orphanQueuedExec{})
				pushOrphanExec(orphanQueuedExec{err: errors.New("history write failed")})
			}
			if _, err := PopulateLangKeySources(); err == nil {
				t.Fatal("history failure swallowed")
			}
			state, failures := sourceScanOutcome()
			if state != "partial" || len(failures) != 1 || failures[0] != "history" {
				t.Fatal(state, failures)
			}
			assertScanTrustBlocked(t, before)
		})
	}
}

func TestSuspiciousScanUsesDistinctCurrentCodeKeysAndLogsBothSkips(t *testing.T) {
	scanTrustFixture(t)
	paths := currentLangKeyRuntimePaths()
	writeLangKeyReference(t, filepath.Join(paths.ApplicationRoot, "frontend", "other.js"), "scan_trust_key")
	before, _ := sourceScanStatus()
	for _, q := range emptySourceScanQueries() {
		pushOrphanQuery(q)
	}
	for i := 0; i < 2; i++ {
		pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	}
	queueCodeSourceHistory([]codeSourceSample{{At: timeNowUTC().Add(-6 * 24 * time.Hour), Count: 10}, {At: timeNowUTC().Add(-time.Hour), Count: 1}})
	old := log.Writer()
	var output bytes.Buffer
	log.SetOutput(&output)
	defer log.SetOutput(old)
	if count, err := PopulateLangKeySources(); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	assertScanTrustBlocked(t, before)
	for _, text := range []string{"suspicious", "1 code keys", "maximum 10", "orphan marking and stale source cleanup skipped", "[MarkOrphanLangKeys] skipped", "[cleanupStaleLangKeySources] skipped"} {
		if !strings.Contains(output.String(), text) {
			t.Fatalf("missing log %q in %s", text, output.String())
		}
	}
}

func TestPopulateLangKeySourcesCompleteEvidence(t *testing.T) {
	scanTrustFixture(t)
	qs := emptySourceScanQueries()
	qs[1].rows = [][]driver.Value{{"scan_trust_key", "app_rows"}}
	qs[2].rows = [][]driver.Value{{"scan_trust_key"}}
	for i := 3; i <= 5; i++ {
		qs[i].rows = [][]driver.Value{{"scan_trust_key"}}
	}
	qs[6].rows = [][]driver.Value{{"public", "app_rows", "title"}}
	qs[7].rows = [][]driver.Value{{"title", "app_rows"}}
	qs = append(qs[:7], append([]orphanQueuedQuery{{cols: []string{"id"}, rows: [][]driver.Value{{int64(1)}}}}, qs[7:]...)...)
	qs = append(qs, orphanQueuedQuery{cols: []string{"value"}, rows: [][]driver.Value{{"scan_trust_key"}}})
	for _, q := range qs {
		pushOrphanQuery(q)
	}
	for i := 0; i < 13; i++ {
		pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	}
	queueCodeSourceHistory(nil)
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	count, err := PopulateLangKeySources()
	if err != nil || count != 8 || !SourceScanIsFresh() {
		t.Fatal(count, err)
	}
	orphanQueueMu.Lock()
	defer orphanQueueMu.Unlock()
	if len(orphanExecQueue) != 0 || len(orphanQueryQueue) != 0 {
		t.Fatal("normal evidence readers/writers omitted", len(orphanExecQueue), len(orphanQueryQueue))
	}
}

func TestCodeSourceFloorEmptyAndFractionalCounts(t *testing.T) {
	for _, tc := range []struct {
		count, maximum int
		want           bool
	}{{0, 0, false}, {0, 1, true}, {94, 105, true}, {95, 105, false}} {
		t.Run(fmt.Sprintf("%d/%d", tc.count, tc.maximum), func(t *testing.T) {
			scanTrustFixture(t)
			now := timeNowUTC()
			var samples []codeSourceSample
			if tc.maximum > 0 {
				samples = []codeSourceSample{{At: now.Add(-time.Hour), Count: tc.maximum}}
			}
			queueCodeSourceHistory(samples)
			got, _, err := recordCodeSourceCount(backend.Db, tc.count, now)
			if err != nil || got != tc.want {
				t.Fatal(got, err)
			}
		})
	}
}
