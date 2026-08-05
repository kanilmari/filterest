// ensure_lang_key_source_for_crud_mutation.go
// Helper layer that upserts lang-key source metadata for manual CRUD mutations.
// Bridges CRUD save/import flows and system_lang_key_sources bookkeeping writes.
// Exists so translation provenance stays attached when admins create or edit lang keys.
package lang

import (
	"database/sql"
	"log"
	"strings"

	"github.com/lib/pq"
)

type sourceUpsertExecutor interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

// EnsureLangKeySourceForCRUDMutation upserts manual CRUD source metadata for one lang key row.
func EnsureLangKeySourceForCRUDMutation(db *sql.DB, tableName string, langKeyID int64, username string) {
	ensureLangKeySourceForCRUDMutationWithExecutor(db, tableName, langKeyID, username)
}

// EnsureLangKeySourceForCRUDMutationTx upserts manual CRUD source metadata inside a transaction.
func EnsureLangKeySourceForCRUDMutationTx(tx *sql.Tx, tableName string, langKeyID int64, username string) {
	ensureLangKeySourceForCRUDMutationWithExecutor(tx, tableName, langKeyID, username)
}

// EnsureLangKeySourcesForCRUDImportTx upserts manual CRUD source metadata in one batch for imported keys.
func EnsureLangKeySourcesForCRUDImportTx(tx *sql.Tx, tableName string, langKeys []string, username string) {
	if tx == nil || tableName != "system_lang_keys" || len(langKeys) == 0 {
		return
	}

	normalizedUsername := normalizeCRUDSourceUsername(username)
	deduplicatedLangKeys := deduplicateAndTrimNonEmpty(langKeys)
	if len(deduplicatedLangKeys) == 0 {
		return
	}

	_, err := tx.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		SELECT slk.id, 'manual_crud', 'admin_ui', $1, CURRENT_DATE
		FROM system_lang_keys slk
		WHERE slk.lang_key = ANY($2::text[])
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE
	`, normalizedUsername, pq.Array(deduplicatedLangKeys))
	if err != nil {
		log.Printf("[EnsureLangKeySourcesForCRUDImportTx] upsert failed (%d keys): %v", len(deduplicatedLangKeys), err)
	}
}

// ensureLangKeySourceForCRUDMutationWithExecutor performs the shared upsert against either DB or Tx executors.
func ensureLangKeySourceForCRUDMutationWithExecutor(exec sourceUpsertExecutor, tableName string, langKeyID int64, username string) {
	if exec == nil || tableName != "system_lang_keys" || langKeyID <= 0 {
		return
	}

	normalizedUsername := normalizeCRUDSourceUsername(username)

	_, err := exec.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		VALUES ($1, 'manual_crud', 'admin_ui', $2, CURRENT_DATE)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE
	`, langKeyID, normalizedUsername)
	if err != nil {
		log.Printf("[EnsureLangKeySourceForCRUDMutation] upsert failed (id=%d): %v", langKeyID, err)
	}
}

// normalizeCRUDSourceUsername trims the actor name and falls back to a stable placeholder.
func normalizeCRUDSourceUsername(username string) string {
	normalizedUsername := strings.TrimSpace(username)
	if normalizedUsername == "" {
		return "unknown"
	}
	return normalizedUsername
}

// deduplicateAndTrimNonEmpty removes blanks and duplicates before bulk source upserts.
func deduplicateAndTrimNonEmpty(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, rawValue := range values {
		trimmedValue := strings.TrimSpace(rawValue)
		if trimmedValue == "" {
			continue
		}
		if _, alreadySeen := seen[trimmedValue]; alreadySeen {
			continue
		}
		seen[trimmedValue] = struct{}{}
		result = append(result, trimmedValue)
	}
	return result
}
