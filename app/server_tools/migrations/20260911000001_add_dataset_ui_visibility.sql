-- 20260911000001_add_dataset_ui_visibility.sql
-- Adds reversible dataset hiding from ordinary navigation and direct UI reads.
-- Connects canonical metadata with administrator hide/restore and dataset readers.
-- Preserves table data, media, identities and all existing permission records.
-- VERSION_DB: 9.7.14

ALTER TABLE public.system_db_tables ADD COLUMN IF NOT EXISTS ui_hidden BOOLEAN DEFAULT FALSE;
UPDATE public.system_db_tables SET ui_hidden = FALSE WHERE ui_hidden IS NULL;
ALTER TABLE public.system_db_tables ALTER COLUMN ui_hidden SET DEFAULT FALSE;
ALTER TABLE public.system_db_tables ALTER COLUMN ui_hidden SET NOT NULL;

-- Administrator-only reversible dataset visibility; preserves all existing rights.
INSERT INTO public.system_functions
 (name, package, disabled, specific_table_related, url_route_endpoint, ui_only,
  rate_limit_amount, rate_limit_minutes, creation_spec)
VALUES ('system_table_tools.AdminDatasetUIVisibilityHandler', 'system_table_tools', FALSE, FALSE,
 '/api/admin/dataset-ui-visibility', FALSE, 200, 20, 'Administrator dataset UI hide and restore.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.system_group_table_func_rights
 (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
SELECT 1, id, 'public', NULL, 'Administrator dataset UI hide and restore.'
FROM public.system_functions f
WHERE f.name = 'system_table_tools.AdminDatasetUIVisibilityHandler'
 AND NOT EXISTS (
  SELECT 1 FROM public.system_group_table_func_rights rights
  WHERE rights.user_group_id = 1 AND rights.function_id = f.id
   AND rights.target_schema_name = 'public' AND rights.target_table_uid IS NULL
 )
ON CONFLICT DO NOTHING;

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.14', 'Reversible dataset UI visibility and confirmed permanent deletion'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.14');
