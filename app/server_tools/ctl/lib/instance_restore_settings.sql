-- instance_restore_settings.sql
-- Reproduces the original database owner, connection ACL/limit and role settings.
-- Runs on a maintenance database while both originals and replacement exist.
-- Creation properties and every copied value must compare equal before swap.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'replacement',r.rolname)
 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=:'target';
\gexec
SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s', :'replacement',datconnlimit)
 FROM pg_database WHERE datname=:'target';
\gexec
CREATE TEMP TABLE restore_database_names AS SELECT :'target'::text AS target, :'replacement'::text AS replacement;
DO $$
DECLARE source pg_database%ROWTYPE; dest pg_database%ROWTYPE; names record;
        wanted jsonb; actual jsonb; setting record; entry text; parameter text; value text;
        old_settings jsonb; new_settings jsonb;
BEGIN
    SELECT * INTO names FROM restore_database_names;
    SELECT * INTO STRICT source FROM pg_database WHERE datname=names.target;
    SELECT * INTO STRICT dest FROM pg_database WHERE datname=names.replacement;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(r.rolname,'PUBLIC'),
               'privilege',a.privilege_type,'grantable',a.is_grantable)
               ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
      INTO wanted FROM aclexplode(COALESCE(source.datacl,acldefault('d',source.datdba))) a
      JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee;
    PERFORM pg_temp.restore_acl('DATABASE',quote_ident(names.replacement),wanted,pg_get_userbyid(source.datdba));
    FOR setting IN SELECT setrole FROM pg_db_role_setting WHERE setdatabase=dest.oid LOOP
        IF setting.setrole=0 THEN EXECUTE format('ALTER DATABASE %I RESET ALL',names.replacement);
        ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL',pg_get_userbyid(setting.setrole),names.replacement); END IF;
    END LOOP;
    FOR setting IN SELECT setrole,setconfig FROM pg_db_role_setting WHERE setdatabase=source.oid LOOP
        FOREACH entry IN ARRAY setting.setconfig LOOP
            parameter := split_part(entry,'=',1); value := substr(entry,length(parameter)+2);
            -- FROM CURRENT preserves list-valued GUCs such as search_path exactly;
            -- quoting a comma-separated path as a single SQL value changes it.
            PERFORM set_config(parameter,value,true);
            IF setting.setrole=0 THEN EXECUTE format('ALTER DATABASE %I SET %I FROM CURRENT',names.replacement,parameter);
            ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I SET %I FROM CURRENT',pg_get_userbyid(setting.setrole),names.replacement,parameter); END IF;
        END LOOP;
    END LOOP;
    SELECT * INTO STRICT dest FROM pg_database WHERE datname=names.replacement;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(r.rolname,'PUBLIC'),
               'privilege',a.privilege_type,'grantable',a.is_grantable)
               ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
      INTO actual FROM aclexplode(COALESCE(dest.datacl,acldefault('d',dest.datdba))) a
      JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(setrole,ARRAY(SELECT v FROM unnest(setconfig) v ORDER BY v)) ORDER BY setrole),'[]')
      INTO old_settings FROM pg_db_role_setting WHERE setdatabase=source.oid;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(setrole,ARRAY(SELECT v FROM unnest(setconfig) v ORDER BY v)) ORDER BY setrole),'[]')
      INTO new_settings FROM pg_db_role_setting WHERE setdatabase=dest.oid;
    IF (to_jsonb(source)-ARRAY['oid','datname','datfrozenxid','datminmxid','datacl'])
       IS DISTINCT FROM (to_jsonb(dest)-ARRAY['oid','datname','datfrozenxid','datminmxid','datacl'])
       OR actual<>wanted OR old_settings<>new_settings THEN
        RAISE EXCEPTION 'database settings verification differs';
    END IF;
END $$;
