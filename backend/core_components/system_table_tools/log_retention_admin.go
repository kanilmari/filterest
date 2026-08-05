// log_retention_admin.go
// Admin API handlers for previewing and pruning old rows from allowed log tables.
// Bridges log-retention requests, the allowed log-table registry, and DB-backed maintenance execution.
// Exists to provide a canonical maintenance path for log retention without manual direct-SQL operations.
package system_table_tools

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"

	"github.com/lib/pq"
)

type logRetentionTableSpec struct {
	TableName       string `json:"table_name"`
	TimestampColumn string `json:"timestamp_column"`
}

type LogRetentionTableResult struct {
	TableName       string `json:"table_name"`
	TimestampColumn string `json:"timestamp_column"`
	Present         bool   `json:"present"`
	MatchedRows     int64  `json:"matched_rows"`
	DeletedRows     int64  `json:"deleted_rows"`
	SkippedReason   string `json:"skipped_reason,omitempty"`
}

type LogRetentionResponse struct {
	Before       string                    `json:"before"`
	DryRun       bool                      `json:"dry_run"`
	Results      []LogRetentionTableResult `json:"results"`
	TotalMatched int64                     `json:"total_matched"`
	TotalDeleted int64                     `json:"total_deleted"`
}

type logRetentionRequest struct {
	Before string   `json:"before"`
	Tables []string `json:"tables"`
	DryRun bool     `json:"dry_run"`
}

var logRetentionTableSpecs = map[string]logRetentionTableSpec{
	"system_audit_log":       {TableName: "system_audit_log", TimestampColumn: "created_at"},
	"system_transaction_log": {TableName: "system_transaction_log", TimestampColumn: "created_at"},
	"system_log":             {TableName: "system_log", TimestampColumn: "created"},
	"bee_messages":           {TableName: "bee_messages", TimestampColumn: "created"},
	"dev_agent_task_runs":    {TableName: "dev_agent_task_runs", TimestampColumn: "started_at"},
	"ai_usage_logs":          {TableName: "ai_usage_logs", TimestampColumn: "created_at"},
	"mcp_query_log":          {TableName: "mcp_query_log", TimestampColumn: "created_at"},
	"deletion_log":           {TableName: "deletion_log", TimestampColumn: "deleted_at"},
}

var defaultLogRetentionTableOrder = []string{
	"system_audit_log",
	"system_transaction_log",
	"system_log",
	"bee_messages",
	"dev_agent_task_runs",
	"ai_usage_logs",
	"mcp_query_log",
	"deletion_log",
}

// PreviewLogRetentionHandler calculates how many rows would be pruned from each allowed log table.
func PreviewLogRetentionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}
	if backend.Db == nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	before, err := parseLogRetentionCutoff(r.URL.Query().Get("before"))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tableNames, err := resolveRequestedLogTables(parseLogRetentionTablesQuery(r.URL.Query().Get("tables")))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := runLogRetention(backend.Db, before, tableNames, true)
	if err != nil {
		log.Printf("\033[31merror: [PreviewLogRetentionHandler] %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "log retention preview failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// PruneLogRetentionHandler deletes rows older than the given cutoff from allowed log tables.
func PruneLogRetentionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var req logRetentionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	before, err := parseLogRetentionCutoff(req.Before)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tableNames, err := resolveRequestedLogTables(req.Tables)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	resp, err := runLogRetention(tx, before, tableNames, req.DryRun)
	if err != nil {
		log.Printf("\033[31merror: [PruneLogRetentionHandler] %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "log retention prune failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func parseLogRetentionCutoff(raw string) (time.Time, error) {
	cutoff := strings.TrimSpace(raw)
	if cutoff == "" {
		return time.Time{}, fmt.Errorf("before is required (use YYYY-MM-DD or RFC3339)")
	}

	if parsed, err := time.Parse(time.RFC3339, cutoff); err == nil {
		return parsed, nil
	}
	if parsed, err := time.ParseInLocation("2006-01-02", cutoff, time.Local); err == nil {
		return parsed, nil
	}

	return time.Time{}, fmt.Errorf("invalid before value %q (use YYYY-MM-DD or RFC3339)", cutoff)
}

func parseLogRetentionTablesQuery(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, ",")
}

func resolveRequestedLogTables(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return append([]string(nil), defaultLogRetentionTableOrder...), nil
	}

	resolved := make([]string, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, item := range raw {
		tableName := strings.ToLower(strings.TrimSpace(item))
		if tableName == "" || seen[tableName] {
			continue
		}
		if _, ok := logRetentionTableSpecs[tableName]; !ok {
			return nil, fmt.Errorf("unknown log table %q", tableName)
		}
		seen[tableName] = true
		resolved = append(resolved, tableName)
	}
	if len(resolved) == 0 {
		return nil, fmt.Errorf("no valid log tables requested")
	}
	return resolved, nil
}

func runLogRetention(q dbutils.Querier, before time.Time, tableNames []string, dryRun bool) (LogRetentionResponse, error) {
	resp := LogRetentionResponse{
		Before:  before.Format(time.RFC3339),
		DryRun:  dryRun,
		Results: make([]LogRetentionTableResult, 0, len(tableNames)),
	}

	for _, tableName := range tableNames {
		spec := logRetentionTableSpecs[tableName]
		result := LogRetentionTableResult{
			TableName:       spec.TableName,
			TimestampColumn: spec.TimestampColumn,
		}

		exists, err := logRetentionTableExists(q, spec.TableName)
		if err != nil {
			return resp, err
		}
		if !exists {
			result.SkippedReason = "table missing in current instance"
			resp.Results = append(resp.Results, result)
			continue
		}
		result.Present = true

		matched, err := countLogRetentionRows(q, spec, before)
		if err != nil {
			return resp, err
		}
		result.MatchedRows = matched
		resp.TotalMatched += matched

		if !dryRun && matched > 0 {
			deleted, err := deleteLogRetentionRows(q, spec, before)
			if err != nil {
				return resp, err
			}
			result.DeletedRows = deleted
			resp.TotalDeleted += deleted
		}

		resp.Results = append(resp.Results, result)
	}

	return resp, nil
}

func logRetentionTableExists(q dbutils.Querier, tableName string) (bool, error) {
	var exists bool
	err := q.QueryRow(
		`SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)`,
		tableName,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("table existence check failed for %s: %w", tableName, err)
	}
	return exists, nil
}

func countLogRetentionRows(q dbutils.Querier, spec logRetentionTableSpec, before time.Time) (int64, error) {
	query := fmt.Sprintf(
		`SELECT COUNT(*) FROM %s WHERE %s < $1`,
		pq.QuoteIdentifier(spec.TableName),
		pq.QuoteIdentifier(spec.TimestampColumn),
	)
	var matched int64
	if err := q.QueryRow(query, before).Scan(&matched); err != nil {
		return 0, fmt.Errorf("count failed for %s: %w", spec.TableName, err)
	}
	return matched, nil
}

func deleteLogRetentionRows(q dbutils.Querier, spec logRetentionTableSpec, before time.Time) (int64, error) {
	query := fmt.Sprintf(
		`DELETE FROM %s WHERE %s < $1`,
		pq.QuoteIdentifier(spec.TableName),
		pq.QuoteIdentifier(spec.TimestampColumn),
	)
	result, err := q.Exec(query, before)
	if err != nil {
		return 0, fmt.Errorf("delete failed for %s: %w", spec.TableName, err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("rows affected lookup failed for %s: %w", spec.TableName, err)
	}
	return rowsAffected, nil
}
