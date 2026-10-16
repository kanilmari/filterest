// composite_foreign_reference.go
// Discovers complete multi-column keys for row-mutation authorization.
// Connects PostgreSQL's ordered constraint columns to add-row and update-row.
// Keeps partial keys out of target resolution and row locking.
package dtt_1_row_read

import (
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

// LoadCompositeForeignKeys reads catalog metadata even when the runtime actor
// does not own the source table. Ordering is stable and no data rows are locked.
func LoadCompositeForeignKeys(q dbutils.Querier, table string) ([]dtt_models.ForeignKeyTuple, error) {
	rows, err := q.Query(`SELECT fk.oid::bigint, ns.nspname, target.relname,
		array_agg(src.attname::text ORDER BY keys.ord), array_agg(dst.attname::text ORDER BY keys.ord)
		FROM pg_catalog.pg_constraint fk
		JOIN pg_catalog.pg_class target ON target.oid=fk.confrelid
		JOIN pg_catalog.pg_namespace ns ON ns.oid=target.relnamespace
		CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) WITH ORDINALITY AS keys(src,dst,ord)
		JOIN pg_catalog.pg_attribute src ON src.attrelid=fk.conrelid AND src.attnum=keys.src
		JOIN pg_catalog.pg_attribute dst ON dst.attrelid=fk.confrelid AND dst.attnum=keys.dst
		WHERE fk.contype='f' AND cardinality(fk.conkey)>1
		AND fk.conrelid=to_regclass(format('%I.%I','public',$1::text))
		GROUP BY fk.oid,ns.nspname,target.relname ORDER BY fk.oid`, table)
	if err != nil {
		return nil, fmt.Errorf("load composite foreign keys: %w", err)
	}
	defer rows.Close()
	var keys []dtt_models.ForeignKeyTuple
	for rows.Next() {
		var key dtt_models.ForeignKeyTuple
		if err := rows.Scan(&key.ConstraintID, &key.TargetSchema, &key.TargetTable,
			pq.Array(&key.SourceColumns), pq.Array(&key.TargetColumns)); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// foreignKeyPredicate binds each value against its actual target column type.
// It retains the single-column SQL contract while composite keys use SQL row
// equality, so PostgreSQL rechecks the entire tuple after waiting for a lock.
func foreignKeyPredicate(table string, columns []string, offset int) string {
	names, values := make([]string, len(columns)), make([]string, len(columns))
	for i, column := range columns {
		names[i] = pq.QuoteIdentifier(column)
		if table != "" {
			names[i] = pq.QuoteIdentifier(table) + "." + names[i]
		}
		values[i] = fmt.Sprintf("$%d", offset+i)
	}
	if len(columns) == 1 {
		return names[0] + " = " + values[0]
	}
	return "(" + strings.Join(names, ",") + ") = (" + strings.Join(values, ",") + ")"
}
