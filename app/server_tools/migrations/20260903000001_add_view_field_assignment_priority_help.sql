-- 20260903000001_add_view_field_assignment_priority_help.sql
-- Adds complete localized help for group-priority precedence in the view-field editor.
-- Bridges the administrator info disclosure with deterministic runtime resolution rules.
-- Exists so overlapping group assignments can be configured without guessing direction or scope.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'view_field_assignments_priority_help_label',
            'Selitä ryhmäprioriteetti',
            'Explain group priority',
            '说明组优先级',
            '說明群組優先次序',
            'Accessible label for the group-priority help disclosure.'
        ),
        (
            'view_field_assignments_priority_help',
            'Suurempi numero voittaa, kun käyttäjä kuuluu useaan ryhmään, joilla on eri kenttäkohdistukset. Käyttäjän oma valinta ohittaa silti kaikki ryhmät, ja ryhmäkohtainen kohdistus ohittaa koko sivuston oletuksen. Jos ryhmäprioriteetit ovat samat, pienemmän numerotunnisteen ryhmä voittaa aina samalla tavalla. Käytä tavallisesti arvoa 0 ja muuta sitä vain, kun ryhmäjäsenyydet menevät tarkoituksella päällekkäin.',
            'A larger number wins when a user belongs to several groups with different field assignments. A personal choice still wins over every group, and every group wins over the site default. If group priorities are equal, the group with the smaller numeric ID wins deterministically. Keep 0 for ordinary assignments and change it only when group memberships overlap intentionally.',
            '当用户属于多个且字段分配不同的组时，较大的数字优先。用户个人选择仍优先于所有组，任何组分配都优先于站点默认值。若组优先级相同，则数字 ID 较小的组以确定方式胜出。普通分配请保留 0，仅在组成员关系有意重叠时更改。',
            '當用戶屬於多個而且欄位分配唔同嘅群組時，較大數字優先。用戶個人選擇仍然優先過所有群組，而任何群組分配都優先過全站預設。如果群組優先次序相同，數字 ID 較細嘅群組會穩定勝出。一般分配請保留 0，只喺群組成員關係有意重疊時先更改。',
            'Long-form explanation of view-field assignment precedence.'
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
        'view_field_assignments_priority_help_label',
        'view_field_assignments_priority_help'
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
       'Administrator view-field assignment priority help.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'view_field_assignments_priority_help_label',
    'view_field_assignments_priority_help'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
