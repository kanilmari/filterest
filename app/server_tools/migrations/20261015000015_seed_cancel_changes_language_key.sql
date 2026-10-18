-- 20261015000015_seed_cancel_changes_language_key.sql
-- Seeds explicit labels for actions that discard unsaved form changes.
-- Connects upgraded and fresh installs to the reviewed form Cancel actions.
-- Preserves authored site copy in both translation stores on repeat runs.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('cancel_changes', 'Peruuta muutokset', 'Cancel changes')
), resolved AS (
    SELECT copy.lang_key,
        COALESCE(CASE WHEN NULLIF(btrim(keys.fi), '') IS NOT NULL THEN keys.fi END,
            CASE WHEN NULLIF(btrim(fi.translation), '') IS NOT NULL THEN fi.translation END, copy.fi) AS fi,
        COALESCE(CASE WHEN NULLIF(btrim(keys.en), '') IS NOT NULL THEN keys.en END,
            CASE WHEN NULLIF(btrim(en.translation), '') IS NOT NULL THEN en.translation END, copy.en) AS en
    FROM authored_keys copy
    LEFT JOIN public.system_lang_keys keys USING (lang_key)
    LEFT JOIN public.system_lang_key_translations fi ON fi.lang_key_id = keys.id AND fi.language_code = 'fi'
    LEFT JOIN public.system_lang_key_translations en ON en.lang_key_id = keys.id AND en.language_code = 'en'
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL169 J8 (#873, K403): explicit discard of unsaved form edits; plain close and abort keep cancel.' FROM resolved
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en FROM public.system_lang_keys k JOIN authored_keys USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s
CROSS JOIN LATERAL (VALUES ('fi', s.fi), ('en', s.en)) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

-- Register one file source per changed frontend consumer, preserving site context on replay.
INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT keys.id, 'code', source.path, '', source.explanation, CURRENT_DATE
FROM public.system_lang_keys keys
CROSS JOIN (VALUES
    ('frontend/core_components/admin_tools/asset_linking/asset_linking_view.js', 'Discard the selected dataset and typed file-size limit in the new asset-link form.'),
    ('frontend/core_components/admin_tools/card_visibility_view.js', 'Reset unsaved field settings or discard the settings draft before changing datasets.'),
    ('frontend/core_components/admin_tools/field_view_editor.js', 'Close the global field editor and discard unsaved field visibility and order changes.'),
    ('frontend/core_components/admin_tools/foreign_keys_view.js', 'Discard the unsaved relation definition in the new foreign-key form.'),
    ('frontend/core_components/admin_tools/row_access_editor.js', 'Discard pending row-permission actions, principals and the typed reason.'),
    ('frontend/core_components/admin_tools/row_group_assignment_editor.js', 'Discard unsaved classification names, new values and row assignments.'),
    ('frontend/core_components/admin_tools/permission_editor.js', 'Reset either permission table or discard unsaved permissions before navigation.'),
    ('frontend/core_components/admin_tools/child_tab_config_view.js', 'Discard child-tab settings when leaving edit mode or changing the selected dataset.'),
    ('frontend/core_components/general_tables/gt_1_row_crud/gt_1_1_row_create/row_submission_handler.js', 'Clear the add-row draft and close its form without saving.'),
    ('frontend/core_components/general_tables/dataset_form/dataset_form.js', 'Close the dataset editor and discard its unsaved settings and column draft.'),
    ('frontend/core_components/general_tables/dataset_form/dataset_form_translation_fallbacks.js', 'Finnish and English fallback copy for discarding the dataset form draft.'),
    ('frontend/core_components/table_views/article_view/article_language_editor.js', 'Clear unsaved text in the article language-version editor.'),
    ('frontend/core_components/table_views/card_view/row_article_attachment_list.js', 'Restore the saved attachment title and description and close the editor.'),
    ('frontend/core_components/table_views/card_view/row_article_image_metadata_editor.js', 'Restore saved image title and description values in the open editor.'),
    ('frontend/core_components/table_views/card_view/row_article_opener.js', 'Cancel article editing and restore the original field values.'),
    ('frontend/core_components/vanilla_tree/van_tr_components/tree_node_rename_editor.js', 'Discard edited technical, Finnish and English names in the rename form.'),
    ('frontend/core_components/lang/dev_lang_key_editor.js', 'Close the translation editor and discard unsaved translations and context.')
) AS source(path, explanation)
WHERE keys.lang_key = 'cancel_changes'
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
