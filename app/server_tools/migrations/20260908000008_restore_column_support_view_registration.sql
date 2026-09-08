-- 20260908000008_restore_column_support_view_registration.sql
-- Restores the read-only support matrix after older catalog cleanup removed its metadata.
-- Connects preserved PostgreSQL views to the dataset tree and administrator read permissions.
-- Does not recreate the view, replace site translations, or grant ordinary users dataset access.
-- VERSION_DB: 9.7.11

INSERT INTO public.system_db_tables (
    table_name,
    description,
    cached_oid,
    folder_id,
    schema_name,
    fk_display_column,
    filterbar_visible_by_default,
    is_removable,
    display_name,
    sql_dump_policy,
    default_view_id
)
SELECT
    'system_column_supported_views',
    'Read-only filterable matrix of registered columns and supported views',
    classes.oid::INTEGER,
    (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_table_views'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    ),
    'public',
    'column_name',
    TRUE,
    FALSE,
    'Column Supported Views',
    'none',
    (
        SELECT id
        FROM public.system_table_views
        WHERE view_key = 'table'
        LIMIT 1
    )
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE classes.relname = 'system_column_supported_views'
  AND classes.relkind = 'v'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_db_tables AS existing
      WHERE existing.table_name = 'system_column_supported_views'
        AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
  );

UPDATE public.system_db_tables AS target
SET description = 'Read-only filterable matrix of registered columns and supported views',
    cached_oid = classes.oid::INTEGER,
    folder_id = COALESCE(target.folder_id, (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_table_views'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    )),
    schema_name = 'public',
    fk_display_column = 'column_name',
    filterbar_visible_by_default = TRUE,
    is_removable = FALSE,
    display_name = 'Column Supported Views',
    sql_dump_policy = 'none',
    default_view_id = COALESCE(target.default_view_id, (
        SELECT id
        FROM public.system_table_views
        WHERE view_key = 'table'
        LIMIT 1
    )),
    updated = now()
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE target.table_name = 'system_column_supported_views'
  AND COALESCE(NULLIF(target.schema_name, ''), 'public') = 'public'
  AND classes.relname = 'system_column_supported_views'
  AND classes.relkind = 'v';

DO $$
DECLARE
    matrix_table_uid INTEGER;
BEGIN
    SELECT table_uid
    INTO matrix_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_column_supported_views'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LIMIT 1;

    IF matrix_table_uid IS NULL THEN
        RAISE EXCEPTION 'column support matrix registration failed';
    END IF;

    INSERT INTO public.system_column_details (
        table_uid,
        column_name,
        data_type,
        co_number,
        editable_in_ui,
        is_multilingual,
        created,
        updated
    )
    SELECT
        matrix_table_uid,
        columns.column_name,
        columns.data_type,
        columns.ordinal_position,
        FALSE,
        FALSE,
        now(),
        now()
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'system_column_supported_views'
      AND NOT EXISTS (
          SELECT 1
          FROM public.system_column_details AS existing
          WHERE existing.table_uid = matrix_table_uid
            AND existing.column_name = columns.column_name
      )
    ORDER BY columns.ordinal_position;

    UPDATE public.system_column_details
    SET editable_in_ui = FALSE,
        is_multilingual = FALSE,
        hide_everywhere = FALSE,
        hide_in_filter_panel = FALSE,
        client_delivery_mode = 'include',
        updated = now()
    WHERE table_uid = matrix_table_uid;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO readeronly;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO admin_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO basic_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO guest_user;
    END IF;
END $$;

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
    'Filterest DB 9.7.3 administrator column support matrix read access',
    matrix.table_uid
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'dtt_1_row_read.GetResultsHandlerWrapper',
      'dtt_1_row_read.GetRowCountHandlerWrapper',
      'dtt_1_row_read.GetFilterOptionsHandler',
      'dtt_3_table_read.GetTableViewHandlerWrapper',
      'dtt_2_column_crud.GetTableColumnsHandler'
  )
JOIN public.system_db_tables AS matrix
  ON matrix.table_name = 'system_column_supported_views'
 AND COALESCE(NULLIF(matrix.schema_name, ''), 'public') = 'public'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid = matrix.table_uid
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );


INSERT INTO public.system_db_version (version, description)
SELECT '9.7.11', 'Restore support-matrix registration and preserve registered SQL views'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.11');
