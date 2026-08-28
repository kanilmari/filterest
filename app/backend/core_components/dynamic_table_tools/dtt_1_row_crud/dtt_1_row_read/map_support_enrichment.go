// map_support_enrichment.go
// Enriches get-results rows with hidden geometry fields only when map view asks for them.
// Bridges the normal visible-column query and the map renderer without changing default table payloads.
// Exists so location tables can stay compact while map view still receives coordinates.
package dtt_1_row_read

import (
	"fmt"
	"log"
	"strings"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

func filterAllowedGeometryColumns(geometryColumns []string, allowedColumns map[string]bool) []string {
	if len(geometryColumns) == 0 || len(allowedColumns) == 0 {
		return nil
	}

	filteredColumns := make([]string, 0, len(geometryColumns))
	seen := make(map[string]bool, len(geometryColumns))
	for _, columnName := range geometryColumns {
		trimmedColumn := strings.TrimSpace(columnName)
		if trimmedColumn == "" || seen[trimmedColumn] || !allowedColumns[trimmedColumn] {
			continue
		}
		seen[trimmedColumn] = true
		filteredColumns = append(filteredColumns, trimmedColumn)
	}
	return filteredColumns
}

func logMapSupportEnrichmentWarning(tableName string, err error) {
	if err == nil {
		return
	}
	log.Printf(
		"\033[33mwarning: map support enrichment for %s skipped: %s\033[0m\n",
		tableName,
		err.Error(),
	)
}

func enrichRowsWithMapSupportColumns(
	readQuerier dbutils.Querier,
	tableName string,
	rows []map[string]interface{},
	geometryColumns []string,
) error {
	if len(rows) == 0 || len(geometryColumns) == 0 {
		return nil
	}

	rowIDs := collectCardSupportRowIDs(rows)
	if len(rowIDs) == 0 {
		return nil
	}

	geometryRows, err := fetchMapSupportRows(readQuerier, tableName, geometryColumns, rowIDs)
	if err != nil {
		return err
	}

	geometryByID := make(map[string]map[string]interface{}, len(geometryRows))
	for _, geometryRow := range geometryRows {
		geometryByID[fmt.Sprint(geometryRow["id"])] = geometryRow
	}

	for _, row := range rows {
		geometryRow, ok := geometryByID[fmt.Sprint(row["id"])]
		if !ok {
			continue
		}
		for _, columnName := range geometryColumns {
			if value, exists := geometryRow[columnName]; exists {
				row[columnName] = value
			}
		}
	}

	return nil
}

func fetchMapSupportRows(
	querier dbutils.Querier,
	tableName string,
	geometryColumns []string,
	rowIDs []int64,
) ([]map[string]interface{}, error) {
	query, queryArgs := buildMapSupportRowsQuery(tableName, geometryColumns, rowIDs)
	if querier == nil || query == "" {
		return nil, nil
	}

	supportRows, err := querier.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer supportRows.Close()

	_, formattedRows, err := FormatRowsToMaps(supportRows)
	if err != nil {
		return nil, err
	}

	return formattedRows, nil
}

func buildMapSupportRowsQuery(
	tableName string,
	geometryColumns []string,
	rowIDs []int64,
) (string, []interface{}) {
	if strings.TrimSpace(tableName) == "" || len(geometryColumns) == 0 || len(rowIDs) == 0 {
		return "", nil
	}

	selectParts := make([]string, 0, len(geometryColumns)+1)
	selectParts = append(
		selectParts,
		fmt.Sprintf(`%s.%s AS %s`, pq.QuoteIdentifier(tableName), pq.QuoteIdentifier("id"), pq.QuoteIdentifier("id")),
	)
	for _, columnName := range geometryColumns {
		trimmedColumn := strings.TrimSpace(columnName)
		if trimmedColumn == "" {
			continue
		}
		selectParts = append(
			selectParts,
			fmt.Sprintf(
				`%s.%s::text AS %s`,
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(trimmedColumn),
				pq.QuoteIdentifier(trimmedColumn),
			),
		)
	}
	if len(selectParts) == 1 {
		return "", nil
	}

	placeholders := make([]string, 0, len(rowIDs))
	queryArgs := make([]interface{}, 0, len(rowIDs))
	for idx, rowID := range rowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT %s FROM %s WHERE %s.%s IN (%s)`,
		strings.Join(selectParts, ", "),
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier(tableName),
		pq.QuoteIdentifier("id"),
		strings.Join(placeholders, ", "),
	)

	return query, queryArgs
}
