// table_cell_lines_validator.go
// Owns the site's table-cell integer rule and safe reading default.
// Connects generic configuration writers and the public presentation service.
// Keeps one server-side range for every route that can save this setting.
package system_config_checks

import (
	"fmt"
	"strconv"
)

const TableCellMaxLinesKey = "table_cell_max_lines"
const DefaultTableCellMaxLines = 3

// ParseTableCellMaxLines accepts integers from SQL, JSON and generic form writes.
func ParseTableCellMaxLines(value any) (int, error) {
	lines, err := strconv.Atoi(fmt.Sprint(value))
	if err != nil || lines < 1 || lines > 30 {
		return 0, fmt.Errorf("table cell maximum lines must be an integer from 1 to 30")
	}
	return lines, nil
}

func validateTableCellMaxLines(row map[string]interface{}) error {
	if fmt.Sprint(row["value_type"]) != "1" {
		return fmt.Errorf("table cell maximum lines requires integer value type 1")
	}
	_, err := ParseTableCellMaxLines(row["int_value"])
	return err
}
