-- Shared database-level snapshot, using names rather than cluster-specific OIDs.
-- Used by both retained-instance recovery and authenticated packet recovery.
CREATE FUNCTION pg_temp.database_snapshot(database_name text) RETURNS jsonb
LANGUAGE sql AS $$
SELECT jsonb_build_object(
 'properties',to_jsonb(d)-ARRAY['oid','datname','datdba','dattablespace','datacl','datfrozenxid','datminmxid'],
 'owner',pg_get_userbyid(d.datdba),'tablespace',t.spcname,
 'acl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(r.rolname,'PUBLIC'),
     'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY g.rolname,r.rolname,a.privilege_type),'[]'::jsonb)
     FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
     JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee),
 'settings',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',CASE WHEN s.setrole=0 THEN NULL ELSE pg_get_userbyid(s.setrole) END,
     'values',ARRAY(SELECT v FROM unnest(s.setconfig) v ORDER BY v)) ORDER BY CASE WHEN s.setrole=0 THEN '' ELSE pg_get_userbyid(s.setrole) END),'[]'::jsonb)
     FROM pg_db_role_setting s WHERE s.setdatabase=d.oid))
FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=database_name
$$;
