-- 20260908000003_add_column_label_value_layout.sql
-- Adds an optional shared field label/value arrangement without changing existing rows.
-- Connects column metadata to the validated editor and card/article pair renderers.
-- Keeps missing defaults inherited and independent from field placement or visibility.
-- VERSION_DB: 9.7.6

ALTER TABLE public.system_column_details
    ADD COLUMN IF NOT EXISTS label_value_layout varchar(16);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.system_column_details'::regclass
          AND conname = 'system_column_details_label_value_layout_check'
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT system_column_details_label_value_layout_check
            CHECK (label_value_layout IS NULL OR label_value_layout IN ('auto', 'inline', 'stacked'));
    END IF;
END $$;

COMMENT ON COLUMN public.system_column_details.label_value_layout IS
    'Optional shared field label/value layout: null preserves existing view behavior; auto, inline or stacked affects presentation only.';

-- BEGIN label/value layout language seed (shared with fresh bootstrap).
WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
    ('label_value_layout', 'Kentän otsikon ja arvon asettelu', 'Field label and value layout', 'Names the shared column label/value default, separately from field placement.'),
    ('label_value_layout_inherit', 'Nykyinen oletus', 'Current default', 'Restores each renderer''s existing behavior without an explicit column layout.'),
    ('label_value_layout_auto', 'Automaattinen', 'Automatic', 'Lets the configured field pair wrap according to text and available space.'),
    ('label_value_layout_inline', 'Rinnakkain', 'Side by side', 'Keeps the label and value in adjacent areas while allowing text to wrap.'),
    ('label_value_layout_stacked', 'Allekkain', 'Stacked', 'Places the field value below its label.'),
    ('label_value_layout_help', 'Otsikon ja arvon asettelu on sarakkeen yhteinen oletus korttien ja artikkelien tietokentille. Se ei muuta kentän paikkaa tai näkyvyyttä. Nykyinen oletus säilyttää näkymän aiemman toiminnan.', 'Label and value layout is the shared column default for card and article detail fields. It does not change field placement or visibility. Current default preserves the previous behavior of each view.', 'Explains the shared default and the unchanged placement, visibility and inherited behavior.'),
    ('label_value_layout_readback_failed', 'Asetuksen tallennusta ei voitu varmistaa. Lataa asetukset uudelleen.', 'The saved setting could not be verified. Reload the settings.', 'Reports a mismatch when reading the saved field layout back through the API.')
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
WHERE keys.lang_key IN ('label_value_layout', 'label_value_layout_inherit', 'label_value_layout_auto', 'label_value_layout_inline', 'label_value_layout_stacked', 'label_value_layout_help', 'label_value_layout_readback_failed')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/core_components/admin_tools/card_visibility_view.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('label_value_layout', 'label_value_layout_inherit', 'label_value_layout_auto', 'label_value_layout_inline', 'label_value_layout_stacked', 'label_value_layout_help', 'label_value_layout_readback_failed')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- END label/value layout language seed.

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.6', 'Add optional shared column label/value layout'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.6');
