// foreign_reference_updates.go
// Validates edited foreign keys using the same referenced-row check as add-row.
// Catalog discovery works for runtime roles that do not own the source table.
// Rechecks account references after UPDATE acquires PostgreSQL's FK lock.
package dtt_1_row_update

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"easelect/backend/core_components/httpresponse"
	"github.com/lib/pq"
)

type updatedReference struct {
	table   string
	id      int64
	column  string
	value   interface{}
	columns []string
	values  []interface{}
}

// The handler already holds the source row's mutation lock. Its ID is required
// for composite keys; legacy scalar callers need no source-row lookup.
func validateUpdatedForeignReferences(tx *sql.Tx, table, column string, value interface{}, userID int, role string, sourceRowIDs ...int64) ([]updatedReference, error) {
	if value == nil {
		return nil, nil
	}
	// format() is variadic "any": PostgreSQL cannot infer the table-name
	// parameter's type. This cast is for the identifier, never the FK value;
	// the shared lookup binds that value against the actual target key column.
	rows, err := tx.Query(`SELECT ns.nspname, target.relname, dst.attname
		FROM pg_catalog.pg_constraint fk
		JOIN pg_catalog.pg_class target ON target.oid=fk.confrelid
		JOIN pg_catalog.pg_namespace ns ON ns.oid=target.relnamespace
		CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) AS keys(src,dst)
		JOIN pg_catalog.pg_attribute src ON src.attrelid=fk.conrelid AND src.attnum=keys.src
		JOIN pg_catalog.pg_attribute referenced ON referenced.attrelid=fk.confrelid AND referenced.attnum=keys.dst
		CROSS JOIN LATERAL (SELECT CASE WHEN cardinality(fk.conkey)>1 THEN ''
			ELSE referenced.attname END AS attname) dst
		WHERE fk.contype='f' AND fk.conrelid=to_regclass(format('%I.%I','public',$1::text)) AND src.attname=$2
		ORDER BY fk.oid`, table, column)
	if err != nil {
		return nil, err
	}
	type target struct{ schema, table, column string }
	var targets []target
	for rows.Next() {
		var item target
		if err := rows.Scan(&item.schema, &item.table, &item.column); err != nil {
			rows.Close()
			return nil, err
		}
		targets = append(targets, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var checked []updatedReference
	var compositeKeys []dtt_models.ForeignKeyTuple
	for _, target := range targets {
		if target.column == "" {
			keys, err := read.LoadCompositeForeignKeys(tx, table)
			if err != nil {
				return nil, err
			}
			for _, key := range keys {
				if slices.Contains(key.SourceColumns, column) {
					compositeKeys = append(compositeKeys, key)
				}
			}
			break
		}
	}
	for _, target := range targets {
		if target.column == "" {
			// No component of a composite constraint reaches the scalar resolver.
			if len(sourceRowIDs) != 1 {
				return nil, &httpresponse.Refusal{Status: 400, Message: "source row is required to check a multi-column foreign key"}
			}
			if len(compositeKeys) == 0 {
				return nil, errors.New("multi-column foreign-key metadata changed")
			}
			key := compositeKeys[0]
			compositeKeys = compositeKeys[1:]
			references, err := validateUpdatedCompositeReference(tx, table, sourceRowIDs[0], column, value, key, userID, role)
			if err != nil {
				return nil, err
			}
			checked = append(checked, references...)
			continue
		}
		if target.schema != "public" {
			return nil, referenceUpdateRefusal(read.ErrForeignRowUnreadable)
		}
		id, err := read.CheckReadableForeignReference(tx, target.table, target.column, value, userID, role)
		if err != nil {
			return nil, referenceUpdateRefusal(err)
		}
		checked = append(checked, updatedReference{table: target.table, id: id, column: target.column, value: value})
	}
	return checked, nil
}

func validateUpdatedCompositeReference(tx *sql.Tx, table string, rowID int64, column string, value interface{}, key dtt_models.ForeignKeyTuple, userID int, role string) ([]updatedReference, error) {
	if key.TargetSchema != "public" {
		return nil, referenceUpdateRefusal(read.ErrForeignRowUnreadable)
	}
	columns := make([]string, len(key.SourceColumns))
	values, destinations := make([]interface{}, len(columns)), make([]interface{}, len(columns))
	for i, name := range key.SourceColumns {
		columns[i] = pq.QuoteIdentifier(name)
		destinations[i] = &values[i]
	}
	// The source mutation lock was acquired before any reference locks.
	// Read raw SQL types from that row, then overlay the converted edit.
	query := fmt.Sprintf("SELECT %s FROM %s WHERE id=$1", strings.Join(columns, ","), pq.QuoteIdentifier(table))
	if err := tx.QueryRow(query, rowID).Scan(destinations...); err != nil {
		return nil, err
	}
	containsNull := false
	for i, name := range key.SourceColumns {
		if name == column {
			values[i] = value
		}
		if bytes, ok := values[i].([]byte); ok {
			values[i] = string(bytes)
		}
		containsNull = containsNull || values[i] == nil
	}
	// MATCH SIMPLE has no referenced row when any component is NULL.
	// PostgreSQL itself rejects an invalid partial-NULL MATCH FULL tuple.
	if containsNull {
		return nil, nil
	}
	id, err := read.CheckReadableForeignKeyTuple(tx, key.TargetTable, key.TargetColumns, values, userID, role)
	if err != nil {
		return nil, referenceUpdateRefusal(err)
	}
	return []updatedReference{{table: key.TargetTable, id: id, columns: key.TargetColumns, values: values}}, nil
}

func referenceUpdateRefusal(err error) error {
	status := 0
	if errors.Is(err, read.ErrForeignRowUnreadable) {
		status = 403
	}
	if errors.Is(err, read.ErrForeignRowMissing) {
		status = 400
	}
	if status == 0 {
		return err
	}
	return &httpresponse.Refusal{Status: status, Message: err.Error()}
}

func recheckUpdatedForeignReferences(tx *sql.Tx, references []updatedReference, userID int, role string) error {
	for _, reference := range references {
		if len(reference.columns) > 1 {
			if err := read.RecheckReadableForeignKeyTuple(tx, reference.table, reference.columns, reference.values, userID, role); err != nil {
				return referenceUpdateRefusal(err)
			}
			continue
		}
		if reference.column != "" && reference.column != "id" {
			if err := read.RecheckReadableForeignReference(tx, reference.table, reference.column, reference.value, userID, role); err != nil {
				return referenceUpdateRefusal(err)
			}
			continue
		}
		visible, err := read.RecheckRowsVisibleAfterInsert(tx, reference.table, role, userID, []int64{reference.id})
		if err != nil {
			return err
		}
		if !visible {
			return referenceUpdateRefusal(read.ErrForeignRowUnreadable)
		}
	}
	return nil
}
