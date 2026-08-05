// permissions_cleanup.go
// Handles cleanup operations for permission records stored in the database.
// Removes invalid, orphaned, or mismatched entries such as permissions referencing
// non-existent tables, disabled functions, or incorrect user IDs.
package backend

import (
	"database/sql"
	"fmt"
	"log"
)

// PermissionCleanupOptions määrittelee suoritettavat tarkistukset.
type PermissionCleanupOptions struct {
	RemoveMissingTables bool
	RemoveDisabledFuncs bool
	RemoveMismatchedUID bool
}

// CleanGroupTableFuncRights poistaa system_group_table_func_rights -taulusta
// virheelliset rivit annettujen asetusten mukaisesti.
func CleanGroupTableFuncRights(db *sql.DB, opts PermissionCleanupOptions) error {
	if opts.RemoveMissingTables {
		delQuery := `
        DELETE FROM system_group_table_func_rights agr
        WHERE agr.target_table_uid IS NOT NULL
          AND NOT EXISTS (
                SELECT 1
                FROM system_db_tables sdt
                JOIN information_schema.tables t
                  ON t.table_schema = sdt.schema_name AND t.table_name = sdt.table_name
                WHERE sdt.table_uid = agr.target_table_uid
          )`
		res, err := db.Exec(delQuery)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}
		rows, _ := res.RowsAffected()
		log.Printf("removed %d permissions due to missing tables", rows)
	}

	if opts.RemoveDisabledFuncs {
		delQuery := `
        DELETE FROM system_group_table_func_rights agr
        WHERE NOT EXISTS (
                SELECT 1
                FROM system_functions f
                WHERE f.id = agr.function_id
                  AND f.disabled = false
        )`
		res, err := db.Exec(delQuery)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}
		rows, _ := res.RowsAffected()
		log.Printf("removed %d permissions due to missing or disabled functions", rows)
	}

	if opts.RemoveMismatchedUID {
		var missingUIDCount int
		err := db.QueryRow(`
                SELECT COUNT(*)
                FROM system_group_table_func_rights gf
                JOIN system_functions f ON gf.function_id = f.id
                WHERE f.specific_table_related = true AND gf.target_table_uid IS NULL
        `).Scan(&missingUIDCount)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}

		var extraUIDCount int
		err = db.QueryRow(`
                SELECT COUNT(*)
                FROM system_group_table_func_rights gf
                JOIN system_functions f ON gf.function_id = f.id
                WHERE f.specific_table_related = false AND gf.target_table_uid IS NOT NULL
        `).Scan(&extraUIDCount)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}

		delQuery := `
        DELETE FROM system_group_table_func_rights gf
        USING system_functions f
        WHERE gf.function_id = f.id
          AND (
                (f.specific_table_related = true AND gf.target_table_uid IS NULL)
             OR (f.specific_table_related = false AND gf.target_table_uid IS NOT NULL)
          )`
		res, err := db.Exec(delQuery)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}
		rows, _ := res.RowsAffected()
		log.Printf("removed %d permissions due to incorrect table_uid (missing: %d, extra: %d)", rows, missingUIDCount, extraUIDCount)
	}
	return nil
}
