// foreign_key_reader.go
// Shared utility functions for the dynamic table tools layer. Provides FK display-column
// resolution, foreign-key metadata lookup, and other helpers consumed across dtt sub-packages.
// Exists to centralize foreign-key lookup behavior for row and schema workflows.
package dtt_utils

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/fk_display"
	"fmt"
	"log"
)

type ForeignKey struct {
	ReferencingColumn string
	ReferencedTable   string
	ReferencedColumn  string
	NameColumn        string
}

func GetForeignKeysForTable(tableName string) (map[string]ForeignKey, error) {
	foreignKeyQuery := `
        SELECT
            kcu.column_name AS referencing_column,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.constraint_schema = kcu.constraint_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.constraint_schema = tc.constraint_schema
        WHERE
            tc.constraint_type = 'FOREIGN KEY' AND
            tc.table_name = $1;
    `

	fkRows, err := backend.Db.Query(foreignKeyQuery, tableName)
	if err != nil {
		return nil, err
	}
	defer fkRows.Close()

	// Read the complete FK result set before resolving display columns. Resolving a
	// display column performs additional queries; doing that while fkRows still
	// owns a connection can exhaust a small pool when two metadata reads overlap.
	foreignKeyReferences := make([]ForeignKey, 0)

	for fkRows.Next() {
		var referencingColumn, referencedTable, referencedColumn string
		if err := fkRows.Scan(&referencingColumn, &referencedTable, &referencedColumn); err != nil {
			return nil, err
		}
		foreignKeyReferences = append(foreignKeyReferences, ForeignKey{
			ReferencingColumn: referencingColumn,
			ReferencedTable:   referencedTable,
			ReferencedColumn:  referencedColumn,
		})
	}
	if err := fkRows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in GetForeignKeysForTable: %w", err)
	}
	if err := fkRows.Close(); err != nil {
		return nil, fmt.Errorf("closing rows in GetForeignKeysForTable: %w", err)
	}

	foreignKeys := make(map[string]ForeignKey, len(foreignKeyReferences))
	for _, foreignKey := range foreignKeyReferences {

		// Haetaan viitatun taulun nimisarakkeen nimi
		nameColumn, err := getReferencedTableNameColumn(foreignKey.ReferencedTable)
		if err != nil {
			log.Printf("error fetching name column for table %s: %v", foreignKey.ReferencedTable, err)
			// Jatketaan ilman nimeä
			nameColumn = ""
		}

		foreignKey.NameColumn = nameColumn
		foreignKeys[foreignKey.ReferencingColumn] = foreignKey
	}

	return foreignKeys, nil
}

// ResolveFKDisplayColumn valitsee viitatun taulun "näyttösarakkeen" FK-viittauksille.
// Tämä on ainoa totuuden lähde — ks. tiedoston alussa oleva arkkitehtuurikuvaus.
//
// Prioriteettijärjestys:
//  1. Konfiguroitu: system_db_tables.fk_display_column (admin-override)
//  2. Kovakoodatut poikkeukset (legacy-yhteensopivuus)
//  3. Heuristiikka: täsmäävä nimi (name, title, lang_key jne.)
//  4. Heuristiikka: osittainen pääte (_name, _title, _label, _key)
//  5. Heuristiikka: sisältö-osuma (name, title, username, header)
//  6. Fallback: ensimmäinen text/varchar-sarake ordinal_position-järjestyksessä
func ResolveFKDisplayColumn(schemaName, tableName string) (string, error) {
	if schemaName == "" {
		schemaName = "public"
	}

	// 1) Konfiguroitu override system_db_tables-taulusta.
	var configured string
	configErr := backend.Db.QueryRow(
		`SELECT fk_display_column FROM system_db_tables
		 WHERE table_name = $1
		   AND fk_display_column IS NOT NULL AND fk_display_column != ''
		 LIMIT 1`,
		tableName,
	).Scan(&configured)
	if configErr == nil && configured != "" {
		var exists bool
		_ = backend.Db.QueryRow(
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
			)`,
			schemaName, tableName, configured,
		).Scan(&exists)
		if exists {
			return configured, nil
		}
		log.Printf("warning: fk_display_column='%s' not found in table %s.%s, using heuristics",
			configured, schemaName, tableName)
	}

	if column := fk_display.LegacyColumn(tableName); column != "" {
		return column, nil
	}

	// 3-6) Heuristiikka + fallback: haetaan kaikki text/varchar-sarakkeet.
	rows, err := backend.Db.Query(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = $1 AND table_name = $2
		   AND data_type IN ('character varying', 'text')
		 ORDER BY ordinal_position`,
		schemaName, tableName,
	)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var textCols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return "", err
		}
		textCols = append(textCols, col)
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("rows iteration error in ResolveFKDisplayColumn: %w", err)
	}

	column, err := fk_display.Resolve(tableName, textCols)
	if err != nil {
		return "", fmt.Errorf("no text/varchar columns found in table %s.%s", schemaName, tableName)
	}
	return column, nil
}

// getReferencedTableNameColumn on sisäinen apufunktio, joka delegoi
// ResolveFKDisplayColumn():lle. Sitä kutsuu GetForeignKeysForTable() yllä.
func getReferencedTableNameColumn(tableName string) (string, error) {
	return ResolveFKDisplayColumn("public", tableName)
}
