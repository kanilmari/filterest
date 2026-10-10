-- 20261009000060_extend_dataset_appearance_three_places.sql
-- Activates owned tab values and sparse default overrides without shared cover writes.
-- Connects upgrades and fresh bootstrap with the reviewed version-two definition.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: dataset_appearance_three_place_schema
-- FINAL_CHECK: public.app_check_dataset_appearance_storage()

-- Immutable migration rule snapshot. Tests compare it with definition.json;
-- future rules need a new migration, never edits to executed source.
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

ALTER TABLE public.system_dataset_appearance ADD COLUMN IF NOT EXISTS tab_values jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.system_dataset_appearance ALTER COLUMN schema_version SET DEFAULT 2;
-- Version one remains readable only between these two atomic migration steps.
-- The backfill tightens this constraint to version two after converting all rows.
DO $schema$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_backfill' AND action='completed') THEN
        ALTER TABLE public.system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_schema_version;
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_schema_version CHECK(schema_version IN (1,2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND conname='ck_system_dataset_appearance_tab_values') THEN
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_tab_values
            CHECK(schema_version=1 OR public.app_valid_dataset_appearance_v2(tab_values,'tab_only',true));
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_overrides
            CHECK(schema_version=1 OR public.app_valid_dataset_appearance_v2(overrides,'site_default',false));
    END IF;
END $schema$;
COMMENT ON COLUMN public.system_dataset_appearance.tab_values IS 'Complete 28 canonical tab-owned appearance_values. Never inherits site changes; one revision covers this map and overrides.';
COMMENT ON TABLE public.system_dataset_appearance IS 'Private version-two tab appearance and sparse default overrides. Dedicated authorized savers only; immutable UID ownership.';
REVOKE ALL ON public.system_dataset_appearance FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_check_dataset_appearance_storage()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'dataset appearance storage requires exactly five non-null columns and version-two defaults'
    WHERE (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
        WHERE attrelid='public.system_dataset_appearance'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull)
        IS DISTINCT FROM ARRAY['overrides','revision','schema_version','tab_values','table_uid']
       OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.system_dataset_appearance'::regclass AND attnum>0 AND NOT attisdropped) <> 5
       OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
           WHERE d.adrelid='public.system_dataset_appearance'::regclass AND a.attname='schema_version' AND pg_get_expr(d.adbin,d.adrelid)='2')
    UNION ALL
    SELECT 'dataset appearance requires its primary key and cascading UID'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (table_uid)')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='f' AND pg_get_constraintdef(oid)='FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE')
    UNION ALL
    SELECT 'dataset appearance storage requires six validated checks'
    WHERE (SELECT count(*) FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND contype='c' AND convalidated
        AND (conname,pg_get_constraintdef(oid)) IN (
            ('ck_system_dataset_appearance_schema_version','CHECK ((schema_version = 2))'),
            ('ck_system_dataset_appearance_schema_version','CHECK ((schema_version = ANY (ARRAY[1, 2])))'),
            ('ck_system_dataset_appearance_object','CHECK ((jsonb_typeof(overrides) = ''object''::text))'),
            ('ck_system_dataset_appearance_no_null','CHECK ((NOT jsonb_path_exists(overrides, ''$.*?(@ == null)''::jsonpath)))'),
            ('ck_system_dataset_appearance_revision','CHECK ((revision > 0))'),
            ('ck_system_dataset_appearance_tab_values','CHECK (((schema_version = 1) OR app_valid_dataset_appearance_v2(tab_values, ''tab_only''::text, true)))'),
            ('ck_system_dataset_appearance_overrides','CHECK (((schema_version = 1) OR app_valid_dataset_appearance_v2(overrides, ''site_default''::text, false)))'))) <> 6
    UNION ALL
    SELECT 'dataset appearance must not be registered or exposed to PUBLIC'
    WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name='system_dataset_appearance')
       OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid='public.system_dataset_appearance'::regclass AND a.grantee=0);
$check$;

DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_dataset_appearance_storage() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'dataset appearance storage final check refused: %',findings; END IF;
END $acceptance$;
INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'dataset_appearance_three_place_schema','completed',jsonb_build_object('file','20261009000060_extend_dataset_appearance_three_places.sql')
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_schema' AND action='completed');
