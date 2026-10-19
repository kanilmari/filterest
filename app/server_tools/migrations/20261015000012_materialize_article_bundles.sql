-- 20261015000012_materialize_article_bundles.sql
-- Materializes legacy Article settings once, retaining authored IFAV values and audiences.
-- Connects upgrades and post-seed bootstrap through the same locked atomic data step.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: article_bundle_materialization
-- FINAL_CHECK: public.app_check_article_bundles()

-- The migration runner executes this whole file in one transaction. Do not split
-- registration, assertions and marker into independently committed operations.
DO $materialize$
DECLARE target record; dataset record; item record; source record; bundle bigint; chosen integer;
        position integer; findings text; blocks jsonb; canonical jsonb; projection_key text; section text;
        raw jsonb; cell jsonb; prior_cell jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('article_bundle_materialization',0));
 LOCK TABLE public.system_db_tables,public.system_view_field_set_assignments,
  public.system_column_field_sets,public.system_column_field_set_members,public.system_column_details,
  public.system_table_views,public.system_functions,public.system_group_table_func_rights IN SHARE ROW EXCLUSIVE MODE;
 -- Completed replay never registers, recopies, reinitializes or grants anything.
 IF EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='article_bundle_materialization' AND action='completed') THEN
  RETURN;
 END IF;

 INSERT INTO public.system_table_views(name,view_key,status)
  SELECT p.view_key,p.view_key,'active' FROM unnest(public.app_article_keys()) p(view_key) WHERE true ON CONFLICT(view_key) DO NOTHING;
 INSERT INTO public.system_functions(name,package,disabled,specific_table_related,url_route_endpoint,ui_only,rate_limit_amount,rate_limit_minutes,creation_spec)
  SELECT 'ui.view.'||p.view_key,'frontend',false,false,'/ui/view/'||p.view_key,true,200,20,'Independent article presentation right.'
  FROM unnest(ARRAY['image_first_view','image_first_page_view']) p(view_key) WHERE true ON CONFLICT(name) DO NOTHING;
 IF EXISTS(SELECT 1 FROM unnest(public.app_article_keys()) p(view_key) WHERE NOT EXISTS(
  SELECT 1 FROM public.system_functions f WHERE f.name='ui.view.'||p.view_key AND f.url_route_endpoint='/ui/view/'||p.view_key)) THEN
  RAISE EXCEPTION 'authored article permission identity conflicts with its route';
 END IF;
 INSERT INTO public.system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
  VALUES('ui.view.image_first_view','Kuvapainotteinen artikkeli','Image-first article','图片优先文章','圖片優先文章','Article presentation permission name.'),
   ('ui.view.image_first_page_view','Sivukokoinen kuvapainotteinen artikkeli','Page-sized image-first article','页面大小的图片优先文章','頁面大小的圖片優先文章','Article presentation permission name.')
  ON CONFLICT(lang_key) DO UPDATE SET
   fi=CASE WHEN NULLIF(btrim(system_lang_keys.fi),'') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
   en=CASE WHEN NULLIF(btrim(system_lang_keys.en),'') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
   ch=CASE WHEN NULLIF(btrim(system_lang_keys.ch),'') IS NULL THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
   yue=CASE WHEN NULLIF(btrim(system_lang_keys.yue),'') IS NULL THEN EXCLUDED.yue ELSE system_lang_keys.yue END;
 INSERT INTO public.system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
  SELECT k.id,t.code,t.copy,'manual','approved' FROM public.system_lang_keys k
  CROSS JOIN LATERAL(VALUES('fi',k.fi),('en',k.en),('zh-CN',k.ch),('zh-TW',k.yue),('zh-HK',k.yue)) t(code,copy)
  JOIN public.system_languages l ON l.language_code=t.code
  WHERE k.lang_key IN('ui.view.image_first_view','ui.view.image_first_page_view')
  ON CONFLICT(lang_key_id,language_code) DO UPDATE SET translation=EXCLUDED.translation
   WHERE NULLIF(btrim(system_lang_key_translations.translation),'') IS NULL;

 -- Fresh bootstrap's metadata completion already sees the folded columns.
 -- An upgrade adds the same three metadata rows with that protocol's defaults,
 -- without touching authored metadata or assigning a reader's column rights.
 INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,card_element,show_key_on_card,editable_in_ui)
  SELECT registry.table_uid,attribute.attname,pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.attnum,'details',NULL,true
  FROM public.system_db_tables registry JOIN pg_catalog.pg_attribute attribute
   ON attribute.attrelid=to_regclass(format('%I.%I',COALESCE(NULLIF(registry.schema_name,''),'public'),registry.table_name))
  WHERE COALESCE(NULLIF(registry.schema_name,''),'public')='public' AND attribute.attnum>0 AND NOT attribute.attisdropped
   AND (registry.table_name,attribute.attname) IN (('system_db_tables','article_opener_policy'),
    ('system_column_field_sets','article_family'),('system_column_field_set_members','presentation_values'))
   AND NOT EXISTS(SELECT 1 FROM public.system_column_details c WHERE c.table_uid=registry.table_uid AND c.column_name=attribute.attname)
  ORDER BY registry.table_uid,attribute.attnum;

 CREATE TEMP TABLE article_upgrade_sources ON COMMIT DROP AS
  SELECT a.table_uid,a.user_id,a.group_id,a.group_priority,a.created_by,v.view_key,m.column_uid,m.sort_order,m.column_width_px
  FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
  LEFT JOIN public.system_column_field_set_members m ON m.field_set_id=a.field_set_id
  WHERE v.view_key=ANY(public.app_article_keys());
 CREATE TEMP TABLE article_upgrade_targets ON COMMIT DROP AS
  SELECT DISTINCT table_uid,user_id,group_id FROM article_upgrade_sources
  UNION SELECT table_uid,NULL::bigint,NULL::bigint FROM public.system_db_tables;
 CREATE TEMP TABLE article_upgrade_rights ON COMMIT DROP AS SELECT * FROM public.system_group_table_func_rights;
 CREATE TEMP TABLE article_upgrade_blocks ON COMMIT DROP AS SELECT table_uid,article_section_initial_open FROM public.system_db_tables;
 IF EXISTS(SELECT 1 FROM article_upgrade_sources GROUP BY table_uid,user_id,group_id HAVING count(DISTINCT group_priority)>1) THEN
  RAISE EXCEPTION 'authored article presentation precedence conflicts; upgrade refused';
 END IF;
 IF EXISTS(SELECT 1 FROM article_upgrade_sources s JOIN public.system_column_details c ON c.column_uid=s.column_uid
  WHERE COALESCE(c.hide_everywhere,false) OR COALESCE(c.client_delivery_mode,'include')<>'include') THEN
  RAISE EXCEPTION 'legacy article assignment contains a forbidden field; upgrade refused';
 END IF;
 IF EXISTS(SELECT 1 FROM article_upgrade_sources s JOIN public.system_column_field_sets b ON b.table_uid=s.table_uid AND b.article_family) THEN
  RAISE EXCEPTION 'unmarked article bundles exist; upgrade refused';
 END IF;

 CREATE TEMP TABLE article_upgrade_nodes(uid integer PRIMARY KEY,rank integer,emitted boolean DEFAULT false) ON COMMIT DROP;
 CREATE TEMP TABLE article_upgrade_edges(predecessor integer,successor integer,PRIMARY KEY(predecessor,successor)) ON COMMIT DROP;
 CREATE TEMP TABLE article_upgrade_expected(view_key text,column_uid integer,sort_order integer,column_width_px integer) ON COMMIT DROP;
 FOR target IN SELECT * FROM article_upgrade_targets ORDER BY table_uid,user_id NULLS FIRST,group_id NULLS FIRST LOOP
  TRUNCATE article_upgrade_nodes,article_upgrade_edges,article_upgrade_expected;
  -- Article comes only from this exact target, never the migrating reader.
  IF EXISTS(SELECT 1 FROM article_upgrade_sources s WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id
    AND s.group_id IS NOT DISTINCT FROM target.group_id AND s.view_key='article_view') THEN
   INSERT INTO article_upgrade_expected SELECT view_key,column_uid,sort_order,column_width_px FROM article_upgrade_sources s
    WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id AND s.group_id IS NOT DISTINCT FROM target.group_id
     AND s.view_key='article_view' AND s.column_uid IS NOT NULL;
  ELSE
   INSERT INTO article_upgrade_expected SELECT 'article_view',column_uid,row_number() OVER(ORDER BY co_number NULLS LAST,column_uid),NULL
    FROM public.system_column_details WHERE table_uid=target.table_uid AND NOT COALESCE(hide_everywhere,false)
     AND COALESCE(client_delivery_mode,'include')='include';
  END IF;
  FOREACH projection_key IN ARRAY ARRAY['image_first_view','image_first_page_view'] LOOP
   IF EXISTS(SELECT 1 FROM article_upgrade_sources s WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id
     AND s.group_id IS NOT DISTINCT FROM target.group_id AND s.view_key=projection_key) THEN
    INSERT INTO article_upgrade_expected SELECT view_key,column_uid,sort_order,column_width_px FROM article_upgrade_sources s
     WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id AND s.group_id IS NOT DISTINCT FROM target.group_id
      AND s.view_key=projection_key AND s.column_uid IS NOT NULL;
   ELSE
    INSERT INTO article_upgrade_expected SELECT projection_key,column_uid,sort_order,column_width_px FROM article_upgrade_expected
     WHERE view_key=CASE projection_key WHEN 'image_first_view' THEN 'article_view' ELSE 'image_first_view' END;
   END IF;
  END LOOP;
  INSERT INTO article_upgrade_nodes(uid,rank)
   SELECT column_uid,min(sort_order+CASE view_key WHEN 'article_view' THEN 0 WHEN 'image_first_view' THEN 1000000 ELSE 2000000 END)
   FROM article_upgrade_expected GROUP BY column_uid;
  INSERT INTO article_upgrade_edges SELECT DISTINCT column_uid,successor FROM(
   SELECT column_uid,lead(column_uid) OVER(PARTITION BY view_key ORDER BY sort_order) successor FROM article_upgrade_expected) ordered
   WHERE successor IS NOT NULL;
  INSERT INTO public.system_column_field_sets(table_uid,owner_user_id,name,article_family,created_by)
   SELECT target.table_uid,target.user_id,public.app_article_bundle_name(target.table_uid,target.user_id,'Article upgrade bundle '||COALESCE('u'||target.user_id,'g'||target.group_id,'site')),true,min(created_by)
   FROM article_upgrade_sources s WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id AND s.group_id IS NOT DISTINCT FROM target.group_id
   RETURNING id INTO bundle;
  position:=0;
  -- A stable topological merge retains each authored projection's relative order.
  -- Cycles are incompatible orders: abort the entire migration, including grants.
  LOOP
   SELECT n.uid INTO chosen FROM article_upgrade_nodes n WHERE NOT n.emitted AND NOT EXISTS(
    SELECT 1 FROM article_upgrade_edges e JOIN article_upgrade_nodes p ON p.uid=e.predecessor
     WHERE e.successor=n.uid AND NOT p.emitted) ORDER BY n.rank,n.uid LIMIT 1;
   EXIT WHEN chosen IS NULL;
   position:=position+1;
   raw:=public.app_article_values(false);
   FOR source IN SELECT * FROM article_upgrade_expected WHERE column_uid=chosen LOOP
    raw:=jsonb_set(raw,ARRAY[source.view_key],jsonb_build_object('visible',true,'width_px',source.column_width_px));
   END LOOP;
   INSERT INTO public.system_column_field_set_members(field_set_id,table_uid,column_uid,sort_order,presentation_values)
    VALUES(bundle,target.table_uid,chosen,position,raw);
   UPDATE article_upgrade_nodes SET emitted=true WHERE uid=chosen;
  END LOOP;
  IF EXISTS(SELECT 1 FROM article_upgrade_nodes WHERE NOT emitted) THEN RAISE EXCEPTION 'authored IFAV order conflicts; upgrade refused'; END IF;
  INSERT INTO public.system_view_field_set_assignments(user_id,group_id,table_uid,view_id,field_set_id,group_priority,created_by)
   SELECT target.user_id,target.group_id,target.table_uid,v.id,bundle,COALESCE((SELECT max(s.group_priority) FROM article_upgrade_sources s
    WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id AND s.group_id IS NOT DISTINCT FROM target.group_id),0),
    (SELECT min(s.created_by) FROM article_upgrade_sources s WHERE s.table_uid=target.table_uid AND s.user_id IS NOT DISTINCT FROM target.user_id AND s.group_id IS NOT DISTINCT FROM target.group_id)
   FROM public.system_table_views v WHERE v.view_key=ANY(public.app_article_keys())
   ON CONFLICT(user_id,group_id,table_uid,view_id) DO UPDATE SET field_set_id=EXCLUDED.field_set_id;
  FOREACH projection_key IN ARRAY public.app_article_keys() LOOP
   IF (SELECT jsonb_agg(jsonb_build_array(column_uid,column_width_px) ORDER BY sort_order) FROM article_upgrade_expected WHERE view_key=projection_key)
      IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(column_uid,(presentation_values->projection_key->>'width_px')::integer) ORDER BY sort_order)
       FROM public.system_column_field_set_members WHERE field_set_id=bundle AND presentation_values->projection_key->'visible'='true') THEN
    RAISE EXCEPTION 'article ordered UID/width preservation failed';
   END IF;
  END LOOP;
 END LOOP;

 FOR dataset IN SELECT * FROM article_upgrade_blocks LOOP
  blocks:=dataset.article_section_initial_open;
  IF jsonb_typeof(blocks)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(blocks) k
     WHERE k NOT IN('classic','image_first','article_view','image_first_view','image_first_page_view')) THEN
   RAISE EXCEPTION 'unknown legacy article block settings';
  END IF;
  canonical:=public.app_article_section_defaults();
  FOREACH projection_key IN ARRAY public.app_article_keys() LOOP
   prior_cell:=blocks->CASE projection_key WHEN 'article_view' THEN 'classic' WHEN 'image_first_view' THEN 'image_first' ELSE projection_key END;
   cell:=blocks->projection_key;
   IF prior_cell IS NOT NULL AND jsonb_typeof(prior_cell)<>'object' OR cell IS NOT NULL AND jsonb_typeof(cell)<>'object' THEN
    RAISE EXCEPTION 'invalid legacy article block settings';
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(COALESCE(prior_cell,'{}')||COALESCE(cell,'{}')) p
     WHERE NOT canonical->projection_key ? p.key OR jsonb_typeof(p.value)<>'boolean') THEN RAISE EXCEPTION 'invalid article section'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(COALESCE(prior_cell,'{}')) p WHERE cell ? p.key AND cell->p.key<>p.value) THEN
    RAISE EXCEPTION 'conflicting canonical and legacy article blocks';
   END IF;
   IF projection_key='image_first_page_view' THEN canonical:=jsonb_set(canonical,ARRAY[projection_key],canonical->'image_first_view'); END IF;
   FOR section IN SELECT jsonb_object_keys(canonical->projection_key) LOOP
    canonical:=jsonb_set(canonical,ARRAY[projection_key,section],COALESCE(cell->section,prior_cell->section,canonical->projection_key->section));
   END LOOP;
  END LOOP;
  IF NOT public.app_valid_article_sections(canonical) THEN RAISE EXCEPTION 'canonical block assertion failed'; END IF;
  UPDATE public.system_db_tables SET article_section_initial_open=canonical WHERE table_uid=dataset.table_uid;
 END LOOP;

 -- Actual authored group grants only, including NULL/global and dataset scopes.
 -- Page receives the initial IFAV audience (authored IFAV plus copied Article).
 FOREACH projection_key IN ARRAY ARRAY['image_first_view','image_first_page_view'] LOOP
  INSERT INTO public.system_group_table_func_rights(user_group_id,function_id,target_schema_name,target_table_uid,creation_spec)
   SELECT r.user_group_id,destination.id,r.target_schema_name,r.target_table_uid,'One-time article audience materialization.'
   FROM public.system_group_table_func_rights r JOIN public.system_functions origin ON origin.id=r.function_id
   CROSS JOIN public.system_functions destination
   WHERE origin.url_route_endpoint='/ui/view/'||CASE projection_key WHEN 'image_first_view' THEN 'article_view' ELSE 'image_first_view' END
    AND origin.disabled IS FALSE
    AND destination.name='ui.view.'||projection_key AND NOT EXISTS(
     SELECT 1 FROM public.system_group_table_func_rights existing WHERE existing.user_group_id=r.user_group_id
      AND existing.function_id=destination.id AND existing.target_schema_name IS NOT DISTINCT FROM r.target_schema_name
      AND existing.target_table_uid IS NOT DISTINCT FROM r.target_table_uid) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.system_group_table_func_rights r JOIN public.system_functions origin ON origin.id=r.function_id
   CROSS JOIN public.system_functions destination
   WHERE origin.url_route_endpoint='/ui/view/'||CASE projection_key WHEN 'image_first_view' THEN 'article_view' ELSE 'image_first_view' END
    AND origin.disabled IS FALSE
    AND destination.name='ui.view.'||projection_key AND NOT EXISTS(
     SELECT 1 FROM public.system_group_table_func_rights copied WHERE copied.user_group_id=r.user_group_id AND copied.function_id=destination.id
      AND copied.target_schema_name IS NOT DISTINCT FROM r.target_schema_name AND copied.target_table_uid IS NOT DISTINCT FROM r.target_table_uid)) THEN
   RAISE EXCEPTION 'complete article audience scope preservation failed';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM article_upgrade_rights b WHERE NOT EXISTS(SELECT 1 FROM public.system_group_table_func_rights a WHERE to_jsonb(a)=to_jsonb(b))) THEN
  RAISE EXCEPTION 'authored grant preservation failed';
 END IF;
 SELECT string_agg(f,'; ') INTO findings FROM public.app_check_article_bundles() f;
 IF findings IS NOT NULL THEN RAISE EXCEPTION 'article materialization refused: %',findings; END IF;
 INSERT INTO public.system_data_repair_records(migration,action,detail)
  VALUES('article_bundle_materialization','completed',jsonb_build_object('file','20261015000012_materialize_article_bundles.sql',
   'targets',(SELECT count(*) FROM article_upgrade_targets),
   'source_assignments',(SELECT count(DISTINCT(table_uid,user_id,group_id,view_key)) FROM article_upgrade_sources)));
END $materialize$;
