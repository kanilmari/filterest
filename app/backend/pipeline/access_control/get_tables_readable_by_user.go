// get_tables_readable_by_user.go
// Lists datasets authorized by the same enabled row-read route as row requests.
// Bridges guest/user group grants and the permission-filtered navigation catalogue.
// Keeps write-only grants out of navigation; admin recovery matches row-read access and overrides UI hiding.
package access_control

import "easelect/backend/core_components/dbutils"

// GetTablesReadableByUser returns an explicit set even for administrators and
// guests (user 1). A catalogue is a read surface, not the administration inventory.
func GetTablesReadableByUser(db dbutils.Querier, userID int) (map[int]bool, error) {
	readable := make(map[int]bool)
	if userID <= 0 {
		return readable, nil
	}
	rows, err := db.Query(readableTablesQuery, userID, adminPermissionRecoveryModeEnabled())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid int
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		readable[uid] = true
	}
	return readable, rows.Err()
}

const readableTablesQuery = `
	SELECT DISTINCT dataset.table_uid
	FROM public.system_db_tables dataset
	WHERE EXISTS (
        SELECT 1 FROM system_functions function
        WHERE function.url_route_endpoint = '/api/get-results'
          AND (function.disabled = false OR function.disabled IS NULL)
          AND (
            ($2 AND EXISTS (
                SELECT 1 FROM system_user_group_memberships admin
                WHERE admin.user_id = $1 AND admin.group_id = 1
            )) OR EXISTS (
                SELECT 1 FROM system_group_table_func_rights rights
                JOIN system_user_group_memberships membership ON membership.group_id = rights.user_group_id
                WHERE rights.function_id = function.id
                  AND rights.target_table_uid = dataset.table_uid
                  AND membership.user_id = $1
            )
          )
    )
	  AND COALESCE(NULLIF(dataset.schema_name, ''), 'public') = 'public'
	  AND dataset.table_uid > 0
	  AND (NOT dataset.ui_hidden OR EXISTS (
		SELECT 1 FROM system_user_group_memberships admin
		WHERE admin.user_id = $1 AND admin.group_id = 1
	  ))
`
