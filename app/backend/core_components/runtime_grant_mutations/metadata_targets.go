// metadata_targets.go
// Captures a generic metadata writer's own dataset targets before mutation.
// Complements snapshot differences for no-op edits and already-invalid rows.
// Includes removed relation endpoints without taking any row locks before the barrier.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"

	"github.com/lib/pq"
)

func targetColumns(table string) []string {
	switch table {
	case "system_db_tables", "system_column_details":
		return []string{"table_uid"}
	case "system_group_table_func_rights":
		return []string{"target_table_uid"}
	case "system_foreign_key_relations_1_m":
		return []string{"source_table_uid", "target_table_uid"}
	case "system_foreign_key_relations_m_m":
		return []string{"table_a_uid", "table_b_uid", "bridging_table_uid"}
	}
	return nil
}

func (m *Mutation) IncludeValues(table string, values map[string]interface{}) {
	if m == nil {
		return
	}
	for _, column := range targetColumns(table) {
		uid, _ := strconv.ParseInt(fmt.Sprint(values[column]), 10, 64)
		if uid > 0 {
			m.targets = append(m.targets, uid)
		}
	}
	if table == "system_triggers" {
		for _, field := range []string{"source_table", "target_table"} {
			for _, object := range m.before.Objects {
				if object.Schema == "public" && object.Name == fmt.Sprint(values[field]) && object.DatasetUID > 0 {
					m.targets = append(m.targets, object.DatasetUID)
				}
			}
		}
	}
}

func (m *Mutation) IncludeRows(ctx context.Context, table string, ids ...int64) error {
	if m == nil {
		return nil
	}
	for _, id := range ids {
		if table == "system_functions" || table == "system_user_groups" {
			for _, right := range m.before.Rights {
				if table == "system_functions" && right.FunctionID == id || table == "system_user_groups" && right.GroupID == id {
					m.targets = append(m.targets, right.DatasetUID)
				}
			}
		}
		for _, column := range targetColumns(table) {
			var uid sql.NullInt64
			query := "SELECT " + pq.QuoteIdentifier(column) + " FROM " + pq.QuoteIdentifier("public") + "." + pq.QuoteIdentifier(table) + " WHERE " + pq.QuoteIdentifier("id") + "=$1"
			if err := m.Tx.QueryRowContext(ctx, query, id).Scan(&uid); err != nil {
				if err == sql.ErrNoRows {
					continue
				}
				return err
			}
			if uid.Valid && uid.Int64 > 0 {
				m.targets = append(m.targets, uid.Int64)
			}
		}
		if table == "system_triggers" {
			var source, target sql.NullString
			if err := m.Tx.QueryRowContext(ctx, `SELECT source_table,target_table FROM public.system_triggers WHERE id=$1`, id).Scan(&source, &target); err != nil {
				if err == sql.ErrNoRows {
					continue
				}
				return err
			}
			m.IncludeValues(table, map[string]interface{}{"source_table": source.String, "target_table": target.String})
		}
	}
	return nil
}
