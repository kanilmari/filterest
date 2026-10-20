-- 20261015000017_add_article_presentations_editor.sql
-- Applies a complete ordered article-family target through the shared projection service.
-- Connects the administrator atomic editor to target-owned bundles and explicit widths.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: article_presentations_editor
CREATE OR REPLACE FUNCTION public.app_save_article_presentations(
 dataset_uid integer, principal_user bigint, principal_group bigint, priority integer,
 members jsonb, label text, author bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,public SET filterest.article_bundle_mutation='on' AS $$
DECLARE presentation text; selected integer[]; bundle bigint; item record;
        baseline_bundle bigint; baseline_columns integer[];
BEGIN
 IF NOT public.app_lock_article_dataset_uid(dataset_uid) THEN RAISE EXCEPTION 'unknown article dataset'; END IF;
 -- Match the snapshot reader: an unassigned target starts from the site bundle.
 SELECT a.field_set_id INTO baseline_bundle FROM public.system_view_field_set_assignments a
  JOIN public.system_table_views v ON v.id=a.view_id WHERE a.table_uid=dataset_uid AND v.view_key='article_view'
   AND a.user_id IS NOT DISTINCT FROM principal_user AND a.group_id IS NOT DISTINCT FROM principal_group;
 IF baseline_bundle IS NULL THEN
  SELECT a.field_set_id INTO baseline_bundle FROM public.system_view_field_set_assignments a
   JOIN public.system_table_views v ON v.id=a.view_id WHERE a.table_uid=dataset_uid AND v.view_key='article_view'
    AND a.user_id IS NULL AND a.group_id IS NULL;
 END IF;
 SELECT COALESCE(array_agg(column_uid ORDER BY sort_order),'{}'::integer[]) INTO baseline_columns
  FROM public.system_column_field_set_members WHERE field_set_id=baseline_bundle;
 -- Legacy bundles can be smaller than the catalogue. Every actual member is
 -- required, including hidden/restricted fields retained by lifecycle triggers.
 IF jsonb_typeof(members) IS DISTINCT FROM 'array' OR length(label)=0 OR length(label)>128
  OR baseline_bundle IS NULL OR jsonb_array_length(members)<>cardinality(baseline_columns)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(members) m WHERE NOT public.app_valid_article_values(m->'values')
    OR NOT EXISTS(SELECT 1 FROM public.system_column_field_set_members existing
      WHERE existing.field_set_id=baseline_bundle AND existing.column_uid=(m->>'column_uid')::integer))
  OR (SELECT count(DISTINCT (m->>'column_uid')::integer) FROM jsonb_array_elements(members) m)<>jsonb_array_length(members)
 THEN RAISE EXCEPTION 'complete article members required'; END IF;
 FOREACH presentation IN ARRAY public.app_article_keys() LOOP
  SELECT COALESCE(array_agg((m->>'column_uid')::integer ORDER BY position),'{}') INTO selected
   FROM jsonb_array_elements(members) WITH ORDINALITY items(m,position) WHERE (m->'values'->presentation->>'visible')::boolean;
  bundle:=public.app_save_article_projection(dataset_uid,presentation,principal_user,principal_group,priority,selected,NULL,author);
 END LOOP;
 -- The compatibility service initializes new targets from the full catalogue.
 -- Keep the exact inherited bundle membership used by this complete request.
 DELETE FROM public.system_column_field_set_members WHERE field_set_id=bundle AND NOT column_uid=ANY(baseline_columns);
 -- The existing service owns validation, target creation and all assignment links.
 -- Apply complete order/widths after its compatibility visible-first ordering.
 UPDATE public.system_column_field_set_members SET sort_order=sort_order+(SELECT COALESCE(max(sort_order),0) FROM public.system_column_field_set_members WHERE field_set_id=bundle)+jsonb_array_length(members) WHERE field_set_id=bundle;
 FOR item IN SELECT m,position FROM jsonb_array_elements(members) WITH ORDINALITY items(m,position) LOOP
  UPDATE public.system_column_field_set_members SET sort_order=item.position,presentation_values=item.m->'values'
   WHERE field_set_id=bundle AND column_uid=(item.m->>'column_uid')::integer;
 END LOOP;
 UPDATE public.system_column_field_sets SET name=label,updated=now() WHERE id=bundle;
 RETURN bundle;
END $$;
INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'article_presentations_editor','completed','{"contract":"K383 atomic editor"}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_presentations_editor' AND action='completed');
