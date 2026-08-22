-- 20260822000007_finalize_view_field_sets.sql
-- Finalizes application metadata, runtime grants, routes, and UI copy for normalized view field sets.
-- Bridges the already-applied structural conversion in 20260822000006 with the runtime contract.
-- Exists as a separate follow-up because applied migrations are immutable.
-- VERSION_DB: 9.5.0

DO $$
BEGIN
    IF to_regclass('public.system_column_field_sets') IS NULL
       OR to_regclass('public.system_column_field_set_members') IS NULL
       OR to_regclass('public.system_view_field_set_assignments') IS NULL THEN
        RAISE EXCEPTION 'normalized view field set tables are missing; run the structural migration first';
    END IF;
END $$;

-- Keep the database view dimension aligned with the renderable frontend view
-- registry. Article is an opening mode for card rows, so it intentionally uses
-- the card key instead of creating a second field-selection dimension.
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
        ('system_column_field_sets', 'Field Collections', 'Reusable personal and shared dataset field collections', 'name'),
        ('system_column_field_set_members', 'Field Collection Members', 'Ordered columns belonging to reusable field collections', 'column_uid'),
        ('system_view_field_set_assignments', 'View Field Assignments', 'Personal and site-default field collections selected for dataset views', 'id')
)
INSERT INTO public.system_db_tables (
    table_name,
    description,
    cached_oid,
    folder_id,
    schema_name,
    fk_display_column,
    filterbar_visible_by_default,
    is_removable,
    display_name,
    sql_dump_policy
)
SELECT desired.table_name,
       desired.description,
       classes.oid::INTEGER,
       (
           SELECT metadata.folder_id
           FROM public.system_db_tables AS metadata
           WHERE metadata.table_name = 'system_table_views'
             AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
           LIMIT 1
       ),
       'public',
       desired.fk_display_column,
       FALSE,
       FALSE,
       desired.display_name,
       'all'
FROM desired_tables AS desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

WITH desired_tables (table_name, display_name, description, fk_display_column) AS (
    VALUES
        ('system_column_field_sets', 'Field Collections', 'Reusable personal and shared dataset field collections', 'name'),
        ('system_column_field_set_members', 'Field Collection Members', 'Ordered columns belonging to reusable field collections', 'column_uid'),
        ('system_view_field_set_assignments', 'View Field Assignments', 'Personal and site-default field collections selected for dataset views', 'id')
)
UPDATE public.system_db_tables AS target
SET description = desired.description,
    cached_oid = classes.oid::INTEGER,
    folder_id = COALESCE(target.folder_id, (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_table_views'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    )),
    schema_name = 'public',
    fk_display_column = desired.fk_display_column,
    filterbar_visible_by_default = FALSE,
    is_removable = FALSE,
    display_name = desired.display_name,
    sql_dump_policy = 'all',
    updated = now()
FROM desired_tables AS desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE target.table_name = desired.table_name
  AND COALESCE(NULLIF(target.schema_name, ''), 'public') = 'public';

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid INTEGER;
BEGIN
    FOR table_record IN
        SELECT unnest(ARRAY[
            'system_column_field_sets',
            'system_column_field_set_members',
            'system_view_field_set_assignments'
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
              SELECT 1 FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;

        UPDATE public.system_column_details
        SET editable_in_ui = FALSE,
            updated = now()
        WHERE table_uid = registered_table_uid;
    END LOOP;

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
          SELECT 1 FROM public.system_column_details AS existing
          WHERE existing.table_uid = registered_table_uid
            AND existing.column_name = columns.column_name
      );
END $$;

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
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

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
        ('system_table_tools.GetViewFieldSetsHandler', '/api/view-field-sets', 'Lists effective and reusable field collections for one authenticated dataset view.'),
        ('system_table_tools.SavePersonalViewFieldSetHandler', '/api/view-field-sets/personal/save', 'Saves and activates a field collection owned by the authenticated user.'),
        ('system_table_tools.AssignPersonalViewFieldSetHandler', '/api/view-field-sets/personal/assign', 'Selects a personal or shared field collection for the authenticated user.'),
        ('system_table_tools.ResetPersonalViewFieldSetHandler', '/api/view-field-sets/personal/reset', 'Removes a personal assignment so the site default is inherited.'),
        ('system_table_tools.DeletePersonalViewFieldSetHandler', '/api/view-field-sets/personal/delete', 'Deletes a field collection owned by the authenticated user.'),
        ('system_table_tools.SaveSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/save', 'Saves and activates an administrator-managed site-default field collection.'),
        ('system_table_tools.AssignSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/assign', 'Selects a shared field collection as a site default.'),
        ('system_table_tools.DeleteSharedViewFieldSetHandler', '/api/admin/view-field-sets/shared/delete', 'Deletes an administrator-managed shared field collection.')
)
UPDATE public.system_functions AS target
SET disabled = FALSE,
    package = 'system_table_tools',
    specific_table_related = FALSE,
    creation_spec = desired.creation_spec,
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.route,
    ui_only = FALSE,
    updated = now()
FROM desired_functions AS desired
WHERE target.name = desired.name;

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest DB 9.5.0 administrator-managed site field collection API',
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
      SELECT 1 FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT SELECT ON TABLE public.system_table_views TO readeronly;
        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO readeronly;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT ON TABLE public.system_table_views TO admin_user;
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
        GRANT SELECT ON TABLE public.system_table_views TO basic_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO basic_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq
        TO basic_user;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        GRANT SELECT ON TABLE public.system_table_views TO guest_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO guest_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq
        TO guest_user;
    END IF;
END $$;

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('edit_site_field_default', 'Muokkaa sivuston oletusta', 'Edit site default', '编辑站点默认字段', '編輯網站預設欄位', 'Switch the visible-fields tool into explicit site-default editing mode.'),
        ('edit_personal_field_selection', 'Palaa omaan valintaan', 'Return to personal selection', '返回个人字段选择', '返回個人欄位選擇', 'Leave site-default editing mode and return to the administrator personal selection.'),
        ('return_to_site_default', 'Palaa sivuston oletukseen', 'Return to site default', '继承站点默认值', '使用網站預設值', 'Remove the personal view assignment and inherit the site default.'),
        ('site_default_restored', 'Sivuston oletus palautettu', 'Site default restored', '已恢复站点默认值', '已恢復網站預設值', 'Confirmation shown after personal field selection is reset.'),
        ('shared', 'Jaettu', 'Shared', '共享', '共用', 'Marks a field collection maintained as shared site content.'),
        ('field_set_fields_placeholder', 'Kentät kenttäjoukossa', 'Fields in collection', '字段集中的字段', '欄位集中的欄位', 'Placeholder for the fields included in a reusable field collection.'),
        ('fields_selected', 'kenttää valittu', 'fields selected', '个字段已选择', '個欄位已選取', 'Suffix for the number of selected fields in the visible-fields tool.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT authored.lang_key,
       authored.fi,
       authored.en,
       authored.ch,
       authored.yue,
       authored.creation_spec
FROM authored_keys AS authored
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('edit_site_field_default', 'fi', 'Muokkaa sivuston oletusta', 'approved'),
        ('edit_site_field_default', 'en', 'Edit site default', 'approved'),
        ('edit_site_field_default', 'zh-CN', '编辑站点默认字段', 'needs_review'),
        ('edit_site_field_default', 'zh-TW', '編輯網站預設欄位', 'needs_review'),
        ('edit_site_field_default', 'zh-HK', '編輯網站預設欄位', 'needs_review'),
        ('edit_personal_field_selection', 'fi', 'Palaa omaan valintaan', 'approved'),
        ('edit_personal_field_selection', 'en', 'Return to personal selection', 'approved'),
        ('edit_personal_field_selection', 'zh-CN', '返回个人字段选择', 'needs_review'),
        ('edit_personal_field_selection', 'zh-TW', '返回個人欄位選擇', 'needs_review'),
        ('edit_personal_field_selection', 'zh-HK', '返回個人欄位選擇', 'needs_review'),
        ('return_to_site_default', 'fi', 'Palaa sivuston oletukseen', 'approved'),
        ('return_to_site_default', 'en', 'Return to site default', 'approved'),
        ('return_to_site_default', 'zh-CN', '继承站点默认值', 'needs_review'),
        ('return_to_site_default', 'zh-TW', '使用網站預設值', 'needs_review'),
        ('return_to_site_default', 'zh-HK', '使用網站預設值', 'needs_review'),
        ('site_default_restored', 'fi', 'Sivuston oletus palautettu', 'approved'),
        ('site_default_restored', 'en', 'Site default restored', 'approved'),
        ('site_default_restored', 'zh-CN', '已恢复站点默认值', 'needs_review'),
        ('site_default_restored', 'zh-TW', '已恢復網站預設值', 'needs_review'),
        ('site_default_restored', 'zh-HK', '已恢復網站預設值', 'needs_review'),
        ('shared', 'fi', 'Jaettu', 'approved'),
        ('shared', 'en', 'Shared', 'approved'),
        ('shared', 'zh-CN', '共享', 'needs_review'),
        ('shared', 'zh-TW', '共用', 'needs_review'),
        ('shared', 'zh-HK', '共用', 'needs_review'),
        ('field_set_fields_placeholder', 'fi', 'Kentät kenttäjoukossa', 'approved'),
        ('field_set_fields_placeholder', 'en', 'Fields in collection', 'approved'),
        ('field_set_fields_placeholder', 'zh-CN', '字段集中的字段', 'needs_review'),
        ('field_set_fields_placeholder', 'zh-TW', '欄位集中的欄位', 'needs_review'),
        ('field_set_fields_placeholder', 'zh-HK', '欄位集中的欄位', 'needs_review'),
        ('fields_selected', 'fi', 'kenttää valittu', 'approved'),
        ('fields_selected', 'en', 'fields selected', 'approved'),
        ('fields_selected', 'zh-CN', '个字段已选择', 'needs_review'),
        ('fields_selected', 'zh-TW', '個欄位已選取', 'needs_review'),
        ('fields_selected', 'zh-HK', '個欄位已選取', 'needs_review')
), resolved AS (
    SELECT keys.id AS lang_key_id,
           authored.language_code,
           authored.translation,
           authored.review_status
    FROM authored_translations AS authored
    JOIN public.system_lang_keys AS keys ON keys.lang_key = authored.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT resolved.lang_key_id,
       resolved.language_code,
       resolved.translation,
       'manual',
       resolved.review_status
FROM resolved
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js',
       '',
       'Per-view personal and site-default field collection controls.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'edit_site_field_default',
    'edit_personal_field_selection',
    'return_to_site_default',
    'site_default_restored',
    'shared',
    'field_set_fields_placeholder',
    'fields_selected'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '9.5.0', 'Finalized normalized personal and site-default field collections for dataset views'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.5.0'
);
