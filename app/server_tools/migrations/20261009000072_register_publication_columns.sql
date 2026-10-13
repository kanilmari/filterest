-- 20261009000072_register_publication_columns.sql
-- Registers publication columns with the existing release-goal dataset metadata.
-- Connects upgraded installations and fresh seeds to the same discovered fields.
-- Preserves administrator-authored metadata and creates no publication content.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql
-- COMPLETION_MARKER: wl164_publication_column_metadata

DO $publication_metadata$
DECLARE registered_table_uid integer;
BEGIN
    SELECT table_uid INTO registered_table_uid FROM public.system_db_tables
    WHERE table_name='dev_agent_release_goals'
      AND COALESCE(NULLIF(schema_name,''),'public')='public';
    IF registered_table_uid IS NULL THEN
        RAISE EXCEPTION 'release-goal dataset metadata is missing';
    END IF;
    INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,created,updated)
    SELECT registered_table_uid,columns.column_name,columns.data_type,columns.ordinal_position,now(),now()
    FROM information_schema.columns columns
    WHERE columns.table_schema='public' AND columns.table_name='dev_agent_release_goals'
      AND columns.column_name IN ('publication_version','target_date','reader_description',
                                  'published','published_at','publication_revision')
      AND NOT EXISTS (SELECT 1 FROM public.system_column_details existing
          WHERE existing.table_uid=registered_table_uid AND existing.column_name=columns.column_name);
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl164_publication_column_metadata','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration='wl164_publication_column_metadata' AND action='completed');
END $publication_metadata$;
