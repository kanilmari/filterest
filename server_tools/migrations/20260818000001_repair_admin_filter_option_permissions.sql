-- 20260818000001_repair_admin_filter_option_permissions.sql
-- Repairs the filter-options read permission omitted from table creation in older releases.
-- Keeps ordinary users opt-in while guaranteeing administrators can open registered datasets.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

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
    'Filterest DB 9.0.0 administrator filter-options permission repair',
    tables.table_uid
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'dtt_1_row_read.GetFilterOptionsHandler'
JOIN public.system_db_tables AS tables
  ON COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid = tables.table_uid
  );
