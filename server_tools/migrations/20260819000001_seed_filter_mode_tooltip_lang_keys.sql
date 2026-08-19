-- 20260819000001_seed_filter_mode_tooltip_lang_keys.sql
-- Seeds concise tooltips for the exact-value, range, and condition filter modes.
-- Bridges legacy language columns with every canonical locale so these controls never need AI fallback.
-- VERSION_DB: 9.2.0
-- VERSION_DB_OWNER: 20260819000003_record_dataset_media_db_release.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'filter_mode_exact_value',
            'Tarkka arvo',
            'Exact value',
            '精确值',
            '精確值',
            'Tooltip and accessible name for the filter mode that matches one exact value.'
        ),
        (
            'filter_mode_range',
            'Arvoväli',
            'Range',
            '范围',
            '範圍',
            'Tooltip and accessible name for the filter mode that matches a lower-to-upper range.'
        ),
        (
            'filter_mode_condition_expression',
            'Ehto tai lauseke',
            'Condition or expression',
            '条件或表达式',
            '條件或運算式',
            'Tooltip and accessible name for the filter mode that accepts a condition or expression.'
        )
)
UPDATE public.system_lang_keys AS existing
SET fi = authored.fi,
    en = authored.en,
    ch = authored.ch,
    yue = authored.yue,
    creation_spec = authored.creation_spec,
    updated = now()
FROM authored_keys AS authored
WHERE existing.lang_key = authored.lang_key;

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('filter_mode_exact_value', 'Tarkka arvo', 'Exact value', '精确值', '精確值', 'Tooltip and accessible name for the filter mode that matches one exact value.'),
        ('filter_mode_range', 'Arvoväli', 'Range', '范围', '範圍', 'Tooltip and accessible name for the filter mode that matches a lower-to-upper range.'),
        ('filter_mode_condition_expression', 'Ehto tai lauseke', 'Condition or expression', '条件或表达式', '條件或運算式', 'Tooltip and accessible name for the filter mode that accepts a condition or expression.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT authored.lang_key,
       authored.fi,
       authored.en,
       authored.ch,
       authored.yue,
       authored.creation_spec
FROM authored_keys AS authored
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = authored.lang_key
);

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('filter_mode_exact_value', 'en', 'Exact value', 'approved'),
        ('filter_mode_exact_value', 'fi', 'Tarkka arvo', 'approved'),
        ('filter_mode_exact_value', 'zh-CN', '精确值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-TW', '精確值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-HK', '精確值', 'needs_review'),
        ('filter_mode_range', 'en', 'Range', 'approved'),
        ('filter_mode_range', 'fi', 'Arvoväli', 'approved'),
        ('filter_mode_range', 'zh-CN', '范围', 'needs_review'),
        ('filter_mode_range', 'zh-TW', '範圍', 'needs_review'),
        ('filter_mode_range', 'zh-HK', '範圍', 'needs_review'),
        ('filter_mode_condition_expression', 'en', 'Condition or expression', 'approved'),
        ('filter_mode_condition_expression', 'fi', 'Ehto tai lauseke', 'approved'),
        ('filter_mode_condition_expression', 'zh-CN', '条件或表达式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-TW', '條件或運算式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-HK', '條件或運算式', 'needs_review')
), resolved AS (
    SELECT keys.id AS lang_key_id,
           authored.language_code,
           authored.translation,
           authored.review_status
    FROM authored_translations AS authored
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = authored.lang_key
)
UPDATE public.system_lang_key_translations AS existing
SET translation = resolved.translation,
    source_kind = 'manual',
    review_status = resolved.review_status,
    updated = now()
FROM resolved
WHERE existing.lang_key_id = resolved.lang_key_id
  AND existing.language_code = resolved.language_code;

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('filter_mode_exact_value', 'en', 'Exact value', 'approved'),
        ('filter_mode_exact_value', 'fi', 'Tarkka arvo', 'approved'),
        ('filter_mode_exact_value', 'zh-CN', '精确值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-TW', '精確值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-HK', '精確值', 'needs_review'),
        ('filter_mode_range', 'en', 'Range', 'approved'),
        ('filter_mode_range', 'fi', 'Arvoväli', 'approved'),
        ('filter_mode_range', 'zh-CN', '范围', 'needs_review'),
        ('filter_mode_range', 'zh-TW', '範圍', 'needs_review'),
        ('filter_mode_range', 'zh-HK', '範圍', 'needs_review'),
        ('filter_mode_condition_expression', 'en', 'Condition or expression', 'approved'),
        ('filter_mode_condition_expression', 'fi', 'Ehto tai lauseke', 'approved'),
        ('filter_mode_condition_expression', 'zh-CN', '条件或表达式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-TW', '條件或運算式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-HK', '條件或運算式', 'needs_review')
), resolved AS (
    SELECT keys.id AS lang_key_id,
           authored.language_code,
           authored.translation,
           authored.review_status
    FROM authored_translations AS authored
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = authored.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT resolved.lang_key_id,
       resolved.language_code,
       resolved.translation,
       'manual',
       resolved.review_status
FROM resolved
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = resolved.lang_key_id
      AND existing.language_code = resolved.language_code
);
