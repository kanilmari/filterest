-- 20260908000010_restrict_media_registry_and_restore_support_view.sql
-- Repairs inherited media-registry grants and accidental ordinary-dataset metadata.
-- Connects dedicated media APIs, exact SQL table privileges and the read-only support matrix.
-- Preserves physical assets, other datasets, existing roles and global default privileges.
-- VERSION_DB: 9.7.13

-- BEGIN exact media registry role policy.
REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
  WHERE rolname IN ('admin_user','basic_user','confidential_user','readonly_user','readeronly','guest_user') LOOP
  -- Default ACLs may have granted direct CRUD before this explicit table policy.
  EXECUTE format('REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM %I', role_name);
  EXECUTE format('GRANT SELECT ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  IF role_name IN ('admin_user','basic_user','confidential_user') THEN
   EXECUTE format('GRANT INSERT, DELETE ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  END IF;
 END LOOP;
END $$;
-- END exact media registry role policy.

-- Remove only accidental generic catalog records; physical files/tables/rows stay.
-- The registry cannot itself be a source dataset for another independent asset.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.system_media_assets a JOIN public.system_db_tables t
   ON t.table_uid IN (a.parent_table_uid, a.child_table_uid)
  WHERE t.table_name IN ('system_media_assets','system_media_asset_usages')
   AND COALESCE(NULLIF(t.schema_name,''),'public')='public'
 ) THEN
  RAISE EXCEPTION 'Media registry unexpectedly references its own generic metadata';
 END IF;
END $$;
WITH internal_tables AS (
 SELECT table_uid FROM public.system_db_tables
 WHERE table_name IN ('system_media_assets','system_media_asset_usages')
  AND COALESCE(NULLIF(schema_name,''),'public')='public'
), removed_rights AS (
 DELETE FROM public.system_group_table_func_rights WHERE target_table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
), removed_fk_1m AS (
 DELETE FROM public.system_foreign_key_relations_1_m WHERE source_table_uid IN
  (SELECT table_uid FROM internal_tables) OR target_table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
), removed_fk_mm AS (
 DELETE FROM public.system_foreign_key_relations_m_m WHERE table_a_uid IN
  (SELECT table_uid FROM internal_tables) OR table_b_uid IN
  (SELECT table_uid FROM internal_tables) OR bridging_table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
), removed_controls AS (
 DELETE FROM public.system_column_control WHERE table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
), removed_columns AS (
 DELETE FROM public.system_column_details WHERE table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
), removed_views AS (
 DELETE FROM public.system_table_row_view_counts WHERE table_uid IN
  (SELECT table_uid FROM internal_tables) RETURNING id
)
DELETE FROM public.system_db_tables WHERE table_uid IN (SELECT table_uid FROM internal_tables);

-- BEGIN unchanged support-view registration repair from migration 08.
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
-- END unchanged support-view registration repair.

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.13', 'Restrict media registry privileges and repair dedicated catalog boundaries'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version='9.7.13');
