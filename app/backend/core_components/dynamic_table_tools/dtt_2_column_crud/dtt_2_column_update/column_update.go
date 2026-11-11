// column_update.go
// Synchronizes system_column_details with the actual PostgreSQL schema and
// handles renaming and retyping of columns via ALTER TABLE. Accepts a Querier
// interface for transaction-safe operation.

package dtt_2_column_update

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/lang"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
)

// A legacy empty schema denotes public. A relation dropped during startup
// resolves to NULL, leaving the caller's transaction usable.
const registeredRelation = `pg_catalog.to_regclass((
    SELECT format('%I.%I', COALESCE(NULLIF(schema_name,''),'public'), table_name)
    FROM system_db_tables WHERE table_uid = $1
))`

// Recheck the live maximum at the write. An uncommitted field-editor save
// numbers its N fields from 1 to N, even if their committed positions are
// zero or negative. A new field must follow those N in either commit order.
const appendFieldOrder = `GREATEST($4::bigint, (
    SELECT GREATEST(MAX(d.co_number)::bigint, COUNT(*)) + 1
    FROM system_column_details d
    JOIN pg_attribute a ON a.attrelid = ` + registeredRelation + `
        AND a.attname=d.column_name AND a.attnum>0 AND NOT a.attisdropped
    WHERE d.table_uid=$1 AND d.column_name<>$2
))`

// UpdateColumnMetadata updates system_column_details based on current table schema.
// Accepts a Querier (either *sql.DB or *sql.Tx) for transaction safety.
func UpdateColumnMetadata(q dbutils.Querier, preserveLegacy ...bool) error {
	preserve := len(preserveLegacy) > 0 && preserveLegacy[0]
	return updateColumnMetadata(q, preserve, "")
}

// UpdateDatasetColumnMetadata synchronizes only the dataset just created or
// changed. Global orphan cleanup belongs to maintenance, not its policy lock.
func UpdateDatasetColumnMetadata(q dbutils.Querier, tableName string) error {
	if strings.TrimSpace(tableName) == "" {
		return fmt.Errorf("dataset name is required for scoped column refresh")
	}
	return updateColumnMetadata(q, false, tableName)
}

func updateColumnMetadata(q dbutils.Querier, preserve bool, tableName string) error {
	// Poista rivit system_column_details-taulusta, joiden table_uid ei enää ole olemassa
	cleanupQuery := `
        DELETE FROM system_column_details
        WHERE table_uid NOT IN (
            SELECT table_uid FROM system_db_tables
        )
    `
	if tableName == "" {
		if _, err := q.Exec(cleanupQuery); err != nil {
			return fmt.Errorf("error cleaning up obsolete entries: %w", err)
		}
	}

	// Hae kaikki taulut system_db_tables-taulusta
	tablesQuery := `
        SELECT table_name, table_uid
        FROM system_db_tables
    `
	var args []any
	if tableName != "" {
		tablesQuery += ` WHERE table_name = $1 AND COALESCE(NULLIF(schema_name,''),'public') = 'public'`
		args = append(args, tableName)
	} else if preserve {
		tablesQuery += ` WHERE table_uid IS NOT NULL AND table_name IS NOT NULL`
	}
	rows, err := q.Query(tablesQuery, args...)
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
		// Rank only unnumbered live columns. A restored field without a position
		// already belongs to the dataset, so it precedes newly discovered fields.
		// PostgreSQL attribute order breaks ties within each group.
		columnsQuery := `
            SELECT a.attname,
                   COALESCE(m.co_number, COALESCE(MAX(m.co_number) OVER (), 0)::bigint +
                       COUNT(*) FILTER (WHERE m.co_number IS NULL)
                       OVER (ORDER BY m.column_uid IS NULL, a.attnum)) AS field_order,
                   pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
            FROM pg_attribute a
            LEFT JOIN system_column_details m ON m.table_uid = $1 AND m.column_name = a.attname
            WHERE a.attrelid = ` + registeredRelation + `
              AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY m.column_uid IS NULL, a.attnum
        `
		colRows, err := q.Query(columnsQuery, table.TableUID)
		if err != nil {
			return fmt.Errorf("error fetching columns for table %s: %w", table.TableName, err)
		}

		type physicalColumn struct {
			name, dataType string
			fieldOrder     int64
		}
		var columns []physicalColumn
		for colRows.Next() {
			var column physicalColumn
			if err := colRows.Scan(&column.name, &column.fieldOrder, &column.dataType); err != nil {
				_ = colRows.Close()
				return fmt.Errorf("error scanning column info for table %s: %w", table.TableName, err)
			}
			if column.fieldOrder > math.MaxInt32 {
				_ = colRows.Close()
				return fmt.Errorf("cannot append field %s.%s: field order exceeds PostgreSQL integer range", table.TableName, column.name)
			}
			columns = append(columns, column)
		}
		if err := colRows.Err(); err != nil {
			_ = colRows.Close()
			return fmt.Errorf("error iterating columns for table %s: %w", table.TableName, err)
		}
		if err := colRows.Close(); err != nil {
			return fmt.Errorf("error closing columns for table %s: %w", table.TableName, err)
		}

		if preserve && len(columns) == 0 {
			continue
		} // Missing legacy datasets stay diagnosable.

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
		for _, col := range columns {
			colName := col.name
			if metaInfo, exists := existingMetadata[colName]; exists {
				delete(existingMetadata, colName)
				// Sarake on jo olemassa, päivitetään column_name ja data_type.
				updateQuery := `
                    UPDATE system_column_details
                    SET data_type   = $3,
                        co_number   = COALESCE(co_number, ` + appendFieldOrder + `),
                        card_element = CASE
                            WHEN card_element IS NULL OR card_element = '' THEN 'details'
                            ELSE card_element
                        END
                    WHERE column_uid = $5 AND column_name = $2
                      AND (
                          data_type IS DISTINCT FROM $3
                          OR co_number IS NULL
                          OR card_element IS NULL
                          OR card_element = ''
                      )
                `
				_, err = q.Exec(
					updateQuery,
					table.TableUID,
					colName,
					col.dataType,
					col.fieldOrder,
					metaInfo.ColumnUID,
				)
				if err != nil {
					return fmt.Errorf("error updating system_column_details for table %s, column %s: %w",
						table.TableName, colName, err)
				}
			} else {
				// An overlapping discovery may have just registered this field.
				insertQuery := `
                    INSERT INTO system_column_details
                        (table_uid, column_name, data_type, co_number, card_element, show_key_on_card)
                    SELECT $1, $2::text, $3, ` + appendFieldOrder + `, 'details', NULL
                    WHERE EXISTS (
                        SELECT FROM pg_attribute WHERE attrelid = ` + registeredRelation + `
                          AND attname = $2::text AND attnum > 0 AND NOT attisdropped
                    )
                    ON CONFLICT (table_uid, column_name) DO NOTHING
                `
				_, err = q.Exec(
					insertQuery,
					table.TableUID,
					colName,
					col.dataType,
					col.fieldOrder,
				)
				if err != nil {
					return fmt.Errorf("error inserting into system_column_details for table %s, column %s: %w",
						table.TableName, colName, err)
				}
			}
		}

		// Poista sarakkeet, joita ei enää ole
		for colName := range existingMetadata {
			deleteQuery := `
                    DELETE FROM system_column_details
                    WHERE table_uid = $1 AND column_name = $2
                      AND NOT EXISTS (
                          SELECT FROM pg_attribute
                          WHERE attrelid = ` + registeredRelation + `
                            AND attname = $2 AND attnum > 0 AND NOT attisdropped
                      )
                `
			_, err = q.Exec(deleteQuery, table.TableUID, colName)
			if err != nil {
				return fmt.Errorf("error deleting from system_column_details for table %s, column %s: %w",
					table.TableName, colName, err)
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
	marks := row_mutation_policy.RowActorColumns{}
	if len(modifiedCols) > 0 {
		var err error
		marks, err = row_mutation_policy.ReadRowActorColumns(tx, strings.ToLower(sanitizedTableName))
		if err != nil {
			return err
		}
		for _, column := range modifiedCols {
			if marks[strings.ToLower(column.OriginalName)] == "" {
				continue
			}
			if !strings.EqualFold(column.OriginalName, column.NewName) {
				return marks.Protect(column.OriginalName)
			}
			var currentType string
			if err := tx.QueryRow(`SELECT data_type FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
				strings.ToLower(sanitizedTableName), strings.ToLower(column.OriginalName)).Scan(&currentType); err != nil {
				return err
			}
			if column.DataType != "" && !strings.EqualFold(strings.TrimSpace(column.DataType), currentType) {
				return marks.Protect(column.OriginalName)
			}
		}
	}

	for _, mcol := range modifiedCols {
		if marks[strings.ToLower(mcol.OriginalName)] != "" {
			continue // A checked no-op must not rewrite actor constraints.
		}
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

			if err := dtt_2_column_crud.RenameColumnMetadata(tx, sanitizedTableName, sOrigName, sNewName); err != nil {
				return fmt.Errorf("rename metadata for %s.%s: %w", sanitizedTableName, sOrigName, err)
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
