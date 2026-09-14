// new_column_field_sets.go
// Gives genuinely added columns visible membership in existing dataset field sets.
// Bridges ModifyColumnsHandler's DDL/metadata transaction with saved presentation lists.
// Preserves every previous hidden choice, member order and width.
package dtt_2_column_update

import (
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"
	"github.com/lib/pq"
)

// AppendNewColumnsToFieldSets must run in the same transaction as successful
// ALTER TABLE ADD COLUMN and metadata refresh. columns names only those additions,
// never all known columns or a metadata-reconciliation inventory.
func AppendNewColumnsToFieldSets(q dbutils.Querier, tableName string, columns []string) error {
	if len(columns) == 0 {
		return nil
	}
	if _, err := security.SanitizeIdentifier(tableName); err != nil {
		return err
	}
	// AddNewColumns emits unquoted identifiers, which PostgreSQL folds to lower case.
	tableName = strings.ToLower(tableName)
	names := make([]string, 0, len(columns))
	expected := make(map[string]bool, len(columns))
	for _, name := range columns {
		if _, err := security.SanitizeIdentifier(name); err != nil {
			return err
		}
		name = strings.ToLower(name)
		if expected[name] {
			return fmt.Errorf("duplicate newly added column: %s", name)
		}
		expected[name] = true
		names = append(names, name)
	}
	rows, err := q.Query(`
        SELECT tables.table_uid, details.column_uid, details.column_name
        FROM public.system_db_tables AS tables
        JOIN public.system_column_details AS details ON details.table_uid = tables.table_uid
        WHERE tables.table_name = $1
          AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
          AND details.column_name = ANY($2)
        ORDER BY details.co_number NULLS LAST, details.column_uid`, tableName, pq.Array(names))
	if err != nil {
		return fmt.Errorf("resolve newly added field metadata: %w", err)
	}
	var tableUID int
	columnUIDs := make([]int, 0, len(names))
	found := make(map[string]bool, len(names))
	for rows.Next() {
		var rowTableUID, columnUID int
		var name string
		if err := rows.Scan(&rowTableUID, &columnUID, &name); err != nil {
			rows.Close()
			return fmt.Errorf("read newly added field metadata: %w", err)
		}
		if rowTableUID <= 0 || columnUID <= 0 || !expected[name] || found[name] ||
			(tableUID != 0 && tableUID != rowTableUID) {
			rows.Close()
			return fmt.Errorf("newly added field metadata does not match the dataset")
		}
		tableUID = rowTableUID
		found[name] = true
		columnUIDs = append(columnUIDs, columnUID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate newly added field metadata: %w", err)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(found) != len(expected) {
		return fmt.Errorf("metadata missing for one or more newly added columns in %s", tableName)
	}

	// Field-set save also locks its parent row before replacing members. Lock all
	// affected parents first so simultaneous appends cannot allocate the same order.
	sets, err := q.Query(`
        SELECT id
        FROM public.system_column_field_sets
        WHERE table_uid = $1
        ORDER BY id
        FOR UPDATE`, tableUID)
	if err != nil {
		return fmt.Errorf("lock dataset field sets: %w", err)
	}
	fieldSetIDs := []int64{}
	for sets.Next() {
		var id int64
		if err := sets.Scan(&id); err != nil {
			sets.Close()
			return fmt.Errorf("read dataset field sets: %w", err)
		}
		fieldSetIDs = append(fieldSetIDs, id)
	}
	if err := sets.Err(); err != nil {
		sets.Close()
		return fmt.Errorf("iterate dataset field sets: %w", err)
	}
	if err := sets.Close(); err != nil {
		return err
	}
	for _, fieldSetID := range fieldSetIDs {
		_, err := q.Exec(`
            WITH missing AS (
                SELECT additions.column_uid, additions.ordinal
                FROM unnest($3::integer[]) WITH ORDINALITY AS additions(column_uid, ordinal)
                WHERE NOT EXISTS (
                    SELECT 1 FROM public.system_column_field_set_members AS existing
                    WHERE existing.field_set_id = $1 AND existing.column_uid = additions.column_uid
                )
            )
            INSERT INTO public.system_column_field_set_members
                (field_set_id, table_uid, column_uid, sort_order)
            SELECT $1, $2, missing.column_uid,
                   COALESCE((
                       SELECT max(existing.sort_order)
                       FROM public.system_column_field_set_members AS existing
                       WHERE existing.field_set_id = $1
                   ), 0) + row_number() OVER (ORDER BY missing.ordinal)
            FROM missing
            ORDER BY missing.ordinal`, fieldSetID, tableUID, pq.Array(columnUIDs))
		if err != nil {
			return fmt.Errorf("append new columns to field set %d: %w", fieldSetID, err)
		}
	}
	return nil
}
