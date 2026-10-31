// foreign_key_reader.go
// Shared utility functions for the dynamic table tools layer. Provides FK display-column
// resolution, foreign-key metadata lookup, and other helpers consumed across dtt sub-packages.
// Exists to centralize foreign-key lookup behavior for row and schema workflows.
package dtt_utils

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/fk_display"
	"errors"
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
	return GetForeignKeysForTableWithQuerier(tableName, backend.Db)
}

// GetForeignKeysForTableWithQuerier carries optional read budgets through both
// relationship discovery and each referenced table's display-column lookup.
func GetForeignKeysForTableWithQuerier(tableName string, q dbutils.Querier) (map[string]ForeignKey, error) {
	return getForeignKeysForTableWithQuerier(tableName, q, func(table string) (string, error) {
		column, found, err := resolveFKDisplayColumnWithQuerier(q, "public", table, false)
		if err == nil && !found {
			err = fmt.Errorf("no text/varchar columns found in table public.%s", table)
		}
		if err != nil {
			log.Printf("error fetching name column for table %s: %v", table, err)
			column = ""
		}
		return column, nil
	})
}

// GetForeignKeysForTableForEvidence refuses incomplete metadata. A successful
// read with no display column is legitimate and leaves NameColumn empty.
func GetForeignKeysForTableForEvidence(tableName string) (map[string]ForeignKey, error) {
	return getForeignKeysForTable(tableName, func(table string) (string, error) {
		column, _, err := resolveFKDisplayColumn("public", table, true)
		return column, err
	})
}

func getForeignKeysForTable(tableName string, resolve func(string) (string, error)) (map[string]ForeignKey, error) {
	return getForeignKeysForTableWithQuerier(tableName, backend.Db, resolve)
}

func getForeignKeysForTableWithQuerier(tableName string, q dbutils.Querier, resolve func(string) (string, error)) (map[string]ForeignKey, error) {
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

	fkRows, err := q.Query(foreignKeyQuery, tableName)
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

		nameColumn, err := resolve(foreignKey.ReferencedTable)
		if err != nil {
			return nil, fmt.Errorf("display column for %s: %w", foreignKey.ReferencedTable, err)
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
	column, found, err := resolveFKDisplayColumn(schemaName, tableName, false)
	if err == nil && !found {
		if schemaName == "" {
			schemaName = "public"
		}
		err = fmt.Errorf("no text/varchar columns found in table %s.%s", schemaName, tableName)
	}
	return column, err
}

// resolveFKDisplayColumn owns the selection rules for runtime and evidence.
// Strict reads propagate optional-override failures too; runtime retains its
// historical fallback. found distinguishes an absent label from a failed read.
func resolveFKDisplayColumn(schemaName, tableName string, strict bool) (column string, found bool, err error) {
	return resolveFKDisplayColumnWithQuerier(backend.Db, schemaName, tableName, strict)
}

func resolveFKDisplayColumnWithQuerier(q dbutils.Querier, schemaName, tableName string, strict bool) (column string, found bool, err error) {
	if schemaName == "" {
		schemaName = "public"
	}

	// 1) Konfiguroitu override system_db_tables-taulusta.
	var configured string
	configErr := q.QueryRow(
		`SELECT fk_display_column FROM system_db_tables
		 WHERE table_name = $1
		   AND fk_display_column IS NOT NULL AND fk_display_column != ''
		 LIMIT 1`,
		tableName,
	).Scan(&configured)
	if strict && configErr != nil && !errors.Is(configErr, sql.ErrNoRows) {
		return "", false, configErr
	}
	if configErr == nil && configured != "" {
		var exists bool
		existsErr := q.QueryRow(
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
			)`,
			schemaName, tableName, configured,
		).Scan(&exists)
		if strict && existsErr != nil {
			return "", false, existsErr
		}
		if exists {
			return configured, true, nil
		}
		log.Printf("warning: fk_display_column='%s' not found in table %s.%s, using heuristics",
			configured, schemaName, tableName)
	}

	if column := fk_display.LegacyColumn(tableName); column != "" {
		return column, true, nil
	}

	// 3-6) Heuristiikka + fallback: haetaan kaikki text/varchar-sarakkeet.
	rows, err := q.Query(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = $1 AND table_name = $2
		   AND data_type IN ('character varying', 'text')
		 ORDER BY ordinal_position`,
		schemaName, tableName,
	)
	if err != nil {
		return "", false, err
	}
	defer rows.Close()

	var textCols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return "", false, err
		}
		textCols = append(textCols, col)
	}
	if err := rows.Err(); err != nil {
		return "", false, fmt.Errorf("rows iteration error in ResolveFKDisplayColumn: %w", err)
	}

	if len(textCols) == 0 {
		return "", false, nil
	}
	column, err = fk_display.Resolve(tableName, textCols)
	return column, err == nil, err
}
