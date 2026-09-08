-- Supplies reviewed web-image picker copy for existing and fresh installations.
-- Connects the picker URL, clipboard help and original-page link to the language catalog.
-- Preserves nonempty site-authored copy while seeding missing Finnish and English text.
-- Shared by the incremental migration and the independent public bootstrap.

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('image_source_picker_help', 'Liitä Unsplash-, Pexels- tai Pixabay-kuvasivun osoite. Kuva ja sen lähdetieto tallennetaan vain tälle uudelle riville.', 'Paste an Unsplash, Pexels, or Pixabay photo-page URL. The image and its credit will be saved only with this new row.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_source_url', 'Kuvasivun osoite', 'Image page URL', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('see_original_page', 'Katso alkuperäinen sivu', 'See original page', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('paste_and_preview', 'Liitä ja esikatsele', 'Paste & preview', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_help', 'Voit liittää osoitteen suoraan kenttään. Selain voi pyytää erillisen Liitä-vahvistuksen, kun käytät painiketta.', 'You can paste the URL directly into the field. Your browser may ask for a separate Paste confirmation when using the button.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_unavailable', 'Leikepöytää ei voitu lukea. Liitä kuvasivun osoite kenttään ja valitse Esikatsele.', 'The clipboard could not be read. Paste the photo-page URL into the field and choose Preview.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_empty', 'Leikepöydällä ei ole osoitetta. Kopioi kuvasivun osoite tai kirjoita se kenttään.', 'The clipboard is empty. Copy a photo-page URL or enter it in the field.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_source_url_invalid', 'Anna kokonainen HTTPS-kuvasivun osoite.', 'Enter a complete HTTPS photo-page URL.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_preview_failed', 'Kuvan esikatselu epäonnistui. Tarkista kuvasivun osoite ja yritä uudelleen.', 'The image preview failed. Check the photo-page URL and try again.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_provider_unsupported', 'Tätä kuvapalvelua ei tueta. Käytä yllä mainittua kuvapalvelua.', 'This image provider is not supported. Use one of the providers listed above.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_provider_unavailable', 'Kuvapalvelu ei ole juuri nyt käytettävissä. Voit yrittää myöhemmin uudelleen.', 'The image provider is not available right now. Please try again later.', 'Web-image picker URL, clipboard action, or preview feedback.')
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
        'image_source_picker_help',
        'image_source_url',
        'see_original_page',
        'paste_and_preview',
        'image_clipboard_help',
        'image_clipboard_unavailable',
        'image_clipboard_empty',
        'image_source_url_invalid',
        'image_preview_failed',
        'image_provider_unsupported',
        'image_provider_unavailable'
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
       'frontend/reusable_components/image_source_picker/image_source_picker.js', '',
       keys.creation_spec, CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'image_source_picker_help',
    'image_source_url',
    'see_original_page',
    'paste_and_preview',
    'image_clipboard_help',
    'image_clipboard_unavailable',
    'image_clipboard_empty',
    'image_source_url_invalid',
    'image_preview_failed',
    'image_provider_unsupported',
    'image_provider_unavailable'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
