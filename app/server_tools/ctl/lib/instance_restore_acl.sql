-- instance_restore_acl.sql
-- Replays effective EXECUTE/database ACLs with their original grantors.
-- Runs only on a retained replacement; callers verify the resulting catalogue.
-- Owners and PUBLIC revocations survive privilege-free portable dumps.
CREATE FUNCTION pg_temp.restore_acl(kind text, identity text, wanted jsonb, owner_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE g record; item jsonb; remaining jsonb; next_remaining jsonb; changed boolean;
        -- Database privilege lookups take raw names; only SQL text needs identifiers.
        sql_identity text := CASE WHEN kind='DATABASE' THEN quote_ident(identity) ELSE identity END;
BEGIN
    EXECUTE format('SET LOCAL ROLE %I', owner_name);
    -- Remove both default PUBLIC rights and replacement-specific default grants.
    EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM PUBLIC CASCADE', kind, sql_identity);
    FOR g IN SELECT DISTINCT value->>'grantee' AS name FROM jsonb_array_elements(wanted)
             UNION SELECT DISTINCT r.rolname FROM pg_roles r
             WHERE CASE WHEN kind='DATABASE' THEN has_database_privilege(r.oid,identity,'CREATE,CONNECT,TEMPORARY')
                        ELSE has_function_privilege(r.oid,identity,'EXECUTE') END
    LOOP
        IF g.name IS NOT NULL AND g.name <> 'PUBLIC' THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM %I CASCADE',kind,sql_identity,g.name);
        END IF;
    END LOOP;
    RESET ROLE;
    remaining := wanted;
    -- A grantor may depend on another ACL grant's grant option. Replay that
    -- chain in dependency order, refusing rather than losing any grantor.
    WHILE jsonb_array_length(remaining)>0 LOOP
        changed := false; next_remaining := '[]'::jsonb;
        FOR item IN SELECT value FROM jsonb_array_elements(remaining) LOOP
            -- PL/pgSQL ends an IF condition at its first THEN, so the CASE needs parentheses.
            IF (CASE WHEN kind='DATABASE'
               THEN has_database_privilege(item->>'grantor',identity,(item->>'privilege')||' WITH GRANT OPTION')
               ELSE has_function_privilege(item->>'grantor',identity,'EXECUTE WITH GRANT OPTION') END) THEN
                EXECUTE format('SET LOCAL ROLE %I',item->>'grantor');
                EXECUTE format('GRANT %s ON %s %s TO %s%s',item->>'privilege',kind,sql_identity,
                    CASE WHEN item->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(item->>'grantee') END,
                    CASE WHEN (item->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END);
                RESET ROLE;
                changed := true;
            ELSE
                next_remaining := next_remaining || jsonb_build_array(item);
            END IF;
        END LOOP;
        IF NOT changed THEN RAISE EXCEPTION 'cannot reproduce ACL grantors on % %',kind,identity; END IF;
        remaining := next_remaining;
    END LOOP;
END $$;
