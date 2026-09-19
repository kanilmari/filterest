-- 20260919000002_repair_chat_attachment_translations.sql
-- Writes the chat attachment copy that the previous migration left untranslated.
-- Bridges the authored Finnish and English text with the language-key tables.
-- Exists because only one of the six keys received its translations, leaving the
-- attach control to fall back to built-in English and to ask the AI translator
-- for copy that was already authored.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, authored.language_code, authored.translation, 'manual', 'approved'
FROM public.system_lang_keys AS keys
JOIN (
    VALUES
        ('chat_attach_image', 'fi', 'Liitä kuva'),
        ('chat_attach_image', 'en', 'Attach an image'),
        ('chat_attach_remove', 'fi', 'Poista tämä kuva'),
        ('chat_attach_remove', 'en', 'Remove this image'),
        ('chat_attach_too_many', 'fi', 'Kerrallaan voi liittää enintään neljä kuvaa.'),
        ('chat_attach_too_many', 'en', 'Only four images can be attached at a time.'),
        ('chat_attach_rejected', 'fi', 'Tiedosto ei ole kuva, jota avustaja voi lukea.'),
        ('chat_attach_rejected', 'en', 'That file is not an image this assistant can read.'),
        ('chat_attach_failed', 'fi', 'Kuvan liittäminen epäonnistui.'),
        ('chat_attach_failed', 'en', 'The image could not be attached.'),
        ('chat_attach_uploading', 'fi', 'Liitetään…'),
        ('chat_attach_uploading', 'en', 'Attaching…')
) AS authored(lang_key, language_code, translation)
  ON authored.lang_key = keys.lang_key
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();
