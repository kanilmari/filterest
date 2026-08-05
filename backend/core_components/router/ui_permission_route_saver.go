// ui_permission_route_saver.go
// Reconciles frontend-only permission routes into system_functions during startup.
// Bridges canonical UI permission metadata, bootstrap databases, and admin permission safety nets.
// Exists so fresh or pruned seeds self-heal before permissions are cleaned and granted.
package router

import (
	"database/sql"
	"fmt"
)

type uiPermissionRouteDefinition struct {
	Name                 string
	URLRouteEndpoint     string
	SpecificTableRelated bool
}

var canonicalUIPermissionRoutes = [...]uiPermissionRouteDefinition{
	{Name: "nav_container_ui", URLRouteEndpoint: "/ui/nav_container", SpecificTableRelated: false},
	{Name: "nav_tree_ui", URLRouteEndpoint: "/ui/nav_tree", SpecificTableRelated: false},
	{Name: "ui.table_view_style_buttons", URLRouteEndpoint: "/ui/table-view-style-buttons", SpecificTableRelated: true},

	{Name: "ui.view.card", URLRouteEndpoint: "/ui/view/card", SpecificTableRelated: false},
	{Name: "ui.view.table", URLRouteEndpoint: "/ui/view/table", SpecificTableRelated: false},
	{Name: "ui.view.list", URLRouteEndpoint: "/ui/view/list", SpecificTableRelated: false},
	{Name: "ui.view.transposed", URLRouteEndpoint: "/ui/view/transposed", SpecificTableRelated: false},
	{Name: "ui.view.tree", URLRouteEndpoint: "/ui/view/tree", SpecificTableRelated: false},
	{Name: "ui.view.ticket", URLRouteEndpoint: "/ui/view/ticket", SpecificTableRelated: false},
	{Name: "ui.view.settings", URLRouteEndpoint: "/ui/view/settings", SpecificTableRelated: false},
	{Name: "ui.view.cloud_management", URLRouteEndpoint: "/ui/view/cloud_management", SpecificTableRelated: false},

	{Name: "ui.admin.permissions", URLRouteEndpoint: "/ui/admin/permissions", SpecificTableRelated: false},
	{Name: "ui.admin.notification_triggers", URLRouteEndpoint: "/ui/admin/notification_triggers", SpecificTableRelated: false},
	{Name: "ui.admin.foreign_keys", URLRouteEndpoint: "/ui/admin/foreign_keys", SpecificTableRelated: false},
	{Name: "ui.admin.create_table", URLRouteEndpoint: "/ui/admin/create_table", SpecificTableRelated: false},
	{Name: "ui.admin.empty_rows", URLRouteEndpoint: "/ui/admin/empty_rows", SpecificTableRelated: false},
	{Name: "ui.admin.refresh_embeddings", URLRouteEndpoint: "/ui/admin/refresh_embeddings", SpecificTableRelated: false},
	{Name: "ui.admin.translation_helper", URLRouteEndpoint: "/ui/admin/translation_helper", SpecificTableRelated: false},
	{Name: "ui.admin.text_index_maintenance", URLRouteEndpoint: "/ui/admin/text_index_maintenance", SpecificTableRelated: false},
	{Name: "ui.admin.check_json_columns", URLRouteEndpoint: "/ui/admin/check_json_columns", SpecificTableRelated: false},
	{Name: "ui.admin.database_consistency", URLRouteEndpoint: "/ui/admin/database_consistency", SpecificTableRelated: false},
	{Name: "ui.admin.fix_media_subfolders", URLRouteEndpoint: "/ui/admin/fix_media_subfolders", SpecificTableRelated: false},
	{Name: "ui.admin.fk_cache_triggers", URLRouteEndpoint: "/ui/admin/fk_cache_triggers", SpecificTableRelated: false},
	{Name: "ui.admin.card_visibility", URLRouteEndpoint: "/ui/admin/card_visibility", SpecificTableRelated: false},
	{Name: "ui.admin.asset_linking", URLRouteEndpoint: "/ui/admin/asset_linking", SpecificTableRelated: false},
	{Name: "ui.admin.child_tab_config", URLRouteEndpoint: "/ui/admin/child_tab_config", SpecificTableRelated: false},
	{Name: "ui.admin.dataset_alias_management", URLRouteEndpoint: "/ui/admin/dataset_alias_management", SpecificTableRelated: false},
	{Name: "ui.admin.dataset_header_config", URLRouteEndpoint: "/ui/admin/dataset_header_config", SpecificTableRelated: false},
	{Name: "ui.admin.service_catalog_moderation", URLRouteEndpoint: "/ui/admin/service_catalog_moderation", SpecificTableRelated: false},
	{Name: "ui.admin.queen_chat", URLRouteEndpoint: "/ui/admin/queen_chat", SpecificTableRelated: false},
}

const reconcileUIPermissionRouteSQL = `
WITH canonical_route AS (
INSERT INTO public.system_functions (
    name,
    "package",
    disabled,
    specific_table_related,
    url_route_endpoint,
    rate_limit_amount,
    rate_limit_minutes,
    ui_only,
    creation_spec
)
VALUES (
    $1, 'frontend', false, $2, $3, $4, $5, true,
    'Canonical frontend-only permission route reconciled at application startup.'
)
ON CONFLICT (name) DO UPDATE
SET disabled = false,
    "package" = 'frontend',
    specific_table_related = EXCLUDED.specific_table_related,
    url_route_endpoint = EXCLUDED.url_route_endpoint,
    rate_limit_amount = EXCLUDED.rate_limit_amount,
    rate_limit_minutes = EXCLUDED.rate_limit_minutes,
    ui_only = true,
    creation_spec = COALESCE(
        NULLIF(system_functions.creation_spec, ''),
        EXCLUDED.creation_spec
    )
RETURNING id
),
endpoint_aliases AS (
    SELECT alias.id
      FROM public.system_functions AS alias
      CROSS JOIN canonical_route AS canonical
     WHERE alias.url_route_endpoint = $3
       AND alias.id <> canonical.id
       AND alias."package" = 'frontend'
       AND alias.ui_only IS TRUE
),
copied_alias_grants AS (
    INSERT INTO public.system_group_table_func_rights (
        user_group_id,
        function_id,
        target_schema_name,
        creation_spec,
        target_table_uid
    )
    SELECT legacy.user_group_id,
           canonical.id,
           legacy.target_schema_name,
           COALESCE(
               NULLIF(legacy.creation_spec, ''),
               'Permission retained while canonicalizing a frontend-only route alias.'
           ),
           legacy.target_table_uid
      FROM public.system_group_table_func_rights AS legacy
      JOIN endpoint_aliases AS alias ON alias.id = legacy.function_id
      CROSS JOIN canonical_route AS canonical
     WHERE NOT EXISTS (
         SELECT 1
           FROM public.system_group_table_func_rights AS existing
          WHERE existing.user_group_id = legacy.user_group_id
            AND existing.function_id = canonical.id
            AND COALESCE(existing.target_table_uid, 0) = COALESCE(legacy.target_table_uid, 0)
     )
    ON CONFLICT DO NOTHING
    RETURNING id
)
UPDATE public.system_functions AS alias
   SET disabled = true,
       url_route_endpoint = NULL,
       ui_only = true,
       creation_spec = COALESCE(
           NULLIF(alias.creation_spec, ''),
           'Deprecated frontend-only permission alias disabled during startup reconciliation.'
       )
 WHERE alias.id IN (SELECT id FROM endpoint_aliases)`

// ReactivateUIRoutes reconciles the complete frontend-only permission registry.
// Existing canonical-name rows keep their IDs and permission grants. Grants on
// older same-endpoint aliases are copied to the canonical ID before those aliases
// are disabled, so an alias cannot remain as a parallel authorization path.
func ReactivateUIRoutes(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin UI route reconciliation: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	for _, route := range canonicalUIPermissionRoutes {
		if _, err := tx.Exec(
			reconcileUIPermissionRouteSQL,
			route.Name,
			route.SpecificTableRelated,
			route.URLRouteEndpoint,
			defaultRateLimitAmount,
			defaultRateLimitMinutes,
		); err != nil {
			return fmt.Errorf("reconcile UI route %s: %w", route.URLRouteEndpoint, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit UI route reconciliation: %w", err)
	}
	return nil
}
