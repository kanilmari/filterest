// column_metadata_ddl.go
// Keeps registered field identities synchronized with an explicit column DDL
// operation before a later rename or addition can reuse the same name.
package dtt_2_column_crud

import "database/sql"

// PostgreSQL propagates ALTER TABLE RENAME/DROP to inherited tables. Match each
// physical relation to its own registered dataset, including non-public children.
const affectedColumnTables = `WITH RECURSIVE affected(oid) AS (
    SELECT pg_catalog.to_regclass($1)::oid
    UNION
    SELECT i.inhrelid FROM pg_inherits i JOIN affected ON i.inhparent=affected.oid
), registered AS (
    SELECT d.table_uid, r.oid FROM affected
    JOIN pg_class r USING (oid)
    JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN system_db_tables d ON d.table_name=r.relname
        AND COALESCE(NULLIF(d.schema_name,''),'public')=n.nspname
)
`

func RenameColumnMetadata(tx *sql.Tx, tableName, oldName, newName string) error {
	_, err := tx.Exec(affectedColumnTables+`
        UPDATE system_column_details d SET column_name=lower($3)
        FROM registered r WHERE d.table_uid=r.table_uid AND d.column_name=lower($2)`, tableName, oldName, newName)
	return err
}

func DeleteDroppedColumnMetadata(tx *sql.Tx, tableName, name string) error {
	// A child can retain a locally defined column after its parent drops it.
	_, err := tx.Exec(affectedColumnTables+`
        DELETE FROM system_column_details d USING registered r
        WHERE d.table_uid=r.table_uid AND d.column_name=lower($2) AND NOT EXISTS (
            SELECT FROM pg_attribute a WHERE a.attrelid=r.oid AND a.attname=d.column_name
                AND a.attnum>0 AND NOT a.attisdropped
        )`, tableName, name)
	return err
}
