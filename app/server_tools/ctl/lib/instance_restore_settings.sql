-- instance_restore_settings.sql
-- Reproduce and verify owner, effective ACL and database/role GUCs while closed.
-- Caller supplies the shared snapshot function and ACL helper in this transaction.
-- Packets use their authenticated backup-time snapshot; instance restores use live state.
-- Packet callers supply this table through stdin, keeping GUC values out of argv.
CREATE TEMP TABLE IF NOT EXISTS restore_database_source AS SELECT pg_temp.database_snapshot(:'target') AS info;
CREATE TEMP TABLE restore_database_names AS SELECT :'replacement'::text AS replacement;
DO $$
DECLARE wanted jsonb; actual jsonb; names record; setting jsonb; entry text; parameter text; value text;
BEGIN
 SELECT info INTO STRICT wanted FROM restore_database_source;
 SELECT * INTO names FROM restore_database_names;
 IF wanted IS NULL THEN RAISE EXCEPTION 'missing original database settings'; END IF;
 EXECUTE format('ALTER DATABASE %I OWNER TO %I',names.replacement,wanted->>'owner');
 PERFORM pg_temp.restore_acl('DATABASE',names.replacement,wanted->'acl',wanted->>'owner');
 FOR setting IN SELECT item.info FROM jsonb_array_elements(pg_temp.database_snapshot(names.replacement)->'settings') AS item(info) LOOP
   IF setting->>'role' IS NULL THEN EXECUTE format('ALTER DATABASE %I RESET ALL',names.replacement);
   ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL',setting->>'role',names.replacement); END IF;
 END LOOP;
 FOR setting IN SELECT item.info FROM jsonb_array_elements(wanted->'settings') AS item(info) LOOP
   FOR entry IN SELECT jsonb_array_elements_text(setting->'values') LOOP
     parameter := split_part(entry,'=',1); value := substr(entry,length(parameter)+2);
     -- FROM CURRENT keeps list-valued GUCs, including search_path, byte-for-byte.
     PERFORM set_config(parameter,value,true);
     IF setting->>'role' IS NULL THEN EXECUTE format('ALTER DATABASE %I SET %I FROM CURRENT',names.replacement,parameter);
     ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I SET %I FROM CURRENT',setting->>'role',names.replacement,parameter); END IF;
   END LOOP;
 END LOOP;
 EXECUTE format('ALTER DATABASE %I ALLOW_CONNECTIONS %s',names.replacement,wanted->'properties'->>'datallowconn');
 actual := pg_temp.database_snapshot(names.replacement);
 -- The swap opens ordinary connections with the saved limit, atomically with renaming.
 IF actual IS DISTINCT FROM jsonb_set(wanted,'{properties,datconnlimit}','0'::jsonb)
 THEN RAISE EXCEPTION 'database settings verification differs'; END IF;
END $$;
