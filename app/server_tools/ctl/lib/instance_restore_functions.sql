-- instance_restore_functions.sql
-- Copies all matching routine owners and effective execution ACLs before swap.
-- Rejects unknown unmatched definers, using the runtime policy's reviewed list.
-- Catalogue verification catches grants silently refused by PostgreSQL.
SET search_path=pg_catalog;
DO $$
DECLARE p record; original jsonb; wanted jsonb; actual jsonb; reviewed jsonb;
BEGIN
    SELECT policy INTO reviewed FROM restore_reviewed_definers;
    FOR p IN SELECT f.*,n.nspname,l.lanname,f.oid::regprocedure::text AS identity,
                    r.rolname AS owner_name,
                    CASE f.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind
             FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
             JOIN pg_roles r ON r.oid=f.proowner JOIN pg_language l ON l.oid=f.prolang
             WHERE f.prokind IN ('f','w','p','a')
    LOOP
        SELECT info INTO original FROM restore_original_functions WHERE identity=p.identity;
        IF original IS NULL THEN
            IF p.prosecdef AND NOT EXISTS (
                SELECT 1 FROM jsonb_each(reviewed) b
                WHERE b.key=md5(p.prosrc) AND b.value->>'schema'=p.nspname
                  AND b.value->>'name'=p.proname
                  AND b.value->>'argument_types'=oidvectortypes(p.proargtypes)
                  AND ((COALESCE((b.value->>'legacy_trigger')::boolean,false)
                    AND p.prorettype='trigger'::regtype AND p.lanname='plpgsql' AND p.provolatile='v' AND p.pronargs=0
                    AND NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) s WHERE s LIKE 'search_path=%')
                    AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE t.tgfoid=p.oid AND NOT t.tgisinternal AND n.nspname='public'
                      AND c.relname='systemview_role_table_privileges' AND c.relkind='v' AND c.relowner=p.proowner)
                    AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE t.tgfoid=p.oid AND (n.nspname<>'public' OR c.relname<>'systemview_role_table_privileges' OR c.relowner<>p.proowner)))
                   OR (COALESCE((b.value->>'account_trigger')::boolean,false) AND p.prorettype='trigger'::regtype
 AND p.lanname='plpgsql' AND p.provolatile='v' AND p.pronargs=0
 AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE acl.grantee<>p.proowner OR acl.privilege_type<>'EXECUTE')
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE t.tgfoid=p.oid AND (NOT pg_has_role(p.proowner,c.relowner,'MEMBER') OR NOT (
     p.proname='app_enforce_administrator_names_differ' AND (
       ns.nspname='public' AND c.relname='system_users' AND t.tgname='app_users_names_differ' AND t.tgtype=17
       OR ns.nspname='public' AND c.relname='system_user_group_memberships' AND t.tgname='app_memberships_names_differ' AND t.tgtype=21
       OR ns.nspname='restricted' AND c.relname='users_restricted' AND t.tgname='app_credentials_names_differ' AND t.tgtype=21)
     OR p.proname='app_describe_account_name_setting' AND ns.nspname='public' AND c.relname='system_config'
       AND t.tgname='app_account_name_setting_description' AND t.tgtype=19)))
 AND EXISTS(SELECT 1 FROM pg_proc helper JOIN pg_namespace ns ON ns.oid=helper.pronamespace
   JOIN pg_language helper_language ON helper_language.oid=helper.prolang
   WHERE ns.nspname='public' AND helper.proname='app_is_administrator_account'
   AND oidvectortypes(helper.proargtypes)='bigint' AND NOT helper.prosecdef
   AND helper_language.lanname='sql' AND helper.provolatile='s' AND helper.prorettype='boolean'::regtype AND NOT helper.proretset
   AND helper.proowner=p.proowner AND helper.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND md5(helper.prosrc)='071d19378af50082c673808a48e86525'))
                   OR (NOT COALESCE((b.value->>'legacy_trigger')::boolean,false)
                    AND NOT COALESCE((b.value->>'account_trigger')::boolean,false)
                    AND p.lanname='sql' AND p.provolatile IN ('s','i')
                    AND (SELECT array_agg(s) FROM unnest(p.proconfig) s WHERE s LIKE 'search_path=%')=ARRAY[b.value->>'search_path']))
            ) THEN RAISE EXCEPTION 'unmatched SECURITY DEFINER function %',p.identity;
            END IF;
            CONTINUE;
        END IF;
        wanted := original->'acl';
        SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(r.rolname,'PUBLIC'),
                   'privilege',a.privilege_type,'grantable',a.is_grantable)
                   ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
          INTO actual FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee;
        IF p.owner_name<>original->>'owner' OR actual<>wanted THEN
            EXECUTE format('ALTER %s %s OWNER TO %I',p.kind,CASE WHEN p.prokind='a' AND p.pronargs=0 THEN left(p.identity,length(p.identity)-2)||'(*)' ELSE p.identity END,original->>'owner');
            PERFORM pg_temp.restore_acl(CASE WHEN p.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,p.identity,wanted,original->>'owner');
        END IF;
    END LOOP;
    -- Check all matching functions, including definer owners, after replay.
    FOR p IN SELECT f.*,f.oid::regprocedure::text AS identity,r.rolname AS owner_name
             FROM pg_proc f JOIN pg_roles r ON r.oid=f.proowner WHERE f.prokind IN ('f','w','p','a') LOOP
        SELECT info INTO original FROM restore_original_functions WHERE identity=p.identity;
        IF original IS NULL THEN CONTINUE; END IF;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(r.rolname,'PUBLIC'),
                   'privilege',a.privilege_type,'grantable',a.is_grantable)
                   ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
          INTO actual FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee;
        IF p.owner_name<>original->>'owner' OR actual<>original->'acl' THEN
            RAISE EXCEPTION 'function security verification differs: %',p.identity;
        END IF;
    END LOOP;
END $$;
