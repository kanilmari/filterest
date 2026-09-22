-- 20260922000006_seed_dataset_creation_warning_language_key.sql
-- Seeds the warning the dataset form shows when a dataset was created but one of
-- its later settings, such as its symbol, could not be saved.
-- Bridges the creation mode of the dataset form with the language keys of the
-- installation.
-- Exists because that warning reused the wording of the editing dialog, which
-- speaks of saved columns; the copy came after 20260922000005 was applied to the
-- development database, so it is seeded here rather than there.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same row.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- Add the missing keys, fill only empty columns, and mirror the served
-- Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Dataset form, creation mode (dataset_form_translation_fallbacks.js).
        ('dataset_created_settings_need_attention',
         'Aineisto luotiin, mutta yksi sen asetuksista jäi tallentamatta – katso lomakkeen viesti. Voit tallentaa asetuksen aineiston hallinnasta.',
         'The dataset was created, but one of its settings was not saved — see the message in the form. You can save it in the dataset''s Manage table dialog.',
         '数据集已创建，但其中一项设置未能保存——请查看表单中的提示。您可以在数据集的管理窗口中保存该设置。',
         '資料集已經建立，但其中一項設定儲存唔到——請睇表單入面嘅訊息。你可以喺資料集嘅管理視窗儲存呢項設定。',
         'Dataset form, creation mode: warning after a dataset was created but one of its later settings (such as its symbol) could not be saved.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
