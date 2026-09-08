-- media_library.lang_keys.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.


WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
    ('media_library_choose', 'Käytä olemassa olevaa kuvaa', 'Use an existing image', 'Existing-image reuse: choose.'),
    ('media_library_close', 'Sulje kuvalista', 'Close image list', 'Existing-image reuse: close.'),
    ('media_library_clear', 'Poista valinta', 'Clear selection', 'Existing-image reuse: clear.'),
    ('media_library_next', 'Lisää kuvia', 'More images', 'Existing-image reuse: next.'),
    ('media_library_loading', 'Ladataan kuvia…', 'Loading images…', 'Existing-image reuse: loading.'),
    ('media_library_scope', 'Valitse saman aineiston kuva. Kuva ja sen nykyiset kuvatekstit liitetään, kun tallennat rivin.', 'Choose an image from this dataset. Its current captions are copied when you save the row.', 'Existing-image reuse: scope.'),
    ('media_library_unavailable', 'Kuvaa ei voi käyttää uudelleen näillä oikeuksilla.', 'This image cannot be reused with these permissions.', 'Existing-image reuse: unavailable.'),
    ('media_library_empty', 'Uudelleenkäytettäviä kuvia ei löytynyt.', 'No reusable images were found.', 'Existing-image reuse: empty.'),
    ('media_library_selected', 'Valittu kuva', 'Selected image', 'Existing-image reuse: selected.')
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

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/reusable_components/media_library_picker/media_library_picker.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
