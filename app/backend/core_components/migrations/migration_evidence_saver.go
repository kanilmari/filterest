// migration_evidence_saver.go
// Saves exact migration byte hashes, outcomes and their source in the ledger.
// Connects the ordered runner with both legacy and evidence-aware ledger schemas.
// Keeps history unverified and failed/interrupted self-managed attempts explicit.
package migrations

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
)

const (
	outcomeApplied                     = "applied"
	outcomeOptionalFailureSkipped      = "optional_failure_skipped"
	outcomeInterruptedSelfManaged      = "interrupted_self_managed"
	outcomeFailedSelfManaged           = "failed_self_managed"
	selfManagedReconciliationProcedure = "follow README.md#reconcile-a-self-managed-migration using app/server_tools/scripts/reconcile_self_managed_migration.sql"
)

type migrationEvidence struct {
	filename string
	hash     string
	outcome  string
}

type migrationEvidenceExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// migrationEvidenceAvailable probes the actual ledger, including uncommitted DDL.
// Partial extensions fail closed rather than quietly dropping execution evidence.
func migrationEvidenceAvailable(executor migrationEvidenceExecutor) (bool, error) {
	var count int
	err := executor.QueryRowContext(context.Background(), `SELECT count(*) FROM pg_catalog.pg_attribute
		WHERE attrelid = to_regclass('system_schema_migrations') AND NOT attisdropped
		AND attname IN ('content_sha256', 'outcome', 'provenance')`).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("read migration evidence schema: %w", err)
	}
	if count != 0 && count != 3 {
		return false, fmt.Errorf("migration evidence schema is incomplete")
	}
	return count == 3, nil
}

// refuseUnresolvedSelfManagedMigrations checks the whole evidence-aware ledger
// before any migration runs, regardless of current source files or allowlists.
// An extension applied later in this run cannot inherit unresolved legacy rows;
// new self-managed failures already stop execution where they occur.
func refuseUnresolvedSelfManagedMigrations(db *sql.DB) error {
	rows, err := db.Query(`SELECT filename, outcome FROM system_schema_migrations
		WHERE outcome IN ($1, $2) ORDER BY filename`, outcomeFailedSelfManaged, outcomeInterruptedSelfManaged)
	if err != nil {
		return fmt.Errorf("read unresolved self-managed migrations: %w", err)
	}
	defer rows.Close()
	var unresolved []string
	for rows.Next() {
		var filename, outcome string
		if err := rows.Scan(&filename, &outcome); err != nil {
			return fmt.Errorf("read unresolved self-managed migrations: %w", err)
		}
		unresolved = append(unresolved, fmt.Sprintf("migration %s has %s execution", filename, outcome))
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read unresolved self-managed migrations: %w", err)
	}
	if len(unresolved) > 0 {
		return fmt.Errorf("%s; operator reconciliation required: %s", strings.Join(unresolved, "; "), selfManagedReconciliationProcedure)
	}
	return nil
}

func insertMigrationEvidence(executor migrationEvidenceExecutor, evidence migrationEvidence, available bool) error {
	query := `INSERT INTO system_schema_migrations (filename) VALUES ($1)`
	args := []any{evidence.filename}
	if available {
		query = `INSERT INTO system_schema_migrations (filename, content_sha256, outcome, provenance)
			VALUES ($1, $2, $3, 'runner')`
		args = append(args, evidence.hash, evidence.outcome)
	}
	if _, err := executor.ExecContext(context.Background(), query, args...); err != nil {
		return fmt.Errorf("migration %s tracking insert failed: %w", evidence.filename, err)
	}
	return nil
}

// persistDeferredMigrationEvidence only updates rows executed by this invocation.
// The all-null predicate ensures it cannot overwrite durable evidence or infer history.
func persistDeferredMigrationEvidence(executor migrationEvidenceExecutor, evidence migrationEvidence) error {
	result, err := executor.ExecContext(context.Background(), `UPDATE system_schema_migrations
		SET content_sha256 = $2, outcome = $3, provenance = 'runner'
		WHERE filename = $1 AND content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL`,
		evidence.filename, evidence.hash, evidence.outcome)
	return checkEvidenceUpdate(result, err, evidence.filename)
}

func checkEvidenceUpdate(result sql.Result, err error, filename string) error {
	if err != nil {
		return fmt.Errorf("migration %s evidence update failed: %w", filename, err)
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return fmt.Errorf("migration %s evidence update did not confirm one row", filename)
	}
	return nil
}

// runSelfManagedMigration pins a connection so an aborted explicit transaction
// cannot leak into the pool. Evidence-aware ledgers mark attempts before SQL and
// distinguish observed failures after rollback from unknown interrupted attempts.
// Legacy ledgers keep the original execute-first, record-only-on-acceptance behavior.
func runSelfManagedMigration(db *sql.DB, content string, optional, available bool, evidence *migrationEvidence) error {
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if available {
		evidence.outcome = outcomeInterruptedSelfManaged
		if err := insertMigrationEvidence(conn, *evidence, true); err != nil {
			return err
		}
	}
	_, executionErr := conn.ExecContext(ctx, content)
	if executionErr == nil {
		// SAVEPOINT succeeds only within an open transaction. The expected 25P01
		// outside a transaction proves the script closed its transaction itself.
		if err := confirmSelfManagedTransactionClosed(conn); err != nil {
			executionErr = fmt.Errorf("self-managed migration did not confirm a closed transaction")
			optional = false // An open/unknown transaction is never an optional skip.
		}
	}
	if _, err := conn.ExecContext(ctx, "ROLLBACK"); err != nil {
		// Discard a connection whose transaction state could not be cleaned up.
		conn.Raw(func(any) error { return driver.ErrBadConn })
		return fmt.Errorf("migration %s transaction cleanup failed: %w", evidence.filename, err)
	}
	if err := confirmSelfManagedTransactionClosed(conn); err != nil {
		conn.Raw(func(any) error { return driver.ErrBadConn })
		return fmt.Errorf("migration %s transaction cleanup unconfirmed: %w", evidence.filename, err)
	}
	evidence.outcome = outcomeApplied
	if executionErr != nil {
		evidence.outcome = outcomeFailedSelfManaged
		if optional {
			evidence.outcome = outcomeOptionalFailureSkipped
		}
	}
	if available {
		result, err := conn.ExecContext(ctx, `UPDATE system_schema_migrations SET outcome = $3
			WHERE filename = $1 AND content_sha256 = $2 AND provenance = 'runner'
			AND outcome = 'interrupted_self_managed'`, evidence.filename, evidence.hash, evidence.outcome)
		if err := checkEvidenceUpdate(result, err, evidence.filename); err != nil {
			return err
		}
	}
	if executionErr != nil && !optional {
		if available {
			return fmt.Errorf("migration %s failed: %w; operator reconciliation required: %s", evidence.filename, executionErr, selfManagedReconciliationProcedure)
		}
		return fmt.Errorf("migration %s failed: %w", evidence.filename, executionErr)
	}
	if !available {
		return insertMigrationEvidence(conn, *evidence, false)
	}
	return nil
}

// confirmSelfManagedTransactionClosed verifies PostgreSQL's idle transaction
// state on the pinned connection, both after execution and after cleanup.
// A failed cleanup probe leaves the durable interruption marker unresolved.
func confirmSelfManagedTransactionClosed(conn *sql.Conn) error {
	_, err := conn.ExecContext(context.Background(), "SAVEPOINT filterest_migration_completion_probe")
	var state interface{ SQLState() string }
	if errors.As(err, &state) && state.SQLState() == "25P01" {
		return nil
	}
	return fmt.Errorf("self-managed transaction closure unconfirmed: %v", err)
}
