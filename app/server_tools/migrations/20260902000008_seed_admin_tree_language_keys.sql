-- 20260902000008_seed_admin_tree_language_keys.sql
-- Adds authored labels for public system datasets exposed in the administrator tree.
-- Bridges newly registered field, row-group, permission, and row-access tables with localization.
-- Exists so normal administrator navigation never depends on best-effort AI translation.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('common', 'Yhteiset', 'Common', '通用', '共用', 'Static database-tree folder label.'),
        ('system_column_field_sets', 'Kenttäkokoelmat', 'Field collections', '字段集合', '欄位集合', 'Static database-tree label for reusable field collections.'),
        ('system_column_field_set_members', 'Kenttäkokoelmien kentät', 'Field collection members', '字段集合成员', '欄位集合成員', 'Static database-tree label for ordered field collection members.'),
        ('system_view_field_set_assignments', 'Näkymien kenttäkokoelmat', 'View field assignments', '视图字段分配', '檢視欄位指派', 'Static database-tree label for view field assignments.'),
        ('system_row_groups', 'Riviryhmät', 'Row groups', '行组', '資料列群組', 'Static database-tree label for reusable row groups.'),
        ('system_row_group_memberships', 'Riviryhmien jäsenyydet', 'Row group memberships', '行组成员关系', '資料列群組成員關係', 'Static database-tree label for row group memberships.'),
        ('system_permission_actions', 'Käyttöoikeustoiminnot', 'Permission actions', '权限操作', '權限操作', 'Static database-tree label for permission actions.'),
        ('system_permission_categories', 'Käyttöoikeusluokat', 'Permission categories', '权限类别', '權限類別', 'Static database-tree label for permission categories.'),
        ('system_row_access_rules', 'Rivioikeussäännöt', 'Row access rules', '行访问规则', '資料列存取規則', 'Static database-tree label for row-access rules.'),
        ('system_row_access_rule_events', 'Rivioikeuksien muutosloki', 'Row access rule events', '行访问规则事件', '資料列存取規則事件', 'Static database-tree label for row-access audit events.')
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
        'common',
        'system_column_field_sets',
        'system_column_field_set_members',
        'system_view_field_set_assignments',
        'system_row_groups',
        'system_row_group_memberships',
        'system_permission_actions',
        'system_permission_categories',
        'system_row_access_rules',
        'system_row_access_rule_events'
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
       'schema',
       'system_db_tables',
       keys.lang_key,
       'Administrator database-tree label for a registered system dataset or folder.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'common',
    'system_column_field_sets',
    'system_column_field_set_members',
    'system_view_field_set_assignments',
    'system_row_groups',
    'system_row_group_memberships',
    'system_permission_actions',
    'system_permission_categories',
    'system_row_access_rules',
    'system_row_access_rule_events'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
