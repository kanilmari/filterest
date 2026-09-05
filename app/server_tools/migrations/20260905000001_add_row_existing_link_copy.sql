-- 20260905000001_add_row_existing_link_copy.sql
-- Adds localized copy for the shared existing-data step in row creation.
-- Bridges direct, one-to-many, and many-to-many selectors with one clear workflow.
-- Exists so row creation never labels nested business-row creation as ordinary linking.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'link_existing_data',
            'Linkitä olemassa olevaa dataa',
            'Link existing data',
            '关联现有数据',
            '連結現有資料',
            'Shared add-row step for linking existing related rows.'
        ),
        (
            'link_existing',
            'Linkitä olemassa oleva',
            'Link existing',
            '关联现有项目',
            '連結現有項目',
            'Action prefix for an existing related dataset selector.'
        ),
        (
            'search_by_name_or_id',
            'Hae nimellä tai ID:llä…',
            'Search by name or ID…',
            '按名称或 ID 搜索…',
            '按名稱或 ID 搜尋…',
            'Search placeholder for existing-row relation selectors.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en, ch, yue
    FROM public.system_lang_keys
    WHERE lang_key IN ('link_existing_data', 'link_existing', 'search_by_name_or_id')
), authored_translations AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation,
           translations.review_status
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES
            ('fi', selected.fi, 'approved'),
            ('en', selected.en, 'approved'),
            ('zh-CN', selected.ch, 'needs_review'),
            ('zh-TW', selected.yue, 'needs_review'),
            ('zh-HK', selected.yue, 'needs_review')
    ) AS translations(language_code, translation, review_status)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', review_status
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/general_tables/gt_1_row_crud/gt_1_1_row_create',
       '',
       'Existing-row relation controls in the add-row modal.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN ('link_existing_data', 'link_existing', 'search_by_name_or_id')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
