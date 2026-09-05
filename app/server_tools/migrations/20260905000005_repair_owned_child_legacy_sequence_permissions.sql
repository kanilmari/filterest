-- 20260905000005_repair_owned_child_legacy_sequence_permissions.sql
-- Repairs PostgreSQL access to legacy nextval() defaults not linked with OWNED BY.
-- Completes the owned-child permission repair for old and third-party project schemas.
-- Exists because pg_attrdef, rather than the table, owns these sequence dependencies.
-- VERSION_DB: 9.7.2

DO $$
DECLARE
    relation_record RECORD;
    sequence_record RECORD;
    grant_record RECORD;
    grantee_sql TEXT;
BEGIN
    FOR relation_record IN
        SELECT DISTINCT
            child_table.oid AS child_table_oid,
            child_table.relowner AS child_owner_oid
        FROM public.system_foreign_key_relations_1_m AS relation_metadata
        JOIN public.system_db_tables AS child_metadata
          ON child_metadata.table_uid = relation_metadata.source_table_uid
        JOIN pg_catalog.pg_namespace AS child_schema
          ON child_schema.nspname = COALESCE(NULLIF(child_metadata.schema_name, ''), 'public')
        JOIN pg_catalog.pg_class AS child_table
          ON child_table.relnamespace = child_schema.oid
         AND child_table.relname = child_metadata.table_name
         AND child_table.relkind = 'r'
        WHERE relation_metadata.insert_new_source_with_target IS TRUE
          AND (
              COALESCE(
                  relation_metadata.target_insert_specs -> 'file_upload' ->> 'enabled',
                  'false'
              ) = 'true'
              OR EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_attribute AS spatial_column
                  JOIN pg_catalog.pg_type AS spatial_type
                    ON spatial_type.oid = spatial_column.atttypid
                  WHERE spatial_column.attrelid = child_table.oid
                    AND spatial_column.attnum > 0
                    AND NOT spatial_column.attisdropped
                    AND spatial_type.typname IN ('geometry', 'geography', 'point')
              )
          )
    LOOP
        FOR sequence_record IN
            SELECT DISTINCT
                sequence_schema.nspname AS sequence_schema_name,
                sequence.relname AS sequence_name
            FROM pg_catalog.pg_attrdef AS column_default
            JOIN pg_catalog.pg_depend AS default_dependency
              ON default_dependency.classid = 'pg_attrdef'::regclass
             AND default_dependency.objid = column_default.oid
             AND default_dependency.refclassid = 'pg_class'::regclass
            JOIN pg_catalog.pg_class AS sequence
              ON sequence.oid = default_dependency.refobjid
             AND sequence.relkind = 'S'
            JOIN pg_catalog.pg_namespace AS sequence_schema
              ON sequence_schema.oid = sequence.relnamespace
            WHERE column_default.adrelid = relation_record.child_table_oid
        LOOP
            FOR grant_record IN
                SELECT runtime_role.oid AS grantee, runtime_role.rolname AS grantee_name
                FROM pg_catalog.pg_roles AS runtime_role
                WHERE runtime_role.oid <> relation_record.child_owner_oid
                  AND NOT runtime_role.rolsuper
                  AND pg_catalog.has_table_privilege(
                      runtime_role.oid,
                      relation_record.child_table_oid,
                      'INSERT'
                  )
                UNION ALL
                SELECT 0::oid AS grantee, NULL::name AS grantee_name
                WHERE EXISTS (
                    SELECT 1
                    FROM pg_catalog.aclexplode(
                        COALESCE(
                            (SELECT relacl FROM pg_catalog.pg_class WHERE oid = relation_record.child_table_oid),
                            pg_catalog.acldefault('r', relation_record.child_owner_oid)
                        )
                    ) AS child_acl
                    WHERE child_acl.grantee = 0
                      AND child_acl.privilege_type = 'INSERT'
                )
            LOOP
                grantee_sql := CASE
                    WHEN grant_record.grantee = 0 THEN 'PUBLIC'
                    ELSE format('%I', grant_record.grantee_name)
                END;
                EXECUTE format(
                    'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO %s',
                    sequence_record.sequence_schema_name,
                    sequence_record.sequence_name,
                    grantee_sql
                );
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.2', 'Repair legacy sequence permissions for optional owned child rows'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.7.2'
);
