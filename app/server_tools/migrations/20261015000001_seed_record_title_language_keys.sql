-- 20261015000001_seed_record_title_language_keys.sql
-- Seeds generated record names and the new-dataset automatic role choice.
-- Connects all card/article renderers and creation to existing UI dictionaries.
-- Preserves authored translations on upgrades and in fresh bootstrap.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

WITH copy(lang_key, fi, en, ch, yue) AS (VALUES
    ('record_title_with_id', 'Tietue {id}', 'Record {id}', '记录 {id}', '記錄 {id}'),
    ('record_title_without_id', 'Tietue', 'Record', '记录', '記錄'),
    ('card_role_automatic', 'Automaattinen', 'Automatic', '自动', '自動')
)
INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, 'Record titles and creation defaults, ticket 962'
FROM copy
ON CONFLICT (lang_key) DO UPDATE SET
    fi = COALESCE(NULLIF(existing.fi, ''), EXCLUDED.fi),
    en = COALESCE(NULLIF(existing.en, ''), EXCLUDED.en),
    ch = COALESCE(NULLIF(existing.ch, ''), EXCLUDED.ch),
    yue = COALESCE(NULLIF(existing.yue, ''), EXCLUDED.yue);

INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
CROSS JOIN LATERAL (VALUES
    ('fi', keys.fi), ('en', keys.en), ('ch', keys.ch), ('yue', keys.yue),
    ('zh-CN', keys.ch), ('zh-TW', CASE keys.lang_key
        WHEN 'record_title_with_id' THEN '記錄 {id}' WHEN 'record_title_without_id' THEN '記錄' ELSE '自動' END),
    ('zh-HK', keys.yue)
) copy(language_code, translation)
JOIN public.system_languages languages ON languages.language_code = copy.language_code
WHERE keys.lang_key IN ('record_title_with_id', 'record_title_without_id', 'card_role_automatic')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation
WHERE NULLIF(btrim(existing.translation), '') IS NULL;
