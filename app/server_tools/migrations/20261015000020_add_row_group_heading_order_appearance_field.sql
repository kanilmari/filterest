-- 20261015000020_add_row_group_heading_order_appearance_field.sql
-- Adds the site-wide category heading order without changing existing saved values.
-- Connects the canonical appearance definition, upgrades and fresh bootstrap.
-- Keeps the default absent in storage, including fresh-install legacy backfill writes.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: row_group_heading_order_appearance_field

-- Copy of the latest rule/validator definitions in 20261009000060, with only
-- the new rule and its absent-value compatibility. No version row or default backfill.
CREATE OR REPLACE FUNCTION public.app_dataset_appearance_v2_rules()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $rules$
 SELECT '
{
 "light.oval_enabled": {
  "place": "tab_only",
  "type": "boolean",
  "default": true,
  "dark_default": false
 },
 "light.oval_width": {
  "place": "tab_only",
  "type": "number",
  "default": 32,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "light.oval_height": {
  "place": "tab_only",
  "type": "number",
  "default": 67,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "light.oval_position_y": {
  "place": "tab_only",
  "type": "number",
  "default": 56,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.center_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.4,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.mid_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.7,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.edge_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "light.center_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 39,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.mid_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 55,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.edge_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 80,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "light.image_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "dark_default": 0.3
 },
 "light.overlay_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0,
  "min": 0,
  "max": 1,
  "step": 0.01
 },
 "light.image_blur": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 24,
  "step": 1
 },
 "dark.oval_enabled": {
  "place": "tab_only",
  "type": "boolean",
  "default": false,
  "dark_default": false
 },
 "dark.oval_width": {
  "place": "tab_only",
  "type": "number",
  "default": 32,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "dark.oval_height": {
  "place": "tab_only",
  "type": "number",
  "default": 67,
  "min": 20,
  "max": 140,
  "step": 1
 },
 "dark.oval_position_y": {
  "place": "tab_only",
  "type": "number",
  "default": 56,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.center_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.4,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.mid_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.7,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.edge_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "dark.center_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 39,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.mid_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 55,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.edge_stop": {
  "place": "tab_only",
  "type": "number",
  "default": 80,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "dark.image_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0.3,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "dark_default": 0.3
 },
 "dark.overlay_opacity": {
  "place": "tab_only",
  "type": "number",
  "default": 0,
  "min": 0,
  "max": 1,
  "step": 0.01
 },
 "dark.image_blur": {
  "place": "tab_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 24,
  "step": 1
 },
 "shared.hero_extra_height": {
  "place": "tab_only",
  "type": "number",
  "default": 40,
  "min": 0,
  "max": 240,
  "step": 5
 },
 "shared.hero_bottom_fade": {
  "place": "tab_only",
  "type": "number",
  "default": 48,
  "min": 0,
  "max": 200,
  "step": 2
 },
 "shared.card_image_width": {
  "place": "site_default",
  "type": "number",
  "default": 300,
  "min": 30,
  "max": 600,
  "step": 5
 },
 "shared.card_image_presentation": {
  "place": "site_default",
  "type": "string",
  "default": "contain",
  "values": [
   "cover",
   "contain",
   "contain_blur"
  ]
 },
 "shared.article_image_caption_position": {
  "place": "site_default",
  "type": "string",
  "default": "below",
  "values": [
   "below",
   "overlay"
  ]
 },
 "shared.card_show_all_fields": {
  "place": "site_default",
  "type": "boolean",
  "default": true
 },
 "shared.label_value_layout": {
  "place": "site_default",
  "type": "string",
  "default": "stacked",
  "values": [
   "stacked",
   "inline"
  ],
  "development_values": [
   "auto"
  ]
 },
 "shared.card_style_variant": {
  "place": "site_default",
  "type": "string",
  "default": "modern",
  "values": [
   "standard",
   "modern"
  ]
 },
 "shared.card_description_lines": {
  "place": "site_default",
  "type": "integer",
  "default": 2,
  "min": 1,
  "max": 12,
  "step": 1
 },
 "shared.card_detail_columns": {
  "place": "site_default",
  "type": "integer",
  "default": 2,
  "min": 1,
  "max": 4,
  "step": 1
 },
 "shared.active_tab_fade": {
  "place": "site_only",
  "type": "number",
  "default": 25,
  "min": 0,
  "max": 100,
  "step": 1
 },
 "shared.active_tab_max_opacity": {
  "place": "site_only",
  "type": "number",
  "default": 1,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "shared.active_tab_glow_intensity": {
  "place": "site_only",
  "type": "number",
  "default": 0.5,
  "min": 0,
  "max": 1,
  "step": 0.05
 },
 "shared.active_tab_glow_width": {
  "place": "site_only",
  "type": "number",
  "default": 2,
  "min": 0,
  "max": 8,
  "step": 0.25
 },
 "shared.active_tab_glow_blur": {
  "place": "site_only",
  "type": "number",
  "default": 4,
  "min": 0,
  "max": 12,
  "step": 0.5
 },
 "shared.filterbar_content_top_space": {
  "place": "site_default",
  "type": "number",
  "default": 40,
  "min": 0,
  "max": 200,
  "step": 2
 },
 "shared.active_filter_remove_side": {
  "place": "site_only",
  "type": "string",
  "default": "start",
  "values": [
   "start",
   "end"
  ]
 },
 "shared.row_group_heading_order": {
  "place": "site_only",
  "type": "string",
  "default": "manual",
  "values": [
   "manual",
   "result_count"
  ]
 },
 "shared.brand_color": {
  "place": "site_only",
  "type": "hex_color",
  "default": "#1a8fe6"
 }
}
'::jsonb;
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

-- BOOTSTRAP_AFTER_DATA_SEED
-- The historical three-place seed uses the current rules' defaults. Run this
-- canonicalization after it on fresh installs, and normally on upgrades/replay.
-- Absent/default sites are untouched; no default is inserted or timestamp changed.
UPDATE public.system_config
SET json_value=jsonb_set(json_value,'{site_values}',(json_value->'site_values')-'shared.row_group_heading_order')
WHERE key='dataset_cover_theme_config' AND json_value->>'schema_version'='2'
  AND json_value->'site_values'->>'shared.row_group_heading_order'='manual';

INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'row_group_heading_order_appearance_field','completed',jsonb_build_object('file','20261015000020_add_row_group_heading_order_appearance_field.sql')
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='row_group_heading_order_appearance_field' AND action='completed');
