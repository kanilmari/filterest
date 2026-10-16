-- 20261015000006_backfill_translation_object_sources.sql
-- Associates existing dataset, column and folder labels before scoped serving.
-- Connects upgrades and fresh installs to the runtime label creators' ownership.
-- Adds provenance only; retains every existing source and translation (WO-SEC2).
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: translation_object_sources_sec2

DO $translation_object_sources$
DECLARE
    before_count bigint;
    after_count bigint;
    unresolved record;
BEGIN
    SELECT count(DISTINCT lang_key_id) INTO before_count
    FROM public.system_lang_key_sources
    WHERE source_type IN ('table', 'column', 'folder', 'dataset_header', 'column_value', 'foreign_key');

    WITH datasets AS (
        SELECT DISTINCT table_name FROM public.system_db_tables
        WHERE COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    ), columns AS (
        SELECT DISTINCT dataset.table_name, col.column_name
        FROM datasets dataset
        JOIN information_schema.columns col
          ON col.table_schema = 'public' AND col.table_name = dataset.table_name
    ), objects(source_type, source_high, source_low) AS (
        SELECT 'table', table_name, table_name FROM datasets
        UNION
        SELECT 'column', table_name, column_name FROM columns
    ), requested AS (
        SELECT names.lang_key, object.source_type, object.source_high, object.source_low
        FROM objects object CROSS JOIN LATERAL (VALUES
            (object.source_low),
            ('add_row_' || object.source_low),
            ('search_for_' || object.source_low),
            ('search_slogan_' || object.source_low),
            (object.source_low || '_front_page'),
            (object.source_low || '_asc'),
            (object.source_low || '_desc')
        ) names(lang_key)
        UNION
        SELECT folder_name, 'folder', folder_name, folder_name
        FROM public.system_table_folders WHERE NULLIF(btrim(folder_name), '') IS NOT NULL
    )
    INSERT INTO public.system_lang_key_sources
        (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
    SELECT DISTINCT ON (keys.id, requested.source_type, requested.source_high)
           keys.id, requested.source_type, requested.source_high, requested.source_low,
           'Object label association repaired by WO-SEC2.', CURRENT_DATE
    FROM requested JOIN public.system_lang_keys keys USING (lang_key)
    ORDER BY keys.id, requested.source_type, requested.source_high, requested.source_low
    ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;

    SELECT count(DISTINCT lang_key_id) INTO after_count
    FROM public.system_lang_key_sources
    WHERE source_type IN ('table', 'column', 'folder', 'dataset_header', 'column_value', 'foreign_key');
    RAISE NOTICE 'WO-SEC2 associated keys before=%, after=%', before_count, after_count;

    FOR unresolved IN
        SELECT keys.lang_key FROM public.system_lang_keys keys
        WHERE (keys.lang_key ~ '^(add_row_|search_for_|search_slogan_)'
               OR keys.lang_key ~ '(_asc|_desc|_front_page)$'
               OR keys.creation_spec = 'Interface label derived from dataset schema names.')
          AND NOT EXISTS (
              SELECT 1 FROM public.system_lang_key_sources source
              WHERE source.lang_key_id = keys.id
                AND source.source_type IN ('table', 'column', 'folder', 'dataset_header', 'column_value', 'foreign_key')
                -- Storage provenance does not resolve an object's owner. This
                -- reviewed list mirrors translationStorageTable in the reader;
                -- unknown system tables remain restrictive, never prefix-guessed.
                AND NOT (source.source_type = 'foreign_key'
                    AND split_part(source.source_high, '.', 1) = 'public'
                    AND split_part(source.source_high, '.', 2) IN (
                        'system_lang_keys', 'system_lang_keys_archive', 'system_lang_key_sources',
                        'system_lang_key_translations', 'system_lang_key_types', 'system_languages'))
          )
        ORDER BY keys.lang_key
    LOOP
        RAISE WARNING 'WO-SEC2 unresolved object key (withheld from non-admin translations): %', unresolved.lang_key;
    END LOOP;

    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'translation_object_sources_sec2', 'completed',
           jsonb_build_object('file', '20261015000006_backfill_translation_object_sources.sql',
                              'associated_before', before_count, 'associated_after', after_count)
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration = 'translation_object_sources_sec2' AND action = 'completed');
END $translation_object_sources$;
