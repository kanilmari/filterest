// embedding_refresh_queue.go
// Persists content-free row refresh requests and coalesces repeated mutations by generation.
// Bridges committed CRUD changes, field consent metadata, and the asynchronous embedding worker.
// Exists so provider outages and process restarts cannot silently lose required embedding refreshes.
package ai_features

import (
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

type embeddingCapabilities struct {
	General      bool
	Multilingual bool
}

type embeddingQueueExecer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

// EnqueueRelevantEmbeddingRefresh schedules one row only when an allowed source field changed.
func EnqueueRelevantEmbeddingRefresh(
	q dbutils.Querier,
	tableName string,
	tableUID int64,
	rowID int64,
	changedFields []string,
) (bool, error) {
	capabilities, err := resolveEmbeddingCapabilities(q, tableName)
	if err != nil {
		return false, err
	}
	if !capabilities.General && !capabilities.Multilingual {
		return false, nil
	}
	_, allowedColumns, err := ResolveExternalEmbeddingSourceColumns(q, tableName)
	if err != nil {
		return false, err
	}
	if !embeddingSourceFieldsChanged(allowedColumns, changedFields) {
		return false, nil
	}
	if err := enqueueEmbeddingRefreshJob(q, tableUID, rowID); err != nil {
		return false, err
	}
	return true, nil
}

// EnqueueCreatedEmbeddingRefresh schedules a newly committed row when the
// dataset has an embedding target and at least one explicitly approved source.
func EnqueueCreatedEmbeddingRefresh(
	q dbutils.Querier,
	tableName string,
	tableUID int64,
	rowID int64,
) (bool, error) {
	capabilities, err := resolveEmbeddingCapabilities(q, tableName)
	if err != nil {
		return false, err
	}
	if !capabilities.General && !capabilities.Multilingual {
		return false, nil
	}
	_, allowedColumns, err := ResolveExternalEmbeddingSourceColumns(q, tableName)
	if err != nil {
		return false, err
	}
	if len(allowedColumns) == 0 {
		return false, nil
	}
	if err := enqueueEmbeddingRefreshJob(q, tableUID, rowID); err != nil {
		return false, err
	}
	return true, nil
}

func embeddingSourceFieldsChanged(allowedColumns []ExternalEmbeddingSourceColumn, changedFields []string) bool {
	allowedNames := make(map[string]bool, len(allowedColumns))
	for _, column := range allowedColumns {
		if column.Allowed {
			allowedNames[column.ColumnName] = true
		}
	}
	for _, changedField := range changedFields {
		if allowedNames[strings.TrimSpace(changedField)] {
			return true
		}
	}
	return false
}

// EnqueueAllEmbeddingRefreshJobs schedules every current row after a policy replacement.
func EnqueueAllEmbeddingRefreshJobs(q dbutils.Querier, tableName string, tableUID int64) (int64, error) {
	sanitized, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return 0, err
	}
	capabilities, err := resolveEmbeddingCapabilities(q, sanitized)
	if err != nil {
		return 0, err
	}
	if !capabilities.General && !capabilities.Multilingual {
		return 0, nil
	}
	result, err := q.Exec(fmt.Sprintf(`
		INSERT INTO system_embedding_refresh_jobs (table_uid, row_id)
		SELECT $1, id FROM %s
		ON CONFLICT (table_uid, row_id) DO UPDATE
		SET generation = system_embedding_refresh_jobs.generation + 1,
		    attempt_count = 0,
		    available_at = now(),
		    last_error_code = '',
		    updated = now()`, pq.QuoteIdentifier(sanitized)), tableUID)
	if err != nil {
		return 0, fmt.Errorf("enqueue dataset embedding refresh: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("read embedding refresh enqueue count: %w", err)
	}
	return rows, nil
}

func enqueueEmbeddingRefreshJob(q embeddingQueueExecer, tableUID, rowID int64) error {
	_, err := q.Exec(`
		INSERT INTO system_embedding_refresh_jobs (table_uid, row_id)
		VALUES ($1, $2)
		ON CONFLICT (table_uid, row_id) DO UPDATE
		SET generation = system_embedding_refresh_jobs.generation + 1,
		    attempt_count = 0,
		    available_at = now(),
		    last_error_code = '',
		    updated = now()`, tableUID, rowID)
	if err != nil {
		return fmt.Errorf("enqueue row embedding refresh: %w", err)
	}
	return nil
}

func resolveEmbeddingCapabilities(q embeddingPolicyQueryer, tableName string) (embeddingCapabilities, error) {
	sanitized, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return embeddingCapabilities{}, err
	}
	var capabilities embeddingCapabilities
	err = q.QueryRow(`
		SELECT
			EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public'
				  AND table_name = $1
				  AND column_name = 'embedding_vector'
			),
			COALESCE((
				SELECT multi_lang_embeddings
				FROM system_db_tables
				WHERE table_name = $1
				  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
			), false)`, sanitized).Scan(&capabilities.General, &capabilities.Multilingual)
	if err != nil {
		return embeddingCapabilities{}, fmt.Errorf("resolve embedding capabilities: %w", err)
	}
	return capabilities, nil
}
