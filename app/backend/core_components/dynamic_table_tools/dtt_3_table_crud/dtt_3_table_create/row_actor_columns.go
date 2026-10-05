// row_actor_columns.go
// Adds actor columns after ordinary dataset metadata has been synchronized.
// Connects dataset creation to the row-actor migration's SQL functions.
// Leaves side-table classification and schema rules in their SQL authority.
package dtt_3_table_create

import (
	"database/sql"
	"fmt"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

// EnsureRowActorColumns runs after UpdateColumnMetadata and before card roles.
// The SQL registration supplies hidden, non-insertable actor metadata and uses
// the stable table_uid, never the registry row's unrelated primary key.
func EnsureRowActorColumns(q dbutils.Querier, tableName string) error {
	var reason sql.NullString
	if err := q.QueryRow(`SELECT public.app_row_actor_side_table_reason($1)`, tableName).Scan(&reason); err != nil {
		return fmt.Errorf("classify actor columns: %w", err)
	}
	if reason.Valid {
		return nil
	}
	target := "public." + pq.QuoteIdentifier(tableName)
	for _, function := range []string{"app_ensure_row_actor_columns", "app_ensure_row_actor_constraints"} {
		if _, err := q.Exec("SELECT public."+function+"($1::regclass, $2::text)", target, "owner_id"); err != nil {
			return fmt.Errorf("%s: %w", function, err)
		}
	}
	var tableUID int
	if err := q.QueryRow(`SELECT table_uid FROM public.system_db_tables
		WHERE schema_name = 'public' AND table_name = $1`, tableName).Scan(&tableUID); err != nil {
		return fmt.Errorf("read new dataset table_uid: %w", err)
	}
	if _, err := q.Exec(`SELECT public.app_register_row_actor_columns($1::integer, $2::text)`, tableUID, "owner_id"); err != nil {
		return fmt.Errorf("register actor columns: %w", err)
	}
	return nil
}
