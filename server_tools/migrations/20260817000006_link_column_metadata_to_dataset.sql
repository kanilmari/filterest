-- 20260817000006_link_column_metadata_to_dataset.sql
-- Makes the dataset identity in column metadata a real foreign key so dynamic
-- table views can expose the referenced dataset's human-readable name column.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS constraints
        JOIN pg_class AS source_table
          ON source_table.oid = constraints.conrelid
        JOIN pg_namespace AS source_schema
          ON source_schema.oid = source_table.relnamespace
        JOIN pg_class AS target_table
          ON target_table.oid = constraints.confrelid
        JOIN pg_namespace AS target_schema
          ON target_schema.oid = target_table.relnamespace
        WHERE constraints.contype = 'f'
          AND source_schema.nspname = 'public'
          AND source_table.relname = 'system_column_details'
          AND target_schema.nspname = 'public'
          AND target_table.relname = 'system_db_tables'
          AND constraints.conkey = ARRAY[
              (
                  SELECT attributes.attnum
                  FROM pg_attribute AS attributes
                  WHERE attributes.attrelid = source_table.oid
                    AND attributes.attname = 'table_uid'
                    AND attributes.attisdropped IS FALSE
              )
          ]::SMALLINT[]
          AND constraints.confkey = ARRAY[
              (
                  SELECT attributes.attnum
                  FROM pg_attribute AS attributes
                  WHERE attributes.attrelid = target_table.oid
                    AND attributes.attname = 'table_uid'
                    AND attributes.attisdropped IS FALSE
              )
          ]::SMALLINT[]
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT fk_system_column_details_table_uid
            FOREIGN KEY (table_uid)
            REFERENCES public.system_db_tables(table_uid)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint AS constraints
        WHERE constraints.conrelid = 'public.system_column_details'::regclass
          AND constraints.conname = 'fk_system_column_details_table_uid'
          AND constraints.convalidated IS FALSE
    ) THEN
        ALTER TABLE public.system_column_details
            VALIDATE CONSTRAINT fk_system_column_details_table_uid;
    END IF;
END $$;
