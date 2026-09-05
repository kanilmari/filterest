-- 20260905000004_repair_owned_child_runtime_permissions.sql
-- Repairs PostgreSQL role access for managed asset and optional location child rows.
-- Bridges parent dataset ACLs, policy-routed request pools, and child serial sequences.
-- Exists so fresh and upgraded projects can create owned children without using the table owner pool.
-- VERSION_DB: 9.7.1

DO $$
DECLARE
    relation_record RECORD;
    grant_record RECORD;
    sequence_record RECORD;
    grantee_sql TEXT;
BEGIN
    FOR relation_record IN
        SELECT DISTINCT
            child_schema.nspname AS child_schema_name,
            child_table.relname AS child_table_name,
            child_table.oid AS child_table_oid,
            child_table.relowner AS child_owner_oid,
            parent_schema.nspname AS parent_schema_name,
            parent_table.relname AS parent_table_name,
            parent_table.oid AS parent_table_oid,
            parent_table.relowner AS parent_owner_oid
        FROM public.system_foreign_key_relations_1_m AS relation_metadata
        JOIN public.system_db_tables AS child_metadata
          ON child_metadata.table_uid = relation_metadata.source_table_uid
        JOIN public.system_db_tables AS parent_metadata
          ON parent_metadata.table_uid = relation_metadata.target_table_uid
        JOIN pg_catalog.pg_namespace AS child_schema
          ON child_schema.nspname = COALESCE(NULLIF(child_metadata.schema_name, ''), 'public')
        JOIN pg_catalog.pg_class AS child_table
          ON child_table.relnamespace = child_schema.oid
         AND child_table.relname = child_metadata.table_name
         AND child_table.relkind = 'r'
        JOIN pg_catalog.pg_namespace AS parent_schema
          ON parent_schema.nspname = COALESCE(NULLIF(parent_metadata.schema_name, ''), 'public')
        JOIN pg_catalog.pg_class AS parent_table
          ON parent_table.relnamespace = parent_schema.oid
         AND parent_table.relname = parent_metadata.table_name
         AND parent_table.relkind = 'r'
        WHERE relation_metadata.insert_new_source_with_target IS TRUE
          AND (
              COALESCE(
                  relation_metadata.target_insert_specs -> 'file_upload' ->> 'enabled',
                  'false'
              ) = 'true'
              OR EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_attribute AS geometry_column
                  JOIN pg_catalog.pg_type AS geometry_type
                    ON geometry_type.oid = geometry_column.atttypid
                  WHERE geometry_column.attrelid = child_table.oid
                    AND geometry_column.attnum > 0
                    AND NOT geometry_column.attisdropped
                    AND geometry_type.typname IN ('geometry', 'geography', 'point')
              )
          )
    LOOP
        -- Copy the parent's explicit non-owner ACL. The application permission
        -- layer remains authoritative; this only lets its selected DB pool
        -- execute the same physical operations it can execute on the parent.
        FOR grant_record IN
            SELECT
                parent_acl.grantee,
                grantee.rolname AS grantee_name,
                parent_acl.privilege_type
            FROM pg_catalog.aclexplode(
                COALESCE(
                    (SELECT relacl FROM pg_catalog.pg_class WHERE oid = relation_record.parent_table_oid),
                    pg_catalog.acldefault('r', relation_record.parent_owner_oid)
                )
            ) AS parent_acl
            LEFT JOIN pg_catalog.pg_roles AS grantee
              ON grantee.oid = parent_acl.grantee
            WHERE parent_acl.grantee <> relation_record.parent_owner_oid
        LOOP
            IF grant_record.privilege_type NOT IN (
                'SELECT', 'INSERT', 'UPDATE', 'DELETE',
                'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ) THEN
                RAISE EXCEPTION 'unsupported table privilege %', grant_record.privilege_type;
            END IF;
            grantee_sql := CASE
                WHEN grant_record.grantee = 0 THEN 'PUBLIC'
                ELSE format('%I', grant_record.grantee_name)
            END;
            EXECUTE format(
                'GRANT %s ON TABLE %I.%I TO %s',
                grant_record.privilege_type,
                relation_record.child_schema_name,
                relation_record.child_table_name,
                grantee_sql
            );
        END LOOP;

        -- Every non-owner role that can insert the child also needs nextval()
        -- access to every serial/identity sequence owned by that child table.
        FOR sequence_record IN
            SELECT DISTINCT
                sequence_schema.nspname AS sequence_schema_name,
                sequence.relname AS sequence_name
            FROM pg_catalog.pg_depend AS dependency
            JOIN pg_catalog.pg_class AS sequence
              ON sequence.oid = dependency.objid
             AND sequence.relkind = 'S'
            JOIN pg_catalog.pg_namespace AS sequence_schema
              ON sequence_schema.oid = sequence.relnamespace
            WHERE dependency.refobjid = relation_record.child_table_oid
              AND dependency.refclassid = 'pg_class'::regclass
              AND dependency.classid = 'pg_class'::regclass
              AND dependency.deptype IN ('a', 'i')
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
SELECT '9.7.1', 'Repair runtime table and sequence permissions for asset and optional location children'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.7.1'
);
