-- 20260926000001_restore_system_foreign_keys.sql
-- Restores the twenty system-table foreign keys some installations never received.
-- Bridges the system tables' own relationships with the row reader that turns a
-- foreign key into a readable companion column, and with the delete rules that keep
-- dependent system rows from outliving what they point at.
-- Exists because the public install schema shipped these tables without their
-- relationships, so a site installed from it can store a group right, a folder link
-- or a relation row whose target has gone, and shows a bare number where a site
-- that does have them shows a name.
-- The names and delete actions are the ones read from a site that has them, so a
-- repaired database and one that was already correct end up with the same schema.
-- A site that already has a constraint keeps it, running the file again changes
-- nothing, and a same-named constraint that states a different rule stops the
-- update instead of being skipped in silence.
-- The public bootstrap runs this same file, so a new installation is born with them.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

DO $$
DECLARE
    -- One row per relationship: child table, constraint name, child column, parent
    -- table, parent column, and the delete rule as PostgreSQL stores it
    -- ('a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL). Fifteen cascade, three clear
    -- the column, two refuse the delete. The rules differ on purpose: a group right
    -- or a relation row means nothing once its target is gone, while a folder or a
    -- default view is a link whose loss must not take the dataset with it.
    intended CONSTANT text[][] := ARRAY[
        ['system_column_control',            'fk_system_column_control_column_uid',                'column_uid',         'system_column_details', 'column_uid', 'c'],
        ['system_column_control',            'fk_system_column_control_table_uid',                 'table_uid',          'system_db_tables',      'table_uid',  'c'],
        ['system_db_tables',                 'fk_system_db_tables_default_view_id',                'default_view_id',    'system_table_views',    'id',         'n'],
        ['system_db_tables',                 'fk_system_db_tables_folder_id',                      'folder_id',          'system_table_folders',  'id',         'a'],
        ['system_foreign_key_relations_1_m', 'fk_rel_1m_source_uid_fk',                            'source_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_1_m', 'fk_rel_1m_target_uid_fk',                            'target_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_bridge_uid_fk',                            'bridging_table_uid', 'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_table_a_uid_fk',                           'table_a_uid',        'system_db_tables',      'table_uid',  'c'],
        ['system_foreign_key_relations_m_m', 'fk_rel_mm_table_b_uid_fk',                           'table_b_uid',        'system_db_tables',      'table_uid',  'c'],
        ['system_group_table_func_rights',   'auth_group_func_rights_auth_user_group_id_fkey',     'user_group_id',      'system_user_groups',    'id',         'c'],
        ['system_group_table_func_rights',   'auth_group_func_rights_function_id_fkey',            'function_id',        'system_functions',      'id',         'c'],
        ['system_group_table_func_rights',   'auth_group_table_func_rights_target_table_uid_fkey', 'target_table_uid',   'system_db_tables',      'table_uid',  'c'],
        ['system_lang_key_sources',          'system_lang_key_sources_lang_key_id_fkey',           'lang_key_id',        'system_lang_keys',      'id',         'c'],
        ['system_table_folders',             'fk_table_folders_parent_id',                         'parent_id',          'system_table_folders',  'id',         'a'],
        ['system_table_folders',             'system_table_folders_admin_user_id_fkey',            'admin_user_id',      'system_users',          'id',         'n'],
        ['system_table_row_view_counts',     'fk_table_row_views_table_uid',                       'table_uid',          'system_db_tables',      'table_uid',  'c'],
        ['system_table_row_view_counts',     'fk_table_row_views_viewed_by_user_id',               'viewed_by_user_id',  'system_users',          'id',         'c'],
        ['system_transaction_log',           'fk_system_transaction_log_function_id',              'function_id',        'system_functions',      'id',         'n'],
        ['system_user_group_memberships',    'user_group_assignments_group_id_fkey',               'group_id',           'system_user_groups',    'id',         'c'],
        ['system_user_group_memberships',    'user_group_assignments_user_id_fkey',                'user_id',            'system_users',          'id',         'c']
    ];
    row_index integer;
    child_table text;
    constraint_name text;
    child_column text;
    parent_table text;
    parent_column text;
    delete_action "char";
    delete_clause text;
    child_relation oid;
    parent_relation oid;
    child_attnum smallint;
    parent_attnum smallint;
    present record;
    equivalent text;
    added integer := 0;
    kept integer := 0;
BEGIN
    FOR row_index IN 1 .. array_length(intended, 1) LOOP
        child_table     := intended[row_index][1];
        constraint_name := intended[row_index][2];
        child_column    := intended[row_index][3];
        parent_table    := intended[row_index][4];
        parent_column   := intended[row_index][5];
        delete_action   := intended[row_index][6]::"char";
        delete_clause   := CASE delete_action
                               WHEN 'c' THEN ' ON DELETE CASCADE'
                               WHEN 'n' THEN ' ON DELETE SET NULL'
                               ELSE ''
                           END;

        child_relation  := to_regclass(format('public.%I', child_table));
        parent_relation := to_regclass(format('public.%I', parent_table));
        IF child_relation IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: this installation has no table public.%',
                constraint_name, child_table;
        END IF;
        IF parent_relation IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: this installation has no table public.%',
                constraint_name, parent_table;
        END IF;

        SELECT a.attnum INTO child_attnum
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = child_relation AND a.attname = child_column
           AND a.attnum > 0 AND NOT a.attisdropped;
        SELECT a.attnum INTO parent_attnum
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = parent_relation AND a.attname = parent_column
           AND a.attnum > 0 AND NOT a.attisdropped;
        IF child_attnum IS NULL OR parent_attnum IS NULL THEN
            RAISE EXCEPTION 'cannot restore %: public.%.% or public.%.% is missing',
                constraint_name, child_table, child_column, parent_table, parent_column;
        END IF;

        -- A constraint of this name is already on this table. Accept it only when
        -- it states the same rule. Anything else is a name this installation gave
        -- to a different relationship, and adopting or skipping it in silence would
        -- leave two databases that report the same version but do not match.
        SELECT c.confrelid, c.conkey, c.confkey, c.confupdtype, c.confdeltype,
               c.confmatchtype, c.condeferrable, c.condeferred, c.convalidated,
               pg_catalog.pg_get_constraintdef(c.oid) AS definition
          INTO present
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = child_relation
           AND c.conname = constraint_name
           AND c.contype = 'f';
        IF FOUND THEN
            IF present.confrelid = parent_relation
               AND present.conkey = ARRAY[child_attnum]
               AND present.confkey = ARRAY[parent_attnum]
               AND present.confupdtype = 'a'::"char"
               AND present.confdeltype = delete_action
               AND present.confmatchtype = 's'::"char"
               AND NOT present.condeferrable
               AND NOT present.condeferred
               AND present.convalidated
            THEN
                kept := kept + 1;
                CONTINUE;
            END IF;
            RAISE EXCEPTION
                'constraint % on public.% states a different rule: % — this update expects FOREIGN KEY (%) REFERENCES public.%(%)%',
                constraint_name, child_table, present.definition,
                child_column, parent_table, parent_column, delete_clause;
        END IF;

        -- The same relationship under another name, for example the name PostgreSQL
        -- invents for an unnamed REFERENCES clause. The rule is already enforced and
        -- the interface already reads it, so a second copy would only make every
        -- insert on this table do the same check twice.
        SELECT c.conname INTO equivalent
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = child_relation
           AND c.contype = 'f'
           AND c.confrelid = parent_relation
           AND c.conkey = ARRAY[child_attnum]
         LIMIT 1;
        IF FOUND THEN
            RAISE NOTICE
                'public.%.% already references public.% under the name %; % was not added',
                child_table, child_column, parent_table, equivalent, constraint_name;
            kept := kept + 1;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I)%s',
            child_table, constraint_name, child_column, parent_table, parent_column,
            delete_clause
        );
        added := added + 1;
    END LOOP;

    RAISE NOTICE 'system foreign keys: % added, % already present', added, kept;
END
$$;
