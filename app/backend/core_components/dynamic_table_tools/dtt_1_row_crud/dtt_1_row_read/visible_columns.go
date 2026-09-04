// visible_columns.go
// Fetches the set of column names visible to the current user.
// Bridges column permission metadata and the query/formatting layers.
// Exists to filter columns by visibility so only permitted data reaches the frontend.
package dtt_1_row_read

import (
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

// getVisibleColumnNames returns column names for the given table
// excluding presentation-hidden and server-only columns in system_column_details.
func getVisibleColumnNames(db dbutils.Querier, tableName string) ([]string, error) {
	const query = `
        SELECT c.column_name
        FROM information_schema.columns c
        LEFT JOIN system_column_details scd
               ON scd.column_name = c.column_name
              AND scd.table_uid = (
                  SELECT table_uid FROM system_db_tables WHERE table_name = $1
              )
        WHERE c.table_schema = 'public'
          AND c.table_name = $1
	      AND (
	          COALESCE(scd.hide_everywhere, false) = false
	          OR c.column_name = 'id'
	      )
	      AND COALESCE(scd.client_delivery_mode, 'include') = 'include'
          AND c.column_name NOT IN ('embedding_vector', 'search_vector_simple')
        ORDER BY c.ordinal_position`
	rows, err := db.Query(query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	return cols, rows.Err()
}

// buildSelectColumns builds a comma-separated list of quoted columns
// prefixed with the table name for use in SELECT statements.
func buildSelectColumns(tableName string, columns []string) string {
	if len(columns) == 0 {
		return fmt.Sprintf("%s.*", pq.QuoteIdentifier(tableName))
	}
	parts := make([]string, len(columns))
	for i, c := range columns {
		parts[i] = fmt.Sprintf("%s.%s", pq.QuoteIdentifier(tableName), pq.QuoteIdentifier(c))
	}
	return strings.Join(parts, ", ")
}

// appendRequiredClientTransportColumnUIDs keeps row identity in the response
// payload even when a view hides it from presentation. The frontend can omit
// the field visually while row links, actions, and updates retain a stable key.
func appendRequiredClientTransportColumnUIDs(
	columnsMap map[int]dtt_models.ColumnInfo,
	columnUIDs []int,
) []int {
	selected := make(map[int]struct{}, len(columnUIDs))
	for _, columnUID := range columnUIDs {
		selected[columnUID] = struct{}{}
	}
	for columnUID, column := range columnsMap {
		if column.ColumnName != "id" {
			continue
		}
		if _, exists := selected[columnUID]; !exists {
			columnUIDs = append(columnUIDs, columnUID)
		}
		break
	}
	return columnUIDs
}

// filterTransportOnlyColumnsFromPresentation keeps required row identity in
// each data object while omitting it from the renderable column list when the
// active view field collection hides it. Row actions can still use row.id.
func filterTransportOnlyColumnsFromPresentation(
	resultColumns []string,
	presentationColumns []string,
) []string {
	presentationSet := make(map[string]struct{}, len(presentationColumns))
	for _, columnName := range presentationColumns {
		presentationSet[columnName] = struct{}{}
	}
	filtered := make([]string, 0, len(resultColumns))
	for _, columnName := range resultColumns {
		if columnName == "id" {
			if _, visible := presentationSet[columnName]; !visible {
				continue
			}
		}
		filtered = append(filtered, columnName)
	}
	return filtered
}
