// primary_key_check.go
// Startup check that verifies all dynamic tables have a valid primary key defined. Logs
// warnings for tables missing a primary key to aid in database integrity monitoring.
// Exists to surface schema problems early without mutating user tables.
package startup

import (
	"database/sql"
	"log"
)

// CheckAllTablesHavePrimaryKey skannaa kaikki käyttäjätaulut ja varoittaa,
// jos jollakin taululla ei ole primary keytä. Palauttaa puuttuvien PKien lukumäärän.
func CheckAllTablesHavePrimaryKey(db *sql.DB) int {
	query := `
		SELECT c.relname AS table_name
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE
			c.relkind = 'r'
			AND n.nspname NOT LIKE 'pg_%'
			AND n.nspname <> 'information_schema'
			AND n.nspname NOT IN ('restricted', 'postgis')
			AND has_schema_privilege(n.nspname, 'USAGE')
			AND has_table_privilege(c.oid, 'SELECT')
			AND NOT EXISTS (
				SELECT 1
				FROM pg_constraint con
				WHERE con.conrelid = c.oid AND con.contype = 'p'
			)
		ORDER BY table_name;
	`

	rows, err := db.Query(query)
	if err != nil {
		log.Printf("[PK-CHECK] Error scanning tables: %v", err)
		return 0
	}
	defer rows.Close()

	missingCount := 0
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			log.Printf("[PK-CHECK] Error reading row: %v", err)
			continue
		}
		log.Printf("\033[33m[PK-CHECK] ⚠ Table '%s' has no primary key!\033[0m", tableName)
		missingCount++
	}

	if missingCount == 0 {
		log.Println("[PK-CHECK] ✓ All tables have a primary key.")
	} else {
		log.Printf("\033[33m[PK-CHECK] ⚠ %d table(s) missing primary key. Consider adding a primary key.\033[0m", missingCount)
	}

	return missingCount
}

// EnsurePrimaryKeyLangKeys varmistaa, että tarvittavat kieliavaimet primary key
// -virheilmoituksille ovat olemassa system_lang_keys-taulussa.
// Kutsutaan käynnistyksessä CheckAllTablesHavePrimaryKey:n jälkeen.
func EnsurePrimaryKeyLangKeys(db *sql.DB) {
	upsertQuery := `
		INSERT INTO system_lang_keys (lang_key, fi, en)
		VALUES ($1, $2, $3)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
			    en = CASE WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' THEN EXCLUDED.en ELSE system_lang_keys.en END
	`

	_, err := db.Exec(upsertQuery,
		"error_table_creation_missing_primary_key",
		"Taulua ei voi luoda ilman primary keytä. Lisää sarake nimeltä 'id' tyypillä 'SERIAL'.",
		"Cannot create a table without a primary key. Add a column named 'id' with type 'SERIAL'.",
	)
	if err != nil {
		log.Printf("[PK-CHECK] Error upserting lang key: %v", err)
	}
}
