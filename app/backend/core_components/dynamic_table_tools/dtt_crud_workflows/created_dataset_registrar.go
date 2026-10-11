// created_dataset_registrar.go
// Registers the physical relation made by one dataset creation request.
// Connects creation DDL with its own identity, folder and column metadata.
// Keeps unrelated catalogue repair out of the serialized mutation transaction.
package dtt_crud_workflows

import (
	"fmt"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

func registerCreatedDataset(q dbutils.Querier, tableName string, folderID int) error {
	result, err := q.Exec(`INSERT INTO public.system_db_tables (cached_oid, schema_name, table_name, folder_id)
 SELECT c.oid, n.nspname, c.relname, $2
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.oid=to_regclass($1) AND n.nspname='public' AND c.relkind='r'`,
		pq.QuoteIdentifier("public")+"."+pq.QuoteIdentifier(tableName), folderID)
	if err != nil {
		return fmt.Errorf("register created dataset: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read created dataset registration result: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("created dataset registration expected one relation, got %d", count)
	}
	return nil
}
