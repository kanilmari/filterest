// consistency_read_safety_test.go
// Proves reports execute only reads, with fresh, expired or absent scan evidence.
// Connects GET and HEAD directly to the recording language-key database fixture.
// Prevents populate, orphan marking and archiving from returning to a read path.
package system_table_tools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConsistencySafeMethodsOnlyRead(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		for _, age := range []time.Duration{0, time.Minute, 10 * time.Minute} {
			t.Run(method+"/"+age.String(), func(t *testing.T) {
				_, state := pauseTestDB(t)
				lastSourceScanMu.Lock()
				previousSuccess := lastSuccessfulSourceScan
				lastSuccessfulSourceScan = time.Time{}
				lastSourceScan = time.Time{}
				if age != 0 {
					lastSourceScan = time.Now().Add(-age)
				}
				lastSourceScanMu.Unlock()
				t.Cleanup(func() { lastSourceScanMu.Lock(); lastSuccessfulSourceScan = previousSuccess; lastSourceScanMu.Unlock() })
				w := httptest.NewRecorder()
				CheckDatabaseConsistencyHandler(w, httptest.NewRequest(method, "/api/check-db-consistency", nil))
				if w.Code != http.StatusOK {
					t.Fatal(w.Code, w.Body)
				}
				for _, query := range state.calls {
					if !strings.HasPrefix(strings.TrimSpace(query), "SELECT") {
						t.Errorf("read reached populate/mark/archive mutation: %s", query)
					}
				}
				assertNoLangKeyRetirement(t, state, false)
				var result struct {
					Categories []struct {
						Number int        `json:"number"`
						At     *time.Time `json:"source_scan_at"`
						Stale  *bool      `json:"source_scan_stale"`
					}
				}
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				orphanFound := false
				for _, category := range result.Categories {
					if category.Number != 8 {
						continue
					}
					orphanFound = true
					if category.Stale == nil || *category.Stale != (age == 0 || age >= 5*time.Minute) {
						t.Fatal("missing or wrong freshness", w.Body)
					}
					if (category.At == nil) != (age == 0) {
						t.Fatal("missing or invented scan time", w.Body)
					}
					if category.At != nil && category.At.Location() != time.UTC {
						t.Fatal("scan time must use UTC for translation variables", w.Body)
					}
				}
				if !orphanFound {
					t.Fatal("report lost orphan category")
				}
			})
		}
	}
}

func TestSourceScanFailurePreservesLastSuccessfulTime(t *testing.T) {
	lastSourceScanMu.Lock()
	previous, previousSuccess := lastSourceScan, lastSuccessfulSourceScan
	lastSourceScan, lastSuccessfulSourceScan = time.Time{}, time.Time{}
	lastSourceScanMu.Unlock()
	t.Cleanup(func() {
		lastSourceScanMu.Lock()
		lastSourceScan, lastSuccessfulSourceScan = previous, previousSuccess
		lastSourceScanMu.Unlock()
	})
	if at, stale := sourceScanStatus(); at != nil || !stale {
		t.Fatal("unknown scan must be stale")
	}
	markSourceScanDone()
	at, stale := sourceScanStatus()
	if at == nil || stale {
		t.Fatal("successful scan must be current")
	}
	markSourceScanFailed()
	after, stale := sourceScanStatus()
	if after == nil || !after.Equal(*at) || !stale {
		t.Fatal("failed scan lost successful time or appeared fresh")
	}
}
