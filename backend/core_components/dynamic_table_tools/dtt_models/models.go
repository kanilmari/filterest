// models.go
// Defines shared model structs and data types used across the dynamic table tools packages.
// Provides canonical type definitions consumed by handlers, query builders, and metadata helpers.
// Exists to keep dynamic-table JSON and metadata shapes consistent across packages.
package dtt_models

import "database/sql"

type Table struct {
	ID                         int     `json:"id"`
	TableName                  string  `json:"dataset_name"`
	CanReadRows                bool    `json:"can_read_rows"`
	IsDefault                  bool    `json:"is_default"`
	FilterbarVisibleByDefault  bool    `json:"filterbar_visible_by_default"`
	IsMainTable                *bool   `json:"is_main_table,omitempty"`
	IsAboutTable               *bool   `json:"is_about_table,omitempty"`
	FolderID                   *int    `json:"folder_id,omitempty"`
	IsInCurrentProject         bool    `json:"is_in_current_project"`
	IsTopLevelInCurrentProject bool    `json:"is_top_level_in_current_project"`
	IconKey                    *string `json:"icon_key,omitempty"`
}

type GroupedTables struct {
	Content []Table `json:"Sisältö,omitempty"`
	Ref     []Table `json:"Aputaulut,omitempty"`
	Child   []Table `json:"Alitaulut,omitempty"`
	System  []Table `json:"Asetukset,omitempty"`
	Auth    []Table `json:"Käyttöoikeudet,omitempty"`
	Dev     []Table `json:"Kehitys,omitempty"`
}

type ColumnInfo struct {
	ColumnUid      int
	ColumnName     string
	DataType       string
	CoNumber       int
	IsNullable     string
	IsIdentity     string
	ColumnDefault  sql.NullString
	CardElement    string
	IsMultilingual bool
	// showKeyOnCard bool
}

type TableReadMeta struct {
	CardDetailsLayout string `json:"card_details_layout"`
	CardStyleVariant  string `json:"card_style_variant"`
}

type AddRowColumnInfo struct {
	ColumnName                string       `json:"column_name"`
	DataType                  string       `json:"data_type"`
	IsNullable                string       `json:"is_nullable"`
	ColumnDefault             string       `json:"column_default"`
	IsIdentity                string       `json:"is_identity"`
	GenerationExpression      string       `json:"generation_expression"`
	ForeignTableSchema        string       `json:"foreign_table_schema,omitempty"`
	ForeignTableName          string       `json:"foreign_dataset_name,omitempty"`
	ForeignColumnName         string       `json:"foreign_column_name,omitempty"`
	UdtName                   string       `json:"udt_name"`
	InsertNewSourceWithTarget sql.NullBool `json:"insert_new_source_with_target"`
	InsertNewTargetWithSource sql.NullBool `json:"insert_new_target_with_source"`
	SourceInsertSpecs         string       `json:"source_insert_specs"`
	TargetInsertSpecs         string       `json:"target_insert_specs"`
	Insertable                sql.NullBool `json:"insertable"`
}
