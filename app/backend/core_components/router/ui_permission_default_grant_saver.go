// ui_permission_default_grant_saver.go
// Grants a UI route's bootstrap visibility only when its permission is first created.
// Connects the startup reconciliation transaction to named site groups and global rights.
// Preserves later administrator grants and revocations across restarts and upgrades.
package router

import (
	"database/sql"
	"errors"
	"fmt"
)

const insertMissingUIPermissionRouteSQL = `
INSERT INTO public.system_functions (
    name, "package", disabled, specific_table_related, url_route_endpoint,
    rate_limit_amount, rate_limit_minutes, ui_only, creation_spec
)
VALUES ($1, 'frontend', false, $2, $3, $4, $5, true,
    'Canonical frontend-only permission route reconciled at application startup.')
ON CONFLICT (name) DO NOTHING
RETURNING id`

const grantNewUIPermissionDefaultsSQL = `
INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id, $1, 'public',
       'Default article UI visibility granted only at first permission creation.', NULL
  FROM public.system_user_groups AS groups
 WHERE groups.name = 'admins'
    OR ($2 = 'readers' AND groups.name IN ('users', 'guests'))
ON CONFLICT DO NOTHING`

// grantNewUIPermissionDefaults uses the INSERT result as the durable creation
// boundary. An existing (even disabled) row returns no ID, so no defaults are
// touched. Creation and grants share reconciliation's transaction and rollback.
func grantNewUIPermissionDefaults(tx *sql.Tx, route uiPermissionRouteDefinition) error {
	if route.DefaultGrantGroups == "" {
		return nil
	}
	if route.DefaultGrantGroups != "admins" && route.DefaultGrantGroups != "readers" {
		return fmt.Errorf("unknown UI default grant policy %q", route.DefaultGrantGroups)
	}
	var functionID int64
	err := tx.QueryRow(insertMissingUIPermissionRouteSQL, route.Name,
		route.SpecificTableRelated, route.URLRouteEndpoint,
		defaultRateLimitAmount, defaultRateLimitMinutes).Scan(&functionID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("insert missing UI permission: %w", err)
	}
	if _, err := tx.Exec(grantNewUIPermissionDefaultsSQL, functionID, route.DefaultGrantGroups); err != nil {
		return fmt.Errorf("grant first-creation UI defaults: %w", err)
	}
	return nil
}
