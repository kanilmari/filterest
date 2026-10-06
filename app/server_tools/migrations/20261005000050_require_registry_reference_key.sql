-- 20261005000050_require_registry_reference_key.sql
-- Requires the dataset registry's integer reference key and protects it in the UI.
-- Bridges stored dataset references with the registry's own column metadata.
-- Exists because a registry row number is not a dataset reference. The precheck
-- refuses missing keys before changing schema or metadata, including on a rerun.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl144_registry_reference_key
-- FINAL_CHECK: public.app_check_registry_reference_key()

DO $registry_key_precheck$
DECLARE
    missing_rows text;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    -- Held until the migration runner's transaction ends, across all later DDL.
    LOCK TABLE public.system_db_tables IN ACCESS EXCLUSIVE MODE;
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO missing_rows
      FROM public.system_db_tables WHERE table_uid IS NULL;
    IF missing_rows IS NOT NULL THEN
        RAISE EXCEPTION 'registry reference-key precheck refused: system_db_tables rows % have no table_uid; repair the registry before upgrading', missing_rows;
    END IF;
END $registry_key_precheck$;

CREATE OR REPLACE FUNCTION public.app_check_registry_reference_key()
RETURNS SETOF text
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $check$
    SELECT 'system_db_tables.table_uid must be NOT NULL'
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                        WHERE attrelid = 'public.system_db_tables'::regclass
                          AND attname = 'table_uid' AND attnotnull AND NOT attisdropped)
    UNION ALL
    SELECT 'system_db_tables contains a missing table_uid'
     WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_uid IS NULL)
    UNION ALL
    -- A fresh installation has no metadata row for this column, and the generic
    -- row editor refuses a column without one, so only an editable row is a finding.
    SELECT 'the registry reference key must not be editable in the UI'
     WHERE EXISTS (
         SELECT 1 FROM public.system_column_details AS column_detail
         JOIN public.system_db_tables AS registry ON registry.table_uid = column_detail.table_uid
          WHERE registry.table_name = 'system_db_tables'
            AND coalesce(nullif(registry.schema_name, ''), 'public') = 'public'
            AND column_detail.column_name = 'table_uid'
            AND column_detail.editable_in_ui IS DISTINCT FROM false
     );
$check$;

DO $registry_key$
DECLARE
    findings text;
BEGIN
    ALTER TABLE public.system_db_tables ALTER COLUMN table_uid SET NOT NULL;
    UPDATE public.system_column_details AS column_detail SET editable_in_ui = false
      FROM public.system_db_tables AS registry
     WHERE column_detail.table_uid = registry.table_uid
       AND registry.table_name = 'system_db_tables'
       AND coalesce(nullif(registry.schema_name, ''), 'public') = 'public'
       AND column_detail.column_name = 'table_uid'
       AND column_detail.editable_in_ui IS DISTINCT FROM false;

    SELECT string_agg(finding, '; ') INTO findings
      FROM public.app_check_registry_reference_key() AS finding;
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION 'registry reference-key final check refused: %', findings;
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl144_registry_reference_key', 'completed',
           '{"file":"20261005000050_require_registry_reference_key.sql"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                        WHERE migration = 'wl144_registry_reference_key' AND action = 'completed');
END $registry_key$;
