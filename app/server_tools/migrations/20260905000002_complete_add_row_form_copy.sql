-- 20260905000002_complete_add_row_form_copy.sql
-- Completes the localized copy used by the add-row form and its shared multiselect.
-- Bridges existing UI fallback labels with the database-backed language registry.
-- Exists so opening the form never needs an AI translation request for known controls.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'details',
            'Tiedot',
            'Details',
            '详细信息',
            '詳細資料',
            'Add-row form step containing the new row''s own fields.'
        ),
        (
            'choose_from_existing',
            'Valitse olemassa olevista…',
            'Choose from existing…',
            '从现有项目中选择…',
            '從現有項目中選擇…',
            'Placeholder for selectors that link an existing related row.'
        ),
        (
            'selected',
            'valittu',
            'selected',
            '已选择',
            '已選擇',
            'Suffix shown after the number of selected multiselect options.'
        ),
        (
            'no_results',
            'Ei tuloksia',
            'No results',
            '无结果',
            '沒有結果',
            'Empty-state message in a searchable selector.'
        ),
        (
            'clear_selection',
            'Tyhjennä valinta',
            'Clear selection',
            '清除选择',
            '清除選擇',
            'Accessible action for clearing a selector.'
        ),
        (
            'pick_image_from_web',
            'Valitse kuva verkosta',
            'Pick image from web',
            '从网络选择图片',
            '從網絡選擇圖片',
            'Button opening the web image picker from an asset section.'
        ),
        (
            'add_sub_item',
            'Lisää kuva tai liite',
            'Add image or attachment',
            '添加图片或附件',
            '新增圖片或附件',
            'Action adding another asset item while creating a row.'
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
        'details',
        'choose_from_existing',
        'selected',
        'no_results',
        'clear_selection',
        'pick_image_from_web',
        'add_sub_item'
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
       'Shared controls and asset actions in the add-row modal.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'details',
    'choose_from_existing',
    'selected',
    'no_results',
    'clear_selection',
    'pick_image_from_web',
    'add_sub_item'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
