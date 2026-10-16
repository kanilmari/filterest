// lang_key_scan_trust.go
// Owns source-scan trust and a persistent rolling seven-day code-key maximum.
// Connects maintenance gates, read-only reports and existing system_config JSON storage.
// Keeps partial or implausibly small scans from aging protective source evidence.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	sourceMaintenanceMu      sync.Mutex
	lastSourceScanMu         sync.Mutex
	lastSourceScan           time.Time
	lastSuccessfulSourceScan time.Time
	lastSourceScanState      string
	lastSourceScanFailures   []string
)

// sourceSubScanError preserves the narrower reader name inside a shared stage.
type sourceSubScanError struct {
	name string
	err  error
}

func (e *sourceSubScanError) Error() string { return e.name + ": " + e.err.Error() }
func (e *sourceSubScanError) Unwrap() error { return e.err }

func timeNowUTC() time.Time { return time.Now().UTC() }

// SourceScanIsFresh authorizes maintenance only after a complete, credible scan.
func SourceScanIsFresh() bool {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	return !lastSourceScan.IsZero() && time.Since(lastSourceScan) < 5*time.Minute
}

// sourceScanStatus preserves 203's last successful time, including after failure.
func sourceScanStatus() (*time.Time, bool) {
	at, stale, _, _ := sourceScanSnapshot()
	return at, stale
}

// Capture time, trust and failure names together so a concurrent maintenance
// attempt cannot give the report a fresh flag paired with a partial outcome.
func sourceScanSnapshot() (*time.Time, bool, string, []string) {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	at := lastSourceScan
	if at.IsZero() {
		at = lastSuccessfulSourceScan
	}
	if at.IsZero() {
		return nil, true, lastSourceScanState, append([]string(nil), lastSourceScanFailures...)
	}
	at = at.UTC()
	return &at, lastSourceScan.IsZero() || time.Since(lastSourceScan) >= 5*time.Minute, lastSourceScanState, append([]string(nil), lastSourceScanFailures...)
}

func sourceScanOutcome() (string, []string) {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	return lastSourceScanState, append([]string(nil), lastSourceScanFailures...)
}

func recordSourceScanOutcome(state string, failures []string) {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	lastSourceScanState = state
	lastSourceScanFailures = append([]string(nil), failures...)
	lastSourceScan = time.Time{}
}

func markSourceScanDone() {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	lastSourceScan = time.Now()
	lastSuccessfulSourceScan = lastSourceScan
	lastSourceScanState, lastSourceScanFailures = "complete", nil
}

func markSourceScanFailed() { recordSourceScanOutcome("partial", []string{"in_progress"}) }

func sourceScanSkipReason() string {
	state, failures := sourceScanOutcome()
	if state == "partial" {
		return "partial source scan: " + strings.Join(failures, ", ")
	}
	if state == "suspicious" {
		return "suspicious source scan: code-key count below the 90% sanity floor"
	}
	return "source scan not fresh"
}

const codeSourceHistoryKey = "lang_key_source_scan_history"

type codeSourceSample struct {
	At    time.Time `json:"at"`
	Count int       `json:"code_keys"`
}

// retainCodeSourcePeaks stores only non-dominated samples: a newer count at
// least as large outlives and replaces an older one. This is the exact rolling
// seven-day maximum with minimal history, rather than retaining every scan.
func retainCodeSourcePeaks(samples []codeSourceSample, count int, now time.Time) ([]codeSourceSample, int, error) {
	cutoff := now.Add(-7 * 24 * time.Hour)
	retained := make([]codeSourceSample, 0, len(samples)+1)
	var previous time.Time
	for _, sample := range samples {
		if sample.At.IsZero() || sample.At.After(now) || sample.Count < 0 || (!previous.IsZero() && !sample.At.After(previous)) {
			return nil, 0, fmt.Errorf("invalid code-source scan history")
		}
		previous = sample.At
		if sample.At.After(cutoff) {
			retained = append(retained, sample)
		}
	}
	maximum := count
	for _, sample := range retained {
		if sample.Count > maximum {
			maximum = sample.Count
		}
	}
	for len(retained) > 0 && retained[len(retained)-1].Count <= count {
		retained = retained[:len(retained)-1]
	}
	return append(retained, codeSourceSample{At: now, Count: count}), maximum, nil
}

// recordCodeSourceCount uses the existing JSON configuration store; no schema or
// seed migration is needed. The row is created lazily on fresh and upgraded sites.
// Serialize the read/replace across processes too, including an initially absent row.
func recordCodeSourceCount(db *sql.DB, count int, now time.Time) (bool, int, error) {
	tx, err := db.Begin()
	if err != nil {
		return false, 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('lang_key_source_scan_history', 0))`); err != nil {
		return false, 0, err
	}
	var raw []byte
	err = tx.QueryRow(`SELECT json_value FROM public.system_config WHERE key=$1 FOR UPDATE`, codeSourceHistoryKey).Scan(&raw)
	var samples []codeSourceSample
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, 0, err
	}
	if err == nil {
		if string(raw) == "null" || len(raw) == 0 {
			return false, 0, fmt.Errorf("missing code-source scan history")
		}
		if err := json.Unmarshal(raw, &samples); err != nil {
			return false, 0, err
		}
	}
	samples, maximum, err := retainCodeSourcePeaks(samples, count, now)
	if err != nil {
		return false, 0, err
	}
	encoded, err := json.Marshal(samples)
	if err != nil {
		return false, 0, err
	}
	_, err = tx.Exec(`INSERT INTO public.system_config(key,json_value,value_type)
        VALUES($1,$2::jsonb,5) ON CONFLICT(key) DO UPDATE SET json_value=EXCLUDED.json_value,value_type=5`, codeSourceHistoryKey, string(encoded))
	if err != nil {
		return false, 0, err
	}
	if err := tx.Commit(); err != nil {
		return false, 0, err
	}
	// Integer counts need ceil(90% of maximum); avoid multiplication overflow.
	return count < maximum-maximum/10, maximum, nil
}
