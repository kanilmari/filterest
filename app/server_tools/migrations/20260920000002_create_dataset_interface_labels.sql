-- 20260920000002_create_dataset_interface_labels.sql
-- Backfills readable interface labels for registered datasets and their columns.
-- Bridges schema-derived names with both translation stores and source tracking.
-- Exists because interface-created datasets previously registered no label keys.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

WITH dataset_names AS (
    SELECT DISTINCT tables.table_name,
           UPPER(LEFT(readable.value, 1)) || SUBSTRING(readable.value FROM 2) AS label
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    CROSS JOIN LATERAL (
        SELECT REPLACE(REPLACE(
            REGEXP_REPLACE(tables.table_name, '^(app_|system_|dev_)', ''),
            '_', ' '
        ), '-', ' ') AS value
    ) AS readable
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), column_names AS (
    SELECT DISTINCT tables.table_name,
           attributes.attname AS column_name,
           UPPER(LEFT(readable.value, 1)) || SUBSTRING(readable.value FROM 2) AS label
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = classes.oid
     AND attributes.attnum > 0
     AND NOT attributes.attisdropped
    CROSS JOIN LATERAL (
        SELECT REPLACE(REPLACE(attributes.attname, '_', ' '), '-', ' ') AS value
    ) AS readable
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), requested(lang_key, fi, en) AS (
    SELECT table_name, label, label FROM dataset_names
    UNION ALL
    SELECT 'add_row_' || table_name, 'Lisää rivi: ' || label, 'Add row: ' || label
    FROM dataset_names
    UNION ALL
    SELECT 'search_for_' || table_name, 'Etsi: ' || label, 'Search: ' || label
    FROM dataset_names
    UNION ALL
    SELECT 'search_slogan_' || table_name,
           'Selaa aineistoa ' || label || '.',
           'Browse ' || label || '.'
    FROM dataset_names
    UNION ALL
    SELECT table_name || '_front_page', label, label FROM dataset_names
    UNION ALL
    SELECT column_name, label, label FROM column_names
    UNION ALL
    SELECT 'search_for_' || column_name, 'Etsi: ' || label, 'Search: ' || label
    FROM column_names
    UNION ALL
    SELECT column_name || '_asc', label || ', nouseva', label || ', ascending'
    FROM column_names
    UNION ALL
    SELECT column_name || '_desc', label || ', laskeva', label || ', descending'
    FROM column_names
), unique_requested AS (
    SELECT DISTINCT ON (lang_key) lang_key, fi, en
    FROM requested
    ORDER BY lang_key
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT requested.lang_key,
       CASE WHEN EXISTS (
           SELECT 1 FROM public.system_languages
           WHERE language_code = 'fi' AND is_enabled
       ) THEN requested.fi END,
       CASE WHEN EXISTS (
           SELECT 1 FROM public.system_languages
           WHERE language_code = 'en' AND is_enabled
       ) THEN requested.en END,
       'Interface label derived from dataset schema names.'
FROM unique_requested AS requested
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE
        WHEN EXCLUDED.fi IS NOT NULL
         AND NULLIF(BTRIM(system_lang_keys.fi), '') IS NULL
        THEN EXCLUDED.fi
        ELSE system_lang_keys.fi
    END,
    en = CASE
        WHEN EXCLUDED.en IS NOT NULL
         AND NULLIF(BTRIM(system_lang_keys.en), '') IS NULL
        THEN EXCLUDED.en
        ELSE system_lang_keys.en
    END,
    creation_spec = CASE
        WHEN NULLIF(BTRIM(system_lang_keys.creation_spec), '') IS NULL
        THEN EXCLUDED.creation_spec
        ELSE system_lang_keys.creation_spec
    END,
    updated = NOW();

WITH dataset_names AS (
    SELECT DISTINCT tables.table_name,
           UPPER(LEFT(readable.value, 1)) || SUBSTRING(readable.value FROM 2) AS label
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    CROSS JOIN LATERAL (
        SELECT REPLACE(REPLACE(
            REGEXP_REPLACE(tables.table_name, '^(app_|system_|dev_)', ''),
            '_', ' '
        ), '-', ' ') AS value
    ) AS readable
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), column_names AS (
    SELECT DISTINCT tables.table_name,
           attributes.attname AS column_name,
           UPPER(LEFT(readable.value, 1)) || SUBSTRING(readable.value FROM 2) AS label
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = classes.oid
     AND attributes.attnum > 0
     AND NOT attributes.attisdropped
    CROSS JOIN LATERAL (
        SELECT REPLACE(REPLACE(attributes.attname, '_', ' '), '-', ' ') AS value
    ) AS readable
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), requested(lang_key) AS (
    SELECT table_name FROM dataset_names
    UNION
    SELECT 'add_row_' || table_name FROM dataset_names
    UNION
    SELECT 'search_for_' || table_name FROM dataset_names
    UNION
    SELECT 'search_slogan_' || table_name FROM dataset_names
    UNION
    SELECT table_name || '_front_page' FROM dataset_names
    UNION
    SELECT column_name FROM column_names
    UNION
    SELECT 'search_for_' || column_name FROM column_names
    UNION
    SELECT column_name || '_asc' FROM column_names
    UNION
    SELECT column_name || '_desc' FROM column_names
), authored_translations AS (
    SELECT keys.id AS lang_key_id,
           translated.language_code,
           translated.translation
    FROM requested
    JOIN public.system_lang_keys AS keys USING (lang_key)
    CROSS JOIN LATERAL (
        VALUES ('fi', keys.fi), ('en', keys.en)
    ) AS translated(language_code, translation)
    JOIN public.system_languages AS languages
      ON languages.language_code = translated.language_code
     AND languages.is_enabled
    WHERE NULLIF(BTRIM(translated.translation), '') IS NOT NULL
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'import', 'unreviewed'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO NOTHING;

WITH dataset_names AS (
    SELECT DISTINCT tables.table_name
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), column_names AS (
    SELECT DISTINCT tables.table_name, attributes.attname AS column_name
    FROM public.system_db_tables AS tables
    JOIN pg_catalog.pg_class AS classes
      ON classes.relname = tables.table_name
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
     AND namespaces.nspname = COALESCE(NULLIF(tables.schema_name, ''), 'public')
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = classes.oid
     AND attributes.attnum > 0
     AND NOT attributes.attisdropped
    WHERE COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
      AND classes.relkind IN ('r', 'p')
), requested(
    lang_key, source_type, source_high, source_low, usage_explanation
) AS (
    SELECT table_name, 'table', table_name, table_name,
           'Readable dataset label derived from the registered schema name.'
    FROM dataset_names
    UNION ALL
    SELECT 'add_row_' || table_name, 'table', table_name, table_name,
           'Add-row label derived from the registered dataset name.'
    FROM dataset_names
    UNION ALL
    SELECT 'search_for_' || table_name, 'table', table_name, table_name,
           'Search placeholder derived from the registered dataset name.'
    FROM dataset_names
    UNION ALL
    SELECT 'search_slogan_' || table_name, 'table', table_name, table_name,
           'Search subtitle derived from the registered dataset name.'
    FROM dataset_names
    UNION ALL
    SELECT table_name || '_front_page', 'table', table_name, table_name,
           'Page heading derived from the registered dataset name.'
    FROM dataset_names
    UNION ALL
    SELECT column_name, 'column', table_name, column_name,
           'Readable column label derived from the registered schema name.'
    FROM column_names
    UNION ALL
    SELECT 'search_for_' || column_name, 'column', table_name, column_name,
           'Search placeholder derived from the registered column name.'
    FROM column_names
    UNION ALL
    SELECT column_name || '_asc', 'column', table_name, column_name,
           'Ascending sort label derived from the registered column name.'
    FROM column_names
    UNION ALL
    SELECT column_name || '_desc', 'column', table_name, column_name,
           'Descending sort label derived from the registered column name.'
    FROM column_names
)
INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low,
    usage_explanation, last_seen
)
SELECT DISTINCT keys.id,
       requested.source_type,
       requested.source_high,
       requested.source_low,
       requested.usage_explanation,
       CURRENT_DATE
FROM requested
JOIN public.system_lang_keys AS keys USING (lang_key)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = CASE
        WHEN NULLIF(BTRIM(system_lang_key_sources.usage_explanation), '') IS NULL
        THEN EXCLUDED.usage_explanation
        ELSE system_lang_key_sources.usage_explanation
    END,
    last_seen = CURRENT_DATE;
