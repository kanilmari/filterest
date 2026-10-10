-- 20261009000061_backfill_dataset_appearance_three_places.sql
-- Activates owned tab appearance_values and sparse default overrides without shared cover writes.
-- Connects upgrades and fresh bootstrap with the reviewed version-two definition.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: dataset_appearance_three_place_backfill
-- FINAL_CHECK: public.app_check_dataset_appearance_three_places()

-- Reproduces config.go:NormalizeStoredConfig, including absent/null fields,
-- legacy shared blur, label-layout normalization and whole-config fallback.
-- Preserve development-only auto in storage; production readers retain their
-- existing stacked projection without discarding a development installation's value.
CREATE OR REPLACE FUNCTION public.app_normalize_legacy_dataset_appearance(raw jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $normal$
DECLARE defaults jsonb; appearance_values jsonb; item record; parts text[]; blur jsonb; theme text;
BEGIN
    SELECT jsonb_object_agg(key,value->'default') INTO defaults FROM jsonb_each(public.app_dataset_appearance_v2_rules());
    appearance_values := defaults;
    IF raw IS NULL OR jsonb_typeof(raw) <> 'object' THEN RETURN defaults; END IF;
    FOREACH theme IN ARRAY ARRAY['light','dark','shared'] LOOP
        IF raw ? theme AND jsonb_typeof(raw->theme) NOT IN ('null','object') THEN RETURN defaults; END IF;
    END LOOP;
    FOR item IN SELECT * FROM jsonb_each(defaults) LOOP
        parts := string_to_array(item.key,'.');
        -- The legacy typed Go integer decoder refuses decimal JSON, even 2.0.
        IF public.app_dataset_appearance_v2_rules()->item.key->>'type'='integer'
           AND raw #> parts IS NOT NULL AND raw #> parts <> 'null'
           AND (raw #> parts)::text !~ '^-?[0-9]+$' THEN RETURN defaults; END IF;
        appearance_values := jsonb_set(appearance_values,ARRAY[item.key],COALESCE(NULLIF(raw #> parts,'null'),item.value));
    END LOOP;
    blur := COALESCE(NULLIF(raw #> '{shared,image_blur}','null'),'1');
    IF jsonb_typeof(blur) <> 'number' OR blur::text::numeric NOT BETWEEN 0 AND 24 THEN RETURN defaults; END IF;
    FOREACH theme IN ARRAY ARRAY['light','dark'] LOOP
        IF NOT COALESCE(raw->theme ? 'image_blur',false) THEN appearance_values := jsonb_set(appearance_values,ARRAY[theme||'.image_blur'],blur); END IF;
    END LOOP;
    IF jsonb_typeof(appearance_values->'shared.label_value_layout') <> 'string' THEN RETURN defaults; END IF;
    IF NOT (appearance_values->'shared.label_value_layout') IN ('"stacked"','"inline"','"auto"') THEN
        appearance_values := jsonb_set(appearance_values,'{shared.label_value_layout}','"stacked"');
    END IF;
    FOR theme IN SELECT DISTINCT value->>'place' FROM jsonb_each(public.app_dataset_appearance_v2_rules()) LOOP
        IF NOT public.app_valid_dataset_appearance_v2((SELECT jsonb_object_agg(v.key,v.value) FROM jsonb_each(appearance_values) v
            JOIN jsonb_each(public.app_dataset_appearance_v2_rules()) r USING(key) WHERE r.value->>'place'=theme),theme,true) THEN RETURN defaults; END IF;
    END LOOP;
    RETURN appearance_values;
END $normal$;

DO $backfill$
DECLARE normalized jsonb; tab jsonb; site jsonb; defaults jsonb; findings text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('dataset_appearance_shared',0));
    LOCK TABLE public.system_db_tables IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE public.system_dataset_appearance IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_backfill' AND action='completed') THEN
        -- Only the two cut-over card leaves may exist in version-one overrides.
        IF EXISTS (SELECT 1 FROM public.system_dataset_appearance a, LATERAL jsonb_each(a.overrides) v
            WHERE a.schema_version=1 AND v.key NOT IN ('shared.card_style_variant','shared.card_detail_columns'))
           OR EXISTS (SELECT 1 FROM public.system_dataset_appearance WHERE schema_version=1
            AND NOT public.app_valid_dataset_appearance_v2(overrides,'site_default',false)) THEN
            RAISE EXCEPTION 'unexpected non-card or invalid legacy appearance overrides; preflight refused';
        END IF;
        SELECT public.app_normalize_legacy_dataset_appearance(json_value) INTO normalized FROM public.system_config WHERE key='dataset_cover_theme_config' FOR UPDATE;
        normalized := COALESCE(normalized,public.app_normalize_legacy_dataset_appearance(NULL));
        SELECT jsonb_object_agg(v.key,v.value) FILTER(WHERE r.value->>'place'='tab_only'),
               jsonb_object_agg(v.key,v.value) FILTER(WHERE r.value->>'place'='site_only'),
               jsonb_object_agg(v.key,v.value) FILTER(WHERE r.value->>'place'='site_default') INTO tab,site,defaults
            FROM jsonb_each(normalized) v JOIN jsonb_each(public.app_dataset_appearance_v2_rules()) r USING(key);
        CREATE TEMP TABLE wl160_appearance_before ON COMMIT DROP AS
            SELECT d.table_uid,COALESCE(a.revision,0) AS revision,COALESCE(a.schema_version,1) AS schema_version,
                CASE WHEN a.schema_version=2 THEN a.tab_values||site||defaults||a.overrides
                     ELSE normalized||COALESCE(a.overrides,'{}') END AS effective
            FROM public.system_db_tables d LEFT JOIN public.system_dataset_appearance a USING(table_uid);
        UPDATE public.system_dataset_appearance SET tab_values=tab,schema_version=2,revision=revision+1 WHERE schema_version=1;
        INSERT INTO public.system_dataset_appearance(table_uid,schema_version,tab_values,overrides,revision)
            SELECT d.table_uid,2,tab,'{}',1 FROM public.system_db_tables d
            WHERE NOT EXISTS (SELECT 1 FROM public.system_dataset_appearance a WHERE a.table_uid=d.table_uid);
        IF EXISTS (SELECT 1 FROM wl160_appearance_before b JOIN public.system_dataset_appearance a USING(table_uid)
            WHERE a.tab_values||site||defaults||a.overrides IS DISTINCT FROM b.effective
               OR a.revision <> b.revision + CASE WHEN b.schema_version=2 THEN 0 ELSE 1 END) THEN
            RAISE EXCEPTION 'effective appearance or one-time revision preservation failed';
        END IF;
        -- Remove the active cover only after every UID has its complete copy.
        UPDATE public.system_config SET json_value=jsonb_build_object('schema_version',2,'site_values',site,'defaults',defaults),updated=clock_timestamp()
            WHERE key='dataset_cover_theme_config';
        INSERT INTO public.system_config(key,json_value,creation_spec,updated)
            SELECT 'dataset_cover_theme_config',jsonb_build_object('schema_version',2,'site_values',site,'defaults',defaults),
                'Admin-managed site appearance_values and overridable appearance defaults.',clock_timestamp()
            WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key='dataset_cover_theme_config');
        ALTER TABLE public.system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_schema_version;
        ALTER TABLE public.system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_schema_version CHECK(schema_version=2);
    END IF;
END $backfill$;

CREATE OR REPLACE FUNCTION public.app_check_dataset_appearance_three_places()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'dataset appearance does not cover every registry UID'
    WHERE EXISTS (SELECT 1 FROM public.system_db_tables d LEFT JOIN public.system_dataset_appearance a USING(table_uid) WHERE a.table_uid IS NULL)
    UNION ALL
    SELECT 'dataset appearance has incomplete tab appearance_values, invalid masks, forbidden overrides or revisions'
    WHERE EXISTS (SELECT 1 FROM public.system_dataset_appearance WHERE schema_version<>2 OR revision<1
        OR NOT public.app_valid_dataset_appearance_v2(tab_values,'tab_only',true)
        OR NOT public.app_valid_dataset_appearance_v2(overrides,'site_default',false))
    UNION ALL
    SELECT 'site storage must contain only seven site appearance_values and nine defaults'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key='dataset_cover_theme_config'
        AND json_value->'schema_version'='2' AND (SELECT count(*) FROM jsonb_object_keys(json_value))=3
        AND public.app_valid_dataset_appearance_v2(json_value->'site_values','site_only',true)
        AND public.app_valid_dataset_appearance_v2(json_value->'defaults','site_default',true))
    UNION ALL
    SELECT 'dataset schema must be restricted to version two'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_dataset_appearance'::regclass AND convalidated
        AND conname='ck_system_dataset_appearance_schema_version' AND pg_get_constraintdef(oid)='CHECK ((schema_version = 2))');
$check$;
DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM (
        SELECT * FROM public.app_check_dataset_appearance_storage() UNION ALL SELECT * FROM public.app_check_dataset_appearance_three_places()) AS checks(finding);
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'three-place appearance final check refused: %',findings; END IF;
    INSERT INTO public.system_data_repair_records(migration,action,detail)
    SELECT 'dataset_appearance_three_place_backfill','completed',jsonb_build_object('file','20261009000061_backfill_dataset_appearance_three_places.sql')
    WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_appearance_three_place_backfill' AND action='completed');
END $acceptance$;
