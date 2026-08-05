-- 20260720000001_add_image_first_sorting.sql
-- VERSION_DB: 8.0.52
-- Adds the localized label used by the image-presence dataset sort mode.

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue)
VALUES (
    'sort_images_first',
    'Kuvalliset ensin',
    'Rows with images first',
    '有图片的行优先',
    '有圖片嘅資料列優先'
)
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = NOW();

INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT id,
       'code',
       'frontend/core_components/filterbar/top_row_buttons/sort_dropdown_builder_helpers.js',
       '',
       'Dataset sort dropdown option that places rows with image content before image-free rows.',
       CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key = 'sort_images_first'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.52',
       'Added the localized language key for image-first dataset sorting.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '8.0.52'
);
