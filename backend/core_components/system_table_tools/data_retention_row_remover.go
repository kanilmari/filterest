// data_retention_row_remover.go
// Previews and prunes rows according to validated data-retention policies.
// Bridges the policy registry, allowed table strategies, and DB-backed maintenance execution.
// Exists so automatic and manual retention runs share one safe deletion engine.
package system_table_tools

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

const (
	dataRetentionDeleteStrategyGeneric       = "generic"
	dataRetentionDeleteStrategyTickets       = "ticket_with_related_messages"
	dataRetentionAutomaticInterval           = 24 * time.Hour
	dataRetentionAutomaticInitialDelay       = 90 * time.Second
	dataRetentionAdvisoryLockKey       int64 = 80428021
)

var automaticDataRetentionLoopOnce sync.Once

type DataRetentionPolicyResult struct {
	PolicyName      string `json:"policy_name"`
	TableName       string `json:"table_name"`
	TimestampColumn string `json:"timestamp_column"`
	FilterColumn    string `json:"filter_column,omitempty"`
	FilterValue     string `json:"filter_value,omitempty"`
	Mode            string `json:"mode"`
	KeepYears       int    `json:"keep_years"`
	Cutoff          string `json:"cutoff"`
	Present         bool   `json:"present"`
	Enabled         bool   `json:"enabled"`
	MatchedRows     int64  `json:"matched_rows"`
	DeletedRows     int64  `json:"deleted_rows"`
	SkippedReason   string `json:"skipped_reason,omitempty"`
	PolicyNote      string `json:"policy_note,omitempty"`
}

type DataRetentionResponse struct {
	DryRun       bool                        `json:"dry_run"`
	RanAt        string                      `json:"ran_at"`
	Results      []DataRetentionPolicyResult `json:"results"`
	TotalMatched int64                       `json:"total_matched"`
	TotalDeleted int64                       `json:"total_deleted"`
}

// StartAutomaticDataRetentionLoop starts the background retention loop exactly once.
func StartAutomaticDataRetentionLoop(db *sql.DB) {
	if db == nil {
		return
	}

	automaticDataRetentionLoopOnce.Do(func() {
		go func() {
			timer := time.NewTimer(dataRetentionAutomaticInitialDelay)
			defer timer.Stop()
			<-timer.C
			runAutomaticDataRetentionPass(db)

			ticker := time.NewTicker(dataRetentionAutomaticInterval)
			defer ticker.Stop()
			for range ticker.C {
				runAutomaticDataRetentionPass(db)
			}
		}()
	})
}

func runAutomaticDataRetentionPass(db *sql.DB) {
	enabled, err := isAutomaticDataRetentionEnabled(db)
	if err != nil {
		log.Printf("\033[31merror: [data-retention] automatic enable check failed: %v\033[0m", err)
		return
	}
	if !enabled {
		return
	}

	policies, err := loadDataRetentionPolicies(db)
	if err != nil {
		log.Printf("\033[31merror: [data-retention] policy load failed: %v\033[0m", err)
		return
	}
	if len(policies) == 0 {
		return
	}

	locked, lockErr := tryAcquireDataRetentionAdvisoryLock(db)
	if lockErr != nil {
		log.Printf("\033[31merror: [data-retention] advisory lock failed: %v\033[0m", lockErr)
		return
	}
	if !locked {
		return
	}
	defer releaseDataRetentionAdvisoryLock(db)

	tx, err := db.Begin()
	if err != nil {
		log.Printf("\033[31merror: [data-retention] transaction begin failed: %v\033[0m", err)
		return
	}

	response, err := runDataRetentionAt(tx, policies, false, time.Now())
	if err != nil {
		_ = tx.Rollback()
		log.Printf("\033[31merror: [data-retention] automatic prune failed: %v\033[0m", err)
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("\033[31merror: [data-retention] commit failed: %v\033[0m", err)
		return
	}

	if response.TotalDeleted > 0 {
		log.Printf("[data-retention] automatic prune deleted %d row(s) across %d policy result(s)", response.TotalDeleted, len(response.Results))
	}
}

func tryAcquireDataRetentionAdvisoryLock(q dbutils.Querier) (bool, error) {
	var locked bool
	if err := q.QueryRow(`SELECT pg_try_advisory_lock($1)`, dataRetentionAdvisoryLockKey).Scan(&locked); err != nil {
		return false, err
	}
	return locked, nil
}

func releaseDataRetentionAdvisoryLock(q dbutils.Querier) {
	if _, err := q.Exec(`SELECT pg_advisory_unlock($1)`, dataRetentionAdvisoryLockKey); err != nil {
		log.Printf("\033[31merror: [data-retention] advisory unlock failed: %v\033[0m", err)
	}
}

func parseDataRetentionPoliciesQuery(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, ",")
}

func runDataRetentionAt(q dbutils.Querier, policies []dataRetentionPolicy, dryRun bool, now time.Time) (DataRetentionResponse, error) {
	response := DataRetentionResponse{
		DryRun:  dryRun,
		RanAt:   now.Format(time.RFC3339),
		Results: make([]DataRetentionPolicyResult, 0, len(policies)),
	}

	for _, policy := range policies {
		spec := dataRetentionTableSpecs[policy.TableName]
		result := DataRetentionPolicyResult{
			PolicyName:      policy.Name,
			TableName:       policy.TableName,
			TimestampColumn: policy.TimestampColumn,
			FilterColumn:    policy.FilterColumn,
			FilterValue:     policy.FilterValueLabel,
			Mode:            policy.Mode,
			KeepYears:       policy.KeepYears,
			Cutoff:          resolveDataRetentionPolicyCutoff(policy, now).Format(time.RFC3339),
			Enabled:         policy.Enabled,
			PolicyNote:      policy.Description,
		}

		if !policy.Enabled {
			result.SkippedReason = "policy disabled"
			response.Results = append(response.Results, result)
			continue
		}

		exists, err := logRetentionTableExists(q, spec.TableName)
		if err != nil {
			return response, err
		}
		if !exists {
			result.SkippedReason = "table missing in current instance"
			response.Results = append(response.Results, result)
			continue
		}
		result.Present = true

		cutoff := resolveDataRetentionPolicyCutoff(policy, now)
		matchedRows, err := countRowsForDataRetentionPolicy(q, policy, cutoff)
		if err != nil {
			return response, err
		}
		result.MatchedRows = matchedRows
		response.TotalMatched += matchedRows

		if !dryRun && matchedRows > 0 {
			deletedRows, err := deleteRowsForDataRetentionPolicy(q, policy, cutoff)
			if err != nil {
				return response, err
			}
			result.DeletedRows = deletedRows
			response.TotalDeleted += deletedRows
		}

		response.Results = append(response.Results, result)
	}

	return response, nil
}

func countRowsForDataRetentionPolicy(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	spec := dataRetentionTableSpecs[policy.TableName]
	switch spec.DeleteStrategy {
	case dataRetentionDeleteStrategyTickets:
		return countTicketRowsForDataRetention(q, policy, cutoff)
	default:
		return countGenericRowsForDataRetention(q, policy, cutoff)
	}
}

func deleteRowsForDataRetentionPolicy(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	spec := dataRetentionTableSpecs[policy.TableName]
	switch spec.DeleteStrategy {
	case dataRetentionDeleteStrategyTickets:
		return deleteTicketRowsForDataRetention(q, policy, cutoff)
	default:
		return deleteGenericRowsForDataRetention(q, policy, cutoff)
	}
}

func countGenericRowsForDataRetention(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	whereClause, args := buildGenericDataRetentionWhereClause(policy, cutoff)
	query := fmt.Sprintf(`SELECT COUNT(*) FROM "%s" WHERE %s`, policy.TableName, whereClause)

	var count int64
	if err := q.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("generic data retention count failed for %s: %w", policy.TableName, err)
	}
	return count, nil
}

func deleteGenericRowsForDataRetention(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	whereClause, args := buildGenericDataRetentionWhereClause(policy, cutoff)
	query := fmt.Sprintf(`DELETE FROM "%s" WHERE %s`, policy.TableName, whereClause)

	result, err := q.Exec(query, args...)
	if err != nil {
		return 0, fmt.Errorf("generic data retention delete failed for %s: %w", policy.TableName, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("generic data retention rows-affected failed for %s: %w", policy.TableName, err)
	}
	return deleted, nil
}

func buildGenericDataRetentionWhereClause(policy dataRetentionPolicy, cutoff time.Time) (string, []any) {
	clauses := []string{fmt.Sprintf(`"%s" < $1`, policy.TimestampColumn)}
	args := []any{cutoff}

	if policy.FilterColumn != "" {
		clauses = append(clauses, fmt.Sprintf(`"%s" = $%d`, policy.FilterColumn, len(args)+1))
		args = append(args, policy.FilterValue)
	}

	return strings.Join(clauses, " AND "), args
}

func countTicketRowsForDataRetention(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	whereClause, args := buildTicketDataRetentionWhereClause(policy, cutoff)
	query := fmt.Sprintf(`SELECT COUNT(*) FROM "dev_agent_tasks" WHERE %s`, whereClause)

	var count int64
	if err := q.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("ticket data retention count failed: %w", err)
	}
	return count, nil
}

func deleteTicketRowsForDataRetention(q dbutils.Querier, policy dataRetentionPolicy, cutoff time.Time) (int64, error) {
	whereClause, args := buildTicketDataRetentionWhereClause(policy, cutoff)
	selectQuery := fmt.Sprintf(`SELECT id FROM "dev_agent_tasks" WHERE %s`, whereClause)

	rows, err := q.Query(selectQuery, args...)
	if err != nil {
		return 0, fmt.Errorf("ticket data retention candidate query failed: %w", err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("ticket data retention candidate scan failed: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("ticket data retention candidate rows failed: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	if _, err := q.Exec(`
		DELETE FROM system_comments
		WHERE table_name = 'dev_agent_tasks'
		  AND row_id = ANY($1)
	`, pq.Array(ids)); err != nil {
		return 0, fmt.Errorf("ticket comment retention delete failed: %w", err)
	}

	if _, err := q.Exec(`
		DELETE FROM bee_messages
		WHERE task_id = ANY($1)
	`, pq.Array(ids)); err != nil {
		return 0, fmt.Errorf("ticket message retention delete failed: %w", err)
	}

	result, err := q.Exec(`
		DELETE FROM dev_agent_tasks
		WHERE id = ANY($1)
	`, pq.Array(ids))
	if err != nil {
		return 0, fmt.Errorf("ticket row retention delete failed: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("ticket row retention rows-affected failed: %w", err)
	}
	return deleted, nil
}

func buildTicketDataRetentionWhereClause(policy dataRetentionPolicy, cutoff time.Time) (string, []any) {
	args := []any{
		cutoff,
		pq.Array([]string{"done", "rejected", "archived", "to_be_deleted"}),
	}
	clauses := []string{
		fmt.Sprintf(`"%s" < $1`, policy.TimestampColumn),
		`status = ANY($2)`,
	}

	if policy.FilterColumn != "" {
		clauses = append(clauses, fmt.Sprintf(`"%s" = $%d`, policy.FilterColumn, len(args)+1))
		args = append(args, policy.FilterValue)
	}

	return strings.Join(clauses, " AND "), args
}
