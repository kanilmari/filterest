-- Separates confidential sign-in names from public display names (WL132, K116/K205).
-- Connects account lifecycle writes, bootstrap acceptance and identifier-only repair history.
-- One statement keeps every import path atomic; old public history remains unchanged (K201).
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: k116_login_names
-- FINAL_CHECK: public.app_check_login_name_protections()

DO $login_names$
DECLARE
    item record;
    ids bigint[];
    targets oid[] := ARRAY['public.system_users'::regclass::oid,
        'public.system_user_group_memberships'::regclass::oid, 'restricted.users_restricted'::regclass::oid];
    allocated text[] := '{}';
    display_name text;
    findings text;
    copied bigint;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    IF EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'k116_login_names' AND action = 'completed') THEN
        RETURN;
    END IF;

    -- Known cache synchronization can propagate the rename. Include every static
    -- write target in its body and every cached-name table, without site-specific names.
    SELECT targets || coalesce(array_agg(DISTINCT relation.oid), '{}'::oid[]) INTO targets
    FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace ns ON ns.oid = relation.relnamespace
    WHERE ns.nspname = 'public' AND relation.relkind = 'r' AND (
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = relation.oid
            AND attname = 'cached_username' AND NOT attisdropped)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger
            JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
            CROSS JOIN LATERAL regexp_matches(fn.prosrc,
                '(?i)(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+((?:public\.)?[a-z_][a-z0-9_]*)', 'g') AS matched(parts)
            WHERE trigger.tgrelid = 'public.system_users'::regclass
                AND fn.proname = 'fn_sync_cached_username'
                AND to_regclass(matched.parts[1]) = relation.oid));
    FOR item IN SELECT oid, relowner FROM pg_catalog.pg_class
        WHERE oid = ANY(targets || ARRAY['public.system_data_repair_records'::regclass::oid,
            'public.system_config'::regclass::oid]) ORDER BY oid
    LOOP
        IF NOT pg_has_role(current_user, item.relowner, 'MEMBER') THEN
            RAISE EXCEPTION 'login-name migration: owner membership required for relation id %', item.oid;
        END IF;
        EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', item.oid::regclass);
    END LOOP;
    LOCK TABLE public.system_user_groups IN SHARE ROW EXCLUSIVE MODE;

    SELECT array_agg(id ORDER BY id) INTO ids FROM public.system_user_groups
    WHERE (id = 1 AND name IS DISTINCT FROM 'admins') OR (id <> 1 AND name = 'admins');
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: administrator group ids %', ids;
    END IF;
    SELECT array_agg(credentials.id ORDER BY credentials.id) INTO ids
    FROM restricted.users_restricted credentials LEFT JOIN public.system_users account ON account.id = credentials.id
    WHERE account.id IS NULL OR account.username IS NULL OR btrim(account.username) = ''
        OR account.username ~ '^[[:space:]]|[[:space:]]$';
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: missing account or invalid name at account ids %', ids;
    END IF;
    SELECT array_agg(id ORDER BY id) INTO ids FROM (
        SELECT id, count(*) OVER (PARTITION BY lower(username)) AS copies FROM public.system_users
        WHERE username IS NOT NULL
    ) duplicates WHERE copies > 1;
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: duplicate display/login names at account ids %', ids;
    END IF;
    FOR item IN SELECT trigger.tgname, fn.proname, ns.nspname, relation.relname
        FROM pg_catalog.pg_trigger trigger JOIN pg_catalog.pg_proc fn ON fn.oid = trigger.tgfoid
        JOIN pg_catalog.pg_namespace ns ON ns.oid = fn.pronamespace
        JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
        WHERE NOT trigger.tgisinternal AND trigger.tgrelid = ANY(targets)
    LOOP
        IF item.nspname = 'public' AND (
            item.proname IN ('set_users_updated_timestamp', 'set_auth_user_group_memberships_updated_timestamp',
                'set_transaction_log_updated_at_timestamp',
                'set_log_updated_timestamp', 'set_service_catalog_updated_timestamp', 'set_domain_workspace_updated_timestamp')
            OR (item.proname = 'fn_sync_cached_username' AND item.tgname = 'trg_sync_cached_username')
            OR (item.proname = 'protect_row_creator' AND item.tgname = public.app_row_actor_object_name('protect', item.relname, 'creator'))
            OR (item.proname = 'app_enforce_administrator_names_differ' AND item.tgname IN (
                'app_users_names_differ', 'app_memberships_names_differ', 'app_credentials_names_differ'))
        ) THEN CONTINUE; END IF;
        RAISE EXCEPTION 'login-name migration: unknown trigger %', item.tgname;
    END LOOP;

    ALTER TABLE restricted.users_restricted ADD COLUMN IF NOT EXISTS login_name text;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'restricted.users_restricted'::regclass
        AND attname = 'login_name' AND atttypid <> 'text'::regtype AND NOT attisdropped) THEN
        RAISE EXCEPTION 'login-name migration: invalid login_name column type';
    END IF;
    -- Check proposed fills before an existing unique index can report its values.
    SELECT array_agg(id ORDER BY id) INTO ids FROM (
        SELECT credentials.id, count(*) OVER (PARTITION BY lower(coalesce(credentials.login_name, account.username))) AS copies
        FROM restricted.users_restricted credentials JOIN public.system_users account USING (id)
    ) duplicates WHERE copies > 1;
    IF ids IS NOT NULL THEN
        RAISE EXCEPTION 'login-name migration: duplicate login names at account ids %', ids;
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_restricted_login_name_lower
        ON restricted.users_restricted (lower(login_name));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_system_users_username_lower ON public.system_users (lower(username));
    -- Reject a same-named wrong index before any write of a name. Its unrelated
    -- unique constraint could otherwise refuse a rename with values in DETAIL.
    FOR item IN SELECT * FROM (VALUES
        ('restricted.uq_users_restricted_login_name_lower', 'restricted.users_restricted', 'lower(login_name)'),
        ('public.uq_system_users_username_lower', 'public.system_users', 'lower((username)::text)')
    ) AS expected(index_name, table_name, expression)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index idx
            JOIN pg_catalog.pg_class relation ON relation.oid = idx.indexrelid
            JOIN pg_catalog.pg_am method ON method.oid = relation.relam
            WHERE idx.indexrelid = to_regclass(item.index_name) AND idx.indrelid = to_regclass(item.table_name)
                AND idx.indisunique AND idx.indisvalid AND idx.indisready AND idx.indpred IS NULL
                AND idx.indnatts = 1 AND idx.indnkeyatts = 1 AND method.amname = 'btree'
                AND pg_get_indexdef(idx.indexrelid, 1, false) = CASE
                    WHEN item.table_name = 'public.system_users' AND EXISTS (
                        SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = idx.indrelid
                            AND attname = 'username' AND atttypid = 'text'::regtype)
                    THEN 'lower(username)' ELSE item.expression END) THEN
            RAISE EXCEPTION 'login-name migration: %: invalid unique lower-name index', item.index_name;
        END IF;
    END LOOP;
    UPDATE restricted.users_restricted credentials SET login_name = account.username
    FROM public.system_users account WHERE credentials.id = account.id AND credentials.login_name IS NULL;
    GET DIAGNOSTICS copied = ROW_COUNT;
    ALTER TABLE restricted.users_restricted ALTER COLUMN login_name SET NOT NULL;

    CREATE OR REPLACE FUNCTION public.app_is_administrator_account(account_id bigint)
    RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
        SELECT EXISTS (SELECT 1 FROM public.system_users account WHERE account.id = account_id
            AND (account.admin_access_allowed IS TRUE OR EXISTS (
                SELECT 1 FROM public.system_user_group_memberships membership
                WHERE membership.user_id = account.id AND membership.group_id = 1)))
    $fn$;
    GRANT EXECUTE ON FUNCTION public.app_is_administrator_account(bigint) TO PUBLIC;

    CREATE OR REPLACE FUNCTION public.app_next_admin_display_name(prefix text, also_taken text[] DEFAULT '{}')
    RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
    DECLARE number bigint := 1; candidate text;
    BEGIN
        IF prefix IS NULL OR prefix NOT IN ('admin', 'auto', 'user') THEN
            RAISE EXCEPTION 'invalid display-name prefix' USING ERRCODE = '22023';
        END IF;
        LOOP
            candidate := prefix || '_' || number;
            IF NOT EXISTS (SELECT 1 FROM public.system_users WHERE lower(username) = lower(candidate))
                AND NOT EXISTS (SELECT 1 FROM restricted.users_restricted WHERE lower(login_name) = lower(candidate))
                AND NOT EXISTS (SELECT 1 FROM unnest(also_taken) AS taken WHERE lower(taken) = lower(candidate)) THEN
                RETURN candidate;
            END IF;
            number := number + 1;
        END LOOP;
    END $fn$;
    GRANT EXECUTE ON FUNCTION public.app_next_admin_display_name(text, text[]) TO PUBLIC;

    INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
    VALUES ('display_name_may_equal_login_name', true, '{"value":true}', 'true', 2,
        'Ordinary accounts may use the same display and login name; administrators must use different names.')
    ON CONFLICT (key) DO NOTHING;

    FOR item IN SELECT account.id, account.username, account.full_name, credentials.api_only
        FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
        WHERE public.app_is_administrator_account(account.id)
            AND lower(btrim(account.username)) = lower(btrim(credentials.login_name)) ORDER BY account.id
    LOOP
        display_name := public.app_next_admin_display_name(CASE WHEN item.api_only THEN 'auto' ELSE 'admin' END, allocated);
        allocated := array_append(allocated, display_name);
        UPDATE public.system_users SET username = display_name,
            full_name = CASE WHEN lower(full_name) = lower(item.username) THEN display_name ELSE full_name END,
            search_vector_simple = NULL WHERE id = item.id;
        UPDATE restricted.users_restricted SET authentication_generation = authentication_generation + 1 WHERE id = item.id;
        INSERT INTO public.system_data_repair_records (migration, table_name, row_id, action)
        SELECT 'k116_login_names', 'system_users', item.id, action FROM unnest(ARRAY[
            'display_name_assigned', 'generation_bumped', 'login_name_inherited_public', 'search_vector_cleared']) AS action;
        IF lower(item.full_name) = lower(item.username) THEN
            INSERT INTO public.system_data_repair_records (migration, table_name, row_id, action)
            VALUES ('k116_login_names', 'system_users', item.id, 'full_name_replaced');
        END IF;
    END LOOP;

    CREATE OR REPLACE FUNCTION public.app_enforce_administrator_names_differ()
    RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE account_id bigint; display text; login text; name_write boolean := false;
    BEGIN
        IF TG_TABLE_NAME = 'system_user_group_memberships' THEN
            account_id := NEW.user_id;
        ELSE
            account_id := NEW.id;
            IF TG_TABLE_NAME = 'system_users' THEN
                name_write := NEW.username IS DISTINCT FROM OLD.username;
            ELSIF TG_OP = 'INSERT' THEN
                name_write := true;
            ELSE
                name_write := NEW.login_name IS DISTINCT FROM OLD.login_name;
            END IF;
        END IF;
        -- Lock and read are separate statements: a waiter gets a fresh RC snapshot.
        -- NO KEY UPDATE is compatible with membership foreign-key KEY SHARE locks.
        PERFORM 1 FROM public.system_users WHERE id = account_id FOR NO KEY UPDATE;
        -- Publish a tuple version for cross-table writes too. A lock alone leaves
        -- an older RR snapshot able to miss a committed credential/membership write.
        -- Touching a non-key column avoids both a key-lock upgrade and recursive name/flag triggers.
        IF TG_TABLE_NAME <> 'system_users' THEN
            UPDATE public.system_users SET updated = updated WHERE id = account_id;
        END IF;
        SELECT account.username, credentials.login_name INTO display, login
        FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
        WHERE account.id = account_id;
        IF lower(btrim(display)) = lower(btrim(login)) THEN
            IF public.app_is_administrator_account(account_id) THEN
                RAISE EXCEPTION 'administrator_names_differ' USING ERRCODE = '23514', CONSTRAINT = 'administrator_names_differ';
            ELSIF name_write AND coalesce((SELECT boolean_value FROM public.system_config
                WHERE key = 'display_name_may_equal_login_name'), true) IS FALSE THEN
                RAISE EXCEPTION 'user_names_differ' USING ERRCODE = '23514', CONSTRAINT = 'user_names_differ';
            END IF;
        END IF;
        RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_enforce_administrator_names_differ() FROM PUBLIC;
    CREATE OR REPLACE TRIGGER app_users_names_differ AFTER UPDATE OF username, admin_access_allowed
        ON public.system_users FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
    CREATE OR REPLACE TRIGGER app_memberships_names_differ AFTER INSERT OR UPDATE
        ON public.system_user_group_memberships FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();
    CREATE OR REPLACE TRIGGER app_credentials_names_differ AFTER INSERT OR UPDATE OF login_name, id
        ON restricted.users_restricted FOR EACH ROW EXECUTE FUNCTION public.app_enforce_administrator_names_differ();

    CREATE OR REPLACE FUNCTION public.app_describe_account_name_setting()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE equal_count bigint;
    BEGIN
        SELECT count(*) INTO equal_count FROM public.system_users account
        JOIN restricted.users_restricted credentials USING (id)
        WHERE NOT public.app_is_administrator_account(account.id)
            AND lower(btrim(account.username)) = lower(btrim(credentials.login_name));
        NEW.creation_spec := format('%s: ordinary credentialed accounts with equal display and login names: %s. '
            'Existing equal names remain until a name is changed; administrators always use different names.',
            current_date, equal_count);
        RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_describe_account_name_setting() FROM PUBLIC;
    CREATE OR REPLACE TRIGGER app_account_name_setting_description BEFORE UPDATE ON public.system_config
        FOR EACH ROW WHEN (NEW.key = 'display_name_may_equal_login_name'
            AND OLD.boolean_value IS DISTINCT FROM NEW.boolean_value)
        EXECUTE FUNCTION public.app_describe_account_name_setting();

    CREATE OR REPLACE FUNCTION public.app_check_login_name_protections()
    RETURNS SETOF text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
    DECLARE item record; fn_oid oid; column_ok boolean;
    BEGIN
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
            WHERE attrelid = 'restricted.users_restricted'::regclass AND attname = 'login_name'
                AND NOT attisdropped AND atttypid = 'text'::regtype AND attnotnull) INTO column_ok;
        IF NOT column_ok THEN RETURN NEXT 'login_name: missing text NOT NULL column'; END IF;
        FOR item IN SELECT * FROM (VALUES
            ('restricted.uq_users_restricted_login_name_lower', 'restricted.users_restricted', 'lower(login_name)'),
            ('public.uq_system_users_username_lower', 'public.system_users', 'lower((username)::text)')
        ) AS expected(index_name, table_name, expression)
        LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index idx
                JOIN pg_catalog.pg_class relation ON relation.oid = idx.indexrelid
                JOIN pg_catalog.pg_am method ON method.oid = relation.relam
                WHERE idx.indexrelid = to_regclass(item.index_name) AND idx.indrelid = to_regclass(item.table_name)
                    AND idx.indisunique AND idx.indisvalid AND idx.indisready AND idx.indpred IS NULL
                    AND idx.indnatts = 1 AND idx.indnkeyatts = 1 AND method.amname = 'btree'
                    AND pg_get_indexdef(idx.indexrelid, 1, false) = CASE
                        WHEN item.table_name = 'public.system_users' AND EXISTS (
                            SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = idx.indrelid
                                AND attname = 'username' AND atttypid = 'text'::regtype)
                        THEN 'lower(username)' ELSE item.expression END) THEN
                RETURN NEXT item.index_name || ': invalid unique lower-name index';
            END IF;
        END LOOP;
        FOR item IN SELECT * FROM (VALUES
            ('public.system_users', 'app_users_names_differ', 17, ARRAY['admin_access_allowed','username']::text[],
                'app_enforce_administrator_names_differ', false),
            ('public.system_user_group_memberships', 'app_memberships_names_differ', 21, '{}'::text[],
                'app_enforce_administrator_names_differ', false),
            ('restricted.users_restricted', 'app_credentials_names_differ', 21, ARRAY['id','login_name']::text[],
                'app_enforce_administrator_names_differ', false),
            ('public.system_config', 'app_account_name_setting_description', 19, '{}'::text[],
                'app_describe_account_name_setting', true)
        ) AS expected(table_name, trigger_name, kind, columns, function_name, conditional)
        LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger
                WHERE trigger.tgrelid = to_regclass(item.table_name) AND trigger.tgname = item.trigger_name
                    AND NOT trigger.tgisinternal AND trigger.tgenabled = 'O' AND trigger.tgtype = item.kind
                    AND trigger.tgfoid = to_regprocedure('public.' || item.function_name || '()')
                    AND trigger.tgnargs = 0 AND NOT trigger.tgdeferrable AND NOT trigger.tginitdeferred
                    AND (SELECT coalesce(array_agg(att.attname::text ORDER BY att.attname), '{}'::text[])
                        FROM pg_catalog.pg_attribute att WHERE att.attrelid = trigger.tgrelid
                            AND att.attnum = ANY(trigger.tgattr::smallint[])) = item.columns
                    AND CASE WHEN item.conditional THEN
                        regexp_replace(lower(substring(pg_get_triggerdef(trigger.oid, true)
                            FROM ' WHEN (.*) EXECUTE FUNCTION ')), '[[:space:]()]|::text', '', 'g') =
                        'new.key=''display_name_may_equal_login_name''andold.boolean_valueisdistinctfromnew.boolean_value'
                        ELSE trigger.tgqual IS NULL END) THEN
                RETURN NEXT item.trigger_name || ': invalid enabled row trigger';
            END IF;
        END LOOP;
        FOR item IN SELECT * FROM (VALUES
            ('app_is_administrator_account(bigint)', false, 'search_path=pg_catalog, public', true),
            ('app_next_admin_display_name(text,text[])', false, 'search_path=pg_catalog, public', true),
            ('app_enforce_administrator_names_differ()', true, 'search_path=pg_catalog, pg_temp', false),
            ('app_describe_account_name_setting()', true, 'search_path=pg_catalog, pg_temp', false),
            ('app_check_login_name_protections()', false, 'search_path=pg_catalog, pg_temp', false)
        ) AS expected(signature, definer, config, public_execute)
        LOOP
            fn_oid := to_regprocedure('public.' || item.signature);
            IF fn_oid IS NULL THEN
                RETURN NEXT item.signature || ': missing function';
            ELSE
                IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = fn_oid
                    AND prosecdef = item.definer AND proconfig = ARRAY[item.config]) THEN
                    RETURN NEXT item.signature || ': invalid security or search_path';
                END IF;
                IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                    CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                    WHERE fn.oid = fn_oid AND (acl.privilege_type <> 'EXECUTE'
                        OR (acl.grantee <> fn.proowner AND (NOT item.public_execute OR acl.grantee <> 0))
                        OR (acl.grantee = 0 AND acl.is_grantable)))
                    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                        CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                        WHERE fn.oid = fn_oid AND acl.grantee = fn.proowner AND acl.privilege_type = 'EXECUTE')
                    OR item.public_execute <> EXISTS (SELECT 1 FROM pg_catalog.pg_proc fn
                        CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) acl
                        WHERE fn.oid = fn_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') THEN
                    RETURN NEXT item.signature || ': invalid full execute ACL';
                END IF;
            END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'display_name_may_equal_login_name'
            AND value_type = 2 AND boolean_value IS NOT NULL) THEN
            RETURN NEXT 'display_name_may_equal_login_name: missing non-NULL boolean setting';
        END IF;
        IF column_ok THEN
            RETURN QUERY SELECT 'administrator_names_differ: account id ' || account.id
            FROM public.system_users account JOIN restricted.users_restricted credentials USING (id)
            WHERE (account.admin_access_allowed IS TRUE OR EXISTS (
                SELECT 1 FROM public.system_user_group_memberships membership
                WHERE membership.user_id = account.id AND membership.group_id = 1))
                AND lower(btrim(account.username)) = lower(btrim(credentials.login_name));
        END IF;
    END $fn$;
    REVOKE ALL ON FUNCTION public.app_check_login_name_protections() FROM PUBLIC;
    SELECT string_agg(finding, '; ') INTO findings FROM public.app_check_login_name_protections() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'login-name protections failed: %', findings; END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    VALUES ('k116_login_names', 'login_name_copied', jsonb_build_object('count', copied)),
        ('k116_login_names', 'account_without_credentials', jsonb_build_object('count', (
            SELECT count(*) FROM public.system_users account WHERE NOT EXISTS (
                SELECT 1 FROM restricted.users_restricted credentials WHERE credentials.id = account.id)))),
        ('k116_login_names', 'completed', '{"file":"20261005000011_separate_login_names.sql"}');
END $login_names$;
