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
	// ReportOnly counts what each enabled rule would remove and removes
	// nothing. An administrator's permission settings are their own data:
	// startup says what it believes is stale and leaves the decision to a
	// person, because a grant deleted on boot is gone without a record of
	// what it was.
	ReportOnly bool
}

// removeOrReport deletes the rows one rule matches, or counts them and leaves
// them in place. The same predicate serves both so a report can never describe
// something different from what an approved removal would do.
func removeOrReport(db *sql.DB, opts PermissionCleanupOptions, rule, predicate string) error {
	if opts.ReportOnly {
		var affected int
		if err := db.QueryRow(`SELECT COUNT(*) FROM system_group_table_func_rights agr WHERE ` + predicate).Scan(&affected); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return err
		}
		if affected > 0 {
			log.Printf("\033[33m[permissions] %d permission(s) look stale (%s) and were NOT removed. Review them, then start once with FILTEREST_APPLY_PERMISSION_CLEANUP=1 to remove them.\033[0m", affected, rule)
		}
		return nil
	}
	res, err := db.Exec(`DELETE FROM system_group_table_func_rights agr WHERE ` + predicate)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return err
	}
	rows, _ := res.RowsAffected()
	log.Printf("removed %d permissions (%s)", rows, rule)
	return nil
}

// CleanGroupTableFuncRights poistaa system_group_table_func_rights -taulusta
// virheelliset rivit annettujen asetusten mukaisesti.
func CleanGroupTableFuncRights(db *sql.DB, opts PermissionCleanupOptions) error {
	if opts.RemoveMissingTables {
		if err := removeOrReport(db, opts, "the dataset no longer exists", `
          agr.target_table_uid IS NOT NULL
          AND NOT EXISTS (
                SELECT 1
                FROM system_db_tables sdt
                JOIN information_schema.tables t
                  ON t.table_schema = sdt.schema_name AND t.table_name = sdt.table_name
                WHERE sdt.table_uid = agr.target_table_uid
          )`); err != nil {
			return err
		}
	}

	if opts.RemoveDisabledFuncs {
		// A renamed handler lands here: its old row is disabled, and every grant
		// an administrator made for that address hangs on it. This is the rule
		// that used to erase them without a word.
		if err := removeOrReport(db, opts, "the route behind them is gone or disabled", `
          NOT EXISTS (
                SELECT 1
                FROM system_functions f
                WHERE f.id = agr.function_id
                  AND f.disabled = false
          )`); err != nil {
			return err
		}
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

		// Flipping a route's dataset scope, in either direction, lands every
		// grant for it here. The scope is decided by a guess from a package
		// name, so this rule must not act on its own either.
		if err := removeOrReport(db, opts, fmt.Sprintf("their dataset scope disagrees with the route (missing: %d, extra: %d)", missingUIDCount, extraUIDCount), `
          EXISTS (
                SELECT 1
                FROM system_functions f
                WHERE f.id = agr.function_id
                  AND (
                        (f.specific_table_related = true AND agr.target_table_uid IS NULL)
                     OR (f.specific_table_related = false AND agr.target_table_uid IS NOT NULL)
                  )
          )`); err != nil {
			return err
		}
	}
	return nil
}
