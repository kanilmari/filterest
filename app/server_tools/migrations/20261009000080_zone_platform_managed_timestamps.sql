-- 20261009000080_zone_platform_managed_timestamps.sql
-- Converts platform table clocks to instants using their historic Helsinki zone.
-- Connects upgraded databases, public bootstrap and runtime embedding helpers.
-- Preserves dependent objects atomically; unsupported dependencies refuse the upgrade.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql
-- COMPLETION_MARKER: wl167_managed_timestamp_zones
-- FINAL_CHECK: public.app_check_managed_timestamp_zones()

-- Explicit public-source ownership, not a system_/app_ name heuristic. Showcases,
-- their assets/relations and private-only legacy tables belong to batch 3b.
-- Includes the installer identity adopted by batch 2b (000079), when present.
-- The migration ledger is already zoned in public sources and every export;
-- its reserved bootstrap definition is outside this conversion's scope.
CREATE OR REPLACE FUNCTION public.app_managed_timestamp_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $scope$
    SELECT ARRAY[
        'public.ai_chat_conversations',
        'public.deletion_log',
        'public.dev_agent_handover_report_items',
        'public.dev_agent_handover_reports',
        'public.dev_agent_release_goal_contracts',
        'public.dev_agent_release_goals',
        'public.dev_agent_task_group_relations',
        'public.dev_agent_task_groups',
        'public.dev_agent_task_queues',
        'public.dev_agent_task_runs',
        'public.dev_agent_task_statuses',
        'public.dev_agent_task_todo_statuses',
        'public.dev_agent_task_todos',
        'public.dev_agent_tasks',
        'public.dev_agent_tasks_assets',
        'public.dev_agent_workline_reports',
        'public.dev_agent_workline_tasks',
        'public.dev_agent_worklines',
        'public.system_about',
        'public.system_audit_log',
        'public.system_child_tab_config',
        'public.system_column_control',
        'public.system_column_details',
        'public.system_column_field_set_members',
        'public.system_column_field_sets',
        'public.system_column_view_presets',
        'public.system_comments',
        'public.system_config',
        'public.system_data_repair_records',
        'public.system_database_identity',
        'public.system_dataset_appearance',
        'public.system_dataset_media',
        'public.system_dataset_sort_defaults',
        'public.system_dataset_view_settings',
        'public.system_db_table_aliases',
        'public.system_db_tables',
        'public.system_db_version',
        'public.system_embedding_refresh_jobs',
        'public.system_favorites',
        'public.system_foreign_key_relations_1_m',
        'public.system_foreign_key_relations_m_m',
        'public.system_front_page_blocks',
        'public.system_front_page_revisions',
        'public.system_functions',
        'public.system_group_table_func_rights',
        'public.system_lang_key_sources',
        'public.system_lang_key_translations',
        'public.system_lang_keys',
        'public.system_lang_keys_archive',
        'public.system_languages',
        'public.system_media_asset_usages',
        'public.system_media_assets',
        'public.system_permission_actions',
        'public.system_permission_categories',
        'public.system_revoked_sign_ins',
        'public.system_row_access_rule_events',
        'public.system_row_access_rules',
        'public.system_row_actor_columns',
        'public.system_row_group_classifications',
        'public.system_row_group_memberships',
        'public.system_row_groups',
        'public.system_table_folders',
        'public.system_table_row_view_counts',
        'public.system_table_views',
        'public.system_transaction_log',
        'public.system_user_group_memberships',
        'public.system_user_groups',
        'public.system_user_visual_preferences',
        'public.system_users',
        'public.system_view_field_set_assignments',
        'restricted.otp_send_events',
        'restricted.password_reset_dummy_work',
        'restricted.system_application_update_admissions',
        'restricted.system_application_update_auth_attempts',
        'restricted.system_application_update_control',
        'restricted.system_application_update_decisions',
        'restricted.system_application_update_events',
        'restricted.system_application_update_jobs',
        'restricted.system_application_update_proofs',
        'restricted.users_restricted',
        'restricted.verification_codes'
    ]::text[];
$scope$;

CREATE OR REPLACE FUNCTION public.app_check_managed_timestamp_zones()
RETURNS SETOF text LANGUAGE sql STABLE AS $check$
    WITH scope AS (
        SELECT name FROM unnest(public.app_managed_timestamp_tables()) AS name
        UNION ALL
        SELECT name || '_lang_embeddings' FROM unnest(public.app_managed_timestamp_tables()) AS name
    )
    SELECT format('%s.%I', a.attrelid::regclass, a.attname)
    FROM scope JOIN pg_attribute a ON a.attrelid = to_regclass(scope.name)
    WHERE a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'timestamp'::regtype
    ORDER BY 1;
$check$;

DO $conversion$
DECLARE
    item record;
    child record;
    grant_item record;
    original_role text := current_user;
    original_zone text := current_setting('TimeZone');
    default_type oid;
    default_sql text;
    reset_acl text;
BEGIN
    -- Literal coercions in reconstructed dependencies must use the same zone
    -- as the stored clocks, independently of the caller's session setting.
    PERFORM set_config('TimeZone', 'Europe/Helsinki', true);
    CREATE TEMP TABLE wl167_timestamp_columns ON COMMIT DROP AS
        WITH scope AS (
            SELECT name FROM unnest(public.app_managed_timestamp_tables()) AS name
            UNION ALL
            SELECT name || '_lang_embeddings' FROM unnest(public.app_managed_timestamp_tables()) AS name
        )
        SELECT a.attrelid AS relation_id, a.attnum, a.attname AS column_name,
               pg_get_expr(d.adbin, d.adrelid) AS old_default
        FROM scope JOIN pg_attribute a ON a.attrelid = to_regclass(scope.name)
        JOIN pg_class c ON c.oid = a.attrelid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'timestamp'::regtype
            AND c.relkind IN ('r', 'p');

    -- ALTER TYPE propagates through inheritance. Refuse an unreviewed child
    -- instead of changing a site-owned table through a managed parent.
    IF EXISTS (SELECT 1 FROM pg_inherits i JOIN wl167_timestamp_columns t
               ON t.relation_id IN (i.inhparent, i.inhrelid)) THEN
        RAISE EXCEPTION 'WL167: timestamp inheritance/partition dependencies require explicit review';
    END IF;
    FOR item IN SELECT DISTINCT relation_id FROM wl167_timestamp_columns ORDER BY relation_id LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', item.relation_id::regclass);
    END LOOP;

    CREATE TEMP TABLE wl167_timestamp_views ON COMMIT DROP AS
        WITH RECURSIVE dependencies AS (
            SELECT r.ev_class AS relation_id, 1 AS depth, ARRAY[r.ev_class] AS path
            FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
            JOIN wl167_timestamp_columns t ON t.relation_id = d.refobjid
                AND d.refobjsubid IN (0, t.attnum)
            WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
                AND r.ev_class <> t.relation_id
            UNION ALL
            SELECT r.ev_class, p.depth + 1, p.path || r.ev_class
            FROM dependencies p JOIN pg_depend d ON d.refobjid = p.relation_id
            JOIN pg_rewrite r ON r.oid = d.objid
            WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
                AND NOT r.ev_class = ANY(p.path)
        )
        SELECT c.oid AS relation_id, d.depth, c.relkind,
               format('%I.%I', n.nspname, c.relname) AS qualified_name,
               pg_get_viewdef(c.oid, false) AS definition, c.reloptions, c.relowner,
               COALESCE(c.relacl, acldefault('r', c.relowner)) AS acl,
               obj_description(c.oid, 'pg_class') AS comment
        FROM (SELECT relation_id, max(depth) AS depth FROM dependencies GROUP BY relation_id) d
        JOIN pg_class c ON c.oid = d.relation_id
        JOIN pg_namespace n ON n.oid = c.relnamespace;
    IF EXISTS (SELECT 1 FROM wl167_timestamp_views WHERE relkind <> 'v') THEN
        RAISE EXCEPTION 'WL167: dependent materialized views require explicit review; nothing converted';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_seclabel s JOIN wl167_timestamp_views v
               ON s.classoid = 'pg_class'::regclass AND s.objoid = v.relation_id) THEN
        RAISE EXCEPTION 'WL167: dependent view security labels require explicit review';
    END IF;
    -- Delegated ACL chains need their original grantors, not new owner grants.
    -- Refuse them rather than silently change revocation authority.
    IF EXISTS (SELECT 1 FROM wl167_timestamp_views v, LATERAL aclexplode(v.acl) x
               WHERE x.grantor <> v.relowner)
        OR EXISTS (SELECT 1 FROM wl167_timestamp_views v
            JOIN pg_attribute a ON a.attrelid = v.relation_id,
            LATERAL aclexplode(a.attacl) x WHERE x.grantor <> v.relowner) THEN
        RAISE EXCEPTION 'WL167: delegated dependent-view grants require explicit review';
    END IF;

    CREATE TEMP TABLE wl167_timestamp_view_columns ON COMMIT DROP AS
        SELECT v.qualified_name, a.attname AS column_name, a.attacl AS acl,
               col_description(a.attrelid, a.attnum) AS comment,
               pg_get_expr(d.adbin, d.adrelid) AS old_default
        FROM wl167_timestamp_views v JOIN pg_attribute a ON a.attrelid = v.relation_id
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped;
    CREATE TEMP TABLE wl167_timestamp_rules ON COMMIT DROP AS
        SELECT pg_get_ruledef(r.oid, false) AS definition,
               obj_description(r.oid, 'pg_rewrite') AS comment, r.rulename,
               v.qualified_name, v.relkind, r.ev_enabled
        FROM wl167_timestamp_views v JOIN pg_rewrite r ON r.ev_class = v.relation_id
        WHERE r.rulename <> '_RETURN';
    -- Metadata repair writes even when metadata's own clocks are already zoned.
    -- Suspend its user triggers with the converted-table triggers, preserving
    -- their definitions, comments and exact enabled states through restoration.
    CREATE TEMP TABLE wl167_timestamp_triggers ON COMMIT DROP AS
        SELECT DISTINCT format('%I.%I', n.nspname, c.relname) AS qualified_name,
               c.relkind, t.tgname, pg_get_triggerdef(t.oid, false) AS definition, t.tgenabled,
               obj_description(t.oid, 'pg_trigger') AS comment
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND (t.tgrelid IN (SELECT relation_id FROM wl167_timestamp_columns)
            OR t.tgrelid IN (SELECT relation_id FROM wl167_timestamp_views)
            OR (t.tgrelid = to_regclass('public.system_column_details')
                AND EXISTS (SELECT 1 FROM wl167_timestamp_columns)));
    -- PostgreSQL 16 recreates rules/triggers in origin state ('O'). State
    -- changes through ALTER TABLE are supported only on tables, not views.
    -- Validate every captured state before removing any object: an unsupported
    -- state must refuse the conversion rather than silently become 'O'.
    FOR item IN
        SELECT * FROM (
            SELECT 'rule' AS object_kind, rulename AS object_name, qualified_name,
                   relkind, ev_enabled AS enabled FROM wl167_timestamp_rules
            UNION ALL
            SELECT 'trigger', tgname, qualified_name, relkind, tgenabled
            FROM wl167_timestamp_triggers
        ) captured
        WHERE enabled NOT IN ('O', 'D', 'R', 'A')
            OR (enabled <> 'O' AND relkind NOT IN ('r', 'p'))
        ORDER BY qualified_name, object_kind, object_name
    LOOP
        RAISE EXCEPTION 'WL167: cannot restore captured % % on %: enabled state % is unsupported for relation kind %; nothing converted',
            item.object_kind, item.object_name, item.qualified_name, item.enabled, item.relkind;
    END LOOP;
    FOR item IN SELECT * FROM wl167_timestamp_triggers LOOP
        EXECUTE format('DROP TRIGGER %I ON %s', item.tgname, item.qualified_name);
    END LOOP;
    FOR item IN SELECT * FROM wl167_timestamp_views ORDER BY depth DESC, qualified_name LOOP
        -- RESTRICT is intentional: an uncaptured dependency aborts this entire
        -- statement/runner transaction, including all previous object removals.
        EXECUTE 'DROP VIEW ' || item.qualified_name || ' RESTRICT';
    END LOOP;

    FOR item IN SELECT * FROM wl167_timestamp_columns ORDER BY relation_id, attnum LOOP
        default_sql := item.old_default;
        IF default_sql IS NOT NULL THEN
            -- Parse the default without executing it (even volatile defaults).
            -- now()/CURRENT_TIMESTAMP are already instants; naive literals and
            -- timestamp-returning expressions need the same explicit conversion.
            EXECUTE 'CREATE TEMP VIEW wl167_timestamp_default_probe AS SELECT (' || default_sql || ') AS value';
            SELECT atttypid INTO default_type FROM pg_attribute
                WHERE attrelid = 'pg_temp.wl167_timestamp_default_probe'::regclass AND attname = 'value';
            DROP VIEW pg_temp.wl167_timestamp_default_probe;
            IF default_type = 'timestamp'::regtype THEN
                default_sql := '(' || default_sql || ') AT TIME ZONE ''Europe/Helsinki''';
            ELSIF default_type <> 'timestamptz'::regtype THEN
                RAISE EXCEPTION 'WL167: unsupported default type on %.%', item.relation_id::regclass, item.column_name;
            END IF;
            EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP DEFAULT', item.relation_id::regclass, item.column_name);
        END IF;
        EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE %L',
                       item.relation_id::regclass, item.column_name, item.column_name, 'Europe/Helsinki');
        IF default_sql IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT %s',
                           item.relation_id::regclass, item.column_name, default_sql);
        END IF;
    END LOOP;

    FOR item IN SELECT * FROM wl167_timestamp_views ORDER BY depth, qualified_name LOOP
        EXECUTE 'CREATE VIEW ' || item.qualified_name
            || CASE WHEN item.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(item.reloptions, ',') || ')' END
            || ' AS ' || item.definition;
        EXECUTE format('ALTER VIEW %s OWNER TO %I', item.qualified_name, pg_get_userbyid(item.relowner));
        EXECUTE format('COMMENT ON VIEW %s IS %L', item.qualified_name, item.comment);
        -- Clear any creation-time default ACL before restoring the original
        -- effective rights, including PUBLIC and grant options. Act as owner
        -- so delegated grants retain their authority on replay.
        SELECT string_agg(format('REVOKE ALL ON %s FROM %s;', item.qualified_name,
                    CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END), '')
            INTO reset_acl FROM pg_class c,
                LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
            WHERE c.oid = to_regclass(item.qualified_name);
        EXECUTE format('SET LOCAL ROLE %I', pg_get_userbyid(item.relowner));
        IF reset_acl IS NOT NULL THEN EXECUTE reset_acl; END IF;
        EXECUTE format('SET LOCAL ROLE %I', original_role);
        FOR grant_item IN SELECT * FROM aclexplode(item.acl) LOOP
            EXECUTE format('SET LOCAL ROLE %I', pg_get_userbyid(item.relowner));
            EXECUTE format('GRANT %s ON %s TO %s%s', grant_item.privilege_type, item.qualified_name,
                CASE WHEN grant_item.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_item.grantee)) END,
                CASE WHEN grant_item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
            EXECUTE format('SET LOCAL ROLE %I', original_role);
        END LOOP;
        FOR child IN SELECT * FROM wl167_timestamp_view_columns WHERE qualified_name = item.qualified_name LOOP
            EXECUTE format('COMMENT ON COLUMN %s.%I IS %L', item.qualified_name, child.column_name, child.comment);
            IF child.old_default IS NOT NULL THEN
                default_sql := child.old_default;
                EXECUTE 'CREATE TEMP VIEW wl167_timestamp_default_probe AS SELECT (' || default_sql || ') AS value';
                SELECT atttypid INTO default_type FROM pg_attribute
                    WHERE attrelid = 'pg_temp.wl167_timestamp_default_probe'::regclass AND attname = 'value';
                DROP VIEW pg_temp.wl167_timestamp_default_probe;
                IF default_type = 'timestamp'::regtype AND EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = to_regclass(item.qualified_name) AND attname = child.column_name
                        AND atttypid = 'timestamptz'::regtype) THEN
                    default_sql := '(' || default_sql || ') AT TIME ZONE ''Europe/Helsinki''';
                END IF;
                EXECUTE format('ALTER VIEW %s ALTER COLUMN %I SET DEFAULT %s', item.qualified_name, child.column_name, default_sql);
            END IF;
            FOR grant_item IN SELECT * FROM aclexplode(child.acl) LOOP
                EXECUTE format('SET LOCAL ROLE %I', pg_get_userbyid(item.relowner));
                EXECUTE format('GRANT %s (%I) ON %s TO %s%s', grant_item.privilege_type, child.column_name,
                    item.qualified_name,
                    CASE WHEN grant_item.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_item.grantee)) END,
                    CASE WHEN grant_item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
                EXECUTE format('SET LOCAL ROLE %I', original_role);
            END LOOP;
        END LOOP;
    END LOOP;
    -- Generic readers derive types from PostgreSQL; keep stored field metadata
    -- aligned too, before restoring triggers: this metadata repair must not
    -- advance the stored modification clocks. Small legacy fixtures may lack
    -- that optional catalogue.
    IF NOT EXISTS (
        SELECT 1 FROM (VALUES ('public.system_db_tables', 'schema_name'),
            ('public.system_db_tables', 'table_name'), ('public.system_db_tables', 'table_uid'),
            ('public.system_column_details', 'table_uid'), ('public.system_column_details', 'column_name'),
            ('public.system_column_details', 'data_type')) AS required_columns(relation_name, column_name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass(required_columns.relation_name)
                AND a.attname = required_columns.column_name AND NOT a.attisdropped)
    ) THEN
        EXECUTE $metadata$UPDATE public.system_column_details details
            SET data_type = 'timestamp with time zone'
            FROM public.system_db_tables registry, wl167_timestamp_columns changed
            WHERE details.table_uid = registry.table_uid AND details.column_name = changed.column_name
                AND to_regclass(format('%I.%I', COALESCE(NULLIF(registry.schema_name, ''), 'public'),
                    registry.table_name)) = changed.relation_id
                AND details.data_type IS DISTINCT FROM 'timestamp with time zone'$metadata$;
    END IF;
    FOR item IN SELECT * FROM wl167_timestamp_rules LOOP
        EXECUTE item.definition;
        IF item.relkind IN ('r', 'p') AND item.ev_enabled <> 'O' THEN
            EXECUTE format('ALTER TABLE %s %s RULE %I', item.qualified_name,
                CASE item.ev_enabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA'
                    WHEN 'A' THEN 'ENABLE ALWAYS' END, item.rulename);
        END IF;
        EXECUTE format('COMMENT ON RULE %I ON %s IS %L', item.rulename, item.qualified_name, item.comment);
    END LOOP;
    FOR item IN SELECT * FROM wl167_timestamp_triggers LOOP
        EXECUTE item.definition;
        IF item.relkind IN ('r', 'p') AND item.tgenabled <> 'O' THEN
            EXECUTE format('ALTER TABLE %s %s TRIGGER %I', item.qualified_name,
                CASE item.tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA'
                    WHEN 'A' THEN 'ENABLE ALWAYS' END, item.tgname);
        END IF;
        EXECUTE format('COMMENT ON TRIGGER %I ON %s IS %L', item.tgname, item.qualified_name, item.comment);
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.app_check_managed_timestamp_zones()) THEN
        RAISE EXCEPTION 'WL167: naive managed timestamp remains';
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl167_managed_timestamp_zones', 'completed',
           jsonb_build_object('file', '20261009000080_zone_platform_managed_timestamps.sql', 'zone', 'Europe/Helsinki')
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'wl167_managed_timestamp_zones' AND action = 'completed');
    PERFORM set_config('TimeZone', original_zone, true);
    DROP TABLE wl167_timestamp_triggers, wl167_timestamp_rules,
        wl167_timestamp_view_columns, wl167_timestamp_views, wl167_timestamp_columns;
END;
$conversion$;
