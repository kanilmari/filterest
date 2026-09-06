-- runtime.seed.sql
-- Seeds only the public runtime identity and version rows needed on first use.
-- Bridges generated release metadata and the reduced public-safe runtime schema.
-- Exists separately from multilingual mock content so runtime readiness stays explicit.

INSERT INTO public.system_about (id, title, description, admin_approved)
VALUES (
    4,
    'Filterest privacy notice',
    'This generated local preview contains synthetic demonstration data only.',
    TRUE
);

INSERT INTO public.system_config (key, json_value, creation_spec)
SELECT
    'production_update_notice',
    '{
      "schema_version": 1,
      "notice_id": "",
      "state": "cleared",
      "announced_at": "",
      "starts_at": "",
      "expires_at": "",
      "updated_at": ""
    }'::jsonb,
    'Manager-controlled fixed-schema administrator production-update notice; no operator-authored display text.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_config WHERE key = 'production_update_notice'
);

INSERT INTO public.system_table_views (name, view_key, status)
VALUES
    ('table', 'table', 'active'),
    ('card', 'card', 'active'),
    ('normal', 'normal', 'active'),
    ('transposed', 'transposed', 'active'),
    ('tree', 'tree', 'active'),
    ('ticket', 'ticket', 'active'),
    ('product_card', 'product_card', 'active'),
    ('calendar', 'calendar', 'active'),
    ('map', 'map', 'active'),
    ('price_chart', 'price_chart', 'active'),
    ('settings', 'settings', 'active'),
    ('cloud_management', 'cloud_management', 'active')
ON CONFLICT (view_key) DO NOTHING;

WITH desired_tables (table_name, display_name, description, fk_display_column) AS (
    VALUES
        ('system_row_groups', 'Row Groups', 'Reusable multilingual row classification groups', 'slug'),
        ('system_row_group_memberships', 'Row Group Memberships', 'Generic assignments from dataset rows to reusable groups', 'id'),
        ('system_column_field_sets', 'Field Collections', 'Reusable personal and shared dataset field collections', 'name'),
        ('system_column_field_set_members', 'Field Collection Members', 'Ordered columns belonging to reusable field collections', 'column_uid'),
        ('system_view_field_set_assignments', 'View Field Assignments', 'Personal and site-default field collections selected for dataset views', 'id'),
        ('system_user_visual_preferences', 'User Visual Preferences', 'Allowlisted account-owned visual preferences', 'theme_mode')
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
    registered_table_uid integer;
BEGIN
    FOR table_record IN
        SELECT unnest(ARRAY[
            'system_row_groups',
            'system_row_group_memberships',
            'system_column_field_sets',
            'system_column_field_set_members',
            'system_view_field_set_assignments',
            'system_user_visual_preferences'
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

    UPDATE public.system_column_details AS details
    SET is_multilingual = TRUE,
        editable_in_ui = FALSE,
        updated = now()
    FROM public.system_db_tables AS tables
    WHERE tables.table_uid = details.table_uid
      AND tables.table_name = 'system_row_groups'
      AND details.column_name IN ('title', 'description');

    UPDATE public.system_column_details AS details
    SET editable_in_ui = FALSE,
        updated = now()
    FROM public.system_db_tables AS tables
    WHERE tables.table_uid = details.table_uid
      AND tables.table_name IN ('system_row_groups', 'system_row_group_memberships');

    SELECT table_uid INTO registered_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_table_views'
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
      AND columns.table_name = 'system_table_views'
      AND columns.column_name = 'view_key'
      AND NOT EXISTS (
          SELECT 1
          FROM public.system_column_details AS existing
          WHERE existing.table_uid = registered_table_uid
            AND existing.column_name = columns.column_name
      );
END $$;

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
        ('system_table_tools.AdminRowGroupsHandler', '/api/admin/row-groups', 'Admin list/create API for reusable row groups.'),
        ('system_table_tools.AdminRowGroupMembershipsHandler', '/api/admin/row-group-memberships', 'Admin assignment API for generic row group memberships.'),
        ('system_table_tools.SavePersonalDatasetSortDefaultHandler', '/api/dataset-sort-default/personal', 'Saves a dataset sorting default owned by the authenticated user.'),
        ('system_table_tools.GetViewFieldSetsHandler', '/api/view-field-sets', 'Lists effective and reusable field collections for one authenticated dataset view.'),
        ('system_table_tools.SavePersonalViewFieldSetHandler', '/api/view-field-sets/personal/save', 'Saves and activates a field collection owned by the authenticated user.'),
        ('system_table_tools.AssignPersonalViewFieldSetHandler', '/api/view-field-sets/personal/assign', 'Selects a personal or shared field collection for the authenticated user.'),
        ('system_table_tools.ResetPersonalViewFieldSetHandler', '/api/view-field-sets/personal/reset', 'Removes a personal assignment so the site default is inherited.'),
        ('system_table_tools.DeletePersonalViewFieldSetHandler', '/api/view-field-sets/personal/delete', 'Deletes a field collection owned by the authenticated user.'),
        ('system_table_tools.SaveSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/save', 'Saves and activates an administrator-managed site-default field collection.'),
        ('system_table_tools.AssignSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/assign', 'Selects a shared field collection as a site default.'),
        ('system_table_tools.DeleteSharedViewFieldSetHandler', '/api/admin/view-field-sets/shared/delete', 'Deletes an administrator-managed shared field collection.')
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT desired.name, FALSE, now(), now(), 'system_table_tools', FALSE,
       desired.creation_spec, 200, 20, desired.route, FALSE
FROM desired_functions AS desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_functions AS existing WHERE existing.name = desired.name
);

INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT
    'auth.UserVisualPreferenceHandler',
    FALSE,
    now(),
    now(),
    'auth',
    FALSE,
    'Authenticated-user-owned allowlisted visual preferences.',
    240,
    20,
    '/api/user-visual-preference',
    FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_functions AS existing
    WHERE existing.name = 'auth.UserVisualPreferenceHandler'
);

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
        ('router.systemUpdateNoticeHandler', '/system/update-notice', 'Manager-authenticated production-update notice state transition.'),
        ('router.adminUpdateNoticeStreamHandler', '/api/admin/update-notice/stream', 'Administrator-only bounded production-update notice stream.')
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT desired.name, FALSE, now(), now(), 'router', FALSE,
       desired.creation_spec, 200, 20, desired.route, FALSE
FROM desired_functions AS desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_functions AS existing WHERE existing.name = desired.name
);

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator row-group API',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.AdminRowGroupsHandler',
      'system_table_tools.AdminRowGroupMembershipsHandler'
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

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator production-update notice stream',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'router.adminUpdateNoticeStreamHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator field collection API',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.SaveSiteViewFieldSetHandler',
      'system_table_tools.AssignSiteViewFieldSetHandler',
      'system_table_tools.DeleteSharedViewFieldSetHandler'
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
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT USAGE ON SCHEMA public TO readeronly;
        GRANT SELECT ON TABLE public.system_table_views TO readeronly;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO readeronly;
        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO readeronly;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT ON TABLE public.system_table_views TO admin_user;
        GRANT SELECT, INSERT, UPDATE ON TABLE
            public.system_user_visual_preferences
        TO admin_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO admin_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq
        TO admin_user;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT USAGE ON SCHEMA public TO basic_user;
        GRANT SELECT ON TABLE public.system_table_views TO basic_user;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO basic_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO basic_user;
        GRANT SELECT, INSERT, UPDATE ON TABLE
            public.system_dataset_sort_defaults,
            public.system_user_visual_preferences
        TO basic_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq,
            public.system_dataset_sort_defaults_id_seq
        TO basic_user;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        GRANT USAGE ON SCHEMA public TO guest_user;
        GRANT SELECT ON TABLE public.system_table_views TO guest_user;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO guest_user;
        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO guest_user;
        REVOKE ALL PRIVILEGES ON TABLE
            public.system_user_visual_preferences
        FROM guest_user;
    END IF;
END $$;

INSERT INTO public.system_db_version (version, description)
VALUES ('__FILTEREST_DB_VERSION__', 'Filterest generated public bootstrap');
