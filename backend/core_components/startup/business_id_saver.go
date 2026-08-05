// business_id_saver.go
// Corrects startup-owned public legal identifier text stored in mutable tables.
// Bridges application startup and legacy system_lang_keys/system_about content.
// Exists so old public privacy notice copies converge without direct SQL maintenance.
package startup

import (
	"database/sql"
	"log"
)

const (
	filterestBusinessIDPattern = `3531564[-‑‐‒–—−]4`
	filterestBusinessIDValue   = `3531564-3`
)

// EnsureFilterestBusinessID normalizes the Filterest business ID in public text tables.
func EnsureFilterestBusinessID(db *sql.DB) {
	queries := []struct {
		name  string
		query string
	}{
		{
			name: "system_lang_keys translations",
			query: `
				UPDATE system_lang_keys
				SET fi = CASE WHEN fi IS NULL THEN NULL ELSE regexp_replace(fi, $1, $2, 'g') END,
				    en = CASE WHEN en IS NULL THEN NULL ELSE regexp_replace(en, $1, $2, 'g') END,
				    ch = CASE WHEN ch IS NULL THEN NULL ELSE regexp_replace(ch, $1, $2, 'g') END
				WHERE (fi IS NOT NULL AND fi ~ $1)
				   OR (en IS NOT NULL AND en ~ $1)
				   OR (ch IS NOT NULL AND ch ~ $1)
			`,
		},
		{
			name: "system_lang_keys names",
			query: `
				WITH candidate AS (
					SELECT id, regexp_replace(lang_key, $1, $2, 'g') AS next_lang_key
					FROM system_lang_keys
					WHERE lang_key ~ $1
				), non_conflicting AS (
					SELECT candidate.id, candidate.next_lang_key
					FROM candidate
					WHERE NOT EXISTS (
						SELECT 1
						FROM system_lang_keys existing
						WHERE existing.lang_key = candidate.next_lang_key
						  AND existing.id <> candidate.id
					)
				)
				UPDATE system_lang_keys target
				SET lang_key = non_conflicting.next_lang_key
				FROM non_conflicting
				WHERE target.id = non_conflicting.id
				  AND target.lang_key <> non_conflicting.next_lang_key
			`,
		},
		{
			name: "system_about descriptions",
			query: `
				UPDATE system_about
				SET description = regexp_replace(description, $1, $2, 'g')
				WHERE description ~ $1
			`,
		},
	}

	var totalRows int64
	for _, item := range queries {
		result, err := db.Exec(item.query, filterestBusinessIDPattern, filterestBusinessIDValue)
		if err != nil {
			log.Printf("\033[31merror: [STARTUP] Filterest business ID correction failed for %s: %v\033[0m", item.name, err)
			continue
		}
		rows, err := result.RowsAffected()
		if err == nil {
			totalRows += rows
		}
	}

	if totalRows > 0 {
		log.Printf("[STARTUP] Filterest business ID normalized in %d public text row(s)", totalRows)
	}
}
