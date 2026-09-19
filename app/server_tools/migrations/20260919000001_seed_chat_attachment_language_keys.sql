-- 20260919000001_seed_chat_attachment_language_keys.sql
-- Adds the interface copy for attaching images to a dataset chat question.
-- Bridges the chat composer's attach control with the installation's language keys.
-- Exists so the control reads from language keys instead of hardcoded copy.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('chat_attach_image', 'Liitä kuva', 'Attach an image',
         'Dataset chat: button that attaches an image to the question.'),
        ('chat_attach_remove', 'Poista tämä kuva', 'Remove this image',
         'Dataset chat: button that removes one attached image before sending.'),
        ('chat_attach_too_many', 'Kerrallaan voi liittää enintään neljä kuvaa.',
         'Only four images can be attached at a time.',
         'Dataset chat: the attachment limit has been reached.'),
        ('chat_attach_rejected', 'Tiedosto ei ole kuva, jota avustaja voi lukea.',
         'That file is not an image this assistant can read.',
         'Dataset chat: the chosen file is not a supported image.'),
        ('chat_attach_failed', 'Kuvan liittäminen epäonnistui.', 'The image could not be attached.',
         'Dataset chat: the upload of an attached image failed.'),
        ('chat_attach_uploading', 'Liitetään…', 'Attaching…',
         'Dataset chat: status while an attached image is being uploaded.')
),
inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, creation_spec)
    SELECT lang_key, creation_spec FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET creation_spec = EXCLUDED.creation_spec,
        updated = now()
    RETURNING id, lang_key
),
authored_translations AS (
    SELECT inserted_keys.id AS lang_key_id, translations.language_code, translations.translation
    FROM inserted_keys
    JOIN authored_keys AS selected ON selected.lang_key = inserted_keys.lang_key
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/ai_features/table_chat',
       'table_chat_attachments.js',
       'Dataset chat: attaching images to a question for the site assistant.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key LIKE 'chat_attach_%'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
