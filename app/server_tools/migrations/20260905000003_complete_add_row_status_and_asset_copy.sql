-- 20260905000003_complete_add_row_status_and_asset_copy.sql
-- Completes add-row failure messages and asset-step translations.
-- Bridges row creation and article asset labels with the shared language registry.
-- Exists so error and asset states stay multilingual without AI-generated fallback copy.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'failed_to_load',
            'Lataus epäonnistui',
            'Failed to load',
            '加载失败',
            '載入失敗',
            'Fallback error shown when an add-row form cannot load its metadata.'
        ),
        (
            'failed_to_save',
            'Tallennus epäonnistui',
            'Failed to save',
            '保存失败',
            '儲存失敗',
            'Fallback error shown when a new row cannot be saved.'
        ),
        (
            'row_article_section_images',
            'Kuvat',
            'Images',
            '图片',
            '圖片',
            'Title for image asset sections in row creation and article views.'
        ),
        (
            'row_article_section_attachments',
            'Liitteet',
            'Attachments',
            '附件',
            '附件',
            'Title for attachment asset sections in row creation and article views.'
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
    WHERE lang_key IN (
        'failed_to_load',
        'failed_to_save',
        'row_article_section_images',
        'row_article_section_attachments'
    )
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
       'Add-row failure messages and asset-section titles.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'failed_to_load',
    'failed_to_save',
    'row_article_section_images',
    'row_article_section_attachments'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
