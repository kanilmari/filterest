-- article_editor.lang_keys.sql
-- Supplies reviewed copy for one multilingual article content field.
-- Connects existing sites and the fresh public bootstrap to the same editor labels.
-- Preserves all nonempty site-authored translations and review metadata.

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('article_edit_languages', 'Muokkaa kieliversioita', 'Edit language versions', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_field', 'Kenttä', 'Field', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_help', 'Muokkaa yhtä kenttää eri kielillä. Voit säätää tekstialueen korkeutta alareunasta vetämällä. Muiden kielten tekstit säilyvät.', 'Edit one field across languages. Drag the lower edge of a text area to resize it. Other languages are preserved.', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_save_failed', 'Tallennus epäonnistui. Muutoksesi ovat yhä tässä; yritä uudelleen tai peru.', 'Saving failed. Your changes are still here; retry or cancel.', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_load_failed', 'Kenttää ei voitu ladata. Yritä uudelleen.', 'The field could not be loaded. Try again.', 'One-field multilingual article editor with preserved drafts and translations.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

WITH selected_keys AS (
    SELECT id, fi, en FROM public.system_lang_keys
    WHERE lang_key IN (
        'article_edit_languages',
        'article_language_field',
        'article_language_help',
        'article_language_save_failed',
        'article_language_load_failed'
    )
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM selected_keys AS keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id, 'code',
       'frontend/core_components/table_views/article_view/article_language_editor.js', '',
       keys.creation_spec, CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
        'article_edit_languages',
        'article_language_field',
        'article_language_help',
        'article_language_save_failed',
        'article_language_load_failed'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
