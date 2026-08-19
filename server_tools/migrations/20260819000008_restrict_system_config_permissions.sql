-- 20260819000008_restrict_system_config_permissions.sql
-- Reconciles system configuration access at the supported group boundary:
-- admins keep normal administrator table tools, every other group has none.
-- VERSION_DB: 9.2.1
-- VERSION_DB_OWNER: 20260819000006_enable_admin_owned_registration.sql

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
