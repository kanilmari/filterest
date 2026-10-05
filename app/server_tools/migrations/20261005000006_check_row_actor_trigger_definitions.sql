-- 20261005000006_check_row_actor_trigger_definitions.sql
-- Checks each actor guard's complete trigger definition, as well as the marks,
-- foreign keys, enabled states and repair-history protections already checked.
-- Bridges the actor checker and the acceptance block: the right function and name
-- alone do not prove that a guard runs before every protected ordinary write.
-- Exists separately because 000001 and 000002 are public migrations that may have
-- run. On upgrade this schema repair follows the data step 000004 (with language
-- seed 000005 between them); 000004's own end check still uses 000002's version.
-- In the package it runs in the schema phase, before any actor columns are marked.
-- Its only data is its completion marker, written after a clean check.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_trigger_definitions
-- FINAL_CHECK: public.app_check_row_actor_marks()

-- pg_trigger's bit mask includes level, timing and events (ROW 1, BEFORE 2, INSERT 4,
-- DELETE 8, UPDATE 16, TRUNCATE 32): 31 is BEFORE ROW INSERT/UPDATE/DELETE, 34 is
-- BEFORE STATEMENT TRUNCATE, 19 is BEFORE ROW UPDATE.
CREATE OR REPLACE FUNCTION public.app_check_row_actor_marks()
RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE
    marked record;
    target regclass;
    column_row record;
    users_id_number smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                                 WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    guard record;
BEGIN
    -- A guard counts only when it fires on ordinary writes ('O' origin or 'A' always,
    -- not 'R' replica-only) and runs its own function.
    FOR guard IN
        SELECT * FROM (VALUES ('public.system_row_actor_columns', 'owner_only_writes', 'public.app_owner_only_writes()', 31, NULL::text),
                              ('public.system_row_actor_columns', 'owner_only_truncate', 'public.app_owner_only_writes()', 34, NULL::text),
                              ('public.system_data_repair_records', 'owner_only_writes', 'public.app_owner_only_writes()', 31, NULL::text),
                              ('public.system_data_repair_records', 'owner_only_truncate', 'public.app_owner_only_writes()', 34, NULL::text),
                              ('public.system_db_tables', 'protect_row_owner_setting', 'public.protect_row_owner_setting()', 19, 'row_policy_owner_column'))
                 AS wanted (table_name, trigger_name, function_name, trigger_type, filter_column)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                       WHERE tgrelid = guard.table_name::regclass AND tgname = guard.trigger_name
                         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                         AND tgfoid = guard.function_name::regprocedure
                         AND tgtype = guard.trigger_type AND tgqual IS NULL
                         AND tgattr::text = coalesce((SELECT attnum::text FROM pg_catalog.pg_attribute
                              WHERE attrelid = guard.table_name::regclass AND attname = guard.filter_column
                                AND attnum > 0 AND NOT attisdropped), '')) THEN
            RETURN NEXT format('%s: guard trigger %s is missing, not firing on ordinary writes or not running %s with the required timing, events, level, columns and no WHEN',
                               guard.table_name, guard.trigger_name, guard.function_name);
        END IF;
    END LOOP;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.system_data_repair_records'::regclass) THEN
        RETURN NEXT 'public.system_data_repair_records: row security is off';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                   WHERE polrelid = 'public.system_data_repair_records'::regclass
                     AND polname = 'repair_records_owner_role') THEN
        RETURN NEXT 'public.system_data_repair_records: policy repair_records_owner_role is missing';
    END IF;

    FOR marked IN
        SELECT registry.table_uid, registry.table_name, COALESCE(registry.schema_name, 'public') AS schema_name,
               registry.row_policy_owner_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'creator') AS creator_column,
               max(mark.column_name) FILTER (WHERE mark.actor_role = 'owner') AS owner_column
          FROM public.system_row_actor_columns AS mark
          JOIN public.system_db_tables AS registry ON registry.table_uid = mark.table_uid
         GROUP BY registry.table_uid, registry.table_name, registry.schema_name, registry.row_policy_owner_column
         ORDER BY registry.table_name
    LOOP
        target := to_regclass(format('%I.%I', marked.schema_name, marked.table_name));
        IF target IS NULL THEN
            RETURN NEXT format('%s: marked table does not exist', marked.table_name);
            CONTINUE;
        END IF;
        IF marked.creator_column IS NULL OR marked.owner_column IS NULL THEN
            RETURN NEXT format('%s: needs both a creator and an owner mark', marked.table_name);
        END IF;
        IF marked.owner_column IS DISTINCT FROM marked.row_policy_owner_column THEN
            RETURN NEXT format('%s: registry owner setting %s differs from the owner mark %s',
                               marked.table_name, COALESCE(marked.row_policy_owner_column, '(empty)'),
                               COALESCE(marked.owner_column, '(none)'));
        END IF;
        FOR column_row IN
            SELECT wanted.role, wanted.column_name, attribute.attnum, attribute.atttypid
              FROM (VALUES ('creator', marked.creator_column), ('owner', marked.owner_column))
                   AS wanted (role, column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = target AND attribute.attname = wanted.column_name
               AND attribute.attnum > 0 AND NOT attribute.attisdropped
             WHERE wanted.column_name IS NOT NULL
        LOOP
            IF column_row.attnum IS NULL THEN
                RETURN NEXT format('%s.%s: marked %s column does not exist',
                                   marked.table_name, column_row.column_name, column_row.role);
                CONTINUE;
            END IF;
            IF column_row.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) THEN
                RETURN NEXT format('%s.%s: marked %s column is %s, not integer or bigint', marked.table_name,
                                   column_row.column_name, column_row.role, format_type(column_row.atttypid, NULL));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND conkey = ARRAY[column_row.attnum]
                   AND confrelid = 'public.system_users'::regclass AND confkey = ARRAY[users_id_number]
                   AND convalidated AND confdeltype = 'n' AND confmatchtype = 's' AND NOT condeferrable) THEN
                RETURN NEXT format('%s.%s: no validated ON DELETE SET NULL foreign key to system_users(id)',
                                   marked.table_name, column_row.column_name);
            END IF;
            IF (SELECT count(*) FROM pg_catalog.pg_constraint
                 WHERE conrelid = target AND contype = 'f' AND column_row.attnum = ANY(conkey)) > 1 THEN
                RETURN NEXT format('%s.%s: has more than one foreign key', marked.table_name, column_row.column_name);
            END IF;
            IF column_row.role = 'creator' AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_trigger
                 WHERE tgrelid = target AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                   AND tgfoid = 'public.protect_row_creator()'::regprocedure
                   AND tgname = public.app_row_actor_object_name('protect', marked.table_name, 'creator')
                   AND tgtype = 19 AND tgattr::text = column_row.attnum::text AND tgqual IS NULL) THEN
                RETURN NEXT format('%s: the creator guard trigger is missing or not firing on ordinary writes with the required definition',
                                   marked.table_name);
            END IF;
        END LOOP;
    END LOOP;
    -- The marks table itself is keyed by table_uid, never by the registry id.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.system_row_actor_columns'::regclass
                 AND attname = 'table_id' AND attnum > 0 AND NOT attisdropped) THEN
        RETURN NEXT 'public.system_row_actor_columns: still keyed by the registry id (table_id)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint AS key
          JOIN pg_catalog.pg_attribute AS referencing
            ON referencing.attrelid = key.conrelid AND referencing.attnum = key.conkey[1]
          JOIN pg_catalog.pg_attribute AS referenced
            ON referenced.attrelid = key.confrelid AND referenced.attnum = key.confkey[1]
         WHERE key.conrelid = 'public.system_row_actor_columns'::regclass AND key.contype = 'f'
           AND key.confrelid = 'public.system_db_tables'::regclass
           AND cardinality(key.conkey) = 1 AND cardinality(key.confkey) = 1
           AND referencing.attname = 'table_uid' AND referenced.attname = 'table_uid'
           AND key.confdeltype = 'c' AND key.convalidated) THEN
        RETURN NEXT 'public.system_row_actor_columns: no validated ON DELETE CASCADE foreign key from table_uid to '
                    'system_db_tables(table_uid)';
    END IF;
    RETURN;
END $$;

DO $check$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding, E'\n') INTO findings FROM public.app_check_row_actor_marks() AS finding;
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'wl58_row_actor_trigger_definitions refused: ' || findings;
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl58_row_actor_trigger_definitions', 'completed',
           jsonb_build_object('file', '20261005000006_check_row_actor_trigger_definitions.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                        WHERE migration = 'wl58_row_actor_trigger_definitions' AND action = 'completed');
END $check$;
