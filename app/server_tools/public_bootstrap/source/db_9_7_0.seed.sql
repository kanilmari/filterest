-- db_9_7_0.seed.sql
-- Seeds DB 9.7.0 runtime metadata, normalized actions, routes, and database-role grants.
-- Bridges fresh-install schema objects with accepted administrator workflows #874 and #879.
-- Exists so first use has the same fail-closed capabilities as a migrated installation.

INSERT INTO public.system_config (
    key, boolean_value, text_value, value_type, creation_spec
)
VALUES (
    'postgresql_rls_backend_enabled',
    FALSE,
    'false',
    2,
    'Global readiness gate for future PostgreSQL RLS rollout. False never disables application-layer row authorization.'
)
ON CONFLICT (key) DO UPDATE
SET boolean_value = FALSE,
    text_value = 'false',
    value_type = 2,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH desired_categories(category_key, label_lang_key, sort_order) AS (
    VALUES
        ('content', 'permission_category_content', 10),
        ('distribution', 'permission_category_distribution', 20),
        ('workflow', 'permission_category_workflow', 30),
        ('administration', 'permission_category_administration', 40)
)
INSERT INTO public.system_permission_categories (
    category_key, label_lang_key, sort_order, enabled
)
SELECT category_key, label_lang_key, sort_order, TRUE
FROM desired_categories
ON CONFLICT (category_key) DO UPDATE
SET label_lang_key = EXCLUDED.label_lang_key,
    sort_order = EXCLUDED.sort_order,
    enabled = TRUE,
    updated = now();

WITH desired_actions(category_key, action_key, scope_type, label_lang_key, sort_order) AS (
    VALUES
        ('content', 'create', 'dataset', 'permission_action_create', 10),
        ('content', 'read', 'row', 'permission_action_read', 20),
        ('content', 'update', 'row', 'permission_action_update', 30),
        ('content', 'delete', 'row', 'permission_action_delete', 40),
        ('distribution', 'export', 'dataset', 'permission_action_export', 10),
        ('administration', 'manage_permissions', 'system', 'permission_action_manage_permissions', 10),
        ('administration', 'delegate', 'system', 'permission_action_delegate', 20)
)
INSERT INTO public.system_permission_actions (
    category_id, action_key, scope_type, label_lang_key, sort_order, enabled
)
SELECT categories.id,
       desired.action_key,
       desired.scope_type,
       desired.label_lang_key,
       desired.sort_order,
       TRUE
FROM desired_actions AS desired
JOIN public.system_permission_categories AS categories
  ON categories.category_key = desired.category_key
ON CONFLICT (action_key) DO UPDATE
SET category_id = EXCLUDED.category_id,
    scope_type = EXCLUDED.scope_type,
    label_lang_key = EXCLUDED.label_lang_key,
    sort_order = EXCLUDED.sort_order,
    enabled = TRUE,
    updated = now();

WITH desired_tables (table_name, display_name, description, fk_display_column) AS (
    VALUES
        ('system_permission_categories', 'Permission Categories', 'Translatable grouping for normalized permission actions', 'category_key'),
        ('system_permission_actions', 'Permission Actions', 'Stable dataset, row, and system permission actions', 'action_key'),
        ('system_row_access_rules', 'Row Access Rules', 'Exact-row user and group allow-deny rules', 'id'),
        ('system_row_access_rule_events', 'Row Access Rule Events', 'Append-only audit events for row-access changes', 'id')
)
INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, folder_id, schema_name,
    fk_display_column, filterbar_visible_by_default, is_removable,
    display_name, sql_dump_policy
)
SELECT desired.table_name,
       desired.description,
       classes.oid::integer,
       folders.id,
       'public',
       desired.fk_display_column,
       FALSE,
       FALSE,
       desired.display_name,
       'all'
FROM desired_tables AS desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
LEFT JOIN LATERAL (
    SELECT id
    FROM public.system_table_folders
    WHERE folder_name = 'system'
    ORDER BY id
    LIMIT 1
) AS folders ON TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid INTEGER;
BEGIN
    FOR table_record IN
        SELECT unnest(ARRAY[
            'system_permission_categories',
            'system_permission_actions',
            'system_row_access_rules',
            'system_row_access_rule_events'
        ]) AS table_name
    LOOP
        SELECT table_uid INTO registered_table_uid
        FROM public.system_db_tables
        WHERE table_name = table_record.table_name
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
        LIMIT 1;

        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
        )
        SELECT registered_table_uid,
               columns.column_name,
               columns.data_type,
               columns.ordinal_position,
               FALSE,
               now(),
               now()
        FROM information_schema.columns AS columns
        WHERE registered_table_uid IS NOT NULL
          AND columns.table_schema = 'public'
          AND columns.table_name = table_record.table_name
          AND NOT EXISTS (
              SELECT 1
              FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END LOOP;
END $$;

-- Technical vectors stay available to backend ranking and filtering but do not
-- become ordinary result fields serialized to an authorized browser client.
UPDATE public.system_column_details AS details
SET client_delivery_mode = 'server_only',
    updated = now()
FROM public.system_db_tables AS tables
JOIN information_schema.columns AS columns
  ON columns.table_schema = COALESCE(NULLIF(tables.schema_name, ''), 'public')
 AND columns.table_name = tables.table_name
WHERE details.table_uid = tables.table_uid
  AND details.column_name = columns.column_name
  AND details.column_name <> 'id'
  AND (
      columns.udt_name IN ('vector', 'tsvector')
      OR lower(details.column_name) ~ '(^|_)(embedding|embeddings|search_vector)(_|$)'
  );

WITH desired_functions(name, route, package_name, ui_only, creation_spec) AS (
    VALUES
        (
            'system_table_tools.AdminRowAccessRulesHandler',
            '/api/admin/row-access-rules',
            'system_table_tools',
            FALSE,
            'Administrator-only exact-row access rule read and fail-closed bulk mutation API.'
        ),
        (
            'system_table_tools.ResetSharedViewFieldSetHandler',
            '/api/admin/view-field-sets/shared/reset',
            'system_table_tools',
            FALSE,
            'Administrator-only reset for exact site or group view-field assignments.'
        ),
        (
            'ui.admin.view_field_assignments',
            '/ui/admin/view_field_assignments',
            'frontend',
            TRUE,
            'Administrator navigation permission for group and site view-field assignments.'
        )
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT name, FALSE, now(), now(), package_name, FALSE,
       creation_spec, 200, 20, route, ui_only
FROM desired_functions
ON CONFLICT (name) DO UPDATE
SET disabled = FALSE,
    updated = now(),
    package = EXCLUDED.package,
    specific_table_related = FALSE,
    creation_spec = EXCLUDED.creation_spec,
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = EXCLUDED.url_route_endpoint,
    ui_only = EXCLUDED.ui_only;

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest DB 9.7.0 accepted administrator access-control workflows',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.AdminRowAccessRulesHandler',
      'system_table_tools.ResetSharedViewFieldSetHandler',
      'ui.admin.view_field_assignments'
  )
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DO $$
DECLARE
    role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['admin_user', 'readeronly']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
                'GRANT SELECT ON TABLE public.system_permission_categories, public.system_permission_actions, public.system_row_access_rules, public.system_row_access_rule_events TO %I',
                role_name
            );
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT INSERT, UPDATE, DELETE ON TABLE public.system_row_access_rules TO admin_user;
        GRANT INSERT ON TABLE public.system_row_access_rule_events TO admin_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_row_access_rules_id_seq,
            public.system_row_access_rule_events_id_seq
        TO admin_user;
    END IF;
END $$;
