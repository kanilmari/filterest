// add_row_composite_foreign_keys.go
// Authorizes new rows' complete multi-column foreign keys.
// Connects server-owned constraint metadata with the converted insert values.
// Prevents one visible key component from authorizing a hidden target tuple.
package dtt_1_row_create

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	backend "easelect/backend/core_components"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// Preserve existing form metadata while carrying the complete constraint only
// on the server. No component of such a metadata row may use scalar validation.
func attachCompositeForeignKeys(columns []dtt_models.AddRowColumnInfo, tableUID string) ([]dtt_models.AddRowColumnInfo, error) {
	var keys []dtt_models.ForeignKeyTuple
	for i := range columns {
		column := &columns[i]
		if !column.IsCompositeForeignKey {
			continue
		}
		if keys == nil {
			table, err := getTableNameFromUID(tableUID, backend.Db)
			if err != nil {
				return nil, err
			}
			keys, err = read.LoadCompositeForeignKeys(backend.Db, table)
			if err != nil {
				return nil, err
			}
		}
		for _, key := range keys {
			if key.TargetSchema != column.ForeignTableSchema || key.TargetTable != column.ForeignTableName || !slices.Contains(key.SourceColumns, column.ColumnName) {
				continue
			}
			column.CompositeForeignKeys = append(column.CompositeForeignKeys, key)
			index := slices.Index(key.SourceColumns, column.ColumnName)
			column.ForeignColumnName = key.TargetColumns[index]
		}
		if len(column.CompositeForeignKeys) == 0 {
			return nil, errors.New("multi-column foreign-key metadata changed")
		}
	}
	return columns, nil
}

func validateMainCompositeForeignKey(tx *sql.Tx, key dtt_models.ForeignKeyTuple, columns []dtt_models.AddRowColumnInfo, row map[string]interface{}, userID int, role string) (*checkedReference, error) {
	values := make([]interface{}, len(key.SourceColumns))
	containsNull := false
	for i, column := range key.SourceColumns {
		value, supplied := row[column]
		if !supplied {
			index := slices.IndexFunc(columns, func(info dtt_models.AddRowColumnInfo) bool { return info.ColumnName == column })
			if index < 0 || (columns[index].IsNullable != "YES" && columns[index].IsNullable != "NO") {
				return nil, fmt.Errorf("cannot determine insert value for omitted multi-column foreign-key column %s: missing column metadata", column)
			}
			info := columns[index]
			if info.ColumnDefault != "" || info.GenerationExpression != "" || strings.EqualFold(info.IsIdentity, "YES") {
				return nil, fmt.Errorf("cannot check omitted multi-column foreign-key column %s: default or generated insert value requires an explicit value", column)
			}
			// With no default or generator, INSERT supplies SQL NULL. Leave the
			// row unchanged so authorization and the actual INSERT agree.
			value = nil
		}
		values[i] = value
		containsNull = containsNull || value == nil
	}
	// Any NULL bypasses MATCH SIMPLE; all NULLs also bypass MATCH FULL.
	// PostgreSQL refuses partial-NULL MATCH FULL tuples at INSERT, without
	// resolving or authorizing a target from only part of its key.
	if containsNull {
		return nil, nil
	}
	if key.TargetSchema != "public" {
		return nil, &forbiddenError{msg: foreignRowUnreadable}
	}
	id, err := read.CheckReadableForeignKeyTuple(tx, key.TargetTable, key.TargetColumns, values, userID, role)
	if errors.Is(err, read.ErrForeignRowUnreadable) {
		return nil, &forbiddenError{msg: foreignRowUnreadable}
	}
	if err != nil {
		return nil, err
	}
	return &checkedReference{tableName: key.TargetTable, rowID: id, keyColumns: key.TargetColumns, keyValues: values}, nil
}
