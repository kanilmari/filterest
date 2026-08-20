-- 20260820000003_seed_travel_dataset_presentation_defaults.sql
-- Seeds conservative travel-dataset and Users-tab presentation defaults.
-- Bridges reviewed filesystem symbol keys with exact Finnish/English dataset labels.
-- Exists so upgrades receive useful metadata while preserving administrator custom icons.
-- VERSION_DB: 9.2.4

WITH desired_icons(table_name, icon_key) AS (
    VALUES
        ('travel_info', 'map'),
        ('app_travel_info', 'map'),
        ('travel_deals', 'payments'),
        ('app_travel_deals', 'payments'),
        ('system_users', 'group_center_filled')
)
UPDATE public.system_db_tables AS target
SET icon_key = desired.icon_key,
    updated = now()
FROM desired_icons AS desired
WHERE target.table_name = desired.table_name
  AND (
      NULLIF(btrim(target.icon_key), '') IS NULL
      OR target.icon_key = 'table'
      OR (target.table_name = 'system_users' AND target.icon_key = 'group_filled')
  );

WITH desired_labels(lang_key, fi, en) AS (
    VALUES
        ('travel_info', 'Matkainfo', 'Travel info'),
        ('app_travel_info', 'Matkainfo', 'Travel info'),
        ('travel_deals', 'Matkatarjoukset', 'Travel deals'),
        ('app_travel_deals', 'Matkatarjoukset', 'Travel deals')
)
UPDATE public.system_lang_keys AS existing
SET fi = desired.fi,
    en = desired.en,
    creation_spec = 'Curated bilingual travel dataset navigation label.',
    updated = now()
FROM desired_labels AS desired
WHERE existing.lang_key = desired.lang_key;

WITH desired_labels(lang_key, fi, en) AS (
    VALUES
        ('travel_info', 'Matkainfo', 'Travel info'),
        ('app_travel_info', 'Matkainfo', 'Travel info'),
        ('travel_deals', 'Matkatarjoukset', 'Travel deals'),
        ('app_travel_deals', 'Matkatarjoukset', 'Travel deals')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT
    desired.lang_key,
    desired.fi,
    desired.en,
    'Curated bilingual travel dataset navigation label.'
FROM desired_labels AS desired
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = desired.lang_key
);

WITH desired_translations(lang_key, language_code, translation) AS (
    VALUES
        ('travel_info', 'fi', 'Matkainfo'),
        ('travel_info', 'en', 'Travel info'),
        ('app_travel_info', 'fi', 'Matkainfo'),
        ('app_travel_info', 'en', 'Travel info'),
        ('travel_deals', 'fi', 'Matkatarjoukset'),
        ('travel_deals', 'en', 'Travel deals'),
        ('app_travel_deals', 'fi', 'Matkatarjoukset'),
        ('app_travel_deals', 'en', 'Travel deals')
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
        desired.language_code,
        desired.translation
    FROM desired_translations AS desired
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = desired.lang_key
)
UPDATE public.system_lang_key_translations AS existing
SET translation = resolved.translation,
    source_kind = 'manual',
    review_status = 'approved',
    updated = now()
FROM resolved
WHERE existing.lang_key_id = resolved.lang_key_id
  AND existing.language_code = resolved.language_code;

WITH desired_translations(lang_key, language_code, translation) AS (
    VALUES
        ('travel_info', 'fi', 'Matkainfo'),
        ('travel_info', 'en', 'Travel info'),
        ('app_travel_info', 'fi', 'Matkainfo'),
        ('app_travel_info', 'en', 'Travel info'),
        ('travel_deals', 'fi', 'Matkatarjoukset'),
        ('travel_deals', 'en', 'Travel deals'),
        ('app_travel_deals', 'fi', 'Matkatarjoukset'),
        ('app_travel_deals', 'en', 'Travel deals')
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
        desired.language_code,
        desired.translation
    FROM desired_translations AS desired
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = desired.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    resolved.lang_key_id,
    resolved.language_code,
    resolved.translation,
    'manual',
    'approved'
FROM resolved
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = resolved.lang_key_id
      AND existing.language_code = resolved.language_code
);

INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT
    keys.id,
    'javascript',
    'frontend/core_components/navigation/main_tabs/main_tab_printer.js',
    keys.lang_key,
    'Dataset tab label resolved from the exact dataset language key.',
    CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'travel_info', 'app_travel_info',
    'travel_deals', 'app_travel_deals'
)
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_lang_key_sources AS existing
      WHERE existing.lang_key_id = keys.id
        AND existing.source_type = 'javascript'
        AND existing.source_high = 'frontend/core_components/navigation/main_tabs/main_tab_printer.js'
        AND existing.source_low = keys.lang_key
  );

INSERT INTO public.system_db_version (version, description)
SELECT '9.2.4', 'Added travel dataset labels and safe dataset-tab icon defaults'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.4'
);
