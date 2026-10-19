-- 20261015000010_add_article_bundle_storage.sql
-- Stores three explicit article projections in one ordered, target-owned collection.
-- Connects assignment foreign keys, dataset policy and generic writers to one contract.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: article_bundle_storage

ALTER TABLE public.system_column_field_sets ADD COLUMN IF NOT EXISTS article_family boolean NOT NULL DEFAULT false;
ALTER TABLE public.system_column_field_set_members ADD COLUMN IF NOT EXISTS presentation_values jsonb;

-- A copied audience must retain its complete nullable target scope. The legacy
-- index ignored schema and could silently discard a different authored scope.
DROP INDEX IF EXISTS public.uq_group_func_rights_group_func_table;
CREATE UNIQUE INDEX uq_group_func_rights_group_func_table ON public.system_group_table_func_rights
 (user_group_id,function_id,target_schema_name,target_table_uid) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.app_article_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['article_view','image_first_view','image_first_page_view']::text[] $$;

CREATE OR REPLACE FUNCTION public.app_article_values(visible boolean, width integer DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_object_agg(key,jsonb_build_object('visible',visible,'width_px',width)) FROM unnest(public.app_article_keys()) key
$$;

CREATE OR REPLACE FUNCTION public.app_valid_article_values(raw jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE key text; cell jsonb;
BEGIN
 IF raw IS NULL OR jsonb_typeof(raw)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(raw))<>3 THEN RETURN false; END IF;
 FOREACH key IN ARRAY public.app_article_keys() LOOP
  cell:=raw->key;
  IF cell IS NULL OR jsonb_typeof(cell)<>'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(cell))<>2
     OR jsonb_typeof(cell->'visible') IS DISTINCT FROM 'boolean'
     OR NOT cell ? 'width_px' THEN RETURN false; END IF;
  IF cell->'width_px'<>'null'::jsonb THEN
   IF jsonb_typeof(cell->'width_px')<>'number' OR (cell->>'width_px') !~ '^[0-9]+$' THEN RETURN false; END IF;
   IF (cell->>'width_px')::numeric>2147483647 THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.app_article_opener_defaults() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT '{"card-body":"article_view","card-title":"article_view","card-summary":"article_view","show-more":"article_view","calendar-event":"article_view","product-body":"article_view","product-image":"article_view","free-layout-body":"article_view","free-layout-image":"article_view","search-result":"article_view","home-button":"article_view","field-link":"article_view","card-image":"image_first_view","article-image":"image_first_view","gallery-thumbnail":"image_first_view"}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.app_valid_article_opener_policy(raw jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF raw IS NULL OR jsonb_typeof(raw)<>'object' THEN RETURN false; END IF;
 RETURN (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(raw) key)
       IS NOT DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(public.app_article_opener_defaults()) key)
   AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(raw) WHERE value IS NULL OR NOT value=ANY(public.app_article_keys()));
END $$;

CREATE OR REPLACE FUNCTION public.app_article_section_defaults() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT '{"article_view":{"details":true,"images":true,"attachments":true,"related_rows":true,"task_progress":true},"image_first_view":{"details":true},"image_first_page_view":{"details":true}}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.app_valid_article_sections(raw jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key text; expected jsonb; cell jsonb;
BEGIN
 IF raw IS NULL OR jsonb_typeof(raw)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(raw))<>3 THEN RETURN false; END IF;
 FOR key,expected IN SELECT * FROM jsonb_each(public.app_article_section_defaults()) LOOP
  cell:=raw->key;
  IF cell IS NULL OR jsonb_typeof(cell)<>'object' THEN RETURN false; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(cell) k)
     IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(expected) k)
     OR EXISTS(SELECT 1 FROM jsonb_each(cell) WHERE jsonb_typeof(value)<>'boolean') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

ALTER TABLE public.system_db_tables ADD COLUMN IF NOT EXISTS article_opener_policy jsonb NOT NULL DEFAULT public.app_article_opener_defaults();
ALTER TABLE public.system_db_tables ALTER COLUMN article_section_initial_open SET DEFAULT public.app_article_section_defaults();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.system_column_field_set_members'::regclass AND conname='ck_article_member_values') THEN
  ALTER TABLE public.system_column_field_set_members ADD CONSTRAINT ck_article_member_values
    CHECK(presentation_values IS NULL OR public.app_valid_article_values(presentation_values));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.system_db_tables'::regclass AND conname='ck_article_opener_policy') THEN
  ALTER TABLE public.system_db_tables ADD CONSTRAINT ck_article_opener_policy CHECK(public.app_valid_article_opener_policy(article_opener_policy));
 END IF;
END $$;

-- One target owns a bundle. Deferred checks permit atomic three-link writes,
-- but reject partial links, cross-target reuse, family changes and generic bypasses.
CREATE OR REPLACE FUNCTION public.app_check_article_bundles() RETURNS SETOF text
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT 'article target links disagree or are incomplete' WHERE EXISTS(
  SELECT a.table_uid,a.user_id,a.group_id FROM public.system_view_field_set_assignments a
  JOIN public.system_table_views v ON v.id=a.view_id
  JOIN public.system_column_field_sets s ON s.id=a.field_set_id
  WHERE v.view_key=ANY(public.app_article_keys()) OR s.article_family
  GROUP BY a.table_uid,a.user_id,a.group_id
  HAVING count(*)<>3 OR count(DISTINCT a.field_set_id)<>1 OR count(DISTINCT a.group_priority)<>1
   OR bool_or(NOT s.article_family OR NOT v.view_key=ANY(public.app_article_keys()))
   OR bool_or(s.owner_user_id IS NOT NULL AND s.owner_user_id IS DISTINCT FROM a.user_id))
 UNION ALL SELECT 'article bundle reused by another target or presentation' WHERE EXISTS(
  SELECT s.id FROM public.system_column_field_sets s JOIN public.system_view_field_set_assignments a ON a.field_set_id=s.id
  WHERE s.article_family GROUP BY s.id HAVING count(*)<>3)
 UNION ALL SELECT 'article member has invalid values, legacy width or forbidden field' WHERE EXISTS(
  SELECT 1 FROM public.system_column_field_set_members m JOIN public.system_column_field_sets s ON s.id=m.field_set_id
  JOIN public.system_column_details c ON c.column_uid=m.column_uid
  WHERE (s.article_family AND (NOT public.app_valid_article_values(m.presentation_values) OR m.column_width_px IS NOT NULL
    OR ((COALESCE(c.hide_everywhere,false) OR COALESCE(c.client_delivery_mode,'include')<>'include')
      AND EXISTS(SELECT 1 FROM jsonb_each(m.presentation_values) p WHERE p.value->'visible'='true'))))
   OR (NOT s.article_family AND m.presentation_values IS NOT NULL))
 UNION ALL SELECT 'dataset lacks explicit article site bundle or canonical sections' WHERE EXISTS(
  SELECT 1 FROM public.system_db_tables d WHERE NOT public.app_valid_article_sections(d.article_section_initial_open)
   OR NOT EXISTS(SELECT 1 FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
     WHERE a.table_uid=d.table_uid AND a.user_id IS NULL AND a.group_id IS NULL AND v.view_key='article_view'));
$$;

CREATE OR REPLACE FUNCTION public.app_enforce_article_bundles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE findings text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_materialization' AND action='completed') THEN
  SELECT string_agg(f,'; ') INTO findings FROM public.app_check_article_bundles() f;
  IF findings IS NOT NULL THEN RAISE EXCEPTION 'article bundle invariant: %',findings; END IF;
 END IF;
 RETURN NULL;
END $$;

-- Serialize writes on the registry row. Function-local mutation scope permits
-- only the shared service, lifecycle cascades and initial materialization to
-- write article storage; it is restored when a service call returns or fails.
-- Limited preference writers need no UPDATE grant on the registry or SELECT
-- grant on private repair records. Definer functions expose locks/checks only.
CREATE OR REPLACE FUNCTION public.app_lock_article_dataset_uid(dataset_uid integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.system_db_tables WHERE table_uid=dataset_uid FOR UPDATE;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.app_lock_article_dataset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb; proposed jsonb; protected boolean:=false;
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM public.app_lock_article_dataset_uid(OLD.table_uid); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM public.app_lock_article_dataset_uid(NEW.table_uid); END IF;
 IF TG_OP<>'INSERT' THEN prior:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN proposed:=to_jsonb(NEW); END IF;
 CASE TG_TABLE_NAME
  WHEN 'system_db_tables' THEN
   protected:=true;
   IF TG_OP='INSERT' AND NEW.article_opener_policy=public.app_article_opener_defaults() THEN protected:=false; END IF;
  WHEN 'system_column_field_sets' THEN
   protected:=COALESCE((prior->>'article_family')::boolean,false) OR COALESCE((proposed->>'article_family')::boolean,false);
  WHEN 'system_column_field_set_members' THEN
   protected:=EXISTS(SELECT 1 FROM public.system_column_field_sets WHERE article_family
    AND id IN ((prior->>'field_set_id')::bigint,(proposed->>'field_set_id')::bigint));
  WHEN 'system_view_field_set_assignments' THEN
   protected:=EXISTS(SELECT 1 FROM public.system_table_views WHERE view_key=ANY(public.app_article_keys())
    AND id IN ((prior->>'view_id')::integer,(proposed->>'view_id')::integer))
    OR EXISTS(SELECT 1 FROM public.system_column_field_sets WHERE article_family
     AND id IN ((prior->>'field_set_id')::bigint,(proposed->>'field_set_id')::bigint));
  ELSE NULL;
 END CASE;
 IF protected AND pg_trigger_depth()=1
  AND current_setting('filterest.article_bundle_mutation',true) IS DISTINCT FROM 'on'
  AND EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_materialization' AND action='completed') THEN
  RAISE EXCEPTION 'article storage requires the shared mutation service';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.app_enforce_article_bundles(),public.app_lock_article_dataset() FROM PUBLIC;

DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['system_column_field_sets','system_column_field_set_members','system_view_field_set_assignments','system_column_details'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS article_dataset_lock ON public.%I',relation);
  EXECUTE format('CREATE TRIGGER article_dataset_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.app_lock_article_dataset()',relation);
 END LOOP;
 DROP TRIGGER IF EXISTS article_opener_mutation ON public.system_db_tables;
 CREATE TRIGGER article_opener_mutation BEFORE INSERT OR UPDATE OF article_opener_policy ON public.system_db_tables
  FOR EACH ROW EXECUTE FUNCTION public.app_lock_article_dataset();
 FOREACH relation IN ARRAY ARRAY['system_column_field_sets','system_column_field_set_members','system_view_field_set_assignments','system_db_tables','system_column_details','system_table_views'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS article_bundle_invariant ON public.%I',relation);
  EXECUTE format('CREATE CONSTRAINT TRIGGER article_bundle_invariant AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.app_enforce_article_bundles()',relation);
 END LOOP;
END $$;

COMMENT ON COLUMN public.system_column_field_sets.article_family IS 'Target-owned article bundle; exactly three sibling presentation assignments share its ordered members.';
COMMENT ON COLUMN public.system_column_field_set_members.presentation_values IS 'Explicit visible/width_px for all three article presentations. JSON null width is automatic; there is no inheritance.';
COMMENT ON COLUMN public.system_db_tables.article_opener_policy IS 'Dataset UID owns the complete registered opener-role map. Read by future activation batches.';

INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'article_bundle_storage','completed','{"contract":"K376 materialize"}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_storage' AND action='completed');
