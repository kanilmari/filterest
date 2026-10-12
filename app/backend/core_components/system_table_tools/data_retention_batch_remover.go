// data_retention_batch_remover.go
// Removes expired log history in small, independently committed transactions.
// Connects validated policies and the daily worker to PostgreSQL row locking.
// Limits locks, execution time and daily work while retaining exact cutoffs.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants"
	"github.com/lib/pq"
)

const (
	dataRetentionLogBatchSize      = 1000
	dataRetentionLogBatchesPerPass = 100
)

// Validate again at execution so even an internal caller cannot bypass the
// table/column registry. Configuration never becomes an SQL identifier unchecked.
func validateDataRetentionExecutionPolicy(policy dataRetentionPolicy) error {
	filter, err := json.Marshal(policy.FilterValue)
	if err != nil {
		return err
	}
	normalized, err := normalizeDataRetentionPolicy(dataRetentionPolicyConfig{
		Name: policy.Name, Enabled: &policy.Enabled,
		TableName: policy.TableName, TimestampColumn: policy.TimestampColumn,
		FilterColumn: policy.FilterColumn, FilterValue: filter,
		Mode: policy.Mode, KeepYears: policy.KeepYears, KeepDays: policy.KeepDays,
	})
	if err != nil {
		return err
	}
	if normalized.TableName != policy.TableName || normalized.TimestampColumn != policy.TimestampColumn || normalized.FilterColumn != policy.FilterColumn || normalized.Mode != policy.Mode {
		return fmt.Errorf("retention execution requires normalized identifiers and mode")
	}
	return nil
}

func runAutomaticDataRetentionBatch(ctx context.Context, conn *sql.Conn, policy dataRetentionPolicy, now time.Time) (int64, error) {
	if err := validateDataRetentionExecutionPolicy(policy); err != nil {
		return 0, err
	}
	if !policy.Enabled {
		return 0, nil
	}
	batchCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var deleted int64
	err := runtime_grants.WithRequestBarrier(batchCtx, backend.DbLifecycle, func(ctx context.Context) error {
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		// A table-level lock cannot use SKIP LOCKED; refuse it quickly instead.
		if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '100ms'; SET LOCAL statement_timeout = '750ms'`); err != nil {
			return err
		}
		q := dbutils.BindQueryContext(ctx, tx)
		exists, err := logRetentionTableExists(q, policy.TableName)
		if err != nil || !exists {
			return err
		}
		// Do not count an entire history table before every automatic batch.
		deleted, err = deleteRowsForDataRetentionPolicy(q, policy, resolveDataRetentionPolicyCutoff(policy, now))
		if err != nil {
			return err
		}
		return tx.Commit()
	})
	return deleted, err
}

func deleteLogRowsForDataRetentionBatch(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	where, args := buildGenericDataRetentionWhereClause(policy, cutoff)
	args = append(args, dataRetentionLogBatchSize)
	// ctid works for the allowlisted history tables regardless of their id type.
	// Locks and deletion share a statement, so an updated row cannot escape the
	// cutoff check between selection and deletion. Busy rows wait for a later pass.
	query := fmt.Sprintf(`WITH candidates AS (
		SELECT ctid FROM public.%s WHERE %s LIMIT $%d FOR UPDATE SKIP LOCKED
	)
	DELETE FROM public.%s AS target USING candidates WHERE target.ctid = candidates.ctid`,
		pq.QuoteIdentifier(policy.TableName), where, len(args), pq.QuoteIdentifier(policy.TableName))
	result, err := q.Exec(query, args...)
	if err != nil {
		return 0, fmt.Errorf("log retention batch failed for %s: %w", policy.TableName, err)
	}
	return result.RowsAffected()
}
