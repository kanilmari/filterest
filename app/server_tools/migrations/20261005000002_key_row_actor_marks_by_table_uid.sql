-- 20261005000002_key_row_actor_marks_by_table_uid.sql
-- Keys the actor marks by the registry's table_uid, the key every other reference to
-- system_db_tables already uses, and moves the functions that read and write the
-- marks to it. Marks that exist keep their columns.
-- Bridges 000001, which keyed the marks by the registry id, and every later reader and
-- writer (the release's data file 000004, dataset creation, the final check).
-- Exists because two keys for one registry let a join on the wrong one silently answer
-- for another dataset: on a long-lived database id and table_uid differ on every row
-- and many values collide, while a new installation starts with them equal, so tests
-- would not notice (owner decision K211, 5.10.2026). 000001 was already public when
-- this was found, and a migration that may have run is never edited, so this file
-- converts. It is schema only; its one row is its own completion marker. Running it
-- again changes nothing.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_marks_by_table_uid
-- FINAL_CHECK: public.app_check_row_actor_marks()

-- 1. The marks table: table_uid replaces the registry id, as key and as foreign key.
-- Each existing mark takes its registry row's table_uid. A mark whose registry row has
-- no table_uid stops the file, because the mark could not be kept.
DO $convert$
DECLARE
    old_constraint record;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.system_row_actor_columns'::regclass
                 AND attname = 'table_id' AND attnum > 0 AND NOT attisdropped) THEN
        ALTER TABLE public.system_row_actor_columns ADD COLUMN IF NOT EXISTS table_uid integer;
        UPDATE public.system_row_actor_columns AS marked
           SET table_uid = registry.table_uid
          FROM public.system_db_tables AS registry
         WHERE registry.id = marked.table_id
           AND marked.table_uid IS DISTINCT FROM registry.table_uid;
        IF EXISTS (SELECT 1 FROM public.system_row_actor_columns WHERE table_uid IS NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'not_null_violation',
                MESSAGE = 'an actor mark points to a registry row without table_uid; the marks were not converted';
        END IF;
        FOR old_constraint IN
            SELECT conname FROM pg_catalog.pg_constraint
             WHERE conrelid = 'public.system_row_actor_columns'::regclass AND contype IN ('p', 'f')
        LOOP
            EXECUTE format('ALTER TABLE public.system_row_actor_columns DROP CONSTRAINT %I', old_constraint.conname);
        END LOOP;
        ALTER TABLE public.system_row_actor_columns DROP COLUMN table_id;
        ALTER TABLE public.system_row_actor_columns ALTER COLUMN table_uid SET NOT NULL;
        ALTER TABLE public.system_row_actor_columns
            ADD CONSTRAINT system_row_actor_columns_table_uid_fkey FOREIGN KEY (table_uid)
            REFERENCES public.system_db_tables (table_uid) ON DELETE CASCADE;
        ALTER TABLE public.system_row_actor_columns
            ADD CONSTRAINT system_row_actor_columns_pkey PRIMARY KEY (table_uid, actor_role);
    END IF;
END $convert$;

COMMENT ON TABLE public.system_row_actor_columns IS
    'Permanent marks naming each marked dataset''s creator and owner columns, keyed by the registry table_uid; written only by the table owner role.';
COMMENT ON COLUMN public.system_row_actor_columns.table_uid IS
    'The marked dataset''s registry table_uid, the key every reference to system_db_tables uses; never its id.';

-- 2. The registry's owner setting stays the marked owner column (000001 section 4),
-- now found by table_uid.
CREATE OR REPLACE FUNCTION public.protect_row_owner_setting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.system_row_actor_columns AS marked
               WHERE marked.table_uid = OLD.table_uid AND marked.actor_role = 'owner'
                 AND marked.column_name IS DISTINCT FROM NEW.row_policy_owner_column) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', CONSTRAINT = 'row_owner_setting_fixed',
            MESSAGE = 'row owner setting is fixed to the marked owner column';
    END IF;
    RETURN NEW;
END $$;

-- 3. Registration takes the registry table_uid. The registry-id form goes, so no caller
-- can pass the other key by mistake. The body is 000001 section 12 on table_uid.
DROP FUNCTION IF EXISTS public.app_register_row_actor_columns(bigint, text);
CREATE OR REPLACE FUNCTION public.app_register_row_actor_columns(registry_table_uid integer, owner_column text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    changes jsonb := '[]'::jsonb;
    registry record;
    target regclass;
    users_table_uid integer;
    actor record;
    previous_flag boolean;
BEGIN
    SELECT table_uid, table_name, COALESCE(schema_name, 'public') AS schema_name, row_policy_owner_column
      INTO registry
      FROM public.system_db_tables WHERE table_uid = registry_table_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'no_data_found',
            MESSAGE = format('registry row with table_uid %s does not exist', registry_table_uid);
    END IF;
    target := format('%I.%I', registry.schema_name, registry.table_name)::regclass;

    FOR actor IN
        SELECT * FROM (VALUES ('creator', 'created_by', 'WL58 row creator'),
                              ('owner', owner_column, 'WL58 row owner')) AS wanted (role, column_name, spec)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.system_column_details
                       WHERE table_uid = registry.table_uid AND column_name = actor.column_name) THEN
            INSERT INTO public.system_column_details
                (table_uid, column_name, data_type, co_number, lang_key, card_element, insertable,
                 editable_in_ui, hide_in_filter_panel, show_value_on_card, creation_spec)
            SELECT registry.table_uid, actor.column_name, format_type(attribute.atttypid, attribute.atttypmod),
                   attribute.attnum, actor.column_name, 'hidden', FALSE, FALSE, TRUE, TRUE, actor.spec
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = target AND attribute.attname = actor.column_name;
            changes := changes || jsonb_build_object('action', 'column_metadata_added', 'column', actor.column_name);
        ELSE
            UPDATE public.system_column_details
               SET insertable = FALSE, editable_in_ui = FALSE, updated = now()
             WHERE table_uid = registry.table_uid AND column_name = actor.column_name
               AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
            IF FOUND THEN
                changes := changes || jsonb_build_object('action', 'column_metadata_locked', 'column', actor.column_name);
            END IF;
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.system_row_actor_columns
                   WHERE table_uid = registry.table_uid AND actor_role = 'owner') THEN
        INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name)
        VALUES (registry.table_uid, 'creator', 'created_by')
        ON CONFLICT (table_uid, actor_role) DO NOTHING;
        INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name)
        VALUES (registry.table_uid, 'owner', owner_column);
        changes := changes || jsonb_build_object('action', 'actor_columns_marked',
                                                 'creator', 'created_by', 'owner', owner_column);
        IF registry.row_policy_owner_column IS DISTINCT FROM owner_column THEN
            UPDATE public.system_db_tables SET row_policy_owner_column = owner_column, updated = now()
             WHERE table_uid = registry.table_uid;
            changes := changes || jsonb_build_object('action', 'registry_owner_moved',
                                                     'old_value', registry.row_policy_owner_column,
                                                     'new_value', owner_column);
        END IF;
    END IF;

    -- A relation row lets the generic synchronisation recognise the two keys; a new
    -- source row must never be inserted with its user, so the flag is FALSE.
    SELECT table_uid INTO users_table_uid FROM public.system_db_tables
     WHERE COALESCE(schema_name, 'public') = 'public' AND table_name = 'system_users';
    IF users_table_uid IS NOT NULL THEN
        FOR actor IN SELECT unnest(ARRAY['created_by', owner_column]) AS column_name LOOP
            SELECT insert_new_source_with_target INTO previous_flag
              FROM public.system_foreign_key_relations_1_m
             WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
               AND source_column_name = actor.column_name AND target_column_name = 'id';
            IF NOT FOUND THEN
                INSERT INTO public.system_foreign_key_relations_1_m
                    (source_table_uid, source_column_name, target_table_uid, target_column_name,
                     reference_direction, insert_new_source_with_target, source_insert_specs)
                VALUES (registry.table_uid, actor.column_name, users_table_uid, 'id',
                        registry.table_name || '->system_users', FALSE, '{}'::jsonb);
            ELSIF previous_flag IS DISTINCT FROM FALSE THEN
                UPDATE public.system_foreign_key_relations_1_m
                   SET insert_new_source_with_target = FALSE, updated = now()
                 WHERE source_table_uid = registry.table_uid AND target_table_uid = users_table_uid
                   AND source_column_name = actor.column_name AND target_column_name = 'id';
                changes := changes || jsonb_build_object('action', 'relation_flag_changed',
                                                         'column', actor.column_name, 'old_value', previous_flag);
            END IF;
        END LOOP;
    END IF;
    RETURN changes;
END $$;

-- 4. Reading the marks (000001 section 13) through table_uid.
CREATE OR REPLACE FUNCTION public.app_row_actor_column(target regclass, actor_role text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT marked.column_name
      FROM public.system_row_actor_columns AS marked
      JOIN public.system_db_tables AS registry ON registry.table_uid = marked.table_uid
      JOIN pg_catalog.pg_class AS relation ON relation.oid = target
      JOIN pg_catalog.pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
     WHERE COALESCE(registry.schema_name, 'public') = relation_schema.nspname
       AND registry.table_name = relation.relname
       AND marked.actor_role = app_row_actor_column.actor_role
$$;

-- 5. The final check (000001 section 14) through table_uid; every other line unchanged.
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
        SELECT * FROM (VALUES ('public.system_row_actor_columns', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_row_actor_columns', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_writes', 'public.app_owner_only_writes()'),
                              ('public.system_data_repair_records', 'owner_only_truncate', 'public.app_owner_only_writes()'),
                              ('public.system_db_tables', 'protect_row_owner_setting', 'public.protect_row_owner_setting()'))
                 AS wanted (table_name, trigger_name, function_name)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                       WHERE tgrelid = guard.table_name::regclass AND tgname = guard.trigger_name
                         AND NOT tgisinternal AND tgenabled IN ('O', 'A')
                         AND tgfoid = guard.function_name::regprocedure) THEN
            RETURN NEXT format('%s: guard trigger %s is missing, not firing on ordinary writes or not running %s',
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
                   AND tgfoid = 'public.protect_row_creator()'::regprocedure) THEN
                RETURN NEXT format('%s: the creator guard trigger is missing or not firing on ordinary writes',
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

-- 6. The file's own completion marker, the one row it writes.
INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl58_row_actor_marks_by_table_uid', 'completed',
       jsonb_build_object('file', '20261005000002_key_row_actor_marks_by_table_uid.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl58_row_actor_marks_by_table_uid' AND action = 'completed'
);
