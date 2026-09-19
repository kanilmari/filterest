-- 20260919000004_serve_authored_seed_translations.sql
-- Copies authored interface copy into the columns the interface actually reads.
-- Bridges the normalized system_lang_key_translations rows that a seed migration
-- writes with the fi and en columns on system_lang_keys that serve those languages.
-- Exists because two seed migrations wrote only the normalized table, so reviewed
-- Finnish and English never reached a screen and the AI translator was asked for
-- copy that had already been authored.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

-- Only an empty column is filled, so a site's own translation always wins and
-- running this again changes nothing.
UPDATE public.system_lang_keys AS keys
SET fi = authored.translation,
    updated = now()
FROM public.system_lang_key_translations AS authored
WHERE authored.lang_key_id = keys.id
  AND authored.language_code = 'fi'
  AND authored.review_status = 'approved'
  AND btrim(authored.translation) <> ''
  AND (keys.fi IS NULL OR btrim(keys.fi) = '');

UPDATE public.system_lang_keys AS keys
SET en = authored.translation,
    updated = now()
FROM public.system_lang_key_translations AS authored
WHERE authored.lang_key_id = keys.id
  AND authored.language_code = 'en'
  AND authored.review_status = 'approved'
  AND btrim(authored.translation) <> ''
  AND (keys.en IS NULL OR btrim(keys.en) = '');
