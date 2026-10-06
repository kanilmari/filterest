// add_row_insert.go
// Inserts main and owned-child rows after checking their candidate settings.
// Connects normalized add-row payloads to transactional SQL and cache refreshes.
// Exists to share the write boundary while keeping orchestration readable.
package dtt_1_row_create

import (
	"context"
	"database/sql"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
	"easelect/backend/core_components/system_config_checks"
	"fmt"
	"github.com/lib/pq"
	"strings"
)

// insertMainRow lisää päärivin tauluun ja palauttaa luodun rivin id-arvon
// Between: insertDataAccordingToPayload -> Database
// Why: Executes the SQL INSERT for the main row.
func insertMainRow(ctx context.Context, tx *sql.Tx, tableName string, rowData map[string]interface{}, columnTypeMap map[string]string) (int64, error) {
	if err := system_config_checks.ValidateRow(tableName, rowData); err != nil {
		return 0, err
	}
	insertColumns := []string{}
	placeholders := []string{}
	values := []interface{}{}
	i := 1

	for col, val := range rowData {
		insertColumns = append(insertColumns, pq.QuoteIdentifier(col))
		colType := strings.ToLower(columnTypeMap[col])

		// Special handling for geometry columns — PostGIS requires valid WKT.
		// Empty nullable geometry stays NULL so missing data cannot become a
		// plausible but false map location.
		if strings.Contains(colType, "geometry") {
			if normalizedValue, normalizeErr := normalizeGeometryInsertValue(val, true); normalizeErr == nil && normalizedValue == nil {
				placeholders = append(placeholders, "NULL")
				continue
			}
			placeholders = append(placeholders, fmt.Sprintf("ST_GeomFromText($%d, 4326)", i))
			values = append(values, val)
			i++
			continue
		}

		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}

	if len(insertColumns) == 0 {
		return 0, fmt.Errorf("no valid columns to insert in table %s", tableName)
	}

	insertQuery := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s) RETURNING id`,
		pq.QuoteIdentifier(tableName),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	var mainRowID int64
	err := tx.QueryRow(insertQuery, values...).Scan(&mainRowID)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertMainRow] error: %s\033[0m\n", err.Error())
		return 0, err
	}
	if err := dtt_search_vectors.RefreshRowSearchVector(ctx, tx, tableName, mainRowID); err != nil {
		return 0, err
	}
	return mainRowID, nil
}

// insertSingleChildRow lisää yksittäisen lapsirivin child.TableName-tauluun
// ja asettaa referencingColumnin arvoksi mainRowID.
// Palauttaa lisätyn rivin id-arvon (childRowID).
// Between: insertDataAccordingToPayload -> Database
// Why: Executes the SQL INSERT for a child row.
func insertSingleChildRow(tx *sql.Tx, mainRowID int64, child ChildRowPayload, columnTypeMap map[string]string) (int64, error) {
	if child.TableName == "" || child.ReferencingColumn == "" {
		return 0, fmt.Errorf("missing child data field: tableName or referencingColumn")
	}
	if child.Data == nil {
		return 0, nil
	}

	// Poistetaan _file -kenttä, ettei yritetä SQL:ään
	delete(child.Data, "_file")

	// Lisätään viite päärivin ID:hen
	child.Data[child.ReferencingColumn] = mainRowID
	if err := system_config_checks.ValidateRow(child.TableName, child.Data); err != nil {
		return 0, err
	}

	insertColumns := []string{}
	placeholders := []string{}
	values := []interface{}{}
	i := 1

	for col, val := range child.Data {
		insertColumns = append(insertColumns, pq.QuoteIdentifier(col))
		if strings.Contains(strings.ToLower(columnTypeMap[col]), "geometry") {
			if val == nil || strings.TrimSpace(fmt.Sprint(val)) == "" {
				placeholders = append(placeholders, "NULL")
				continue
			}
			placeholders = append(placeholders, fmt.Sprintf("ST_GeomFromText($%d, 4326)", i))
			values = append(values, val)
			i++
			continue
		}
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}

	if len(insertColumns) == 0 {
		return 0, nil
	}

	insertQuery := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s) RETURNING id`,
		pq.QuoteIdentifier(child.TableName),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	var childRowID int64
	err := tx.QueryRow(insertQuery, values...).Scan(&childRowID)
	if err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertSingleChildRow] error: %s\033[0m\n", err.Error())
		return 0, err
	}

	// Child rows are created in the order the form lists them, before any file is
	// saved, so several pictures of a new row keep that order and the first is the card
	// picture; placing them later, in the file map's random order, would lose it.
	_, orderChosen := child.Data["sort_order"]
	if err := dtt_asset_linking.SettleNewGalleryRows(tx, child.TableName, []int64{childRowID}, orderChosen); err != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertSingleChildRow -> SettleNewGalleryRows] error: %s\033[0m\n", err.Error())
		return 0, err
	}

	// Tämän jälkeen (transaktion sisällä) päivitetään mahdolliset cacheTargets
	if cacheErr := updateCacheTargets(tx, child.TableName, child.ReferencingColumn, child.Data); cacheErr != nil {
		fmt.Printf("\033[31m[add_row_db.go] [insertSingleChildRow -> updateCacheTargets] error: %s\033[0m\n", cacheErr.Error())
		return 0, cacheErr
	}

	return childRowID, nil
}
