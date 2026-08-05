// get_tables_visible_to_user.go
// Queries the database for the list of tables the current user may view.
// Bridges the permissions database and the access-control stage's visible-tables set.
// Exists to centralise the per-user table visibility query for the access-control pipeline stage.
package access_control

import "database/sql"

// GetTablesVisibleToUser returns table_uids that user can access via any function.
// Returns nil map for admins, which callers should interpret as "all tables visible".
func GetTablesVisibleToUser(db *sql.DB, userID int) (map[int]bool, error) {
	if userIsAdmin(userID) {
		return nil, nil
	}

	queryRows, queryError := db.Query(`
		SELECT DISTINCT gf.target_table_uid
		FROM system_group_table_func_rights gf
		JOIN system_user_group_memberships ug ON gf.user_group_id = ug.group_id
		WHERE ug.user_id = $1
		  AND gf.target_table_uid IS NOT NULL
	`, userID)
	if queryError != nil {
		return nil, queryError
	}
	defer queryRows.Close()

	visibleTableUIDs := make(map[int]bool)
	for queryRows.Next() {
		var tableUID int
		if scanError := queryRows.Scan(&tableUID); scanError != nil {
			return nil, scanError
		}
		visibleTableUIDs[tableUID] = true
	}
	if rowsError := queryRows.Err(); rowsError != nil {
		return nil, rowsError
	}

	return visibleTableUIDs, nil
}
