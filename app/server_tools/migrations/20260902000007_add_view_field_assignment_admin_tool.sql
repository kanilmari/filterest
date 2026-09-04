-- 20260902000007_add_view_field_assignment_admin_tool.sql
-- Registers the group/view field assignment administration surface and reset API.
-- Bridges the DB 9.7.0 field-set model with permission-gated multilingual UI copy.
-- Exists so administrators can manage exact shared targets without direct SQL.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH desired_functions(name, route, package_name, ui_only, creation_spec) AS (
    VALUES
        (
            'system_table_tools.ResetSharedViewFieldSetHandler',
            '/api/admin/view-field-sets/shared/reset',
            'system_table_tools',
            FALSE,
            'Administrator-only reset for exact site or group view-field assignments.'
        ),
        (
            'ui.admin.view_field_assignments',
            '/ui/admin/view_field_assignments',
            'frontend',
            TRUE,
            'Administrator navigation permission for group and site view-field assignments.'
        )
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT name, FALSE, now(), now(), package_name, FALSE,
       creation_spec, 200, 20, route, ui_only
FROM desired_functions
ON CONFLICT (name) DO UPDATE
SET disabled = FALSE,
    updated = now(),
    package = EXCLUDED.package,
    specific_table_related = FALSE,
    creation_spec = EXCLUDED.creation_spec,
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = EXCLUDED.url_route_endpoint,
    ui_only = EXCLUDED.ui_only;

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest DB 9.7.0 view-field assignment administration',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.ResetSharedViewFieldSetHandler',
      'ui.admin.view_field_assignments'
  )
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('field_set_source_group', 'Ryhmäkohtainen oletus on käytössä', 'Group default in use', '正在使用组默认设置', '正在使用群組預設設定', 'Effective view-field source label.'),
        ('view_field_assignments', 'Näkymien kenttäkohdistukset', 'View field assignments', '视图字段分配', '檢視欄位分配', 'Administrator tool title and navigation label.'),
        ('view_field_assignments_description', 'Valitse datasetti ja näkymä, ja määritä sitten yhteinen kenttäjärjestys koko sivustolle tai valituille käyttäjäryhmille.', 'Choose a dataset and view, then set the shared field order for the site or selected user groups.', '选择数据集和视图，然后为整个站点或所选用户组设置共享字段顺序。', '揀選資料集同檢視，然後為全站或所選用戶群組設定共用欄位次序。', 'Administrator tool description.'),
        ('view_field_assignments_instructions', 'Valitse datasetti puurakenteesta ladataksesi sen näkymäkentät.', 'Select a dataset from the tree to load its view fields.', '从树中选择数据集以加载其视图字段。', '請喺樹狀清單揀選資料集，以載入檢視欄位。', 'Initial administrator tool instructions.'),
        ('view_field_assignments_view', 'Näkymä', 'View', '视图', '檢視', 'View selector label.'),
        ('view_field_assignments_groups', 'Käyttäjäryhmät', 'User groups', '用户组', '用戶群組', 'Group selector label.'),
        ('view_field_assignments_group_placeholder', 'Valitse käyttäjäryhmät', 'Select user groups', '选择用户组', '揀選用戶群組', 'Group multiselect placeholder.'),
        ('view_field_assignments_group_search', 'Etsi käyttäjäryhmiä', 'Search user groups', '搜索用户组', '搜尋用戶群組', 'Group multiselect search placeholder.'),
        ('view_field_assignments_select_group', 'Valitse vähintään yksi käyttäjäryhmä ennen tallennusta tai perinnän palautusta.', 'Select at least one user group before saving or restoring inheritance.', '保存或恢复继承前，请至少选择一个用户组。', '儲存或還原繼承之前，請至少揀一個用戶群組。', 'Empty target warning.'),
        ('view_field_assignments_select_field', 'Valitse vähintään yksi näkyvä kenttä ennen tallennusta.', 'Select at least one visible field before saving.', '保存前请至少选择一个可见字段。', '儲存之前，請至少揀一個顯示欄位。', 'Empty visible-field warning.'),
        ('view_field_assignments_target_site', 'Koskee koko sivustoa', 'Applies to the whole site', '应用于整个站点', '套用到全站', 'Site-default target summary.'),
        ('view_field_assignments_target_groups', 'Koskee vain valittuja ryhmiä', 'Applies only to the selected groups', '仅应用于所选组', '只套用到所選群組', 'Explicit group target summary.'),
        ('view_field_assignments_name', 'Kenttäjoukon nimi', 'Field collection name', '字段集合名称', '欄位集合名稱', 'Shared field-set name label.'),
        ('view_field_assignments_priority', 'Ryhmäprioriteetti', 'Group priority', '组优先级', '群組優先次序', 'Group precedence label.'),
        ('view_field_assignments_fields', 'Kentät', 'Fields', '字段', '欄位', 'Field list heading.'),
        ('view_field_assignments_search_fields', 'Etsi kenttiä', 'Search fields', '搜索字段', '搜尋欄位', 'Field search placeholder.'),
        ('view_field_assignments_visible', 'Näkyvissä', 'Visible', '可见', '顯示', 'Per-field visibility label.'),
        ('view_field_assignments_drag', 'Vedä järjestääksesi', 'Drag to reorder', '拖动排序', '拖動排序', 'Field drag-handle tooltip.'),
        ('view_field_assignments_move_up', 'Siirrä ylös', 'Move up', '上移', '上移', 'Field move-up accessible label.'),
        ('view_field_assignments_move_down', 'Siirrä alas', 'Move down', '下移', '下移', 'Field move-down accessible label.'),
        ('view_field_assignments_mixed_warning', 'Valituilla ryhmillä on nyt eri kohdistukset. Tallennus korvaa ne yhdellä yhteisellä kohdistuksella.', 'The selected groups currently use different assignments. Saving will replace them with one shared assignment.', '所选组当前使用不同的分配。保存会用一个共享分配替换它们。', '所選群組目前使用唔同分配。儲存會用一個共用分配取代佢哋。', 'Mixed group assignment warning.'),
        ('view_field_assignments_mixed_confirm', 'Valituilla ryhmillä on eri kenttäkohdistukset. Korvataanko ne tällä yhdellä yhteisellä kohdistuksella?', 'The selected groups use different field assignments. Replace them with this one shared assignment?', '所选组使用不同的字段分配。是否用此共享分配替换？', '所選群組使用唔同欄位分配。要唔要用呢個共用分配取代？', 'Mixed group assignment confirmation.'),
        ('view_field_assignments_save', 'Tallenna kohdistus', 'Save assignment', '保存分配', '儲存分配', 'Save action label.'),
        ('view_field_assignments_restore', 'Palauta perintä', 'Restore inheritance', '恢复继承', '還原繼承', 'Restore inherited assignment action.'),
        ('view_field_assignments_restore_confirm', 'Poistetaanko valittu kohdistus ja palautetaanko perityt kentät?', 'Remove the selected assignment and restore inherited fields?', '移除所选分配并恢复继承字段？', '移除所選分配並還原繼承欄位？', 'Restore inherited assignment confirmation.'),
        ('view_field_assignments_loading', 'Ladataan kenttäkohdistuksia…', 'Loading field assignments…', '正在加载字段分配…', '載入緊欄位分配…', 'Loading status.'),
        ('view_field_assignments_load_error', 'Kenttäkohdistuksia ei voitu ladata. Mitään ei muutettu.', 'Field assignments could not be loaded. Nothing was changed.', '无法加载字段分配。未进行任何更改。', '未能載入欄位分配。冇作出任何更改。', 'Fail-closed load error.')
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
    SELECT id, lang_key, fi, en, ch, yue
    FROM public.system_lang_keys
    WHERE lang_key = 'field_set_source_group'
       OR lang_key = 'view_field_assignments'
       OR lang_key LIKE 'view_field_assignments\_%' ESCAPE '\'
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
       CASE
           WHEN keys.lang_key = 'field_set_source_group'
               THEN 'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js'
           ELSE 'frontend/core_components/admin_tools/view_field_assignments_view.js'
       END,
       '',
       'Administrator view-field assignment user interface.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key = 'field_set_source_group'
   OR keys.lang_key = 'view_field_assignments'
   OR keys.lang_key LIKE 'view_field_assignments\_%' ESCAPE '\'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
