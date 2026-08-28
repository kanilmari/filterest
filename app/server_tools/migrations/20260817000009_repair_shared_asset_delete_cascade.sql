-- 20260817000009_repair_shared_asset_delete_cascade.sql
-- Repairs delete behavior only for Filterest-managed shared asset child tables.
-- Connects file-upload relation metadata to its matching PostgreSQL foreign key.
-- Exists so deleting a parent row also removes its internally owned image rows.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

DO $$
DECLARE
    asset_constraint RECORD;
BEGIN
    IF to_regclass('public.system_foreign_key_relations_1_m') IS NULL
       OR to_regclass('public.system_db_tables') IS NULL THEN
        RAISE NOTICE 'Filterest relation metadata is unavailable; skipping asset cascade repair';
        RETURN;
    END IF;

    FOR asset_constraint IN
        SELECT
            constraints.conname AS constraint_name,
            source_schema.nspname AS source_schema_name,
            source_table.relname AS source_table_name,
            source_attribute.attname AS source_column_name,
            target_schema.nspname AS target_schema_name,
            target_table.relname AS target_table_name,
            target_attribute.attname AS target_column_name
        FROM public.system_foreign_key_relations_1_m AS relation_metadata
        JOIN public.system_db_tables AS source_metadata
          ON source_metadata.table_uid = relation_metadata.source_table_uid
        JOIN public.system_db_tables AS target_metadata
          ON target_metadata.table_uid = relation_metadata.target_table_uid
        JOIN pg_namespace AS source_schema
          ON source_schema.nspname = COALESCE(NULLIF(source_metadata.schema_name, ''), 'public')
        JOIN pg_class AS source_table
          ON source_table.relnamespace = source_schema.oid
         AND source_table.relname = source_metadata.table_name
         AND source_table.relkind IN ('r', 'p')
        JOIN pg_namespace AS target_schema
          ON target_schema.nspname = COALESCE(NULLIF(target_metadata.schema_name, ''), 'public')
        JOIN pg_class AS target_table
          ON target_table.relnamespace = target_schema.oid
         AND target_table.relname = target_metadata.table_name
         AND target_table.relkind IN ('r', 'p')
        JOIN pg_constraint AS constraints
          ON constraints.contype = 'f'
         AND constraints.conrelid = source_table.oid
         AND constraints.confrelid = target_table.oid
         AND array_length(constraints.conkey, 1) = 1
         AND array_length(constraints.confkey, 1) = 1
        JOIN pg_attribute AS source_attribute
          ON source_attribute.attrelid = source_table.oid
         AND source_attribute.attnum = constraints.conkey[1]
         AND source_attribute.attisdropped IS FALSE
        JOIN pg_attribute AS target_attribute
          ON target_attribute.attrelid = target_table.oid
         AND target_attribute.attnum = constraints.confkey[1]
         AND target_attribute.attisdropped IS FALSE
        WHERE COALESCE(NULLIF(source_metadata.schema_name, ''), 'public') = 'public'
          AND COALESCE(NULLIF(target_metadata.schema_name, ''), 'public') = 'public'
          AND source_metadata.table_name = target_metadata.table_name || '_assets'
          AND relation_metadata.source_column_name = target_metadata.table_name || '_id'
          AND relation_metadata.target_column_name = 'id'
          AND source_attribute.attname = relation_metadata.source_column_name
          AND target_attribute.attname = relation_metadata.target_column_name
          AND lower(COALESCE(
              relation_metadata.target_insert_specs -> 'file_upload' ->> 'enabled',
              'false'
          )) = 'true'
          AND constraints.confdeltype <> 'c'
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT %I',
            asset_constraint.source_schema_name,
            asset_constraint.source_table_name,
            asset_constraint.constraint_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
            'REFERENCES %I.%I (%I) ON DELETE CASCADE',
            asset_constraint.source_schema_name,
            asset_constraint.source_table_name,
            asset_constraint.constraint_name,
            asset_constraint.source_column_name,
            asset_constraint.target_schema_name,
            asset_constraint.target_table_name,
            asset_constraint.target_column_name
        );
    END LOOP;
END $$;
