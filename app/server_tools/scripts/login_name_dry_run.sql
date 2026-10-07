-- WL132/K116/K205 preflight, before or after upgrade; SELECT only.
-- Connects migration stops, rename propagation and the setting's equal-name count.
-- Run with a role allowed to read credentials. Results contain counts, ids and
-- trigger names, never account names, passwords, emails or copied source text.
WITH credentials AS (
    SELECT parsed.id, parsed.login_name, parsed.api_only, parsed.needs_backfill
    FROM XMLTABLE('/table/row' PASSING query_to_xml(
        CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
            WHERE attrelid = 'restricted.users_restricted'::regclass
                AND attname = 'login_name' AND NOT attisdropped)
        THEN 'SELECT id, login_name, api_only, login_name IS NULL AS needs_backfill FROM restricted.users_restricted'
        ELSE 'SELECT c.id, u.username AS login_name, c.api_only, true AS needs_backfill FROM restricted.users_restricted c '
            || 'LEFT JOIN public.system_users u ON u.id=c.id' END,
        true, false, '') COLUMNS id bigint PATH 'id', login_name text PATH 'login_name',
            api_only boolean PATH 'api_only', needs_backfill boolean PATH 'needs_backfill') parsed
), accounts AS (
    SELECT account.id, account.username, credentials.login_name, credentials.api_only,
        account.admin_access_allowed IS TRUE AS flag,
        EXISTS (SELECT 1 FROM public.system_user_group_memberships membership
            WHERE membership.user_id = account.id AND membership.group_id = 1) AS member,
        credentials.id IS NOT NULL AS credentialed
    FROM public.system_users account LEFT JOIN credentials USING (id)
), admins AS (
    SELECT * FROM accounts WHERE (flag OR member) AND credentialed
), duplicates AS (
    SELECT array_agg(id ORDER BY id) AS ids FROM accounts WHERE username IS NOT NULL
    GROUP BY lower(username) HAVING count(*) > 1
), login_duplicates AS (
    SELECT array_agg(id ORDER BY id) AS ids FROM credentials WHERE login_name IS NOT NULL
    GROUP BY lower(login_name) HAVING count(*) > 1
), targets AS (
    SELECT relation.oid, relation.relowner, relation.relname FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace ns ON ns.oid = relation.relnamespace
    WHERE relation.oid IN ('public.system_users'::regclass, 'public.system_user_group_memberships'::regclass,
        'restricted.users_restricted'::regclass, 'public.system_config'::regclass,
        'public.system_data_repair_records'::regclass)
        OR (ns.nspname = 'public' AND relation.relkind = 'r' AND (
            EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = relation.oid
                AND attname = 'cached_username' AND NOT attisdropped)
            OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger
                JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
                CROSS JOIN LATERAL regexp_matches(fn.prosrc,
                    '(?i)(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+((?:public\.)?[a-z_][a-z0-9_]*)', 'g') AS matched(parts)
                WHERE trigger.tgrelid = 'public.system_users'::regclass
                    AND fn.proname = 'fn_sync_cached_username' AND to_regclass(matched.parts[1]) = relation.oid)))
), triggers AS (
    SELECT trigger.tgname, trigger.tgrelid, trigger.tgenabled,
        ns.nspname = 'public' AND (
            fn.proname IN ('set_users_updated_timestamp', 'set_auth_user_group_memberships_updated_timestamp',
                'set_transaction_log_updated_at_timestamp',
                'set_log_updated_timestamp', 'set_service_catalog_updated_timestamp', 'set_domain_workspace_updated_timestamp')
            OR (fn.proname = 'fn_sync_cached_username' AND trigger.tgname = 'trg_sync_cached_username')
            OR (fn.proname = 'protect_row_creator' AND trigger.tgname = public.app_row_actor_object_name('protect', targets.relname, 'creator'))
            OR (fn.proname = 'app_enforce_administrator_names_differ' AND trigger.tgname IN (
                'app_users_names_differ', 'app_memberships_names_differ', 'app_credentials_names_differ'))
        ) AS known
    FROM targets JOIN pg_catalog.pg_trigger trigger ON trigger.tgrelid = targets.oid
    JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = fn.pronamespace WHERE NOT trigger.tgisinternal
        AND targets.oid NOT IN ('public.system_config'::regclass, 'public.system_data_repair_records'::regclass)
), propagation AS (
    SELECT targets.oid, scanned.count
    FROM targets CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
        CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = targets.oid
            AND attname = 'cached_username' AND NOT attisdropped)
        THEN format('SELECT count(*) AS count FROM %s WHERE lower(cached_username) IN '
            || '(SELECT lower(u.username) FROM public.system_users u JOIN restricted.users_restricted c USING (id) '
            || 'WHERE u.admin_access_allowed IS TRUE OR EXISTS (SELECT 1 FROM public.system_user_group_memberships m '
            || 'WHERE m.user_id=u.id AND m.group_id=1))', targets.oid::regclass)
        ELSE 'SELECT 0 AS count' END, true, false, '') COLUMNS count bigint PATH 'count') scanned
), report AS (
    SELECT 'administrator_accounts' AS item, jsonb_build_object('flag_only', count(*) FILTER (WHERE flag AND NOT member),
        'group_only', count(*) FILTER (WHERE member AND NOT flag), 'both', count(*) FILTER (WHERE flag AND member),
        'rename_ids', coalesce(jsonb_agg(id ORDER BY id) FILTER (
            WHERE lower(btrim(username)) = lower(btrim(login_name))), '[]'::jsonb),
        'automation_count', count(*) FILTER (WHERE api_only)) AS detail FROM admins
    UNION ALL SELECT 'stop_administrator_group_ids', coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
        FROM public.system_user_groups WHERE (id = 1 AND name IS DISTINCT FROM 'admins') OR (id <> 1 AND name = 'admins')
    UNION ALL SELECT 'stop_invalid_or_orphan_credential_ids', coalesce(jsonb_agg(credentials.id ORDER BY credentials.id), '[]'::jsonb)
        FROM credentials LEFT JOIN accounts ON accounts.id = credentials.id
        WHERE accounts.id IS NULL OR username IS NULL OR btrim(username) = '' OR username ~ '^[[:space:]]|[[:space:]]$'
    UNION ALL SELECT 'stop_duplicate_display_ids', coalesce(jsonb_agg(ids), '[]'::jsonb) FROM duplicates
    UNION ALL SELECT 'stop_duplicate_login_ids', coalesce(jsonb_agg(ids), '[]'::jsonb) FROM login_duplicates
    UNION ALL SELECT 'existing_login_column', coalesce(jsonb_agg(jsonb_build_object(
        'attribute_id', attnum, 'text_type', atttypid = 'text'::regtype, 'not_null', attnotnull)), '[]'::jsonb)
        FROM pg_catalog.pg_attribute WHERE attrelid = 'restricted.users_restricted'::regclass
            AND attname = 'login_name' AND NOT attisdropped
    UNION ALL SELECT 'existing_name_indexes', coalesce(jsonb_agg(jsonb_build_object(
        'relation_id', indexrelid, 'table_id', indrelid, 'unique', indisunique, 'valid', indisvalid,
        'ready', indisready, 'non_partial', indpred IS NULL, 'single_key', indnatts = 1 AND indnkeyatts = 1,
        'exact_expression', pg_get_indexdef(indexrelid, 1, false) IN (
            'lower(login_name)', 'lower(username)', 'lower((username)::text)'))), '[]'::jsonb)
        FROM pg_catalog.pg_index WHERE indexrelid IN (to_regclass('restricted.uq_users_restricted_login_name_lower'),
            to_regclass('public.uq_system_users_username_lower'))
    UNION ALL SELECT 'stop_unknown_triggers', coalesce(jsonb_agg(jsonb_build_object(
        'relation_id', tgrelid, 'trigger', tgname) ORDER BY tgrelid, tgname), '[]'::jsonb) FROM triggers WHERE NOT known
    UNION ALL SELECT 'owner_membership', jsonb_agg(jsonb_build_object('relation_id', oid,
        'owner_role_id', relowner, 'member', pg_has_role(current_user, relowner, 'MEMBER')) ORDER BY oid) FROM targets
    UNION ALL SELECT 'trigger_rows', coalesce(jsonb_agg(jsonb_build_object('relation_id', triggers.tgrelid,
        'trigger', tgname, 'state', tgenabled, 'count', CASE WHEN triggers.tgrelid = 'restricted.users_restricted'::regclass THEN
            (SELECT count(*) FROM credentials WHERE needs_backfill OR id IN (
                SELECT id FROM admins WHERE lower(btrim(username)) = lower(btrim(login_name))))
            WHEN triggers.tgrelid = 'public.system_users'::regclass THEN
            (SELECT count(*) FROM admins WHERE lower(btrim(username)) = lower(btrim(login_name)))
            ELSE propagation.count END) ORDER BY triggers.tgrelid, tgname), '[]'::jsonb)
        FROM triggers JOIN propagation ON propagation.oid = triggers.tgrelid
    UNION ALL SELECT 'credential_rows_to_backfill', to_jsonb(count(*)) FROM credentials WHERE needs_backfill
    UNION ALL SELECT 'numbered_login_names', jsonb_build_object('admin', count(*) FILTER (WHERE login_name ~* '^admin_[0-9]+$'),
        'auto', count(*) FILTER (WHERE login_name ~* '^auto_[0-9]+$')) FROM credentials
    UNION ALL SELECT 'test_name_orphan_ids', coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
        FROM accounts WHERE NOT credentialed AND lower(username) IN ('test_admin', 'test_user')
    UNION ALL SELECT 'reserved_name_case_variant_ids', coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
        FROM credentials WHERE lower(login_name) IN ('test_admin', 'test_user')
            AND login_name NOT IN ('test_admin', 'test_user')
    UNION ALL SELECT 'ordinary_equal_name_count', to_jsonb(count(*)) FROM accounts
        WHERE credentialed AND NOT flag AND NOT member AND lower(btrim(username)) = lower(btrim(login_name))
    UNION ALL SELECT 'non_admin_log_right_ids', coalesce(jsonb_agg(rights.id ORDER BY rights.id), '[]'::jsonb)
        FROM public.system_group_table_func_rights rights JOIN public.system_db_tables registry
            ON registry.table_uid = rights.target_table_uid
        WHERE rights.user_group_id <> 1 AND registry.table_name IN ('system_audit_log', 'system_transaction_log', 'system_log')
    UNION ALL SELECT 'registration_enabled', to_jsonb(boolean_value) FROM public.system_config WHERE key = 'registration_enabled'
    UNION ALL SELECT 'function_default_privileges', coalesce(jsonb_agg(jsonb_build_object(
        'owner_role_id', defaclrole, 'schema_id', defaclnamespace, 'grantee_role_id', acl.grantee,
        'privilege', acl.privilege_type, 'grantable', acl.is_grantable)
        ORDER BY defaclrole, defaclnamespace, acl.grantee), '[]'::jsonb)
        FROM pg_catalog.pg_default_acl CROSS JOIN LATERAL aclexplode(defaclacl) acl
        WHERE defaclobjtype = 'f'
    UNION ALL SELECT 'database_log_settings', jsonb_object_agg(name, setting) FROM pg_catalog.pg_settings
        WHERE name IN ('log_statement', 'log_min_duration_statement', 'log_min_error_statement',
            'log_parameter_max_length', 'log_parameter_max_length_on_error')
)
SELECT item, detail FROM report ORDER BY item;
