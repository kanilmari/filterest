-- 20260819000006_enable_admin_owned_registration.sql
-- Makes self-registration an explicit, visible system setting and restricts
-- system_config dataset rights to the administrators group.
-- VERSION_DB: 9.2.1

INSERT INTO public.system_config (
    key,
    json_value,
    boolean_value,
    text_value,
    value_type,
    creation_spec
)
VALUES (
    'registration_enabled',
    '{"value":true}'::jsonb,
    TRUE,
    'true',
    2,
    'Administrator-owned self-registration availability setting.'
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

INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    target_table_uid,
    creation_spec
)
SELECT
    groups.id,
    functions.id,
    COALESCE(NULLIF(tables.schema_name, ''), 'public'),
    tables.table_uid,
    'Filterest DB 9.2.1 administrators-only system configuration'
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.disabled IS FALSE
 AND COALESCE(functions.specific_table_related, TRUE) IS TRUE
JOIN public.system_db_tables AS tables
  ON tables.table_name = 'system_config'
 AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid = tables.table_uid
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') =
            COALESCE(NULLIF(tables.schema_name, ''), 'public')
  );

INSERT INTO public.system_db_version (version, description)
SELECT
    '9.2.1',
    'Enabled administrator-owned self-registration and restricted system configuration rights to administrators.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.1'
);
