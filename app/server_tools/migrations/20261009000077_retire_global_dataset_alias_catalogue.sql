-- 20261009000077_retire_global_dataset_alias_catalogue.sql
-- Retires the global alias catalogue now that navigation uses readable name pools.
-- Connects removed HTTP registration and public bootstrap with stored capability grants.
-- Keeps the separate administrator alias editor while revoking the retired read surface.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

DELETE FROM public.system_group_table_func_rights
WHERE function_id IN (
    SELECT id FROM public.system_functions
    WHERE url_route_endpoint = '/api/dataset-aliases'
       OR name = 'router.GetDatasetAliasesHandler'
);

UPDATE public.system_functions
SET disabled = true
WHERE url_route_endpoint = '/api/dataset-aliases'
   OR name = 'router.GetDatasetAliasesHandler';
