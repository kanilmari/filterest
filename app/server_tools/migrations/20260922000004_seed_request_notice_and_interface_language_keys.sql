-- 20260922000004_seed_request_notice_and_interface_language_keys.sql
-- Seeds the failed-request notices the API pipeline shows for 4xx, 429 and 503.
-- Bridges the notices of request_failure_notice.js with the language keys of the
-- installation, beside server_error_notice and network_error_notice (20260922000001).
-- Exists because the rate-limit notice was Finnish only, the maintenance notice
-- chose between hardcoded Finnish and English, and other refusals showed the
-- route name and the raw server text.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same rows. The other interface copy of this release follows in
-- 20260922000005.
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
        ('request_failed_notice',
         'Pyyntöä ei voitu suorittaa.',
         'The request could not be completed.',
         '无法完成请求。',
         '完成唔到呢個請求。',
         'Failed-request notice: the service refused or could not complete the request (4xx). The status code follows in parentheses.'),
        ('rate_limit_notice',
         'Pyyntöjä tuli liian monta. Odota hetki ja yritä uudelleen.',
         'Too many requests. Wait a moment and try again.',
         '请求过多。请稍等片刻后重试。',
         '請求太多。請等一陣再試。',
         'Failed-request notice: the service refused the request because too many were sent in a short time (429).'),
        ('service_unavailable_notice',
         'Palvelu on hetkellisesti huoltotilassa. Yritä pian uudelleen.',
         'The service is temporarily under maintenance. Please retry shortly.',
         '服务正在临时维护。请稍后重试。',
         '服務暫時維護緊。請稍後再試。',
         'Failed-request notice: the service is temporarily unavailable, for example during maintenance or an update (503).')
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
