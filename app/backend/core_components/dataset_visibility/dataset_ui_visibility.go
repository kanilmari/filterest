// dataset_ui_visibility.go
// Reads current dataset UI visibility without changing underlying permissions.
// Bridges dataset metadata, existing administrator membership and page/row readers.
// Exists so stale browser navigation cannot reveal a newly hidden dataset.
package dataset_visibility

import "database/sql"

type rowQuerier interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

// HiddenForUser checks current metadata on every request. The existing admin
// group retains access; no grant is added or removed. Unregistered datasets keep
// their existing not-found handling.
func HiddenForUser(db rowQuerier, datasetName string, userID int) (bool, error) {
	var hidden bool
	err := db.QueryRow(hiddenForUserQuery, datasetName, userID).Scan(&hidden)
	return hidden, err
}

const hiddenForUserQuery = `
 SELECT EXISTS (
  SELECT 1 FROM public.system_db_tables AS dataset
  WHERE dataset.table_name = $1
    AND COALESCE(NULLIF(dataset.schema_name, ''), 'public') = 'public'
    AND dataset.ui_hidden = TRUE
    AND NOT EXISTS (
     SELECT 1 FROM public.system_user_group_memberships AS membership
     WHERE membership.user_id = $2 AND membership.group_id = 1
    )
 )
`
