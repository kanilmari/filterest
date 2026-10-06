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
                   OR (NOT COALESCE((b.value->>'legacy_trigger')::boolean,false)
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
