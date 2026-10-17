// lang_key_ui_scan_trust.go
// Persists literal-UI scan attempts separately from the last completed scan.
// Connects generation-marked code evidence to the translation reader's one query.
// Advisory serialization and generation CAS prevent an older scan restoring trust.
package system_table_tools

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strconv"
)

const uiScanConfigKey = "lang_key_ui_scan"

type uiLiteralScanAttempt struct {
	generation  string
	fingerprint string
}

// Hold a transaction-scoped lock on a dedicated connection, not a transaction
// around evidence: the running state must be committed before rows are rewritten.
// Runtime pools need two connections (the lock and the ordinary scanner pool).
func lockUILiteralScan(db *sql.DB) (*sql.Tx, error) {
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('lang_key_ui_scan', 0))`); err != nil {
		tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func beginUILiteralScan(db *sql.DB, fingerprint string) (uiLiteralScanAttempt, error) {
	attempt := uiLiteralScanAttempt{strconv.FormatInt(timeNowUTC().UnixNano(), 10), fingerprint}
	// This is the scan's first write. Never replace the completed fields here.
	_, err := db.Exec(`INSERT INTO public.system_config(key,json_value,value_type)
 VALUES('lang_key_ui_scan', jsonb_build_object('scanner','ui_literal_v1', 'attempt',
   jsonb_build_object('generation',$1::bigint,'fingerprint',$2::text,'state','running','at',CURRENT_TIMESTAMP)),5)
 ON CONFLICT(key) DO UPDATE SET value_type=5,
 json_value=COALESCE(system_config.json_value,'{}'::jsonb) || EXCLUDED.json_value`, attempt.generation, fingerprint)
	return attempt, err
}

func (attempt uiLiteralScanAttempt) finish(db *sql.DB, complete bool) (bool, error) {
	state := "failed"
	if complete {
		state = "complete"
	}
	// One statement changes all completion fields AND attempt state, only for
	// this generation. Failure uses the same CAS and preserves completed history.
	result, err := db.Exec(`UPDATE public.system_config SET json_value =
 jsonb_set(json_value,'{attempt,state}',to_jsonb($2::text)) ||
 CASE WHEN $2::text='complete' THEN jsonb_build_object(
   'complete_generation',$1::bigint,'complete_fingerprint',$3::text,'completed_at',CURRENT_TIMESTAMP)
 ELSE '{}'::jsonb END
 WHERE key='lang_key_ui_scan' AND json_value #>> '{attempt,generation}'=$1::text`, attempt.generation, state, attempt.fingerprint)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if count == 0 && complete {
		log.Printf("[PopulateLangKeySources] dropped UI scan completion for generation %s: a newer attempt owns trust", attempt.generation)
	}
	return count == 1, nil
}

func (attempt uiLiteralScanAttempt) marker() string {
	return uiLiteralScanner + ":" + attempt.generation
}

func requireUILiteralCompletion(attempt uiLiteralScanAttempt, db *sql.DB) error {
	updated, err := attempt.finish(db, true)
	if err != nil {
		return err
	}
	if !updated {
		return fmt.Errorf("UI scan completion superseded by a newer attempt")
	}
	return nil
}
