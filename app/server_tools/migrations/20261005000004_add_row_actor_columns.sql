-- 20261005000004_add_row_actor_columns.sql
-- Gives registered content datasets their creator and owner, keeping a site's proven
-- owner column and filling old rows only from the approved creator sources.
-- Bridges the support functions of 000001/000002 and existing datasets: the same
-- physical and metadata definitions serve upgrades, the package and dataset creation.
-- Exists because an existing owner is a rights decision, not a value to guess from a
-- column name. All preflight findings are collected before the first write. The one
-- statement also rolls back fills, trigger suspension and history together on error.
-- Repair records contain identifiers only. Table completion protects intentional NULLs
-- on a rerun; ensuring steps record only actual changes. K211 requires table_uid.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_columns
-- FINAL_CHECK: public.app_check_row_actor_marks()

DO $row_actors$
DECLARE
    migration_id constant text := 'wl58_row_actor_columns';
    file_detail constant jsonb := '{"file":"20261005000004_add_row_actor_columns.sql"}';
    examples constant text[] := ARRAY['palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit'];
    fill_sources constant text[] := ARRAY['palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit', 'app_autojen_vanteet'];
    decisions jsonb := '[]';
    findings text[] := ARRAY[]::text[];
    excluded_datasets jsonb;
    item record;
    actor record;
    reference record;
    target regclass;
    owner_column text;
    reason text;
    marked_owner text;
    owner_used boolean;
    table_done boolean;
    different_count bigint;
    empty_count bigint;
    reference_count integer;
    users_id smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                          WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    folder integer;
    admins integer;
    repair_uid integer;
    saved jsonb;
    changes jsonb;
    change jsonb;
    started timestamptz;
    affected bigint;
    filled bigint;
    cleared bigint;
    total_filled bigint := 0;
    total_cleared bigint := 0;
    total_tables integer := 0;
    user_number smallint;
    clear_condition text;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);

    -- Preflight is read only, including on a completed run. A broken mark must stop
    -- a rerun, not be hidden by the ensuring functions recreating its missing column.
    SELECT coalesce(array_agg(finding), ARRAY[]::text[]) INTO findings
      FROM public.app_check_row_actor_marks() AS finding;
    SELECT json_value INTO excluded_datasets FROM public.system_config
     WHERE key = 'row_owner_column_excluded_datasets';
    IF excluded_datasets IS NOT NULL AND (jsonb_typeof(excluded_datasets) <> 'array'
        OR jsonb_path_exists(excluded_datasets, '$[*] ? (@.type() != "string")')) THEN
        findings := array_append(findings, 'system_config: row_owner_column_excluded_datasets must be an array of table names');
    END IF;
    SELECT id INTO folder FROM public.system_table_folders WHERE folder_name = 'logs' ORDER BY id LIMIT 1;
    IF folder IS NULL THEN
        SELECT folder_id INTO folder FROM public.system_db_tables
         WHERE table_name = 'system_audit_log' AND coalesce(schema_name, 'public') = 'public';
    END IF;
    SELECT id INTO admins FROM public.system_user_groups WHERE name = 'admins';
    IF folder IS NULL THEN
        findings := array_append(findings, 'system_data_repair_records: neither logs folder nor system_audit_log folder exists');
    END IF;
    IF admins IS NULL THEN
        findings := array_append(findings, 'system_data_repair_records: admins group is missing');
    END IF;

    FOR item IN
        SELECT registry.table_uid, registry.table_name, registry.row_policy_owner_column,
               coalesce(registry.schema_name, 'public') AS schema_name,
               relation.oid, relation.relkind, relation.relowner
          FROM public.system_db_tables AS registry
          LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = coalesce(registry.schema_name, 'public')
          LEFT JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid AND relation.relname = registry.table_name
         ORDER BY registry.table_uid
    LOOP
        target := item.oid;
        reason := public.app_row_actor_side_table_reason(item.table_name);
        IF reason IS NULL THEN
            reason := CASE
                WHEN item.schema_name <> 'public' THEN 'not a public table'
                WHEN target IS NULL OR item.relkind <> 'r' OR item.table_name = 'spatial_ref_sys' THEN 'R7: extension or not an ordinary table'
                WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key
                                  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = key.conrelid AND attribute.attnum = key.conkey[1]
                                 WHERE key.conrelid = target AND key.contype = 'p' AND cardinality(key.conkey) = 1 AND attribute.attname = 'id')
                    THEN 'not a single-column id primary key'
                WHEN EXISTS (SELECT 1 FROM public.system_foreign_key_relations_m_m WHERE bridging_table_uid = item.table_uid)
                    THEN 'R4: registered bridge'
                WHEN NOT EXISTS (
                    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
                     WHERE attribute.attrelid = target AND attribute.attnum > 0 AND NOT attribute.attisdropped
                       AND attribute.attname NOT IN ('id', 'created', 'updated', 'sort_order', 'search_vector_simple')
                       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key WHERE key.conrelid = target
                                        AND key.contype = 'f' AND key.conkey = ARRAY[attribute.attnum]))
                 AND (SELECT count(DISTINCT key.conkey[1]) FROM pg_catalog.pg_constraint AS key
                       JOIN pg_catalog.pg_class AS other ON other.oid = key.confrelid
                      WHERE key.conrelid = target AND key.contype = 'f' AND cardinality(key.conkey) = 1
                        AND other.relname NOT LIKE 'system\_%') >= 2 THEN 'R4: pure link table'
                WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key
                              JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target AND attribute.attnum = key.conkey[1]
                             WHERE key.conrelid = target AND key.contype = 'f' AND key.confrelid = 'public.system_users'::regclass
                               AND key.confkey = ARRAY[users_id] AND cardinality(key.conkey) = 1 AND attribute.attnotnull)
                    THEN 'R6: required user reference'
                WHEN excluded_datasets ? item.table_name THEN 'R8: site exclusion'
            END;
        END IF;
        IF reason IS NOT NULL THEN
            decisions := decisions || jsonb_build_object('table_uid', item.table_uid, 'table_name', item.table_name, 'reason', reason);
            CONTINUE;
        END IF;
        IF NOT pg_has_role(current_user, item.relowner, 'MEMBER') THEN
            findings := array_append(findings, format('%s: migration role is not a member of table owner role %s', item.table_name, item.relowner));
            CONTINUE;
        END IF;
        IF item.table_uid IS NULL THEN
            findings := array_append(findings, format('%s: registry table_uid is missing', item.table_name));
        END IF;

        -- Decision A keeps a validated site owner. The pilot's owner is fixed by its
        -- database policies; it alone may have dangling owners cleared below.
        owner_column := CASE WHEN item.table_name = 'app_service_catalog' THEN 'user_id'
                             WHEN coalesce(btrim(item.row_policy_owner_column), '') IN ('', 'created_by', 'owner_id') THEN 'owner_id'
                             ELSE btrim(item.row_policy_owner_column) END;
        marked_owner := public.app_row_actor_column(target, 'owner');
        IF marked_owner IS NOT NULL AND marked_owner IS DISTINCT FROM owner_column THEN
            findings := array_append(findings, format('%s: selected owner %s differs from owner mark %s', item.table_name, owner_column, marked_owner));
        END IF;
        owner_used := FALSE;
        FOR actor IN
            SELECT wanted.column_name, attribute.attnum, attribute.atttypid, attribute.attgenerated
              FROM unnest(ARRAY['created_by', owner_column]) AS wanted(column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target
                AND attribute.attname = wanted.column_name AND attribute.attnum > 0 AND NOT attribute.attisdropped
        LOOP
            IF actor.attnum IS NULL AND actor.column_name NOT IN ('created_by', 'owner_id') THEN
                findings := array_append(findings, format('%s.%s: kept owner column does not exist', item.table_name, actor.column_name));
            END IF;
            IF actor.attnum IS NOT NULL AND (actor.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) OR actor.attgenerated <> '') THEN
                findings := array_append(findings, format('%s.%s: must be integer or bigint and not generated', item.table_name, actor.column_name));
            END IF;
            SELECT count(*) INTO reference_count FROM pg_catalog.pg_constraint
             WHERE conrelid = target AND contype = 'f' AND actor.attnum = ANY(conkey);
            FOR reference IN SELECT *, pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
                              WHERE conrelid = target AND contype = 'f' AND actor.attnum = ANY(conkey)
            LOOP
                IF reference_count > 1 OR reference.conkey <> ARRAY[actor.attnum]
                    OR reference.confrelid <> 'public.system_users'::regclass OR reference.confkey <> ARRAY[users_id]
                    OR reference.confdeltype <> 'n' OR reference.confmatchtype <> 's' OR reference.condeferrable THEN
                    findings := array_append(findings, format('%s.%s: incompatible foreign key %s: %s', item.table_name, actor.column_name, reference.conname, reference.definition));
                END IF;
            END LOOP;
            IF reference_count = 0 AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = target
                AND conname = public.app_row_actor_object_name('fk', item.table_name, actor.column_name)) THEN
                findings := array_append(findings, format('%s.%s: same-name constraint has another definition', item.table_name, actor.column_name));
            END IF;
            IF actor.column_name = owner_column AND actor.attnum IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I IS NOT NULL)', target, owner_column) INTO owner_used;
                IF (owner_column <> 'owner_id' AND item.table_name <> 'app_service_catalog') OR (owner_column = 'owner_id' AND owner_used) THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = target AND contype = 'f'
                                    AND conkey = ARRAY[actor.attnum] AND confrelid = 'public.system_users'::regclass
                                    AND confkey = ARRAY[users_id] AND convalidated) THEN
                        findings := array_append(findings, format('%s.%s: owner has no validated single-column foreign key to system_users(id)', item.table_name, owner_column));
                    END IF;
                END IF;
            END IF;
        END LOOP;
        -- Decision B never fills an owner column already in use, even its NULLs.
        IF owner_column = 'owner_id' AND owner_used AND btrim(item.row_policy_owner_column) = 'created_by'
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = target AND attname = 'created_by' AND NOT attisdropped) THEN
            EXECUTE format('SELECT count(*) FILTER (WHERE owner_id IS NOT NULL AND owner_id::text IS DISTINCT FROM created_by::text), '
                           'count(*) FILTER (WHERE owner_id IS NULL AND created_by IS NOT NULL) FROM %s', target)
               INTO different_count, empty_count;
            IF different_count + empty_count > 0 THEN
                findings := array_append(findings, format('%s: creator/owner conflict: different=%s, empty_owner=%s', item.table_name, different_count, empty_count));
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = target
                    AND tgname = public.app_row_actor_object_name('protect', item.table_name, 'creator')
                    AND (tgfoid <> 'public.protect_row_creator()'::regprocedure OR tgenabled NOT IN ('O', 'A'))) THEN
            findings := array_append(findings, format('%s: existing creator guard has another function or does not fire on ordinary writes', item.table_name));
        END IF;
        decisions := decisions || jsonb_build_object('table_uid', item.table_uid, 'table_name', item.table_name,
                                                     'owner_column', owner_column, 'owner_used', owner_used);
    END LOOP;
    IF cardinality(findings) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'wl58_row_actor_columns preflight refused: ' || array_to_string(findings, E'\n');
    END IF;

    -- 0. Adopt automatic registration if present. Dataset rights are limited to the
    -- admins group; row security remains the independent database-level read boundary.
    INSERT INTO public.system_db_tables (table_name, schema_name, folder_id, is_removable, creation_spec)
    SELECT 'system_data_repair_records', 'public', folder, FALSE, 'WL58 immutable repair history'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name = 'system_data_repair_records' AND coalesce(schema_name, 'public') = 'public');
    SELECT table_uid INTO repair_uid FROM public.system_db_tables
     WHERE table_name = 'system_data_repair_records' AND coalesce(schema_name, 'public') = 'public';
    UPDATE public.system_db_tables SET folder_id = folder, is_removable = FALSE
     WHERE table_uid = repair_uid AND (folder_id IS DISTINCT FROM folder OR is_removable IS DISTINCT FROM FALSE);
    INSERT INTO public.system_column_details (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui, creation_spec)
    SELECT repair_uid, attname, format_type(atttypid, atttypmod), attnum, attname, FALSE, FALSE, 'WL58 immutable repair history'
      FROM pg_catalog.pg_attribute AS attribute WHERE attrelid = 'public.system_data_repair_records'::regclass AND attnum > 0 AND NOT attisdropped
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details WHERE table_uid = repair_uid AND column_name = attribute.attname);
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = repair_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    DELETE FROM public.system_group_table_func_rights WHERE target_table_uid = repair_uid AND user_group_id <> admins;
    INSERT INTO public.system_group_table_func_rights (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
    SELECT admins, functions.id, 'public', repair_uid, 'WL58 repair history: administrators only'
      FROM public.system_functions AS functions
     WHERE functions.name IN ('dtt_1_row_read.GetResultsHandlerWrapper', 'dtt_1_row_read.GetRowCountHandlerWrapper',
                              'dtt_1_row_read.GetFilterOptionsHandler', 'dtt_3_table_read.GetTableViewHandlerWrapper',
                              'dtt_2_column_crud.GetTableColumnsHandler')
       AND NOT EXISTS (SELECT 1 FROM public.system_group_table_func_rights WHERE target_table_uid = repair_uid
                        AND user_group_id = admins AND function_id = functions.id);

    INSERT INTO public.system_data_repair_records (migration, table_name, action, detail)
    SELECT migration_id, 'system_data_repair_records', 'excluded', file_detail || jsonb_build_object('reason', 'R1: system table')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id
                        AND table_name = 'system_data_repair_records' AND action = 'excluded');

    FOR item IN SELECT * FROM jsonb_to_recordset(decisions)
        AS chosen(table_uid integer, table_name text, reason text, owner_column text, owner_used boolean)
    LOOP
        IF item.reason IS NOT NULL THEN
            INSERT INTO public.system_data_repair_records (migration, table_name, action, detail)
            SELECT migration_id, item.table_name, 'excluded', file_detail || jsonb_build_object('reason', item.reason)
             WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id AND table_name = item.table_name AND action = 'excluded');
            CONTINUE;
        END IF;
        target := format('public.%I', item.table_name)::regclass;
        started := clock_timestamp();
        filled := 0;
        cleared := 0;
        -- 1-2. Completion only skips one-time work; the common functions still ensure.
        SELECT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id
                        AND table_name = item.table_name AND action = 'table_completed') INTO table_done;
        changes := public.app_ensure_row_actor_columns(target, item.owner_column);
        IF NOT table_done THEN
            -- 3-5. No audit/timestamp/history trigger observes these repairs. Each
            -- invalid creator (and each dangling pilot owner) is recorded by row id.
            saved := public.app_suspend_row_triggers(target);
            IF item.table_name = ANY(fill_sources) AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                WHERE attrelid = target AND attname = 'user_id' AND NOT attisdropped) THEN
                EXECUTE format('UPDATE %s AS row SET created_by = row.user_id WHERE row.created_by IS NULL AND row.user_id > 1 '
                               'AND EXISTS (SELECT 1 FROM public.system_users WHERE id = row.user_id)', target);
                GET DIAGNOSTICS affected = ROW_COUNT;
                filled := filled + affected;
                changes := changes || jsonb_build_object('action', 'backfilled', 'column', 'created_by', 'count', affected);
            END IF;
            FOR actor IN SELECT 'created_by' AS column_name UNION ALL SELECT 'user_id' WHERE item.table_name = 'app_service_catalog' LOOP
                clear_condition := format('row.%I IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.system_users WHERE id = row.%I)',
                                          actor.column_name, actor.column_name);
                IF actor.column_name = 'created_by' THEN
                    clear_condition := clear_condition || format(' OR row.%I <= 1', actor.column_name);
                END IF;
                clear_condition := clear_condition || ')';
                EXECUTE format('INSERT INTO public.system_data_repair_records (migration, table_name, row_id, column_name, old_value, action, detail) '
                    'SELECT $1, $2, row.id::text, $3, row.%1$I::text, CASE WHEN $3 = ''user_id'' THEN ''value_cleared_dangling'' WHEN row.%1$I = 1 THEN ''value_cleared_guest'' '
                    'WHEN row.%1$I = 0 THEN ''value_cleared_zero'' WHEN row.%1$I < 0 THEN ''value_cleared_negative'' ELSE ''value_cleared_dangling'' END, $4 '
                    'FROM %2$s AS row WHERE %3$s', actor.column_name, target, clear_condition)
                    USING migration_id, item.table_name, actor.column_name, file_detail;
                GET DIAGNOSTICS affected = ROW_COUNT;
                cleared := cleared + affected;
                EXECUTE format('UPDATE %s AS row SET %I = NULL WHERE %s', target, actor.column_name, clear_condition);
            END LOOP;
            IF item.owner_column = 'owner_id' AND NOT item.owner_used THEN
                EXECUTE format('UPDATE %s SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL', target);
                GET DIAGNOSTICS affected = ROW_COUNT;
                filled := filled + affected;
                changes := changes || jsonb_build_object('action', 'owner_filled_from_creator', 'column', 'owner_id', 'count', affected);
            ELSIF item.owner_column = 'owner_id' THEN
                changes := changes || jsonb_build_object('action', 'owner_column_adopted', 'column', 'owner_id');
            ELSE
                changes := changes || jsonb_build_object('action', 'kept_site_owner_setting', 'column', item.owner_column);
            END IF;
            -- Existing keys are adopted once; ensure reports additions/validations.
            FOR reference IN SELECT attribute.attname, key.conname FROM pg_catalog.pg_constraint AS key
                JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target AND key.conkey = ARRAY[attribute.attnum]
                WHERE key.conrelid = target AND key.contype = 'f' AND attribute.attname IN ('created_by', item.owner_column)
            LOOP
                changes := changes || jsonb_build_object('action', 'fk_adopted', 'column', reference.attname, 'constraint', reference.conname);
            END LOOP;
        END IF;
        -- 6-12. Physical keys, indexes, defaults and guard precede metadata and marks.
        changes := changes || public.app_ensure_row_actor_constraints(target, item.owner_column);
        changes := changes || public.app_register_row_actor_columns(item.table_uid, item.owner_column);
        IF NOT table_done THEN
            -- 13. Keep the example's old column whenever a registry, relation, stamp,
            -- view/rule or incoming database dependency still names it. Never CASCADE.
            SELECT attnum INTO user_number FROM pg_catalog.pg_attribute
             WHERE attrelid = target AND attname = 'user_id' AND NOT attisdropped;
            IF item.table_name = ANY(examples) AND user_number IS NOT NULL THEN
                reason := NULL;
                IF item.owner_column = 'user_id' OR EXISTS (SELECT 1 FROM public.system_db_tables
                    WHERE table_uid = item.table_uid AND (row_policy_owner_column = 'user_id' OR fk_display_column = 'user_id')) THEN
                    reason := 'registry owner or foreign-key display column';
                ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_depend WHERE refclassid = 'pg_class'::regclass AND refobjid = target
                               AND refobjsubid = user_number AND deptype = 'n' AND classid <> 'pg_attrdef'::regclass) THEN
                    reason := 'database dependency (including view, rule or incoming foreign key)';
                ELSIF EXISTS (SELECT 1 FROM public.system_foreign_key_relations_1_m AS relation WHERE
                       (source_table_uid = item.table_uid AND (source_column_name = 'user_id' OR cached_name_col_in_src = 'user_id'))
                    OR (target_table_uid = item.table_uid AND (target_column_name = 'user_id' OR name_col_in_tgt = 'user_id'))
                    OR ((source_table_uid = item.table_uid OR target_table_uid = item.table_uid
                         OR coalesce(source_insert_specs::text, '') LIKE '%' || item.table_name || '%'
                         OR coalesce(target_insert_specs::text, '') LIKE '%' || item.table_name || '%')
                        AND (coalesce(source_insert_specs::text, '') ~ '"user_id"' OR coalesce(target_insert_specs::text, '') ~ '"user_id"')))
                    OR EXISTS (SELECT 1 FROM public.system_foreign_key_relations_m_m WHERE
                       (table_a_uid = item.table_uid AND table_a_column = 'user_id')
                    OR (table_b_uid = item.table_uid AND table_b_column = 'user_id')
                    OR (bridging_table_uid = item.table_uid AND 'user_id' IN (bridging_col_a, bridging_col_b))) THEN
                    reason := 'relation or insertion specification';
                END IF;
                IF reason IS NULL THEN
                    DELETE FROM public.system_column_details WHERE table_uid = item.table_uid AND column_name = 'user_id';
                    EXECUTE format('ALTER TABLE %s DROP COLUMN user_id', target);
                    changes := changes || jsonb_build_object('action', 'example_user_column_dropped', 'column', 'user_id');
                ELSE
                    changes := changes || jsonb_build_object('action', 'example_user_column_kept', 'column', 'user_id', 'reason', reason);
                END IF;
            END IF;
            -- 14. The new creator trigger was not in saved; existing O/R/A/D states
            -- return exactly, including a previously disabled timestamp trigger.
            PERFORM public.app_restore_row_triggers(target, saved);
            changes := changes || jsonb_build_object('action', 'timing_ms', 'milliseconds', extract(epoch FROM clock_timestamp() - started) * 1000)
                               || jsonb_build_object('action', 'table_completed');
        END IF;
        FOR change IN SELECT value FROM jsonb_array_elements(changes) LOOP
            INSERT INTO public.system_data_repair_records (migration, table_name, column_name, old_value, new_value, action, detail)
            VALUES (migration_id, item.table_name, change->>'column', change->>'old_value', change->>'new_value', change->>'action', file_detail || change);
        END LOOP;
        total_tables := total_tables + 1;
        total_filled := total_filled + filled;
        total_cleared := total_cleared + cleared;
        RAISE NOTICE 'wl58_row_actor_columns: %, filled %, cleared %, already completed %', item.table_name, filled, cleared, table_done;
    END LOOP;
    -- 15. The current checker is 000002 on upgrade, and 000006 in the package.
    -- The later schema-only migration strengthens trigger-definition verification.
    SELECT array_agg(finding) INTO findings FROM public.app_check_row_actor_marks() AS finding;
    IF cardinality(findings) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'wl58_row_actor_columns final check refused: ' || array_to_string(findings, E'\n');
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT migration_id, 'completed', file_detail WHERE NOT EXISTS (
        SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id AND action = 'completed');
    RAISE NOTICE 'wl58_row_actor_columns: % tables, % filled values, % cleared values', total_tables, total_filled, total_cleared;
END $row_actors$;
