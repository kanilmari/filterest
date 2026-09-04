-- 20260903000002_refine_mixed_view_field_assignment_copy.sql
-- Explains the preserving tri-state behavior of mixed group field assignments.
-- Bridges indeterminate checkboxes with their transactional per-group save semantics.
-- Exists so administrators know that a dash means leave each group's value unchanged.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'view_field_assignments_mixed_warning',
            'Valituilla ryhmillä on eri kohdistukset. Viiva säilyttää kentän nykyisen arvon kullakin ryhmällä; valittu tai tyhjä asettaa yhden arvon kaikille valituille ryhmille.',
            'The selected groups use different assignments. A dash keeps that field''s current value for each group; checked or empty applies one value to every selected group.',
            '所选组使用不同的分配。横线会为每个组保留该字段的当前值；选中或清空会对所有所选组应用同一值。',
            '所選群組使用唔同分配。橫線會為每個群組保留該欄位而家嘅值；剔選或清空就會向所有所選群組套用同一個值。',
            'Warning and behavior explanation for mixed group field assignments.'
        ),
        (
            'view_field_assignments_mixed_confirm',
            'Tallennetaanko yhteiset muutokset ja säilytetäänkö viivalla näkyvien kenttien nykyiset ryhmäkohtaiset arvot?',
            'Save the shared changes while preserving each group''s current value for fields that still show a dash?',
            '是否保存共享更改，并保留仍显示横线的字段在各组中的当前值？',
            '要唔要儲存共用變更，同時保留仍然顯示橫線嘅欄位喺各群組而家嘅值？',
            'Confirmation for transactional mixed group field assignment saves.'
        ),
        (
            'view_field_assignments_select_field',
            'Jätä jokaiselle valitulle ryhmälle vähintään yksi näkyvä kenttä ennen tallennusta.',
            'Keep at least one visible field for every selected group before saving.',
            '保存前，请为每个所选组保留至少一个可见字段。',
            '儲存之前，請為每個所選群組保留至少一個顯示欄位。',
            'Fail-closed validation message for group field variants.'
        ),
        (
            'view_field_assignments_mixed_value',
            'Eri arvot',
            'Different values',
            '不同的值',
            '唔同值',
            'Placeholder for a group setting whose selected targets have different values.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en, ch, yue
    FROM public.system_lang_keys
    WHERE lang_key IN (
        'view_field_assignments_mixed_warning',
        'view_field_assignments_mixed_confirm',
        'view_field_assignments_select_field',
        'view_field_assignments_mixed_value'
    )
), authored_translations AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation,
           translations.review_status
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES
            ('fi', selected.fi, 'approved'),
            ('en', selected.en, 'approved'),
            ('zh-CN', selected.ch, 'needs_review'),
            ('zh-TW', selected.yue, 'needs_review'),
            ('zh-HK', selected.yue, 'needs_review')
    ) AS translations(language_code, translation, review_status)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', review_status
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
       'frontend/core_components/admin_tools/view_field_assignments_view.js',
       '',
       'Administrator mixed group field assignment controls.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'view_field_assignments_mixed_warning',
    'view_field_assignments_mixed_confirm',
    'view_field_assignments_select_field',
    'view_field_assignments_mixed_value'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
