-- 20261015000003_seed_dataset_default_view_language_keys.sql
-- Seeds the administrator filterbar default-view label, checkbox and failure message.
-- Connects upgrades and fresh bootstrap to the same multilingual interface keys.
-- Preserves authored translations and changes no route or group permissions.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

WITH copy(lang_key, fi, en, ch, tw, yue) AS (VALUES
    ('dataset_default_view_for', 'Oletusnäkymä aineistolle', 'Default view for', '数据集默认视图', '資料集預設視圖', '資料集預設檢視'),
    ('dataset_default_view_saved', 'Oletusnäkymä', 'Default', '默认', '預設', '預設'),
    ('dataset_default_view_error', 'Oletusnäkymää ei voitu tallentaa. Yritä uudelleen.', 'The default view could not be saved. Try again.', '无法保存默认视图。请重试。', '無法儲存預設視圖。請重試。', '未能儲存預設檢視。請再試。')
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Dataset default view control, WL162.' FROM copy
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL OR NULLIF(btrim(existing.yue), '') IS NULL
    RETURNING id, lang_key, fi, en, ch, yue
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue FROM public.system_lang_keys k JOIN copy USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s JOIN copy USING (lang_key)
CROSS JOIN LATERAL (VALUES
    ('fi', s.fi), ('en', s.en), ('ch', s.ch), ('yue', s.yue),
    ('zh-CN', s.ch), ('zh-TW', copy.tw), ('zh-HK', s.yue)
) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

