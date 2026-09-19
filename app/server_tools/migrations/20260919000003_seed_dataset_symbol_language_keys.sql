-- 20260919000003_seed_dataset_symbol_language_keys.sql
-- Adds the interface copy for choosing a dataset's symbol in the dataset forms.
-- Bridges the shared symbol control with the installation's own language keys.
-- Exists so the control reads from language keys instead of hardcoded copy.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

INSERT INTO public.system_lang_keys (lang_key, creation_spec)
VALUES
    ('dataset_symbol_label', 'Dataset form: label of the dataset symbol control.'),
    ('dataset_symbol_none', 'Dataset form: option that leaves the dataset without a symbol.'),
    ('dataset_symbol_loading', 'Dataset form: status while the symbol registry is being read.'),
    ('dataset_symbol_unavailable', 'Dataset form: the symbol registry could not be read.'),
    ('dataset_symbol_save_failed', 'Dataset form: saving the chosen symbol failed.')
ON CONFLICT (lang_key) DO UPDATE
SET creation_spec = EXCLUDED.creation_spec,
    updated = now();

INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, authored.language_code, authored.translation, 'manual', 'approved'
FROM public.system_lang_keys AS keys
JOIN (
    VALUES
        ('dataset_symbol_label', 'fi', 'Symboli'),
        ('dataset_symbol_label', 'en', 'Symbol'),
        ('dataset_symbol_none', 'fi', 'Ei symbolia'),
        ('dataset_symbol_none', 'en', 'No symbol'),
        ('dataset_symbol_loading', 'fi', 'Luetaan symboleja…'),
        ('dataset_symbol_loading', 'en', 'Reading the symbols…'),
        ('dataset_symbol_unavailable', 'fi', 'Symboleja ei voitu lukea.'),
        ('dataset_symbol_unavailable', 'en', 'The symbols could not be read.'),
        ('dataset_symbol_save_failed', 'fi', 'Symbolin tallennus epäonnistui.'),
        ('dataset_symbol_save_failed', 'en', 'The symbol could not be saved.')
) AS authored(lang_key, language_code, translation)
  ON authored.lang_key = keys.lang_key
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();
