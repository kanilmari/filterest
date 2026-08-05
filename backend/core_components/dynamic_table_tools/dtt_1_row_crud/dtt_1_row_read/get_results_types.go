// get_results_types.go
// Defines shared data structures for the get-results process.
// Bridges the metadata, query, and formatting layers with type-safe structs.
// Exists to provide common types for user settings, column metadata, and query parameters.
package dtt_1_row_read

import (
	"net/url"

	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// UserColumnSetting on pieni struct system_user_column_settings -riville
type UserColumnSetting struct {
	ColumnName  string `json:"column_name"`
	SortOrder   int    `json:"sort_order"`
	ColumnWidth int    `json:"column_width_px"`
	IsHidden    bool   `json:"is_hidden"`
}

// QueryBuilderContext holds all the information needed to build the SELECT query.
type QueryBuilderContext struct {
	DB              dbutils.Querier
	TableName       string
	ColumnsMap      map[int]dtt_models.ColumnInfo
	VisibleColUIDs  []int
	QueryParams     url.Values
	ColumnDataTypes map[string]interface{}
	ResultsPerLoad  int
	Offset          int
	UserID          int
	UserRole        string
	ReadPolicy      ReadRowPolicy
	ClientRowCount  int // -1 = execute COUNT(*), >= 0 = use this value
}
