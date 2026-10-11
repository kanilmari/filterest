-- 20261009000082_complete_registered_column_metadata.sql
-- Completes column metadata before a registered dataset reaches a generic editor.
-- Connects fresh bootstrap and upgraded registries to the same structural defaults.
-- Keeps creation scoped to its own relation without depending on incidental global repair.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: t919_registered_column_metadata

DO $registered_columns$
BEGIN
    -- These are the defaults of UpdateColumnMetadata, with the registry's
    -- immutable reference key protected even when its metadata was absent.
    -- Existing permission flags, presentation choices and diagnostics stay intact.
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, card_element, show_key_on_card, editable_in_ui)
    SELECT registry.table_uid, attribute.attname,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
           attribute.attnum, 'details', NULL,
           NOT (COALESCE(NULLIF(registry.schema_name, ''), 'public') = 'public'
                AND registry.table_name = 'system_db_tables' AND attribute.attname = 'table_uid')
      FROM public.system_db_tables AS registry
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = CASE WHEN NULLIF(registry.table_name, '') IS NOT NULL
             THEN to_regclass(format('%I.%I',
                 COALESCE(NULLIF(registry.schema_name, ''), 'public'), registry.table_name)) END
     WHERE registry.table_uid IS NOT NULL
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
       AND NOT EXISTS (
           SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registry.table_uid
              AND existing.column_name = attribute.attname
       )
     ORDER BY registry.table_uid, attribute.attnum;

    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 't919_registered_column_metadata', 'completed',
           '{"file":"20261009000082_complete_registered_column_metadata.sql"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                        WHERE migration = 't919_registered_column_metadata' AND action = 'completed');
END $registered_columns$;
