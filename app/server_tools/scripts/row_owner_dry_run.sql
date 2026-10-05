-- row_owner_dry_run.sql
-- Reports the WL58 upgrade decisions and data/permission risks without changing data.
-- Bridges the 9.9.2 catalog (which has no actor helper functions) and 000004's rules.
-- Exists so an administrator can resolve every ownership conflict before maintenance.
-- One read-only statement, usable by the read-only role. Dynamic reads use only quoted
-- catalog identifiers and SELECT; only counts, column/table names and ids leave them.
-- R1-R5 below are checked against app_row_actor_side_table_reason by the upgrade tests.
-- Role configuration lives outside the database: the roles summary reports every
-- non-built-in role by name and oid, so the operator can find the four configured
-- runtime roles, including custom names. Role names are database accounts, not
-- people. owner_membership is for the inspecting role, not an assumed upgrader.
-- Lock duration cannot be inferred from size: the report explicitly requires a timed
-- disposable rehearsal; lock_timeout is 5 seconds, not an estimate of execution time.
WITH registered AS MATERIALIZED (
    SELECT registry.table_uid, registry.table_name, coalesce(registry.schema_name, 'public') AS schema_name,
           registry.row_policy_owner_column, registry.fk_display_column,
           relation.oid, relation.relkind, relation.relowner, relation.reltuples,
           CASE WHEN relation.relkind IN ('r', 'm') THEN pg_total_relation_size(relation.oid) END AS bytes,
           CASE WHEN registry.table_name = 'app_service_catalog' THEN 'user_id'
                WHEN coalesce(btrim(registry.row_policy_owner_column), '') IN ('', 'created_by', 'owner_id') THEN 'owner_id'
                ELSE btrim(registry.row_policy_owner_column) END AS owner_column
      FROM public.system_db_tables AS registry
      LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = coalesce(registry.schema_name, 'public')
      LEFT JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid AND relation.relname = registry.table_name
), named AS (
    SELECT registered.*,
           CASE
               WHEN lower(table_name) LIKE 'system\_%' AND lower(table_name) <> 'system_about' THEN 'R1: system table'
               WHEN lower(table_name) LIKE '%\_assets' THEN 'R2: attachment table'
               WHEN lower(table_name) LIKE '%\_lang\_embeddings' THEN 'R3: language embedding table'
               WHEN lower(table_name) ~ '_relations?$' THEN 'R4: link table'
               WHEN lower(table_name) ~ '_(log|logs|audit|audit_log|events|history|runs)$' THEN 'R5: log or history table'
           END AS name_reason
      FROM registered
), users_key AS (
    SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.system_users'::regclass AND attname = 'id'
), excluded AS MATERIALIZED (
    SELECT named.*, coalesce(name_reason, CASE
        WHEN schema_name <> 'public' THEN 'not a public table'
        WHEN oid IS NULL OR relkind <> 'r' OR table_name = 'spatial_ref_sys' THEN 'R7: extension or not an ordinary table'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key JOIN pg_catalog.pg_attribute AS attribute
                          ON attribute.attrelid = key.conrelid AND attribute.attnum = key.conkey[1]
                         WHERE key.conrelid = named.oid AND key.contype = 'p' AND cardinality(key.conkey) = 1 AND attribute.attname = 'id')
            THEN 'not a single-column id primary key'
        WHEN EXISTS (SELECT 1 FROM public.system_foreign_key_relations_m_m WHERE bridging_table_uid = named.table_uid) THEN 'R4: registered bridge'
        WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS attribute
                          WHERE attribute.attrelid = named.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
                            AND attribute.attname NOT IN ('id', 'created', 'updated', 'sort_order', 'search_vector_simple')
                            AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key WHERE key.conrelid = named.oid
                                             AND key.contype = 'f' AND key.conkey = ARRAY[attribute.attnum]))
         AND (SELECT count(DISTINCT key.conkey[1]) FROM pg_catalog.pg_constraint AS key
               JOIN pg_catalog.pg_class AS other ON other.oid = key.confrelid
              WHERE key.conrelid = named.oid AND key.contype = 'f' AND cardinality(key.conkey) = 1 AND other.relname NOT LIKE 'system\_%') >= 2
            THEN 'R4: pure link table'
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key JOIN pg_catalog.pg_attribute AS attribute
                      ON attribute.attrelid = named.oid AND attribute.attnum = key.conkey[1]
                     WHERE key.conrelid = named.oid AND key.contype = 'f' AND cardinality(key.conkey) = 1
                       AND key.confrelid = 'public.system_users'::regclass AND key.confkey = ARRAY[(SELECT attnum FROM users_key)] AND attribute.attnotnull)
            THEN 'R6: required user reference'
        WHEN EXISTS (SELECT 1 FROM public.system_config WHERE key = 'row_owner_column_excluded_datasets' AND json_value ? named.table_name)
            THEN 'R8: site exclusion' END) AS exclusion
      FROM named
), catalog AS MATERIALIZED (
    SELECT excluded.*,
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'column', attribute.attname, 'type', format_type(attribute.atttypid, attribute.atttypmod),
               'generated', attribute.attgenerated <> '', 'not_null', attribute.attnotnull,
               'foreign_keys', coalesce((SELECT jsonb_agg(jsonb_build_object('name', key.conname,
                   'delete_rule', key.confdeltype, 'validated', key.convalidated, 'simple', key.confmatchtype = 's',
                   'deferred', key.condeferrable, 'target_oid', key.confrelid, 'columns', key.conkey,
                   'compatible', key.conkey = ARRAY[attribute.attnum] AND key.confrelid = 'public.system_users'::regclass
                       AND key.confkey = ARRAY[(SELECT attnum FROM users_key)] AND key.confdeltype = 'n'
                       AND key.confmatchtype = 's' AND NOT key.condeferrable,
                   'qualifies', key.conkey = ARRAY[attribute.attnum] AND key.confrelid = 'public.system_users'::regclass
                       AND key.confkey = ARRAY[(SELECT attnum FROM users_key)] AND key.confdeltype = 'n'
                       AND key.confmatchtype = 's' AND NOT key.condeferrable AND key.convalidated))
                   FROM pg_catalog.pg_constraint AS key WHERE key.conrelid = excluded.oid AND key.contype = 'f'
                     AND attribute.attnum = ANY(key.conkey)), '[]'::jsonb),
               'indexes', coalesce((SELECT jsonb_agg(jsonb_build_object('name', relation.relname,
                   'qualifies', method.amname = 'btree' AND index_row.indisvalid AND index_row.indisready
                       AND index_row.indpred IS NULL AND index_row.indkey[0] = attribute.attnum))
                   FROM pg_catalog.pg_index AS index_row JOIN pg_catalog.pg_class AS relation ON relation.oid = index_row.indexrelid
                   JOIN pg_catalog.pg_am AS method ON method.oid = relation.relam
                   WHERE index_row.indrelid = excluded.oid AND attribute.attnum = ANY(index_row.indkey)), '[]'::jsonb)) ORDER BY attribute.attname)
             FROM pg_catalog.pg_attribute AS attribute WHERE attribute.attrelid = excluded.oid AND attribute.attnum > 0
               AND NOT attribute.attisdropped AND attribute.attname IN ('created_by', 'owner_id', owner_column, 'user_id')), '[]'::jsonb) AS columns,
           coalesce((SELECT jsonb_agg(jsonb_build_object('name', tgname, 'state', tgenabled, 'function_oid', tgfoid,
                                                        'type', tgtype, 'column_filter', tgattr::text, 'has_when', tgqual IS NOT NULL) ORDER BY tgname)
                     FROM pg_catalog.pg_trigger WHERE tgrelid = excluded.oid AND NOT tgisinternal), '[]'::jsonb) AS triggers,
           coalesce((SELECT jsonb_agg(jsonb_build_object('column', attribute.attname, 'dependent_class_oid', dependency.classid,
                                                        'dependent_oid', dependency.objid, 'kind', dependency.deptype))
                     FROM pg_catalog.pg_attribute AS attribute LEFT JOIN pg_catalog.pg_depend AS dependency
                       ON dependency.refclassid = 'pg_class'::regclass AND dependency.refobjid = attribute.attrelid AND dependency.refobjsubid = attribute.attnum
                    WHERE attribute.attrelid = excluded.oid AND attribute.attname IN ('user_id', 'cached_username') AND NOT attribute.attisdropped), '[]'::jsonb) AS legacy_dependencies
      FROM excluded
), scanned AS MATERIALIZED (
    SELECT catalog.*, counts.report::jsonb AS counts
      FROM catalog
      -- query_to_xml is PostgreSQL's read-only dynamic SELECT bridge, available in
      -- 9.9.2. JSON projection tolerates missing actor columns without parsing them.
      LEFT JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
        -- Excluded tables are not read row by row (a site may hold millions of rows of
        -- reference data); history and report tables still give their writer counts.
        CASE WHEN exclusion IS NOT NULL AND table_name !~ '_(history|reports)$'
                 THEN 'SELECT ''{"not_scanned":"excluded"}''::text AS report'
             WHEN oid IS NOT NULL AND relkind IN ('r', 'v', 'm', 'p') AND has_table_privilege(oid, 'SELECT') THEN format($scan$
            WITH rows AS MATERIALIZED (SELECT to_jsonb(row) AS data FROM %I.%I AS row),
            actor_values AS (
                SELECT wanted.column_name, data->>wanted.column_name AS raw,
                       CASE WHEN data->>wanted.column_name ~ '^-?[0-9]+$' THEN (data->>wanted.column_name)::numeric END AS actor_id
                  FROM rows CROSS JOIN (SELECT DISTINCT unnest(ARRAY['created_by', 'owner_id', %L, 'user_id']) AS column_name) AS wanted
            ), actors AS (
                SELECT column_name, jsonb_build_object('total', count(*), 'null', count(*) FILTER (WHERE raw IS NULL),
                    'zero', count(*) FILTER (WHERE actor_id = 0), 'guest', count(*) FILTER (WHERE actor_id = 1),
                    'negative', count(*) FILTER (WHERE actor_id < 0), 'invalid_type', count(*) FILTER (WHERE raw IS NOT NULL AND actor_id IS NULL),
                    'dangling', count(*) FILTER (WHERE actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.system_users WHERE id = actor_id)),
                    'distinct_user_ids', count(DISTINCT actor_id)) AS counts FROM actor_values GROUP BY column_name
            ) SELECT jsonb_build_object(
                'total', (SELECT count(*) FROM rows), 'actors', coalesce((SELECT jsonb_object_agg(column_name, counts) FROM actors), '{}'::jsonb),
                'different_owner', (SELECT count(*) FROM rows WHERE data->>'owner_id' IS NOT NULL AND data->>'owner_id' IS DISTINCT FROM data->>'created_by'),
                'empty_owner_with_creator', (SELECT count(*) FROM rows WHERE data->>'owner_id' IS NULL AND data->>'created_by' IS NOT NULL),
                'backfillable_creator', (SELECT count(*) FROM rows WHERE data->>'created_by' IS NULL AND EXISTS
                    (SELECT 1 FROM public.system_users WHERE id > 1 AND id::text = data->>'user_id')),
                'cached_name_rows', (SELECT count(*) FROM rows WHERE nullif(data->>'cached_username', '') IS NOT NULL),
                'cached_name_matching_user_ids', (SELECT coalesce(jsonb_agg(DISTINCT users.id), '[]'::jsonb) FROM rows JOIN public.system_users AS users ON users.username = data->>'cached_username'),
                -- Only a table with a name copy can index user names; the check is rows x users.
                'vectors_containing_usernames', CASE WHEN EXISTS (SELECT 1 FROM rows WHERE data ? 'cached_username') THEN
                    (SELECT count(*) FROM rows WHERE data->>'search_vector_simple' IS NOT NULL AND EXISTS
                    (SELECT 1 FROM public.system_users WHERE nullif(username, '') IS NOT NULL AND (data->>'search_vector_simple')::tsvector @@ plainto_tsquery('simple', username))) END,
                'actor_automation_ids', (SELECT coalesce(jsonb_agg(data->>'id'), '[]'::jsonb) FROM rows
                    WHERE (data->'action_values')::text ~ '"(created_by|owner_id|user_id)"'
                       OR (data->'action_details')::text ~ '"(created_by|owner_id|user_id)"'),
                'legacy_settings', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',data->>'id',
                    'cached_name_col_in_src',data->>'cached_name_col_in_src','name_col_in_tgt',data->>'name_col_in_tgt')), '[]'::jsonb) FROM rows
                    WHERE nullif(data->>'cached_name_col_in_src', '') IS NOT NULL OR nullif(data->>'name_col_in_tgt', '') IS NOT NULL)
            ) AS report
        $scan$, schema_name, table_name, owner_column)
        ELSE 'SELECT ''{"unreadable_or_missing":true}''::text AS report' END,
        TRUE, FALSE, '') COLUMNS report text PATH 'report') AS counts ON TRUE
), optional_reports AS (
    -- These registries exist on some long-lived sites, not in every 9.9.2 package.
    SELECT item.report_name, extracted.report::jsonb AS detail
      FROM (VALUES ('cached_name_registry', 'system_fk_cache_triggers'), ('actor_automations', 'system_triggers'),
                   ('actor_marks', 'system_row_actor_columns')) AS item(report_name, table_name)
      CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
          CASE WHEN to_regclass('public.' || item.table_name) IS NOT NULL
                AND has_table_privilege(to_regclass('public.' || item.table_name), 'SELECT') THEN
              CASE item.report_name WHEN 'actor_marks' THEN format($marks$
                  SELECT coalesce(jsonb_agg(jsonb_build_object('table_uid',data->'table_uid',
                      'role',data->>'actor_role','column',data->>'column_name')), '[]'::jsonb) AS report
                    FROM (SELECT to_jsonb(row) AS data FROM public.%I AS row) AS rows
              $marks$, item.table_name)
              WHEN 'cached_name_registry' THEN format($registry$
                  SELECT coalesce(jsonb_agg(to_jsonb(row)->>'id'), '[]'::jsonb) AS report FROM public.%I AS row
                   WHERE to_jsonb(row)->>'function_name' = 'fn_sync_cached_username'
              $registry$, item.table_name)
              ELSE format($automations$
                  SELECT coalesce(jsonb_agg(jsonb_build_object('id',data->>'id','target_table_uid',registry.table_uid)), '[]'::jsonb) AS report
                    FROM (SELECT to_jsonb(row) AS data FROM public.%I AS row) AS rows
                    LEFT JOIN public.system_db_tables AS registry ON registry.table_name = data->>'target_table'
                   WHERE (data->>'action_values') ~ '"(created_by|owner_id)"'
                      OR position('"' || registry.row_policy_owner_column || '"' IN data->>'action_values') > 0
              $automations$, item.table_name) END
          ELSE 'SELECT ''{"missing_or_unreadable":true}''::text AS report' END,
          TRUE, FALSE, '') COLUMNS report text PATH 'report') AS extracted
), marked AS (
    -- A pre-support site has no marks registry. Read it only through the same
    -- optional SELECT bridge, so this report also exposes conflicts after upgrade.
    SELECT scanned.*, coalesce(marks.values, '{}'::jsonb) AS existing_marks
      FROM scanned
      LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(mark->>'role', mark->>'column') AS values
            FROM optional_reports CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(detail) = 'array' THEN detail ELSE '[]'::jsonb END) AS mark
           WHERE report_name = 'actor_marks' AND mark->>'table_uid' = scanned.table_uid::text
      ) AS marks ON TRUE
), decisions AS (
    SELECT marked.*, ARRAY_REMOVE(ARRAY[
        CASE WHEN existing_marks <> '{}'::jsonb AND (NOT (existing_marks ? 'creator') OR NOT (existing_marks ? 'owner'))
            THEN 'needs both a creator and an owner mark' END,
        CASE WHEN existing_marks ? 'owner' AND (existing_marks->>'owner' IS DISTINCT FROM row_policy_owner_column
            OR existing_marks->>'owner' IS DISTINCT FROM owner_column)
            THEN 'registry owner or selected owner differs from the owner mark' END,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_each_text(existing_marks) AS actor
            WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = marked.oid
                               AND attname = actor.value AND attnum > 0 AND NOT attisdropped))
            THEN 'marked actor column does not exist' END,
        CASE WHEN existing_marks ? 'creator' AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger AS trigger
              JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
              JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
              JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = trigger.tgrelid
               AND attribute.attname = existing_marks->>'creator' AND NOT attribute.attisdropped
             WHERE trigger.tgrelid = marked.oid AND NOT trigger.tgisinternal AND trigger.tgenabled IN ('O','A')
               AND namespace.nspname = 'public' AND procedure.proname = 'protect_row_creator'
               AND trigger.tgtype = 19 AND trigger.tgattr::text = attribute.attnum::text AND trigger.tgqual IS NULL)
            THEN 'marked creator guard has an incompatible definition or enabled state' END,
        CASE WHEN exclusion IS NULL AND NOT pg_has_role(current_user, relowner, 'MEMBER') THEN 'inspecting role is not a member of table owner role' END,
        CASE WHEN exclusion IS NULL AND table_uid IS NULL THEN 'registry table_uid is missing' END,
        CASE WHEN exclusion IS NULL AND owner_column NOT IN ('created_by', 'owner_id')
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(columns) AS col WHERE col->>'column' = owner_column)
            THEN 'kept owner column does not exist' END,
        CASE WHEN exclusion IS NULL AND EXISTS (
            SELECT 1 FROM unnest(ARRAY['created_by', owner_column]) AS actor(column_name)
            CROSS JOIN LATERAL (SELECT 'fk_' || table_name || '_' || actor.column_name AS full_name) AS object_name
            CROSS JOIN LATERAL (SELECT CASE WHEN octet_length(full_name) <= 63 THEN full_name ELSE
                (SELECT left(full_name, max(length)) FROM generate_series(1, char_length(full_name)) AS length
                  WHERE octet_length(left(full_name, length)) <= 52) || '_' || substr(md5(full_name), 1, 10) END AS wanted_name) AS object_key
             WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = marked.oid AND conname = wanted_name)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key JOIN pg_catalog.pg_attribute AS attribute
                                ON attribute.attrelid=key.conrelid AND attribute.attnum=ANY(key.conkey)
                               WHERE key.conrelid=marked.oid AND key.contype='f' AND attribute.attname=actor.column_name))
            THEN 'same-name actor constraint has another definition' END,
        CASE WHEN exclusion IS NULL AND counts ? 'unreadable_or_missing' THEN 'data cannot be inspected with this role' END,
        CASE WHEN exclusion IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(columns) AS col WHERE col->>'column' IN ('created_by', owner_column)
            AND (col->>'type' NOT IN ('integer', 'bigint') OR (col->>'generated')::boolean)) THEN 'actor type or generated column is incompatible' END,
        CASE WHEN exclusion IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(columns) AS col WHERE col->>'column' IN ('created_by', owner_column)
            AND (jsonb_array_length(col->'foreign_keys') > 1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(col->'foreign_keys') AS fk
              WHERE NOT (fk->>'compatible')::boolean)))
            THEN 'actor foreign key has another definition (see columns)' END,
        CASE WHEN exclusion IS NULL AND ((owner_column <> 'owner_id' AND table_name <> 'app_service_catalog')
            OR (owner_column = 'owner_id' AND coalesce((counts#>>'{actors,owner_id,total}')::bigint - (counts#>>'{actors,owner_id,null}')::bigint, 0) > 0))
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(columns) AS col CROSS JOIN LATERAL jsonb_array_elements(col->'foreign_keys') AS fk
                            WHERE col->>'column' = owner_column AND (fk->>'qualifies')::boolean)
            THEN 'owner has no validated single-column SET NULL foreign key' END,
        CASE WHEN exclusion IS NULL AND owner_column = 'owner_id' AND btrim(row_policy_owner_column) = 'created_by'
            AND coalesce((counts#>>'{actors,owner_id,total}')::bigint - (counts#>>'{actors,owner_id,null}')::bigint, 0) > 0
            AND (counts->>'different_owner')::bigint + (counts->>'empty_owner_with_creator')::bigint > 0
            THEN 'creator/owner conflict (different_owner and empty_owner_with_creator)' END
    ], NULL) AS stops
      FROM marked
), expected_guards AS (
    -- These catalog-only checks are empty before support exists. After upgrade,
    -- show the same global protections that can refuse a data-step rerun.
    SELECT * FROM (VALUES
        ('system_row_actor_columns', 'owner_only_writes', 'app_owner_only_writes', 31, NULL::text),
        ('system_row_actor_columns', 'owner_only_truncate', 'app_owner_only_writes', 34, NULL::text),
        ('system_data_repair_records', 'owner_only_writes', 'app_owner_only_writes', 31, NULL::text),
        ('system_data_repair_records', 'owner_only_truncate', 'app_owner_only_writes', 34, NULL::text),
        ('system_db_tables', 'protect_row_owner_setting', 'protect_row_owner_setting', 19, 'row_policy_owner_column')
    ) AS wanted(table_name, trigger_name, function_name, trigger_type, filter_column)
     WHERE to_regclass('public.system_row_actor_columns') IS NOT NULL
    UNION ALL
    SELECT table_name, CASE WHEN octet_length(full_name) <= 63 THEN full_name ELSE
        (SELECT left(full_name, max(length)) FROM generate_series(1, char_length(full_name)) AS length
          WHERE octet_length(left(full_name, length)) <= 52) || '_' || substr(md5(full_name), 1, 10) END,
        'protect_row_creator', 19, existing_marks->>'creator'
      FROM marked CROSS JOIN LATERAL (SELECT 'protect_' || table_name || '_creator' AS full_name) AS names
     WHERE existing_marks ? 'creator'
), protection_findings AS (
    SELECT table_name, trigger_name AS object_name, 'guard definition, function or enabled state is incompatible' AS reason
      FROM expected_guards AS guard
     WHERE NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger AS trigger
           JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
           JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
          WHERE trigger.tgrelid = to_regclass(format('public.%I', guard.table_name)) AND trigger.tgname = guard.trigger_name
            AND NOT trigger.tgisinternal AND trigger.tgenabled IN ('O','A')
            AND namespace.nspname = 'public' AND procedure.proname = guard.function_name AND procedure.pronargs = 0
            AND trigger.tgtype = guard.trigger_type AND trigger.tgqual IS NULL
            AND trigger.tgattr::text = coalesce((SELECT attnum::text FROM pg_catalog.pg_attribute
                 WHERE attrelid = trigger.tgrelid AND attname = guard.filter_column AND attnum > 0 AND NOT attisdropped), ''))
    UNION ALL
    SELECT 'system_data_repair_records', 'repair_records_owner_role', 'repair history row security or owner policy is missing'
     WHERE to_regclass('public.system_data_repair_records') IS NOT NULL AND (
        NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = to_regclass('public.system_data_repair_records'))
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.system_data_repair_records')
                        AND polname = 'repair_records_owner_role'))
), report AS (
    SELECT 'table'::text AS kind, table_uid::text AS id,
           jsonb_build_object('table', schema_name || '.' || table_name, 'name_reason', name_reason,
               'decision', CASE WHEN exclusion IS NOT NULL THEN 'excluded' WHEN cardinality(stops) > 0 THEN 'stop' ELSE 'include' END,
               'reason', exclusion, 'stops', stops, 'registry_owner', row_policy_owner_column, 'selected_owner', owner_column,
               'existing_marks', existing_marks,
               'owner_action', CASE WHEN owner_column <> 'owner_id' THEN 'keep site owner'
                   WHEN coalesce((counts#>>'{actors,owner_id,total}')::bigint - (counts#>>'{actors,owner_id,null}')::bigint, 0) > 0 THEN 'adopt, preserve NULLs'
                   ELSE 'fill from creator' END,
               'creator_fill_source', CASE WHEN table_name IN ('palvelukatalogi','riskienhallinta','dokumentaatio','tiketit','app_autojen_vanteet') THEN 'user_id' END,
               'columns', columns, 'counts', counts, 'bytes', bytes, 'estimated_rows', reltuples,
               'lock_estimate', 'not measurable from catalogs; timed rehearsal required', 'lock_timeout_seconds', 5,
               'owner_role_id', relowner, 'owner_membership', pg_has_role(current_user, relowner, 'MEMBER'),
               'triggers', triggers, 'legacy_dependencies', legacy_dependencies,
               'cached_name_without_owner_mark', exclusion IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = decisions.oid AND attname = 'cached_username' AND NOT attisdropped),
               'registry_cached_settings', CASE WHEN fk_display_column = 'cached_username' THEN jsonb_build_object('fk_display_column', fk_display_column) END) AS detail
      FROM decisions
    UNION ALL
    SELECT 'summary', 'tables', jsonb_build_object('registered', count(*), 'included', count(*) FILTER (WHERE exclusion IS NULL),
        'excluded', count(*) FILTER (WHERE exclusion IS NOT NULL), 'stopped', count(*) FILTER (WHERE cardinality(stops) > 0),
        'bytes_to_lock', sum(bytes) FILTER (WHERE exclusion IS NULL)) FROM decisions
    UNION ALL
    SELECT 'summary', 'extensions_and_settings', jsonb_build_object(
        'pg_trgm', EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm'),
        'r8_key_exists', EXISTS (SELECT 1 FROM public.system_config WHERE key = 'row_owner_column_excluded_datasets'),
        'r8_valid', coalesce((SELECT jsonb_typeof(json_value) = 'array' AND NOT jsonb_path_exists(json_value, '$[*] ? (@.type() != "string")')
                              FROM public.system_config WHERE key = 'row_owner_column_excluded_datasets'), TRUE),
        'history_writer_counts', coalesce((SELECT jsonb_object_agg(coalesce(table_uid::text, oid::text), counts#>'{actors,created_by,distinct_user_ids}') FROM scanned
            WHERE table_name ~ '_(history|reports)$'), '{}'::jsonb),
        'runtime_roles', 'Match the four configured runtime roles to their role ids below; configuration is outside the database.')
    UNION ALL
    SELECT 'summary', report_name, detail FROM optional_reports
    UNION ALL
    SELECT 'summary', 'protection_findings', coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name, 'object', object_name, 'reason', reason) ORDER BY table_name, object_name), '[]'::jsonb)
      FROM protection_findings
    UNION ALL
    SELECT 'summary', 'cached_name_sync_trigger', coalesce(jsonb_agg(jsonb_build_object('id',oid,'state',tgenabled,'function_oid',tgfoid)), '[]'::jsonb)
      FROM pg_catalog.pg_trigger WHERE tgrelid='public.system_users'::regclass AND tgname='trg_sync_cached_username'
    UNION ALL
    SELECT 'role', roles.oid::text, jsonb_build_object('name', rolname, 'superuser', rolsuper, 'bypass_rls', rolbypassrls,
        'read_grant_preconditions', NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = roles.oid)
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                            WHERE relation.relowner = roles.oid AND namespace.nspname IN ('public', 'restricted')),
        'current_inspecting_role', rolname = current_user)
      FROM pg_catalog.pg_roles AS roles
     WHERE rolname !~ '^pg_'
)
SELECT kind, id, detail FROM report ORDER BY kind, id;
