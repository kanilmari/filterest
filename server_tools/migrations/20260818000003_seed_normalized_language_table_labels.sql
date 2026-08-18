-- 20260818000003_seed_normalized_language_table_labels.sql
-- Seeds the two static database-tree labels introduced by the normalized language model.
-- Bridges legacy columns and all five canonical locale rows without invoking runtime AI fallback.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'system_languages',
            'Kielet',
            'Languages',
            '语言',
            '語言',
            'Static database-tree label for the canonical UI-language registry; authored for every supported locale so normal navigation never requests an AI translation.'
        ),
        (
            'system_lang_key_translations',
            'Kieliavainten käännökset',
            'Language key translations',
            '语言键翻译',
            '語言鍵翻譯',
            'Static database-tree label for normalized UI language-key translations; authored for every supported locale so normal navigation never requests an AI translation.'
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
        (
            'system_languages',
            'Kielet',
            'Languages',
            '语言',
            '語言',
            'Static database-tree label for the canonical UI-language registry; authored for every supported locale so normal navigation never requests an AI translation.'
        ),
        (
            'system_lang_key_translations',
            'Kieliavainten käännökset',
            'Language key translations',
            '语言键翻译',
            '語言鍵翻譯',
            'Static database-tree label for normalized UI language-key translations; authored for every supported locale so normal navigation never requests an AI translation.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT
    authored.lang_key,
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
        ('system_languages', 'en', 'Languages', 'approved'),
        ('system_languages', 'fi', 'Kielet', 'approved'),
        ('system_languages', 'zh-CN', '语言', 'needs_review'),
        ('system_languages', 'zh-TW', '語言', 'needs_review'),
        ('system_languages', 'zh-HK', '語言', 'needs_review'),
        ('system_lang_key_translations', 'en', 'Language key translations', 'approved'),
        ('system_lang_key_translations', 'fi', 'Kieliavainten käännökset', 'approved'),
        ('system_lang_key_translations', 'zh-CN', '语言键翻译', 'needs_review'),
        ('system_lang_key_translations', 'zh-TW', '語言鍵翻譯', 'needs_review'),
        ('system_lang_key_translations', 'zh-HK', '語言鍵翻譯', 'needs_review')
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
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
        ('system_languages', 'en', 'Languages', 'approved'),
        ('system_languages', 'fi', 'Kielet', 'approved'),
        ('system_languages', 'zh-CN', '语言', 'needs_review'),
        ('system_languages', 'zh-TW', '語言', 'needs_review'),
        ('system_languages', 'zh-HK', '語言', 'needs_review'),
        ('system_lang_key_translations', 'en', 'Language key translations', 'approved'),
        ('system_lang_key_translations', 'fi', 'Kieliavainten käännökset', 'approved'),
        ('system_lang_key_translations', 'zh-CN', '语言键翻译', 'needs_review'),
        ('system_lang_key_translations', 'zh-TW', '語言鍵翻譯', 'needs_review'),
        ('system_lang_key_translations', 'zh-HK', '語言鍵翻譯', 'needs_review')
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
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
SELECT
    resolved.lang_key_id,
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
