// lang_key_pause_test.go
// Proves report, scan and repair entry points cannot retire language keys.
// Connects actual handlers to a recording SQL driver and the grant-boundary fixture.
// Keeps old clients and stale reports from bypassing the archiving pause.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type langKeyPauseState struct {
	calls    []string
	deleted  int64
	execErr  error
	queryErr error
}
type langKeyPauseDriver struct{ state *langKeyPauseState }
type langKeyPauseConn struct {
	orphanQueueConn
	state *langKeyPauseState
}

func (d langKeyPauseDriver) Open(string) (driver.Conn, error) {
	return &langKeyPauseConn{state: d.state}, nil
}
func (c *langKeyPauseConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.calls = append(c.state.calls, query)
	if c.state.queryErr != nil {
		return nil, c.state.queryErr
	}
	if rows, ok := granttest.BoundaryQuery(query, args); ok {
		return rows, nil
	}
	switch {
	case query == "SELECT CURRENT_DATE":
		return &orphanQueueRows{cols: []string{"today"},
			data: [][]driver.Value{{time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)}}}, nil
	case strings.Contains(query, "FROM (SELECT 1) calendar"):
		return &orphanQueueRows{cols: []string{"today", "id", "type", "high", "low", "last_seen", "empty"},
			data: [][]driver.Value{{time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC), nil, nil, nil, nil, nil, true}}}, nil
	case strings.Contains(query, "AS has_live_usage"):
		return &orphanQueueRows{cols: []string{"id", "lang_key", "en", "type", "live", "translated"}, data: [][]driver.Value{{int64(42), "unused_pause_key", "Copy", "ui", false, true}}}, nil
	case strings.Contains(query, "AS age_days"):
		return &orphanQueueRows{cols: []string{"id", "age", "live"}, data: [][]driver.Value{{int64(42), int64(400), false}}}, nil
	case strings.Contains(query, "SELECT src.lang_key_id, src.last_seen"):
		return &orphanQueueRows{cols: []string{"id", "since"}, data: [][]driver.Value{{int64(42), "2020-01-01"}}}, nil
	case strings.Contains(query, "WHERE slk.id = $1::bigint"):
		return &orphanQueueRows{cols: []string{"live"}, data: [][]driver.Value{{true}}}, nil
	case strings.Contains(query, "ORDER BY slk.id") || strings.Contains(query, "WHERE lang_key ~ '[<>]'"):
		return &orphanQueueRows{cols: []string{"id", "key"}, data: [][]driver.Value{{int64(43), "<p>old key</p>"}}}, nil
	default:
		return &orphanQueueRows{cols: []string{"empty"}}, nil
	}
}
func (c *langKeyPauseConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.state.calls = append(c.state.calls, query)
	if strings.Contains(query, "DELETE FROM system_lang_keys ") || strings.Contains(query, "DELETE FROM system_lang_keys\n") {
		if c.state.execErr != nil {
			return nil, c.state.execErr
		}
		return driver.RowsAffected(c.state.deleted), nil
	}
	return driver.RowsAffected(1), nil
}
func pauseTestDB(t *testing.T) (*sql.DB, *langKeyPauseState) {
	t.Helper()
	state := &langKeyPauseState{}
	name := fmt.Sprintf("lang_key_pause_%d", atomic.AddInt64(&consistencyBoundaryCounter, 1))
	sql.Register(name, langKeyPauseDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	oldDB := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = oldDB; _ = db.Close() })
	root := t.TempDir()
	createLangKeySourceRoot(t, root, true)
	replaceLangKeyRuntimePathsForTest(t, langKeyRuntimePaths(root, root))
	replaceAdditionalLangKeySourceRootsForTest(t, nil)
	markSourceScanFreshForTest(t)
	return db, state
}
func assertNoLangKeyRetirement(t *testing.T, state *langKeyPauseState, wantMark bool) {
	t.Helper()
	marked := false
	for _, query := range state.calls {
		normalized := strings.Join(strings.Fields(query), " ")
		if strings.Contains(normalized, "system_lang_keys_archive") || strings.Contains(normalized, "DELETE FROM system_lang_keys ") || strings.Contains(normalized, "SELECT src.lang_key_id, src.last_seen") {
			t.Errorf("automatic language-key retirement still reachable: %s", normalized)
		}
		marked = marked || strings.Contains(query, "FROM UNNEST")
	}
	if marked != wantMark {
		t.Errorf("orphan marking = %v, want %v", marked, wantMark)
	}
}
func TestLangKeyPauseOnlyMaintenanceScanKeepsMarking(t *testing.T) {
	for _, test := range []struct {
		name    string
		method  string
		handler http.HandlerFunc
		marks   bool
	}{
		{"report GET", "GET", CheckDatabaseConsistencyHandler, false},
		{"report HEAD", "HEAD", CheckDatabaseConsistencyHandler, false},
		{"scan", "POST", ScanLangSourcesHandler, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, state := pauseTestDB(t)
			rec := httptest.NewRecorder()
			test.handler(rec, httptest.NewRequest(test.method, "/", nil))
			if rec.Code != 200 {
				t.Fatal(rec.Code, rec.Body)
			}
			assertNoLangKeyRetirement(t, state, test.marks)
		})
	}
}
func TestLangKeyPauseFixAllSkipsBothCategories(t *testing.T) {
	db, state := pauseTestDB(t)
	state.deleted = 1 // Old code actually deletes both listed keys in this fixture.
	granttest.ConfigureRoles(t)
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"fix_all":true}`))
	req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
	rec := httptest.NewRecorder()
	FixDatabaseConsistencyHandler(granttest.Recorder{ResponseRecorder: rec}, req)
	var response struct {
		Fixed  int
		Errors []string
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || rec.Code != 200 || response.Fixed != 0 || len(response.Errors) != 0 {
		t.Fatal("Fix All did not skip language keys", rec.Code, rec.Body, err)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	assertNoLangKeyRetirement(t, state, false)
}

func TestLangKeyPauseSingleFixesAndStaleIDs(t *testing.T) {
	for _, test := range []struct {
		name, id    string
		deleted     int64
		wantSkipped bool
	}{
		{"category 8", "cat8_42", 1, true},
		{"stale garbage ID", "cat7_42", 0, true},
		{"eligible garbage", "cat7_43", 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, state := pauseTestDB(t)
			state.deleted = test.deleted
			err := fixIssue(db, test.id, nil)
			if test.wantSkipped && !errors.Is(err, errConsistencyFixSkipped) || !test.wantSkipped && err != nil {
				t.Fatal(err)
			}
			if test.id == "cat8_42" {
				assertNoLangKeyRetirement(t, state, false)
				return
			}
			if len(state.calls) != 1 {
				t.Fatal("guard must be in a single DELETE", state.calls)
			}
			query := strings.Join(strings.Fields(state.calls[0]), " ")
			for _, guard := range []string{"WHERE slk.id = $1::bigint", "slk.lang_key ~ '[<>]'", "length(slk.lang_key) > 200", "AND NOT EXISTS", "live.lang_key_id = slk.id", "live.source_type NOT IN ('orphan', 'manual_crud')"} {
				if !strings.Contains(query, guard) {
					t.Errorf("missing DELETE guard %q: %s", guard, query)
				}
			}
		})
	}
}
func TestLangKeyPauseSkippedFixHandlerReportsZero(t *testing.T) {
	for _, id := range []string{"cat7_42", "cat8_42"} {
		t.Run(id, func(t *testing.T) {
			db, state := pauseTestDB(t)
			granttest.ConfigureRoles(t)
			lazy := dbutils.NewLazyTx(db)
			req := httptest.NewRequest("POST", "/", strings.NewReader(`{"fix_ids":["`+id+`"]}`))
			req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
			rec := httptest.NewRecorder()
			FixDatabaseConsistencyHandler(granttest.Recorder{ResponseRecorder: rec}, req)
			var response struct {
				Fixed  int
				Errors []string
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || rec.Code != 200 || response.Fixed != 0 || len(response.Errors) != 0 {
				t.Fatal("skipped fix reported as completed/failed", rec.Code, rec.Body, err)
			}
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
			if id == "cat8_42" {
				assertNoLangKeyRetirement(t, state, false)
			}
		})
	}
}
func TestLangKeyPauseSQLUsesOneSharedCountingRule(t *testing.T) {
	db, state := pauseTestDB(t)
	findOrphanLangKeys()
	checkOrphanLangKeys() // description query shares detection
	_ = fixIssue(db, "cat7_43", nil)
	_ = fixIssue(db, "cat8_42", nil)
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	archiveDB := newSystemTableToolsTestDB(t)
	defer archiveDB.Close()
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "since"}})
	tx, err := archiveDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	archiveExpiredOrphans(tx)
	calls := append(state.calls, snapshotOrphanCalls()...)
	queries := 0
	for _, query := range calls {
		keyColumn := "slk.id"
		if strings.Contains(query, "AS age_days") || strings.Contains(query, "SELECT src.lang_key_id, src.last_seen") {
			keyColumn = "src.lang_key_id"
		}
		expected := strings.Join(strings.Fields(countingLangKeySourceExistsSQL(keyColumn)), " ")
		if !strings.Contains(strings.Join(strings.Fields(query), " "), expected) {
			t.Errorf("missing full shared counting-source fragment: %s", query)
		}
		queries++
	}
	if queries != 6 {
		t.Fatalf("checked %d queries, want detection, description detection and age, both actions and archive", queries)
	}
	for _, file := range []string{"lang_key_consistency_checks.go", "database_consistency_check.go"} {
		source, err := os.ReadFile(filepath.Clean(file))
		if err != nil {
			t.Fatal(err)
		}
		text := string(source)
		if file == "lang_key_consistency_checks.go" && strings.Count(text, "source_type NOT IN ('orphan', 'manual_crud')") != 1 {
			t.Fatal("counting rule duplicated or absent")
		}
		if strings.Contains(text, "htmlFragmentPattern") {
			t.Fatal("unused HTML regex remains")
		}
	}
}

func TestLangKeyPauseCopyCatalogueIsVisibleToCurrentScanner(t *testing.T) {
	source, err := os.ReadFile("lang_key_consistency_checks.go")
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, pattern := range langKeyPatterns {
		for _, match := range pattern.FindAllStringSubmatch(string(source), -1) {
			found[match[1]] = true
		}
	}
	for _, key := range []string{"consistency_orphan_archiving_paused", "consistency_synthetic_key_archiving_paused", "consistency_orphan_age_days", "consistency_lang_key_counting_source"} {
		if !found[key] {
			t.Errorf("current source scan misses seeded pause key %q", key)
		}
	}
}

func TestLangKeyPauseCategory8ReadFailureStillSkips(t *testing.T) {
	db, state := pauseTestDB(t)
	state.queryErr = errors.New("fixture status unavailable")
	if err := fixIssue(db, "cat8_42", nil); !errors.Is(err, errConsistencyFixSkipped) {
		t.Fatal(err)
	}
	assertNoLangKeyRetirement(t, state, false)
}

func TestLangKeyPauseCategory7DatabaseFailureIsNotSkipped(t *testing.T) {
	db, state := pauseTestDB(t)
	state.execErr = errors.New("fixture delete failure")
	if err := fixIssue(db, "cat7_43", nil); !errors.Is(err, state.execErr) {
		t.Fatal(err)
	}
}

func TestLangKeyPauseGarbageAndOrphanQueriesShareLengthLimit(t *testing.T) {
	_, state := pauseTestDB(t)
	checkGarbageLangKeys()
	findOrphanLangKeys()
	for _, query := range state.calls {
		if !strings.Contains(query, "length(slk.lang_key) > 200") || strings.Contains(query, ">= 200") {
			t.Errorf("garbage/orphan length boundary drifted: %s", query)
		}
	}
	source, err := os.ReadFile("lang_key_consistency_checks.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(source), "= 200") != 1 {
		t.Fatal("length limit must be defined once")
	}
}
