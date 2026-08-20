-- 20260820000002_add_admin_ui_feature_flags.sql
-- Adds the administrator-only UI feature-flag capability and enables the
-- temporary dataset cover-image test palette.
-- VERSION_DB: 9.2.3

INSERT INTO public.system_config (
    key,
    json_value,
    boolean_value,
    text_value,
    value_type,
    creation_spec
)
VALUES (
    'view_admin_cover_image_test_palette',
    '{"value":true}'::jsonb,
    TRUE,
    'true',
    2,
    'Temporary administrator-only dataset cover-image test palette switch.'
)
ON CONFLICT (key) DO UPDATE
SET json_value = EXCLUDED.json_value,
    boolean_value = EXCLUDED.boolean_value,
    text_value = EXCLUDED.text_value,
    value_type = EXCLUDED.value_type,
    creation_spec = COALESCE(
        NULLIF(public.system_config.creation_spec, ''),
        EXCLUDED.creation_spec
    ),
    updated = now();

DELETE FROM public.system_group_table_func_rights AS rights
USING public.system_db_tables AS tables
WHERE tables.table_name = 'system_config'
  AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
  AND rights.target_table_uid = tables.table_uid
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );

WITH desired_function (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES (
        'system_table_tools.GetAdminUIFeatureFlagsHandler',
        'system_table_tools',
        FALSE,
        '/api/admin/ui-feature-flags'
    )
), missing_function AS (
    SELECT desired.*
    FROM desired_function AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
)
INSERT INTO public.system_functions (
    name,
    disabled,
    created,
    updated,
    package,
    specific_table_related,
    creation_spec,
    rate_limit_amount,
    rate_limit_minutes,
    url_route_endpoint,
    ui_only
)
SELECT
    missing.name,
    FALSE,
    now(),
    now(),
    missing.package,
    missing.specific_table_related,
    'Filterest DB 9.2.3 administrator UI feature flags',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_function AS missing;

UPDATE public.system_functions
SET disabled = FALSE,
    updated = now(),
    package = 'system_table_tools',
    specific_table_related = FALSE,
    creation_spec = 'Filterest DB 9.2.3 administrator UI feature flags',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = '/api/admin/ui-feature-flags',
    ui_only = FALSE
WHERE name = 'system_table_tools.GetAdminUIFeatureFlagsHandler';

INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    creation_spec,
    target_table_uid
)
SELECT
    groups.id,
    functions.id,
    'public',
    'Filterest DB 9.2.3 administrator UI feature flags',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'system_table_tools.GetAdminUIFeatureFlagsHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DELETE FROM public.system_group_table_func_rights AS rights
USING public.system_functions AS functions
WHERE functions.id = rights.function_id
  AND functions.name = 'system_table_tools.GetAdminUIFeatureFlagsHandler'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );

INSERT INTO public.system_db_version (version, description)
SELECT '9.2.3', 'Added administrator-only UI feature-flag allowlist endpoint and cover-image test palette switch'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.3'
);
