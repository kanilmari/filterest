-- 20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql
-- Seeds interface copy that until now existed only as frontend fallback text.
-- Bridges the failed-request notices of the global fetch monitor and the dataset
-- form (its column table and folder hint) with the language keys of the installation.
-- Exists because the notices were hardcoded Finnish, two column headings had no
-- runtime row, and the folder hint still held wording made from the name of its key.
-- A nonempty translation is never overwritten; only that exact unreviewed
-- wording gives way. Running the file again changes nothing. The public
-- bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- 1. Wording generated from the name of a key before its copy was written was
--    never reviewed. Where a site still holds exactly that wording, it counts
--    as missing copy: it is withdrawn here and filled in step 2 like any empty
--    value. Any other text, a reviewed translation included, stays as it is.
WITH superseded_placeholders(lang_key, fi, en) AS (
    VALUES
        ('table_folder_hint', 'Taulukon kansion vihje', 'Table folder hint')
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_placeholders AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    updated = now()
FROM superseded_placeholders AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en);

-- 2. Add the missing keys, fill only empty columns, and mirror the served
--    Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('server_error_notice',
         'Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen.',
         'The service ran into an error. Please try again in a moment.',
         '服务出现错误。请稍后再试。',
         '服務出咗錯。請稍後再試。',
         'Failed-request notice: the service answered with a server error (5xx). The status code follows in parentheses.'),
        ('network_error_notice',
         'Palveluun ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.',
         'The service could not be reached. Check your connection and try again.',
         '无法连接到服务。请检查网络连接后重试。',
         '連唔到服務。請檢查網絡連線再試。',
         'Failed-request notice: the request never reached the service, for example because the connection was lost.'),
        ('dataset_column_type_parameters',
         'Pituus / tarkkuus',
         'Length / precision',
         '长度 / 精度',
         '長度 / 精度',
         'Dataset form: heading of the column table''s length or precision column.'),
        ('actions',
         'Toiminnot',
         'Actions',
         '操作',
         '操作',
         'Heading of a column holding row or item actions, for example in the dataset form''s column table.'),
        ('table_folder_hint',
         'Valitse olemassa oleva kansio tai luo uusi. Oletuskansio on database / other_tables.',
         'Choose an existing folder or create one. The default folder is database / other_tables.',
         '选择现有文件夹或创建新文件夹。默认文件夹为 database / other_tables。',
         '選擇現有資料夾或建立新資料夾。預設資料夾係 database / other_tables。',
         'Dataset form: hint under the folder selector of a new dataset.')
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
