// catalogue_refresh_reader.go
// Detects structural metadata drift without opening a policy mutation.
// Connects automatic administrator bootstrap to its existing maintenance writer.
// Avoids whole-catalogue refresh and reconciliation when startup made it current.
package system_table_tools

import (
	"context"
	"database/sql"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"github.com/lib/pq"
)

func catalogueRefreshRequired(ctx context.Context, db *sql.DB) (bool, error) {
	var changed bool
	err := db.QueryRowContext(ctx, catalogueRefreshRequiredSQL, pq.Array(row_mutation_policy.InternalRegistryTables)).Scan(&changed)
	return changed, err
}

// Match the maintenance writer's public/visible relation discovery and column
// defaults. No row/reference locks or advisory locks belong in this read.
const catalogueRefreshRequiredSQL = `WITH registered AS (
 SELECT d.*,CASE WHEN d.table_name IS NULL OR d.table_name='' THEN NULL::oid ELSE
 to_regclass(format('%I.%I',COALESCE(NULLIF(d.schema_name,''),'public'),d.table_name))::oid END AS actual_oid
 FROM public.system_db_tables d
), columns AS (
 SELECT d.table_uid,a.attname,a.attnum,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type
 FROM registered d JOIN pg_attribute a ON a.attrelid=d.actual_oid
 WHERE a.attnum>0 AND NOT a.attisdropped
)
SELECT EXISTS(
 SELECT 1 FROM registered d WHERE d.actual_oid IS NULL OR d.table_uid IS NULL
 OR d.cached_oid IS DISTINCT FROM d.actual_oid OR d.schema_name IS NULL
 UNION ALL
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema','restricted','postgis')
 AND has_schema_privilege(n.nspname,'USAGE') AND has_table_privilege(c.oid,'SELECT')
 AND NOT (n.nspname='public' AND c.relname=ANY($1::text[]))
 AND NOT EXISTS(SELECT 1 FROM registered d WHERE d.table_name=c.relname AND d.schema_name=n.nspname)
 UNION ALL
 SELECT 1 FROM columns c FULL JOIN public.system_column_details m
 ON m.table_uid=c.table_uid AND m.column_name=c.attname
 WHERE c.table_uid IS NULL OR m.column_uid IS NULL
 OR m.data_type IS DISTINCT FROM c.data_type OR m.co_number IS DISTINCT FROM c.attnum
 OR m.card_element IS NULL OR m.card_element=''
)`
