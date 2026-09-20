// column_update.go
// Synchronizes system_column_details with the actual PostgreSQL schema and
// handles renaming and retyping of columns via ALTER TABLE. Accepts a Querier
// interface for transaction-safe operation.

package dtt_2_column_update

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/lang"
	"errors"
	"fmt"
	"log"
	"strings"
)

// UpdateColumnMetadata updates system_column_details based on current table schema.
// Accepts a Querier (either *sql.DB or *sql.Tx) for transaction safety.
func UpdateColumnMetadata(q dbutils.Querier) error {
	// Poista rivit system_column_details-taulusta, joiden table_uid ei enää ole olemassa
	cleanupQuery := `
        DELETE FROM system_column_details
        WHERE table_uid NOT IN (
            SELECT table_uid FROM system_db_tables
        )
    `
	_, err := q.Exec(cleanupQuery)
	if err != nil {
		return fmt.Errorf("error cleaning up obsolete entries: %w", err)
	}

	// Hae kaikki taulut system_db_tables-taulusta
	tablesQuery := `
        SELECT table_name, table_uid
        FROM system_db_tables
    `
	rows, err := q.Query(tablesQuery)
	if err != nil {
		return fmt.Errorf("error fetching tables: %w", err)
	}
	defer rows.Close()

	type TableInfo struct {
		TableName string
		TableUID  int
	}

	var tables []TableInfo

	for rows.Next() {
		var table TableInfo
		if err := rows.Scan(&table.TableName, &table.TableUID); err != nil {
			return fmt.Errorf("error scanning table info: %w", err)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating tables: %w", err)
	}

	// Iteroi jokainen taulu
	for _, table := range tables {
		// Hae saraketiedot mukaan lukien attnum
		columnsQuery := `
			SELECT a.attname,
			       a.attnum,
			       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
			FROM pg_attribute a
			WHERE a.attrelid = pg_catalog.to_regclass($1)
			  AND a.attnum > 0
			  AND NOT a.attisdropped
			ORDER BY a.attnum
		`

		// The table can be deleted after the system_db_tables snapshot was read.
		// to_regclass returns NULL for that expected race instead of aborting the
		// caller's transaction like a direct ::regclass cast would.
		colRows, err := q.Query(columnsQuery, table.TableName)
		if err != nil {
			return fmt.Errorf("error fetching columns for table %s: %w", table.TableName, err)
		}

		// Talletetaan sarakkeen nimi -> (data_type, attnum)
		type ColumnSmallInfo struct {
			DataType  string
			AttNumber int
		}
		existingColumns := make(map[string]ColumnSmallInfo)

		for colRows.Next() {
			var colName string
			var attNumber int
			var dataType string
			if err := colRows.Scan(&colName, &attNumber, &dataType); err != nil {
				_ = colRows.Close()
				return fmt.Errorf("error scanning column info for table %s: %w", table.TableName, err)
			}
			existingColumns[colName] = ColumnSmallInfo{
				DataType:  dataType,
				AttNumber: attNumber,
			}
		}
		if err := colRows.Err(); err != nil {
			_ = colRows.Close()
			return fmt.Errorf("error iterating columns for table %s: %w", table.TableName, err)
		}
		if err := colRows.Close(); err != nil {
			return fmt.Errorf("error closing columns for table %s: %w", table.TableName, err)
		}

		// Hae olemassa olevat system_column_details-rivit käyttäen column_name:a
		metadataQuery := `
            SELECT column_name, column_uid, data_type
            FROM system_column_details
            WHERE table_uid = $1
        `
		metaRows, err := q.Query(metadataQuery, table.TableUID)
		if err != nil {
			return fmt.Errorf("error fetching metadata for table %s: %w", table.TableName, err)
		}

		// Talletetaan column_name -> (column_uid, data_type)
		type ExistingMeta struct {
			ColumnUID int
			DataType  *string // voi olla nil, jos data_type on null
		}
		existingMetadata := make(map[string]ExistingMeta)

		for metaRows.Next() {
			var colName string
			var columnID int
			var dataType sql.NullString

			if err := metaRows.Scan(&colName, &columnID, &dataType); err != nil {
				_ = metaRows.Close()
				return fmt.Errorf("error scanning metadata for table %s: %w", table.TableName, err)
			}
			existingMetadata[colName] = ExistingMeta{
				ColumnUID: columnID,
				DataType:  nilIfEmpty(dataType),
			}
		}
		if err := metaRows.Err(); err != nil {
			_ = metaRows.Close()
			return fmt.Errorf("error iterating metadata for table %s: %w", table.TableName, err)
		}
		if err := metaRows.Close(); err != nil {
			return fmt.Errorf("error closing metadata for table %s: %w", table.TableName, err)
		}

		// Päivitä tai lisää sarakkeet
		for colName, col := range existingColumns {
			if metaInfo, exists := existingMetadata[colName]; exists {
				// Sarake on jo olemassa, päivitetään column_name ja data_type.
				updateQuery := `
                    UPDATE system_column_details
                    SET column_name = $1,
                        data_type   = $2,
                        co_number   = $3,
                        card_element = CASE
                            WHEN card_element IS NULL OR card_element = '' THEN 'details'
                            ELSE card_element
                        END
                    WHERE column_uid = $4
                      AND (
                          column_name IS DISTINCT FROM $1
                          OR data_type IS DISTINCT FROM $2
                          OR co_number IS DISTINCT FROM $3
                          OR card_element IS NULL
                          OR card_element = ''
                      )
                `
				_, err = q.Exec(
					updateQuery,
					colName,
					col.DataType,
					col.AttNumber,
					metaInfo.ColumnUID,
				)
				if err != nil {
					return fmt.Errorf("error updating system_column_details for table %s, column %s: %w",
						table.TableName, colName, err)
				}
			} else {
				// Uusi sarake, lisätään se ja asetetaan co_number = attNumber
				insertQuery := `
                    INSERT INTO system_column_details
                        (table_uid, column_name, data_type, co_number, card_element, show_key_on_card)
                    VALUES ($1, $2, $3, $4, 'details', NULL)
                `
				_, err = q.Exec(
					insertQuery,
					table.TableUID,
					colName,
					col.DataType,
					col.AttNumber,
				)
				if err != nil {
					return fmt.Errorf("error inserting into system_column_details for table %s, column %s: %w",
						table.TableName, colName, err)
				}
			}
		}

		// Poista sarakkeet, joita ei enää ole
		for colName := range existingMetadata {
			if _, exists := existingColumns[colName]; !exists {
				deleteQuery := `
                    DELETE FROM system_column_details
                    WHERE table_uid = $1 AND column_name = $2
                `
				_, err = q.Exec(deleteQuery, table.TableUID, colName)
				if err != nil {
					return fmt.Errorf("error deleting from system_column_details for table %s, column %s: %w",
						table.TableName, colName, err)
				}
			}
		}
	}

	return nil
}

// nilIfEmpty on pieni apufunktio, jolla muutetaan mahdollinen NullString osoittimeksi
func nilIfEmpty(ns sql.NullString) *string {
	if ns.Valid {
		s := ns.String
		return &s
	}
	return nil
}

// UpdateColumns päivittää sarakkeiden nimen/tyypin annetussa taulussa.
// Tämä on entinen "UpdateColumns(...)", siirretty erilliseen pakettiin.
// Parametrina annetaan "sanitizeIdentifierFunc", jotta tämä paketti ei viittaa suoraan security-pakettiin.
func UpdateColumns(
	tx *sql.Tx,
	sanitizedTableName string,
	modifiedCols []dtt_2_column_crud.ModifiedCol,
	sanitizeIdentifierFunc func(string) (string, error),
) error {
	fmt.Println("Modifying columns (if any):", modifiedCols)

	for _, mcol := range modifiedCols {
		fmt.Println("Processing modification:", mcol)

		sOrigName, err := sanitizeIdentifierFunc(mcol.OriginalName)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}

		sNewName, err := sanitizeIdentifierFunc(mcol.NewName)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}

		// Sarakkeen uudelleennimeäminen
		if sOrigName != sNewName {
			renameStmt := fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s",
				sanitizedTableName, sOrigName, sNewName)
			fmt.Println("Renaming column:", renameStmt)

			_, err = tx.Exec(renameStmt)
			if err != nil {
				fmt.Printf("\033[31merror renaming column: %s\033[0m\n", err.Error())
				return err
			}

			// Update lang key sources and descriptions to reflect the new column name.
			if cleanErr := lang.UpdateLangKeySourcesForColumnRename(tx, sanitizedTableName, sOrigName, sNewName); cleanErr != nil {
				log.Printf("[UpdateColumns] warning: lang key source update for column rename %s.%s→%s: %v",
					sanitizedTableName, sOrigName, sNewName, cleanErr)
				// Non-fatal: column is already renamed, metadata update is best-effort.
			}
		}

		// Sarakkeen tyypin muuttaminen
		newType := strings.ToUpper(mcol.DataType)
		if newType == "VARCHAR" && mcol.Length != nil {
			newType = fmt.Sprintf("VARCHAR(%d)", *mcol.Length)
		}
		alterTypeStmt := fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s",
			sanitizedTableName, sNewName, newType)

		// A column that stores JSON has no automatic conversion into a scalar
		// type, so PostgreSQL refuses the plain statement. The clause below
		// reads the stored JSON value out as text first, which treats 10 and
		// "10" alike and lets the ordinary cast finish the change.
		jsonConversion, convErr := jsonScalarConversion(tx, sanitizedTableName, sNewName, newType)
		if convErr != nil {
			fmt.Printf("\033[31merror preparing column type change: %s\033[0m\n", convErr.Error())
			return convErr
		}
		if jsonConversion != "" {
			alterTypeStmt += " " + jsonConversion
		}

		fmt.Println("Modifying column type:", alterTypeStmt)

		_, err = tx.Exec(alterTypeStmt)
		if err != nil {
			fmt.Printf("\033[31merror changing column type: %s\033[0m\n", err.Error())
			return err
		}
	}
	return nil
}

// jsonScalarConversion returns the USING clause a JSON column needs before it
// can become a scalar column, and an empty string when the type change needs no
// help. Only this direction needs one: PostgreSQL turns a scalar into JSON by
// itself, and every other pair of types keeps the conversion it has always had.
func jsonScalarConversion(
	tx *sql.Tx,
	sanitizedTableName string,
	sanitizedColumnName string,
	newType string,
) (string, error) {
	var currentType string

	// Identifiers are composed unquoted here, so PostgreSQL has folded the
	// stored column name to lower case.
	err := tx.QueryRow(`
        SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        WHERE a.attrelid = pg_catalog.to_regclass($1)
          AND a.attname = lower($2)
          AND a.attnum > 0
          AND NOT a.attisdropped
    `, sanitizedTableName, sanitizedColumnName).Scan(&currentType)
	if errors.Is(err, sql.ErrNoRows) {
		// The ALTER statement reports a missing table or column by itself.
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("error reading current type of column %s.%s: %w",
			sanitizedTableName, sanitizedColumnName, err)
	}

	if !isJSONTypeName(currentType) || isJSONTypeName(newType) {
		return "", nil
	}

	// An empty JSON string leaves the column empty instead of failing the whole
	// change, the same way an empty form field leaves a value unset.
	return fmt.Sprintf("USING NULLIF(%s #>> '{}', '')::%s",
		sanitizedColumnName, newType), nil
}

// isJSONTypeName reports whether a PostgreSQL type name is one of the JSON types.
func isJSONTypeName(typeName string) bool {
	baseName := strings.ToUpper(strings.TrimSpace(typeName))
	if parenIndex := strings.Index(baseName, "("); parenIndex != -1 {
		baseName = strings.TrimSpace(baseName[:parenIndex])
	}
	return baseName == "JSON" || baseName == "JSONB"
}
