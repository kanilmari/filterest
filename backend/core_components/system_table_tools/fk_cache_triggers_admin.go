// fk_cache_triggers_admin.go
// Admin API handler for managing FK cache invalidation triggers.
// Bridges the FK cache trigger registry and the admin cache-management UI.
// Exists to let admins list trigger status and manually refresh cached FK values.
package system_table_tools

import (
	"database/sql"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/lib/pq"
)

// ─── Response types ────────────────────────────────────────────

// FKCacheTriggerInfo describes one registered FK cache trigger.
type FKCacheTriggerInfo struct {
	ID            int    `json:"id"`
	SourceTable   string `json:"source_table"`
	SourceColumn  string `json:"source_column"`
	TargetTable   string `json:"target_table"`
	TargetColumn  string `json:"target_column"`
	JoinColumn    string `json:"join_column"`
	TriggerName   string `json:"trigger_name"`
	FunctionName  string `json:"function_name"`
	TriggerEvents string `json:"trigger_events"`
	Enabled       bool   `json:"enabled"`
	TriggerExists bool   `json:"trigger_exists"`
	Notes         string `json:"notes"`
	CachedCount   int    `json:"cached_count"`
	StaleCount    int    `json:"stale_count"`
}

// FKCacheTriggersResponse is the response for the list endpoint.
type FKCacheTriggersResponse struct {
	Triggers []FKCacheTriggerInfo `json:"triggers"`
	Total    int                  `json:"total"`
}

// FKCacheRefreshRequest is the request body for the refresh endpoint.
type FKCacheRefreshRequest struct {
	TriggerID int `json:"trigger_id"`
}

// FKCacheRefreshResponse is the response for the refresh endpoint.
type FKCacheRefreshResponse struct {
	Updated int      `json:"updated"`
	Errors  []string `json:"errors"`
}

// ─── Handlers ──────────────────────────────────────────────────

// ListFKCacheTriggersHandler returns all registered FK cache triggers
// with their current PG status and staleness metrics.
// Between: HTTP Request (admin) -> Database (system_fk_cache_triggers + pg_trigger)
// Why: Gives admin visibility into which cache triggers exist and if they're active.
func ListFKCacheTriggersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}

	rows, err := backend.Db.Query(`
		SELECT id, source_table, source_column, target_table, target_column,
		       join_column, trigger_name, function_name, trigger_events,
		       enabled, COALESCE(notes, '')
		FROM system_fk_cache_triggers
		ORDER BY id
	`)
	if err != nil {
		log.Printf("[FK-CACHE] query error: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "cannot query FK cache triggers")
		return
	}
	defer rows.Close()

	var triggers []FKCacheTriggerInfo
	for rows.Next() {
		var t FKCacheTriggerInfo
		if err := rows.Scan(
			&t.ID, &t.SourceTable, &t.SourceColumn, &t.TargetTable, &t.TargetColumn,
			&t.JoinColumn, &t.TriggerName, &t.FunctionName, &t.TriggerEvents,
			&t.Enabled, &t.Notes,
		); err != nil {
			log.Printf("[FK-CACHE] scan error: %v", err)
			continue
		}

		// Check if the PG trigger actually exists
		var exists bool
		checkErr := backend.Db.QueryRow(`
			SELECT EXISTS (
				SELECT 1 FROM pg_trigger
				WHERE tgname = $1
			)
		`, t.TriggerName).Scan(&exists)
		if checkErr != nil {
			log.Printf("[FK-CACHE] pg_trigger check error for %s: %v", t.TriggerName, checkErr)
		}
		t.TriggerExists = exists

		// Count cached column values (non-NULL) and stale values
		t.CachedCount = countNonNull(t.TargetTable, t.TargetColumn)

		triggers = append(triggers, t)
	}

	if triggers == nil {
		triggers = []FKCacheTriggerInfo{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FKCacheTriggersResponse{
		Triggers: triggers,
		Total:    len(triggers),
	})
}

// RefreshFKCacheHandler manually re-syncs all cached values for a given trigger.
// This is useful after bulk data imports or to fix stale data.
// Between: HTTP Request (admin) -> Database (UPDATE target SET cached_col = source_val)
// Why: Allows manual cache refresh when automatic triggers haven't caught all cases.
func RefreshFKCacheHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var req FKCacheRefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	// Look up the trigger config
	var t FKCacheTriggerInfo
	err := tx.QueryRow(`
		SELECT id, source_table, source_column, target_table, target_column,
		       join_column, trigger_name, function_name
		FROM system_fk_cache_triggers
		WHERE id = $1
	`, req.TriggerID).Scan(
		&t.ID, &t.SourceTable, &t.SourceColumn, &t.TargetTable, &t.TargetColumn,
		&t.JoinColumn, &t.TriggerName, &t.FunctionName,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, "trigger not found")
		return
	}

	// Execute the refresh
	updated, refreshErrors := refreshCachedValues(tx, t)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FKCacheRefreshResponse{
		Updated: updated,
		Errors:  refreshErrors,
	})
}

// ─── Helpers ───────────────────────────────────────────────────

// countNonNull counts rows with non-NULL values in the given column.
func countNonNull(tableName, columnName string) int {
	query := fmt.Sprintf(
		`SELECT COUNT(*) FROM %s WHERE %s IS NOT NULL`,
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier(columnName),
	)
	var count int
	if err := backend.Db.QueryRow(query).Scan(&count); err != nil {
		log.Printf("[FK-CACHE] count error for %s.%s: %v", tableName, columnName, err)
		return 0
	}
	return count
}

// refreshCachedValues re-syncs all cached values for a given trigger config.
// Returns (updated count, error messages).
func refreshCachedValues(tx *sql.Tx, t FKCacheTriggerInfo) (int, []string) {
	var errors []string
	var updated int

	switch t.FunctionName {
	case "fn_sync_cached_username":
		// Re-derive cached_username for every app_service_catalog row from system_users
		result, err := tx.Exec(`
			UPDATE app_service_catalog sc
			SET cached_username = u.username
			FROM system_users u
			WHERE sc.user_id = u.id
			  AND (sc.cached_username IS DISTINCT FROM u.username)
		`)
		if err != nil {
			errors = append(errors, fmt.Sprintf("cached_username update error: %v", err))
		} else {
			n, _ := result.RowsAffected()
			updated = int(n)
		}

	default:
		// Generic refresh: UPDATE target SET cached_col = (SELECT source_col FROM source WHERE join = target.join)
		// This is a fallback for future triggers registered via the admin tool.
		query := fmt.Sprintf(`
			UPDATE %s t
			SET %s = s.%s
			FROM %s s
			WHERE t.%s = s.id
			  AND (t.%s IS DISTINCT FROM s.%s)
		`,
			pq.QuoteIdentifier(t.TargetTable),
			pq.QuoteIdentifier(t.TargetColumn),
			pq.QuoteIdentifier(t.SourceColumn),
			pq.QuoteIdentifier(t.SourceTable),
			pq.QuoteIdentifier(t.JoinColumn),
			pq.QuoteIdentifier(t.TargetColumn),
			pq.QuoteIdentifier(t.SourceColumn),
		)
		result, err := tx.Exec(query)
		if err != nil {
			errors = append(errors, fmt.Sprintf("generic refresh error: %v", err))
		} else {
			n, _ := result.RowsAffected()
			updated = int(n)
		}
	}

	log.Printf("[FK-CACHE] refreshed %d rows for trigger %s", updated, t.TriggerName)
	return updated, errors
}
