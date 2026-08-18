-- 20260817000007_repair_filterest_admin_schema_permissions.sql
-- Gives an existing Filterest administrator the same dataset-management rights
-- that a fresh public bootstrap and newly created datasets receive.
-- VERSION_DB: 9.0.0

WITH desired_functions (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES
        ('dtt_crud_workflows.CreateTableHandler', 'dtt_crud_workflows', FALSE, '/api/create_dataset'),
        ('dtt_crud_workflows.ModifyColumnsHandler', 'dtt_crud_workflows', TRUE, '/api/modify-columns'),
        ('dtt_3_table_delete.DropTableHandler', 'dtt_3_table_delete', TRUE, '/api/drop-dataset'),
        ('system_table_tools.GetCardVisibilityHandler', 'system_table_tools', FALSE, '/api/card-visibility/'),
        ('system_table_tools.UpdateCardVisibilityHandler', 'system_table_tools', FALSE, '/api/card-visibility/update')
), missing_functions AS (
    SELECT
        desired.*,
        ROW_NUMBER() OVER (ORDER BY desired.name) AS id_offset
    FROM desired_functions AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
), current_id AS (
    SELECT COALESCE(MAX(id), 0)::BIGINT AS max_id
    FROM public.system_functions
)
INSERT INTO public.system_functions (
    id,
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
    current_id.max_id + missing.id_offset,
    missing.name,
    FALSE,
    now(),
    now(),
    missing.package,
    missing.specific_table_related,
    'Filterest DB 9.0.0 administrator schema-permission repair',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_functions AS missing
CROSS JOIN current_id;

WITH desired_functions (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES
        ('dtt_crud_workflows.CreateTableHandler', 'dtt_crud_workflows', FALSE, '/api/create_dataset'),
        ('dtt_crud_workflows.ModifyColumnsHandler', 'dtt_crud_workflows', TRUE, '/api/modify-columns'),
        ('dtt_3_table_delete.DropTableHandler', 'dtt_3_table_delete', TRUE, '/api/drop-dataset'),
        ('system_table_tools.GetCardVisibilityHandler', 'system_table_tools', FALSE, '/api/card-visibility/'),
        ('system_table_tools.UpdateCardVisibilityHandler', 'system_table_tools', FALSE, '/api/card-visibility/update')
)
UPDATE public.system_functions AS target
SET disabled = FALSE,
    updated = now(),
    package = desired.package,
    specific_table_related = desired.specific_table_related,
    creation_spec = 'Filterest DB 9.0.0 administrator schema-permission repair',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.url_route_endpoint,
    ui_only = FALSE
FROM desired_functions AS desired
WHERE target.name = desired.name;

WITH tableless_functions(name) AS (
    VALUES
        ('dtt_crud_workflows.CreateTableHandler'),
        ('system_table_tools.GetCardVisibilityHandler'),
        ('system_table_tools.UpdateCardVisibilityHandler')
)
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
    'Filterest DB 9.0.0 administrator schema-permission repair',
    NULL
FROM public.system_user_groups AS groups
JOIN tableless_functions ON TRUE
JOIN public.system_functions AS functions
  ON functions.name = tableless_functions.name
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
  );

WITH table_functions(name) AS (
    VALUES
        ('dtt_crud_workflows.ModifyColumnsHandler'),
        ('dtt_3_table_delete.DropTableHandler')
)
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
    COALESCE(NULLIF(tables.schema_name, ''), 'public'),
    'Filterest DB 9.0.0 administrator schema-permission repair',
    tables.table_uid
FROM public.system_user_groups AS groups
JOIN table_functions ON TRUE
JOIN public.system_functions AS functions
  ON functions.name = table_functions.name
JOIN public.system_db_tables AS tables
  ON COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
 AND tables.is_removable IS TRUE
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid = tables.table_uid
  );

INSERT INTO public.system_db_version (version, description)
SELECT
    '9.0.0',
    'Added normalized UI-language tables, administrator-owned embedding policy defaults, column metadata dataset references, and existing-installation administrator schema permissions.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.0.0'
);
