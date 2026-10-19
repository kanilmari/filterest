-- 20261015000011_add_article_bundle_mutations.sql
-- Shares target-preserving projection mutations and dataset/field lifecycle defaults.
-- Connects legacy settings endpoints and generic metadata writers to bundle storage.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: article_bundle_mutations

-- A legacy authored name must never make cloning overwrite or reject unrelated
-- collections. Dataset locks make suffix allocation deterministic and race-free.
CREATE OR REPLACE FUNCTION public.app_article_bundle_name(dataset_uid integer,principal_user bigint,base_label text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE candidate_name text:=left(base_label,110); suffix integer:=0;
BEGIN
 WHILE EXISTS(SELECT 1 FROM public.system_column_field_sets WHERE table_uid=dataset_uid
  AND owner_user_id IS NOT DISTINCT FROM principal_user AND name=candidate_name) LOOP
  suffix:=suffix+1;
  candidate_name:=left(base_label,110)||' ('||suffix||')';
 END LOOP;
 RETURN candidate_name;
END $$;

-- The caller owns the transaction and authorization. Dataset locks cover the
-- complete operation; its function-local scope never authorizes later generic writes.
CREATE OR REPLACE FUNCTION public.app_save_article_projection(
 dataset_uid integer, presentation text, principal_user bigint, principal_group bigint,
 priority integer, selected_columns integer[], label text, author bigint,
 source_collection bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
DECLARE bundle bigint; prior bigint; item record; ordered integer[]; raw jsonb; width integer; collection_name text;
BEGIN
 IF NOT presentation=ANY(public.app_article_keys()) OR principal_user=1
    OR (principal_user IS NOT NULL AND principal_group IS NOT NULL)
    OR priority NOT BETWEEN -1000000 AND 1000000 THEN RAISE EXCEPTION 'invalid article target'; END IF;
 IF NOT public.app_lock_article_dataset_uid(dataset_uid) THEN RAISE EXCEPTION 'unknown article dataset'; END IF;
 IF source_collection IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.system_column_field_sets WHERE id=source_collection AND table_uid=dataset_uid
    AND (owner_user_id IS NULL OR owner_user_id=principal_user)) THEN RAISE EXCEPTION 'unavailable article source'; END IF;
  SELECT COALESCE(array_agg(m.column_uid ORDER BY m.sort_order),'{}'::integer[]) INTO selected_columns
   FROM public.system_column_field_set_members m JOIN public.system_column_field_sets s ON s.id=m.field_set_id
   WHERE m.field_set_id=source_collection AND (NOT s.article_family OR (m.presentation_values->presentation->>'visible')::boolean);
 END IF;
 selected_columns:=COALESCE(selected_columns,'{}'::integer[]);
 IF cardinality(selected_columns)<>(SELECT count(DISTINCT uid) FROM unnest(selected_columns) uid)
   OR EXISTS(SELECT 1 FROM unnest(selected_columns) uid WHERE NOT EXISTS(
    SELECT 1 FROM public.system_column_details WHERE table_uid=dataset_uid AND column_uid=uid
      AND NOT COALESCE(hide_everywhere,false) AND COALESCE(client_delivery_mode,'include')='include'))
 THEN RAISE EXCEPTION 'forbidden or duplicate article field'; END IF;
 SELECT a.field_set_id INTO prior FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
  WHERE a.table_uid=dataset_uid AND a.user_id IS NOT DISTINCT FROM principal_user
   AND a.group_id IS NOT DISTINCT FROM principal_group AND v.view_key='article_view';
 -- NULL labels edit the current target (editor or restore).
 -- Named saves select their own collection; a new name snapshots the current
 -- siblings rather than overwriting the previous saved choice.
 IF source_collection IS NOT NULL THEN
  -- Selecting a saved choice must not rewrite the previously active named one.
  -- Clone the active siblings, then copy only the selected source projection.
  bundle:=CASE WHEN source_collection=prior THEN prior ELSE NULL END;
 ELSIF label IS NULL THEN
  bundle:=prior;
 ELSE
  collection_name:=CASE WHEN principal_group IS NULL THEN label
   ELSE left(label,70)||' [g'||principal_group||':'||left(md5(label),16)||']' END;
  -- A legacy/listing collection or another target may already own this label.
  -- A deterministic Article name preserves both it and same-name save replay.
  IF EXISTS(SELECT 1 FROM public.system_column_field_sets s WHERE s.table_uid=dataset_uid
   AND s.owner_user_id IS NOT DISTINCT FROM principal_user AND s.name=collection_name
   AND (NOT s.article_family OR EXISTS(SELECT 1 FROM public.system_view_field_set_assignments a
    WHERE a.field_set_id=s.id AND (a.user_id IS DISTINCT FROM principal_user OR a.group_id IS DISTINCT FROM principal_group)))) THEN
   collection_name:=left(label,60)||' [article '||COALESCE('u'||principal_user,'g'||principal_group,'site')||':'||left(md5(label),16)||']';
  END IF;
  SELECT s.id INTO bundle FROM public.system_column_field_sets s
   WHERE s.table_uid=dataset_uid AND s.owner_user_id IS NOT DISTINCT FROM principal_user
    AND s.name=collection_name AND s.article_family
    AND NOT EXISTS(SELECT 1 FROM public.system_view_field_set_assignments a WHERE a.field_set_id=s.id
     AND (a.user_id IS DISTINCT FROM principal_user OR a.group_id IS DISTINCT FROM principal_group));
 END IF;
 IF bundle IS NULL THEN
  INSERT INTO public.system_column_field_sets(table_uid,owner_user_id,name,article_family,created_by)
   VALUES(dataset_uid,principal_user,COALESCE(collection_name,public.app_article_bundle_name(dataset_uid,principal_user,'Article selection')),true,author)
   RETURNING id INTO bundle;
  INSERT INTO public.system_column_field_set_members(field_set_id,table_uid,column_uid,sort_order,presentation_values)
   SELECT bundle,dataset_uid,c.column_uid,
    row_number() OVER(ORDER BY m.sort_order NULLS LAST,c.co_number NULLS LAST,c.column_uid),
    COALESCE(m.presentation_values,public.app_article_values(false))
   FROM public.system_column_details c LEFT JOIN public.system_column_field_set_members m ON m.field_set_id=prior AND m.column_uid=c.column_uid
   WHERE c.table_uid=dataset_uid;
 END IF;
 SELECT selected_columns||COALESCE(array_agg(column_uid ORDER BY sort_order) FILTER(WHERE NOT column_uid=ANY(selected_columns)),'{}'::integer[])
  INTO ordered FROM public.system_column_field_set_members WHERE field_set_id=bundle;
 -- Move orders out of the positive destination range before assigning them.
 UPDATE public.system_column_field_set_members SET sort_order=sort_order+(SELECT COALESCE(max(sort_order),0) FROM public.system_column_field_set_members WHERE field_set_id=bundle)+cardinality(ordered)
  WHERE field_set_id=bundle;
 FOR item IN SELECT uid,position FROM unnest(ordered) WITH ORDINALITY c(uid,position) LOOP
  SELECT presentation_values INTO raw FROM public.system_column_field_set_members WHERE field_set_id=bundle AND column_uid=item.uid;
  raw:=COALESCE(raw,public.app_article_values(false));
  width:=(raw->presentation->>'width_px')::integer;
  IF source_collection IS NOT NULL THEN
   SELECT CASE WHEN s.article_family THEN (m.presentation_values->presentation->>'width_px')::integer ELSE m.column_width_px END INTO width
    FROM public.system_column_field_set_members m JOIN public.system_column_field_sets s ON s.id=m.field_set_id
    WHERE m.field_set_id=source_collection AND m.column_uid=item.uid;
  END IF;
  raw:=jsonb_set(raw,ARRAY[presentation],jsonb_build_object('visible',item.uid=ANY(selected_columns),'width_px',width));
  INSERT INTO public.system_column_field_set_members(field_set_id,table_uid,column_uid,sort_order,presentation_values)
   VALUES(bundle,dataset_uid,item.uid,item.position,raw)
   ON CONFLICT(field_set_id,column_uid) DO UPDATE SET sort_order=EXCLUDED.sort_order,presentation_values=EXCLUDED.presentation_values;
 END LOOP;
 INSERT INTO public.system_view_field_set_assignments(user_id,group_id,table_uid,view_id,field_set_id,group_priority,created_by)
  SELECT principal_user,principal_group,dataset_uid,id,bundle,priority,author FROM public.system_table_views WHERE view_key=ANY(public.app_article_keys())
  ON CONFLICT(user_id,group_id,table_uid,view_id) DO UPDATE SET field_set_id=EXCLUDED.field_set_id,group_priority=EXCLUDED.group_priority,updated=now();
 RETURN bundle;
END $$;

CREATE OR REPLACE FUNCTION public.app_initialize_article_dataset(dataset_uid integer) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
DECLARE bundle bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
  WHERE a.table_uid=dataset_uid AND a.user_id IS NULL AND a.group_id IS NULL AND v.view_key='article_view') THEN
  INSERT INTO public.system_column_field_sets(table_uid,name,article_family) VALUES(dataset_uid,public.app_article_bundle_name(dataset_uid,NULL,'Article site bundle'),true) RETURNING id INTO bundle;
  INSERT INTO public.system_column_field_set_members(field_set_id,table_uid,column_uid,sort_order,presentation_values)
   SELECT bundle,dataset_uid,column_uid,row_number() OVER(ORDER BY co_number NULLS LAST,column_uid),
    public.app_article_values(NOT COALESCE(hide_everywhere,false) AND COALESCE(client_delivery_mode,'include')='include')
   FROM public.system_column_details WHERE table_uid=dataset_uid;
  INSERT INTO public.system_view_field_set_assignments(table_uid,view_id,field_set_id)
   SELECT dataset_uid,id,bundle FROM public.system_table_views WHERE view_key=ANY(public.app_article_keys());
 END IF;
END $$;

-- These invoker entry points retain the caller's table privileges and the HTTP
-- layer's authorization. Scope is confined to the call, including on rollback.
CREATE OR REPLACE FUNCTION public.app_reset_article_target(dataset_uid integer,principal_user bigint,principal_group bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
BEGIN
 IF principal_user IS NULL AND principal_group IS NULL THEN RAISE EXCEPTION 'article site bundle requires explicit defaults'; END IF;
 IF NOT public.app_lock_article_dataset_uid(dataset_uid) THEN RAISE EXCEPTION 'unknown article dataset'; END IF;
 DELETE FROM public.system_view_field_set_assignments a USING public.system_table_views v
  WHERE a.view_id=v.id AND a.table_uid=dataset_uid AND a.user_id IS NOT DISTINCT FROM principal_user
   AND a.group_id IS NOT DISTINCT FROM principal_group AND v.view_key=ANY(public.app_article_keys());
END $$;

CREATE OR REPLACE FUNCTION public.app_delete_article_collection(collection_id bigint,principal_user bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
DECLARE dataset_uid integer; deleted bigint;
BEGIN
 SELECT table_uid INTO dataset_uid FROM public.system_column_field_sets WHERE id=collection_id AND owner_user_id IS NOT DISTINCT FROM principal_user;
 IF dataset_uid IS NULL THEN RETURN 0; END IF;
 PERFORM public.app_lock_article_dataset_uid(dataset_uid);
 DELETE FROM public.system_column_field_sets WHERE id=collection_id AND owner_user_id IS NOT DISTINCT FROM principal_user;
 GET DIAGNOSTICS deleted=ROW_COUNT;
 RETURN deleted;
END $$;

CREATE OR REPLACE FUNCTION public.app_save_article_opener_policy(dataset_uid integer,policy jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
BEGIN
 IF NOT public.app_valid_article_opener_policy(policy) THEN RAISE EXCEPTION 'invalid article opener policy'; END IF;
 IF NOT public.app_lock_article_dataset_uid(dataset_uid) THEN RAISE EXCEPTION 'unknown article dataset'; END IF;
 UPDATE public.system_db_tables SET article_opener_policy=policy WHERE table_uid=dataset_uid;
END $$;

CREATE OR REPLACE FUNCTION public.app_article_dataset_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_materialization' AND action='completed') THEN
  PERFORM public.app_initialize_article_dataset(NEW.table_uid);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS article_dataset_created ON public.system_db_tables;
CREATE TRIGGER article_dataset_created AFTER INSERT ON public.system_db_tables FOR EACH ROW EXECUTE FUNCTION public.app_article_dataset_created();

-- New fields are explicit members of every bundle. Site defaults show deliverable
-- fields; existing personal/group selections start with the new field unchecked.
-- The existing member FK removes deleted fields in the same transaction.
CREATE OR REPLACE FUNCTION public.app_article_field_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.system_column_field_set_members(field_set_id,table_uid,column_uid,sort_order,presentation_values)
  SELECT s.id,NEW.table_uid,NEW.column_uid,COALESCE((SELECT max(sort_order) FROM public.system_column_field_set_members WHERE field_set_id=s.id),0)+1,
   public.app_article_values(NOT COALESCE(NEW.hide_everywhere,false) AND COALESCE(NEW.client_delivery_mode,'include')='include'
    AND EXISTS(SELECT 1 FROM public.system_view_field_set_assignments WHERE field_set_id=s.id AND user_id IS NULL AND group_id IS NULL))
  FROM public.system_column_field_sets s WHERE s.table_uid=NEW.table_uid AND s.article_family;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS article_field_created ON public.system_column_details;
CREATE TRIGGER article_field_created AFTER INSERT ON public.system_column_details FOR EACH ROW EXECUTE FUNCTION public.app_article_field_created();

-- A delivery restriction clears visibility without deleting stored order/widths.
CREATE OR REPLACE FUNCTION public.app_article_field_restricted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF COALESCE(NEW.hide_everywhere,false) OR COALESCE(NEW.client_delivery_mode,'include')<>'include' THEN
  UPDATE public.system_column_field_set_members m SET presentation_values=(SELECT jsonb_object_agg(key,jsonb_set(value,'{visible}','false')) FROM jsonb_each(m.presentation_values))
   FROM public.system_column_field_sets s WHERE s.id=m.field_set_id AND s.article_family AND m.column_uid=NEW.column_uid;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS article_field_restricted ON public.system_column_details;
CREATE TRIGGER article_field_restricted AFTER UPDATE OF hide_everywhere,client_delivery_mode ON public.system_column_details
 FOR EACH ROW EXECUTE FUNCTION public.app_article_field_restricted();

REVOKE ALL ON FUNCTION public.app_article_dataset_created(),public.app_article_field_created(),public.app_article_field_restricted() FROM PUBLIC;

INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'article_bundle_mutations','completed','{"contract":"K376 lifecycle"}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_mutations' AND action='completed');
