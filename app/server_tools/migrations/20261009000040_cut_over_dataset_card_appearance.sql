-- 20261009000040_cut_over_dataset_card_appearance.sql
-- Preserves explicit legacy card choices as canonical dataset appearance overrides.
-- Connects upgrades and fresh bootstrap with the sole revision-protected authority.
-- Retires both physical columns and their editable metadata after checking preservation.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: dataset_card_appearance_cutover
-- FINAL_CHECK: public.app_check_dataset_card_appearance_cutover()

-- to_jsonb makes replay safe after the source columns have been retired.
DO $cutover$
DECLARE findings text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('dataset_appearance_shared',0));
    IF EXISTS (SELECT 1 FROM public.system_db_tables d
                WHERE (to_jsonb(d)->>'card_style_variant') IS NOT NULL
                  AND (to_jsonb(d)->>'card_style_variant') NOT IN ('modern','standard')) THEN
        RAISE EXCEPTION 'invalid legacy card style; cutover refused';
    END IF;
    INSERT INTO public.system_dataset_appearance AS current (table_uid,overrides)
    SELECT table_uid,jsonb_strip_nulls(jsonb_build_object(
        'shared.card_style_variant',to_jsonb(d)->'card_style_variant',
        'shared.card_detail_columns',to_jsonb(d)->'card_detail_columns'))
      FROM public.system_db_tables d
     WHERE (to_jsonb(d)->>'card_style_variant') IS NOT NULL
        OR (to_jsonb(d)->>'card_detail_columns') IS NOT NULL
    ON CONFLICT(table_uid) DO UPDATE
       SET overrides=current.overrides || EXCLUDED.overrides,revision=current.revision+1
     WHERE current.overrides IS DISTINCT FROM current.overrides || EXCLUDED.overrides;

    IF EXISTS (SELECT 1 FROM public.system_db_tables d
        LEFT JOIN public.system_dataset_appearance a USING(table_uid)
        WHERE ((to_jsonb(d)->>'card_style_variant') IS NOT NULL
            AND a.overrides->'shared.card_style_variant' IS DISTINCT FROM to_jsonb(d)->'card_style_variant')
           OR ((to_jsonb(d)->>'card_detail_columns') IS NOT NULL
            AND a.overrides->'shared.card_detail_columns' IS DISTINCT FROM to_jsonb(d)->'card_detail_columns')) THEN
        RAISE EXCEPTION 'legacy card choices were not preserved; cutover refused';
    END IF;
    DELETE FROM public.system_column_details
     WHERE table_uid IN (SELECT table_uid FROM public.system_db_tables WHERE table_name='system_db_tables')
       AND column_name IN ('card_style_variant','card_detail_columns');
    ALTER TABLE public.system_db_tables DROP COLUMN IF EXISTS card_style_variant;
    ALTER TABLE public.system_db_tables DROP COLUMN IF EXISTS card_detail_columns;
END $cutover$;

COMMENT ON TABLE public.system_dataset_appearance IS
    'Private revision-protected per-dataset appearance overrides. Authorized results and dedicated administrator APIs are the only presentation boundary.';

CREATE OR REPLACE FUNCTION public.app_check_dataset_card_appearance_cutover()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $check$
    SELECT 'legacy card appearance columns remain'
     WHERE EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.system_db_tables'::regclass
         AND NOT attisdropped AND attname IN ('card_style_variant','card_detail_columns'))
    UNION ALL
    SELECT 'legacy card appearance editable metadata remains'
     WHERE EXISTS (SELECT 1 FROM public.system_column_details c JOIN public.system_db_tables d USING(table_uid)
         WHERE d.table_name='system_db_tables' AND c.column_name IN ('card_style_variant','card_detail_columns'))
    UNION ALL
    SELECT 'invalid migrated card override'
     WHERE EXISTS (SELECT 1 FROM public.system_dataset_appearance
         WHERE (overrides ? 'shared.card_style_variant' AND overrides->>'shared.card_style_variant' NOT IN ('modern','standard'))
            OR (overrides ? 'shared.card_detail_columns' AND overrides->'shared.card_detail_columns' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb)));
$check$;

DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_dataset_card_appearance_cutover() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'dataset card appearance final check refused: %',findings; END IF;
END $acceptance$;

INSERT INTO public.system_data_repair_records(migration,action,detail)
SELECT 'dataset_card_appearance_cutover','completed',jsonb_build_object('file','20261009000040_cut_over_dataset_card_appearance.sql')
WHERE NOT EXISTS(SELECT 1 FROM public.system_data_repair_records WHERE migration='dataset_card_appearance_cutover' AND action='completed');
