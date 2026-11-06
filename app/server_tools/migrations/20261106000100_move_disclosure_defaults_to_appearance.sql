-- 20261106000100_move_disclosure_defaults_to_appearance.sql
-- Moves article and palette opening defaults to the existing three-place appearance owner.
-- Owner decision K604 (6 November): all disclosures start closed, including articles.
-- Audit legacy defaults before removal; title, primary image and article text are not disclosures.
-- No browser choice is imported into server storage. Bottom related-row tabs are unchanged.
-- Integration: restamp at APPROVE. VERSION_DB/bootstrap retain base 9.13.5 only
-- as a worktree placeholder; Foreman assigns the release record and next free DB
-- version on approval. This is not a released 9.13.5 schema or a reserved number.
-- COMPLETION_MARKER: disclosure_appearance_defaults
-- FINAL_CHECK: public.app_check_disclosure_appearance_defaults()

CREATE OR REPLACE FUNCTION public.app_dataset_appearance_v2_rules()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $rules$
 SELECT '
{
 "light.oval_enabled": {"place":"tab_only","type":"boolean","default":true,"dark_default":false},
 "light.oval_width": {"place":"tab_only","type":"number","default":32,"min":20,"max":140,"step":1},
 "light.oval_height": {"place":"tab_only","type":"number","default":67,"min":20,"max":140,"step":1},
 "light.oval_position_y": {"place":"tab_only","type":"number","default":56,"min":0,"max":100,"step":1},
 "light.center_opacity": {"place":"tab_only","type":"number","default":0.4,"min":0,"max":1,"step":0.05},
 "light.mid_opacity": {"place":"tab_only","type":"number","default":0.7,"min":0,"max":1,"step":0.05},
 "light.edge_opacity": {"place":"tab_only","type":"number","default":1,"min":0,"max":1,"step":0.05},
 "light.center_stop": {"place":"tab_only","type":"number","default":39,"min":0,"max":100,"step":1},
 "light.mid_stop": {"place":"tab_only","type":"number","default":55,"min":0,"max":100,"step":1},
 "light.edge_stop": {"place":"tab_only","type":"number","default":80,"min":0,"max":100,"step":1},
 "light.image_opacity": {"place":"tab_only","type":"number","default":1,"min":0,"max":1,"step":0.05,"dark_default":0.3},
 "light.overlay_opacity": {"place":"tab_only","type":"number","default":0,"min":0,"max":1,"step":0.01},
 "light.image_blur": {"place":"tab_only","type":"number","default":1,"min":0,"max":24,"step":1},
 "dark.oval_enabled": {"place":"tab_only","type":"boolean","default":false,"dark_default":false},
 "dark.oval_width": {"place":"tab_only","type":"number","default":32,"min":20,"max":140,"step":1},
 "dark.oval_height": {"place":"tab_only","type":"number","default":67,"min":20,"max":140,"step":1},
 "dark.oval_position_y": {"place":"tab_only","type":"number","default":56,"min":0,"max":100,"step":1},
 "dark.center_opacity": {"place":"tab_only","type":"number","default":0.4,"min":0,"max":1,"step":0.05},
 "dark.mid_opacity": {"place":"tab_only","type":"number","default":0.7,"min":0,"max":1,"step":0.05},
 "dark.edge_opacity": {"place":"tab_only","type":"number","default":1,"min":0,"max":1,"step":0.05},
 "dark.center_stop": {"place":"tab_only","type":"number","default":39,"min":0,"max":100,"step":1},
 "dark.mid_stop": {"place":"tab_only","type":"number","default":55,"min":0,"max":100,"step":1},
 "dark.edge_stop": {"place":"tab_only","type":"number","default":80,"min":0,"max":100,"step":1},
 "dark.image_opacity": {"place":"tab_only","type":"number","default":0.3,"min":0,"max":1,"step":0.05,"dark_default":0.3},
 "dark.overlay_opacity": {"place":"tab_only","type":"number","default":0,"min":0,"max":1,"step":0.01},
 "dark.image_blur": {"place":"tab_only","type":"number","default":1,"min":0,"max":24,"step":1},
 "shared.hero_extra_height": {"place":"tab_only","type":"number","default":40,"min":0,"max":240,"step":5},
 "shared.hero_bottom_fade": {"place":"tab_only","type":"number","default":48,"min":0,"max":200,"step":2},
 "shared.card_image_width": {"place":"site_default","type":"number","default":300,"min":30,"max":600,"step":5},
 "shared.card_image_presentation": {"place":"site_default","type":"string","default":"contain","values":["cover","contain","contain_blur"]},
 "shared.article_image_caption_position": {"place":"site_default","type":"string","default":"below","values":["below","overlay"]},
 "shared.card_show_all_fields": {"place":"site_default","type":"boolean","default":true},
 "shared.label_value_layout": {"place":"site_default","type":"string","default":"stacked","values":["stacked","inline"],"development_values":["auto"]},
 "shared.card_style_variant": {"place":"site_default","type":"string","default":"modern","values":["standard","modern"]},
 "shared.card_description_lines": {"place":"site_default","type":"integer","default":2,"min":1,"max":12,"step":1},
 "shared.card_detail_columns": {"place":"site_default","type":"integer","default":2,"min":1,"max":4,"step":1},
 "shared.active_tab_fade": {"place":"site_only","type":"number","default":25,"min":0,"max":100,"step":1},
 "shared.active_tab_max_opacity": {"place":"site_only","type":"number","default":1,"min":0,"max":1,"step":0.05},
 "shared.active_tab_glow_intensity": {"place":"site_only","type":"number","default":0.5,"min":0,"max":1,"step":0.05},
 "shared.active_tab_glow_width": {"place":"site_only","type":"number","default":2,"min":0,"max":8,"step":0.25},
 "shared.active_tab_glow_blur": {"place":"site_only","type":"number","default":4,"min":0,"max":12,"step":0.5},
 "shared.filterbar_content_top_space": {"place":"site_default","type":"number","default":40,"min":0,"max":200,"step":2},
 "shared.active_filter_remove_side": {"place":"site_only","type":"string","default":"start","values":["start","end"]},
 "shared.row_group_heading_order": {"place":"site_only","type":"string","default":"manual","values":["manual","result_count"]},
 "shared.brand_color": {"place":"site_only","type":"hex_color","default":"#1a8fe6"},
 "shared.filterbar_filters_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_search_overview_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_search_controls_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_tools_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_views_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_field_sets_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_style_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.filterbar_chat_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.article_view_details_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.article_view_images_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.article_view_attachments_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.article_view_related_rows_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.article_view_task_progress_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.image_first_view_details_initial_open": {"place":"site_default","type":"boolean","default":false},
 "shared.image_first_page_view_details_initial_open": {"place":"site_default","type":"boolean","default":false}
}'::jsonb;
$rules$;

CREATE OR REPLACE FUNCTION public.app_valid_dataset_appearance_v2(appearance_values jsonb, place text, complete boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $check$
DECLARE item record; rule jsonb; number numeric; wanted integer;
BEGIN
    IF appearance_values IS NULL OR jsonb_typeof(appearance_values) <> 'object' THEN RETURN false; END IF;
    -- Additive stored-read compatibility only: old sites need no data backfill.
    -- A present value still goes through the same strict enum/type validation.
    IF place='site_only' AND complete AND NOT appearance_values ? 'shared.row_group_heading_order' THEN
        appearance_values := jsonb_build_object('shared.row_group_heading_order',
            public.app_dataset_appearance_v2_rules()->'shared.row_group_heading_order'->'default') || appearance_values;
    END IF;
    -- Additive read compatibility for old complete maps, never for unknown leaves.
    IF place='site_default' AND complete THEN
        appearance_values := (SELECT COALESCE(jsonb_object_agg(key,value->'default'),'{}')
            FROM jsonb_each(public.app_dataset_appearance_v2_rules())
            WHERE key LIKE 'shared.%_initial_open' AND value->>'place'='site_default') || appearance_values;
    END IF;
    SELECT count(*) INTO wanted FROM jsonb_each(public.app_dataset_appearance_v2_rules()) WHERE value->>'place'=place;
    IF complete AND (SELECT count(*) FROM jsonb_each(appearance_values)) <> wanted THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_each(appearance_values) LOOP
        rule := public.app_dataset_appearance_v2_rules()->item.key;
        IF rule IS NULL OR rule->>'place' <> place OR item.value='null'::jsonb THEN RETURN false; END IF;
        CASE rule->>'type'
        WHEN 'boolean' THEN IF jsonb_typeof(item.value) <> 'boolean' THEN RETURN false; END IF;
        WHEN 'number', 'integer' THEN
            IF jsonb_typeof(item.value) <> 'number' THEN RETURN false; END IF;
            number := item.value::text::numeric;
            IF number < (rule->>'min')::numeric OR number > (rule->>'max')::numeric
               OR (rule->>'type'='integer' AND number <> trunc(number)) THEN RETURN false; END IF;
        WHEN 'hex_color' THEN
            IF jsonb_typeof(item.value) <> 'string' OR (item.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' THEN RETURN false; END IF;
        WHEN 'string' THEN
            IF jsonb_typeof(item.value) <> 'string' OR NOT (COALESCE(rule->'values','[]') || COALESCE(rule->'development_values','[]')) @> jsonb_build_array(item.value) THEN RETURN false; END IF;
        ELSE RETURN false;
        END CASE;
    END LOOP;
    IF place='tab_only' AND complete THEN
        FOREACH place IN ARRAY ARRAY['light','dark'] LOOP
            IF (appearance_values->>(place||'.center_opacity'))::numeric > (appearance_values->>(place||'.mid_opacity'))::numeric
               OR (appearance_values->>(place||'.mid_opacity'))::numeric > (appearance_values->>(place||'.edge_opacity'))::numeric
               OR (appearance_values->>(place||'.center_stop'))::numeric > (appearance_values->>(place||'.mid_stop'))::numeric
               OR (appearance_values->>(place||'.mid_stop'))::numeric > (appearance_values->>(place||'.edge_stop'))::numeric THEN RETURN false; END IF;
        END LOOP;
    END IF;
    RETURN true;
END $check$;

-- Complete derived article projection; there is no second writable block store.
CREATE OR REPLACE FUNCTION public.app_article_disclosure_defaults(dataset_uid integer)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $blocks$
 WITH blocks(presentation,block) AS (VALUES
        ('article_view','details'),
        ('article_view','images'),
        ('article_view','attachments'),
        ('article_view','related_rows'),
        ('article_view','task_progress'),
        ('image_first_view','details'),
        ('image_first_page_view','details')
 ), resolved AS (
    SELECT b.presentation,b.block,
        COALESCE(a.overrides->('shared.'||b.presentation||'_'||b.block||'_initial_open'),
            c.json_value->'defaults'->('shared.'||b.presentation||'_'||b.block||'_initial_open'),
            public.app_dataset_appearance_v2_rules()->('shared.'||b.presentation||'_'||b.block||'_initial_open')->'default') AS value
    FROM public.system_db_tables d CROSS JOIN blocks b
    LEFT JOIN public.system_dataset_appearance a USING(table_uid)
    LEFT JOIN public.system_config c ON c.key='dataset_cover_theme_config'
    WHERE d.table_uid=dataset_uid
 ), presentations AS (
    SELECT presentation,jsonb_object_agg(block,value) AS blocks FROM resolved GROUP BY presentation
 ) SELECT jsonb_object_agg(presentation,blocks) FROM presentations;
$blocks$;

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
  SELECT 1 FROM public.system_db_tables d WHERE NOT public.app_valid_article_sections(public.app_article_disclosure_defaults(d.table_uid))
   OR NOT EXISTS(SELECT 1 FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
     WHERE a.table_uid=d.table_uid AND a.user_id IS NULL AND a.group_id IS NULL AND v.view_key='article_view'));
$$;

-- This check remains valid after a later administrator intentionally opens a block.
CREATE OR REPLACE FUNCTION public.app_check_disclosure_appearance_defaults()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $final$
 SELECT 'legacy article disclosure column remains' WHERE EXISTS(
  SELECT 1 FROM pg_attribute WHERE attrelid='public.system_db_tables'::regclass
   AND NOT attisdropped AND attname='article_section_initial_open')
 UNION ALL SELECT 'legacy article disclosure metadata remains' WHERE EXISTS(
  SELECT 1 FROM public.system_column_details c JOIN public.system_db_tables d USING(table_uid)
   WHERE d.table_name='system_db_tables' AND c.column_name='article_section_initial_open')
 UNION ALL SELECT 'legacy palette disclosure storage remains' WHERE EXISTS(
  SELECT 1 FROM public.system_config WHERE key='filterbar_section_layout' AND json_value ? 'section_collapsed')
 UNION ALL SELECT 'closed disclosure rule catalogue is incomplete' WHERE (
  SELECT count(*) FROM jsonb_each(public.app_dataset_appearance_v2_rules())
   WHERE key LIKE 'shared.%_initial_open' AND value->>'place'='site_default'
    AND value->>'type'='boolean' AND value->'default'='false'::jsonb)<>15
 UNION ALL SELECT * FROM public.app_check_article_bundles();
$final$;

-- The bootstrap runs this entire migration after historical article materialization.
-- Legacy schema and data must exist until that step has finished.
-- Replay is safe after the old column has been removed; no user's current defaults reset.
DO $cutover$
DECLARE dataset record; new_paths jsonb;
BEGIN
    IF EXISTS(SELECT 1 FROM public.system_data_repair_records
        WHERE migration='disclosure_appearance_defaults' AND action='completed') THEN RETURN; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('dataset_appearance_shared',0));
    SELECT COALESCE(jsonb_object_agg(key,value->'default'),'{}') INTO new_paths
        FROM jsonb_each(public.app_dataset_appearance_v2_rules())
        WHERE key LIKE 'shared.%_initial_open' AND value->>'place'='site_default';
    INSERT INTO public.system_data_repair_records(migration,action,detail)
        SELECT 'disclosure_appearance_defaults','prior_site_disclosures',
            (SELECT jsonb_object_agg(key,value) FROM jsonb_each(json_value->'defaults') WHERE new_paths ? key)
        FROM public.system_config WHERE key='dataset_cover_theme_config'
            AND json_value->>'schema_version'='2'
            AND (json_value->'defaults') ?| ARRAY(SELECT jsonb_object_keys(new_paths));
    UPDATE public.system_config SET json_value=jsonb_set(json_value,'{defaults}',(json_value->'defaults')||new_paths)
        WHERE key='dataset_cover_theme_config' AND json_value->>'schema_version'='2';
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='system_db_tables' AND column_name='article_section_initial_open') THEN
        FOR dataset IN SELECT table_uid,article_section_initial_open FROM public.system_db_tables LOOP
            IF NOT public.app_valid_article_sections(dataset.article_section_initial_open) THEN
                RAISE EXCEPTION 'invalid legacy article disclosure defaults for dataset %',dataset.table_uid;
            END IF;
            INSERT INTO public.system_data_repair_records(migration,action,detail)
                VALUES('disclosure_appearance_defaults','legacy_article_values',
                    jsonb_build_object('dataset_uid',dataset.table_uid,'values',dataset.article_section_initial_open));
        END LOOP;
        DELETE FROM public.system_column_details WHERE column_name='article_section_initial_open'
            AND table_uid IN (SELECT table_uid FROM public.system_db_tables WHERE table_name='system_db_tables');
        -- Drain only the article invariant before DDL; other deferred checks keep their mode.
        SET CONSTRAINTS public.article_bundle_invariant IMMEDIATE;
        ALTER TABLE public.system_db_tables DROP COLUMN article_section_initial_open;
        SET CONSTRAINTS public.article_bundle_invariant DEFERRED;
    END IF;
    -- Do not promote old opening states into dataset overrides: that would undo
    -- the owner's closed initial state. Future explicit admin saves may override it.
    INSERT INTO public.system_data_repair_records(migration,action,detail)
        SELECT 'disclosure_appearance_defaults','prior_appearance_disclosures',
            jsonb_build_object('dataset_uid',a.table_uid,'values',
                (SELECT jsonb_object_agg(key,value) FROM jsonb_each(a.overrides) WHERE new_paths ? key))
        FROM public.system_dataset_appearance a WHERE a.overrides ?| ARRAY(SELECT jsonb_object_keys(new_paths));
    UPDATE public.system_dataset_appearance SET overrides=overrides-ARRAY(SELECT jsonb_object_keys(new_paths)),revision=revision+1
        WHERE overrides ?| ARRAY(SELECT jsonb_object_keys(new_paths));
    INSERT INTO public.system_data_repair_records(migration,action,detail)
        SELECT 'disclosure_appearance_defaults','legacy_palette_values',json_value->'section_collapsed'
        FROM public.system_config WHERE key='filterbar_section_layout' AND json_value ? 'section_collapsed';
    UPDATE public.system_config SET json_value=json_value-'section_collapsed'
        WHERE key='filterbar_section_layout' AND json_value ? 'section_collapsed';
    INSERT INTO public.system_data_repair_records(migration,action,detail)
        VALUES('disclosure_appearance_defaults','completed',jsonb_build_object('fields',15,'owner','dataset_appearance'));
END $cutover$;

DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_disclosure_appearance_defaults() finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'disclosure default cutover refused: %',findings; END IF;
END $acceptance$;
