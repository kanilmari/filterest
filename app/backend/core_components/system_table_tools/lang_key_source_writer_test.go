// lang_key_source_writer_test.go
// Checks snapshot decisions, bounded buffering and failure reporting without PostgreSQL.
// Connects the scan writer to the existing queued SQL fixture and stage trust gate.
// Keeps fast regression coverage available when disposable PostgreSQL is blocked.
package system_table_tools

import (
	"bytes"
	"database/sql/driver"
	"errors"
	"fmt"
	"log"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"github.com/lib/pq"
)

// Legacy scanner proofs use one-row chunks to retain their per-save fault sites.
func immediateSourceWriter() *langKeySourceWriter {
	return &langKeySourceWriter{
		db: backend.Db, today: 20261030, chunkRows: 1,
		index:   make(map[langKeySourceIdentity]langKeySourceState),
		pending: make(map[langKeySourceIdentity]string), explanations: make(map[langKeySourceIdentity]string),
	}
}

func sourceChunkTextArgument(t *testing.T, value driver.Value) []string {
	t.Helper()
	var values pq.StringArray
	if err := values.Scan(value); err != nil {
		t.Fatal(err)
	}
	return values
}

// UI trust proofs save a single generation marker outside full population.
func upsertSource(id int64, sourceType, high, low string) error {
	w, err := newLangKeySourceWriter(langKeySourceChunkRows)
	if err != nil {
		return err
	}
	if err := w.upsertSource(id, sourceType, high, low); err != nil {
		return err
	}
	return w.flush()
}

func TestLangKeySourceWriterSkipsOnlyUnchangedCurrentRows(t *testing.T) {
	w := immediateSourceWriter()
	w.chunkRows = langKeySourceChunkRows
	key := langKeySourceIdentity{1, "column", "app_rows"}
	w.index[key] = langKeySourceState{low: "same", lastSeen: w.today, explanationEmpty: true}
	for _, low := range []string{"same", "changed", "last"} {
		if err := w.upsertSource(key.id, key.sourceType, key.high, low); err != nil {
			t.Fatal(err)
		}
	}
	if w.stats.seen != 3 || len(w.pending) != 1 || w.pending[key] != "last" || w.index[key].low != "last" {
		t.Fatal(w.stats, w.pending, w.index)
	}
	for _, state := range []langKeySourceState{
		{low: "last", lastSeen: w.today - 1}, {low: "last", lastSeen: w.today, lowNull: true}, {low: "last"},
	} {
		clear(w.pending)
		w.index[key] = state
		if err := w.upsertSource(key.id, key.sourceType, key.high, "last"); err != nil || len(w.pending) != 1 {
			t.Fatal("old/NULL row skipped", state, err)
		}
	}
	clear(w.pending)
	if err := w.upsertSource(2, "table", "new", "new"); err != nil || len(w.pending) != 1 {
		t.Fatal("missing row skipped", err)
	}
	if err := w.upsertSource(0, "table", "new", "new"); err == nil {
		t.Fatal("missing identity accepted")
	}
}

func TestLangKeySourceIndexUsesDatabaseCalendarAndPropagatesFailures(t *testing.T) {
	for _, failure := range []string{"", "query", "conversion", "iteration", "missing_date"} {
		t.Run(failure, func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			// A remote database calendar, deliberately unrelated to the Go clock.
			date := time.Date(2001, 2, 3, 0, 0, 0, 0, time.FixedZone("database", 13*60*60))
			q := orphanQueuedQuery{
				cols: []string{"today", "id", "type", "high", "low", "last_seen", "empty"},
				rows: [][]driver.Value{{date, int64(7), "code", "file.go", "", date, true}},
			}
			switch failure {
			case "query":
				q.err = errors.New("source snapshot read failed")
			case "conversion":
				q.rows[0][1] = "invalid id"
			case "iteration":
				q.rowErr = errors.New("source snapshot iteration failed")
			case "missing_date":
				q.rows = nil
			}
			orphanSourceIndex = &q
			if failure == "" {
				w, err := newLangKeySourceWriter(2)
				if err != nil || w.today != 20010203 {
					t.Fatal(w, err)
				}
				if err := w.upsertSource(7, "code", "file.go", ""); err != nil || len(w.pending) != 0 {
					t.Fatal("database date did not suppress write", err)
				}
				return
			}
			pushOrphanQuery(emptySourceScanQueries()[0])
			if _, err := PopulateLangKeySources(); err == nil {
				t.Fatal("failed snapshot trusted")
			}
			state, failures := sourceScanOutcome()
			if state != "partial" || len(failures) != 1 || failures[0] != "source_index" {
				t.Fatal(state, failures)
			}
			assertScanTrustBlocked(t, before)
		})
	}
}

func TestLangKeySourceDeferredFlushFailureBlocksOwningStage(t *testing.T) {
	scanTrustFixture(t)
	before, _ := sourceScanStatus()
	for _, q := range emptySourceScanQueries() {
		pushOrphanQuery(q)
	}
	pushOrphanExec(orphanQueuedExec{err: errors.New("forced deferred chunk failure")})
	if count, err := PopulateLangKeySources(); err == nil || count != 1 {
		t.Fatal(count, err)
	}
	state, failures := sourceScanOutcome()
	if state != "partial" || len(failures) != 1 || failures[0] != "code" {
		t.Fatal(state, failures)
	}
	assertScanTrustBlocked(t, before)
}

func TestLangKeySourceExplanationFirstNonblankAndStickyFailure(t *testing.T) {
	scanTrustFixture(t)
	w := immediateSourceWriter()
	w.chunkRows = langKeySourceChunkRows
	if err := w.saveExplainedSource(1, "table", "app_rows", "app_rows", " \t"); err != nil {
		t.Fatal(err)
	}
	for _, explanation := range []string{" first ", "second"} {
		if err := w.updateSourceUsageExplanationIfEmpty(1, "table", "app_rows", explanation); err != nil {
			t.Fatal(err)
		}
	}
	key := langKeySourceIdentity{1, "table", "app_rows"}
	if w.explanations[key] != " first " || w.index[key].explanationEmpty {
		t.Fatal(w.explanations, w.index)
	}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	pushOrphanExec(orphanQueuedExec{err: errors.New("forced explanation failure")})
	err := w.finishStage("schema")
	var stage *sourceSubScanError
	if !errors.As(err, &stage) || stage.name != "schema" || w.stats.inserted != 1 || w.stats.explanations != 0 {
		t.Fatal(err, w.stats)
	}
	calls := len(snapshotOrphanCalls())
	if w.flush() == nil || w.upsertSource(1, "table", "app_rows", "new") == nil || len(snapshotOrphanCalls()) != calls {
		t.Fatal("failed writer resumed")
	}
}

func TestLangKeySourceScanLogsContentFreeWriteSummary(t *testing.T) {
	scanTrustFixture(t)
	for _, q := range emptySourceScanQueries() {
		pushOrphanQuery(q)
	}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	queueCodeSourceHistory(nil)
	pushOrphanExec(orphanQueuedExec{})
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	if count, err := PopulateLangKeySources(); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if strings.Count(output.String(), "rows_seen=") != 1 || !strings.Contains(output.String(),
		"rows_seen=1 inserted=1 updated=0 explanations_written=0 chunks=1 deadlock_retries=0 milliseconds=") || strings.Contains(output.String(), "scan_trust_key") {
		t.Fatal(output.String())
	}
}

func TestLangKeySourceChunksUseSortedIdentityOrder(t *testing.T) {
	want := []langKeySourceIdentity{{1, "column", "a"}, {1, "column", "z"}, {1, "table", "a"}, {2, "code", "a"}}
	chunk := map[langKeySourceIdentity]string{}
	for i, key := range want {
		chunk[key] = fmt.Sprint(i)
	}
	for range 20 {
		ids, types, highs, values := sourceChunkArrays(chunk)
		var got []langKeySourceIdentity
		for i, id := range ids {
			key := langKeySourceIdentity{id, types[i], highs[i]}
			got = append(got, key)
			if values[i] != chunk[key] {
				t.Fatal("sorted chunk detached a value from its identity")
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatal("chunk identities are not sorted", got)
		}
	}
}

func TestLangKeySourceReadsFlushEarlierColumnSaves(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			scanTrustFixture(t)
			backend.Db.SetMaxOpenConns(1)
			w := immediateSourceWriter()
			w.chunkRows = langKeySourceChunkRows
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"column", "table"}, rows: [][]driver.Value{
				{"label", "app_values"}, {"source_low", "system_lang_key_sources"},
			}})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"value"}, rows: [][]driver.Value{{"scan_trust_key"}}})
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"value"}, rows: [][]driver.Value{{"scan_trust_key"}}})
			if fail {
				pushOrphanExec(orphanQueuedExec{err: errors.New("pre-read flush failed")})
			} else {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			count, err := w.scanHasLangKeyColumns(map[string]int64{"scan_trust_key": 1})
			calls := snapshotOrphanCalls()
			saved, read := -1, -1
			for i, call := range calls {
				if strings.Contains(call, "INSERT INTO system_lang_key_sources") {
					saved = i
				}
				if strings.HasPrefix(call, `SELECT DISTINCT "source_low"`) {
					read = i
				}
			}
			if fail {
				if err == nil || w.err == nil || count != 1 || saved < 0 || read >= 0 {
					t.Fatal("failed pre-read flush did not block the dependent read", count, err, calls)
				}
				return
			}
			key := langKeySourceIdentity{1, "column_value", "system_lang_key_sources.source_low"}
			if err != nil || count != 2 || saved < 0 || read <= saved || w.pending[key] != "scan_trust_key" {
				t.Fatal("dependent column read preceded its source save", count, err, calls)
			}
		})
	}
}

func TestLangKeySourceWriterRefreshesCalendarBetweenChunks(t *testing.T) {
	scanTrustFixture(t)
	w := immediateSourceWriter()
	w.chunkRows = 2
	key := langKeySourceIdentity{3, "column", "unchanged"}
	w.index[key] = langKeySourceState{low: "same", lastSeen: w.today}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 2})
	for _, id := range []int64{1, 2} {
		if err := w.upsertSource(id, "column", "first chunk", "value"); err != nil {
			t.Fatal(err)
		}
	}
	orphanSourceDate = &orphanQueuedQuery{cols: []string{"today"}, rows: [][]driver.Value{{time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)}}}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	if err := w.upsertSource(4, "column", "second chunk", "value"); err != nil {
		t.Fatal(err)
	}
	requireSourceFlush(t, w)
	if err := w.upsertSource(key.id, key.sourceType, key.high, "same"); err != nil || w.pending[key] != "same" {
		t.Fatal("unchanged row skipped after midnight", err, w.today, w.pending)
	}
	pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	requireSourceFlush(t, w)
	if w.today != 20261031 || w.index[key].lastSeen != 20261031 || w.stats.chunks != 3 {
		t.Fatal("later unchanged row kept yesterday's calendar date", w.today, w.index[key], w.stats)
	}
	// Empty flushes must refresh the calendar too, even if every save was skipped.
	orphanSourceDate.rows[0][0] = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	requireSourceFlush(t, w)
	if w.today != 20261101 || w.stats.chunks != 3 {
		t.Fatal("empty flush did not refresh the calendar", w.today, w.stats)
	}
}

func TestLangKeySourceFlushCalendarFailureBlocksScan(t *testing.T) {
	scanTrustFixture(t)
	before, _ := sourceScanStatus()
	pushOrphanQuery(emptySourceScanQueries()[0])
	orphanSourceDate = &orphanQueuedQuery{err: errors.New("database calendar unavailable")}
	if _, err := PopulateLangKeySources(); err == nil || !strings.Contains(err.Error(), "read source flush date") {
		t.Fatal("date failure accepted", err)
	}
	state, failures := sourceScanOutcome()
	if state != "partial" || !reflect.DeepEqual(failures, []string{"code"}) {
		t.Fatal(state, failures)
	}
	assertScanTrustBlocked(t, before)
}

func TestLangKeySourceDeadlockRetriesPreserveScanTrust(t *testing.T) {
	for _, test := range []struct {
		name     string
		failures int
		code     pq.ErrorCode
		retries  int
		success  bool
	}{
		{"one deadlock", 1, "40P01", 1, true},
		{"three deadlocks", 3, "40P01", 3, true},
		{"exhausted", 4, "40P01", 3, false},
		{"other error", 1, "23505", 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			scanTrustFixture(t)
			before, _ := sourceScanStatus()
			for _, q := range emptySourceScanQueries() {
				pushOrphanQuery(q)
			}
			for range test.failures {
				pushOrphanExec(orphanQueuedExec{err: fmt.Errorf("statement failed: %w", &pq.Error{Code: test.code})})
			}
			if test.success {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
				queueCodeSourceHistory(nil)
				pushOrphanExec(orphanQueuedExec{})
			}
			var output bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&output)
			t.Cleanup(func() { log.SetOutput(previous) })
			count, err := PopulateLangKeySources()
			if (err == nil) != test.success || count != 1 {
				t.Fatal(count, err)
			}
			state, failures := sourceScanOutcome()
			if test.success {
				if state != "complete" || len(failures) != 0 || !SourceScanIsFresh() {
					t.Fatal(state, failures)
				}
			} else {
				var pgErr *pq.Error
				if !errors.As(err, &pgErr) || pgErr.Code != test.code || state != "partial" || !reflect.DeepEqual(failures, []string{"code"}) {
					t.Fatal(err, state, failures)
				}
				assertScanTrustBlocked(t, before)
			}
			attempts := 0
			for _, call := range snapshotOrphanCalls() {
				if strings.Contains(call, "WITH saved AS (") {
					attempts++
				}
			}
			if attempts != test.retries+1 || !strings.Contains(output.String(), fmt.Sprintf("deadlock_retries=%d", test.retries)) {
				t.Fatal("incorrect retry count or missing log", attempts, output.String())
			}
		})
	}
}

func TestLangKeySourceExplanationChunksRetryDeadlocks(t *testing.T) {
	for _, exhaust := range []bool{false, true} {
		t.Run(fmt.Sprint(exhaust), func(t *testing.T) {
			scanTrustFixture(t)
			w := immediateSourceWriter()
			w.chunkRows = langKeySourceChunkRows
			if err := w.saveExplainedSource(1, "table", "example", "example", "first"); err != nil {
				t.Fatal(err)
			}
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			retries := 1
			if exhaust {
				retries = langKeySourceDeadlockRetries
			}
			for range retries {
				pushOrphanExec(orphanQueuedExec{err: &pq.Error{Code: "40P01"}})
			}
			if exhaust {
				pushOrphanExec(orphanQueuedExec{err: &pq.Error{Code: "40P01"}})
			} else {
				pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			}
			err := w.finishStage("folders")
			if (err != nil) != exhaust || w.stats.inserted != 1 || w.stats.deadlockRetries != int64(retries) {
				t.Fatal(err, w.stats)
			}
			if exhaust {
				var stage *sourceSubScanError
				if !errors.As(err, &stage) || stage.name != "folders" || w.stats.explanations != 0 || w.flush() == nil {
					t.Fatal("exhausted explanation chunk lost its failure", err, w.stats)
				}
			} else if w.stats.explanations != 1 || w.stats.chunks != 2 {
				t.Fatal("explanation retry counted failed writes", w.stats)
			}
		})
	}
}
