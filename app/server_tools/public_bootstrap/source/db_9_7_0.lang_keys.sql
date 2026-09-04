-- db_9_7_0.lang_keys.sql
-- Seeds complete localized copy for the DB 9.7.0 field and row-access administrator surfaces.
-- Bridges accepted UI controls, database-tree labels, normalized translations, and source evidence.
-- Exists so a fresh installation never depends on browser AI to explain security-sensitive choices.

WITH authored_keys(lang_key, fi, en, ch, yue, usage_explanation) AS (
    VALUES
        ('client_delivery_mode', 'Toimitus selaimelle', 'Client delivery', '客户端传送', '用戶端傳送', 'Column-level client projection mode in the administration editor.'),
        ('client_delivery_include', 'Lähetä selaimelle', 'Include in client data', '包含在客户端数据中', '包含喺用戶端資料', 'Client-delivery option that includes authorized field data.'),
        ('client_delivery_server_only', 'Vain palvelimelle', 'Server only', '仅限服务器', '只限伺服器', 'Client-delivery option that keeps technical field data on the backend.'),
        ('edit_row_permissions', 'Muokkaa rivioikeuksia', 'Edit row permissions', '编辑行权限', '編輯列權限', 'Selected-row action and modal title for exact-row access rules.'),
        ('row_access_principal', 'Käyttäjät tai ryhmät', 'Users or groups', '用户或组', '用戶或群組', 'Principal multiselect label in the row-access editor.'),
        ('row_access_user', 'Käyttäjä', 'User', '用户', '用戶', 'User principal type in the row-access editor.'),
        ('row_access_group', 'Ryhmä', 'Group', '组', '群組', 'Group principal type in the row-access editor.'),
        ('row_access_groups', 'Ryhmät', 'Groups', '组', '群組', 'Group principal option heading in the row-access editor.'),
        ('row_access_users', 'Käyttäjät', 'Users', '用户', '用戶', 'User principal option heading in the row-access editor.'),
        ('row_access_choose_principals', 'Valitse käyttäjiä tai ryhmiä…', 'Select users or groups…', '选择用户或组…', '選擇用戶或群組…', 'Placeholder for the row-access principal multiselect.'),
        ('row_access_search_principals', 'Hae nimellä, käyttäjänimellä tai ID:llä…', 'Search by name, username, or ID…', '按姓名、用户名或 ID 搜索…', '按姓名、用戶名稱或 ID 搜尋…', 'Search placeholder for the row-access principal multiselect.'),
        ('row_access_no_matching_principals', 'Ei vastaavia käyttäjiä tai ryhmiä', 'No matching users or groups', '没有匹配的用户或组', '沒有符合的用戶或群組', 'Empty search result in the row-access principal multiselect.'),
        ('row_access_clear_principals', 'Tyhjennä valitut käyttäjät ja ryhmät', 'Clear selected users and groups', '清除所选用户和组', '清除所選用戶和群組', 'Accessible clear action for the row-access principal multiselect.'),
        ('row_access_principals_selected', 'käyttäjää tai ryhmää valittu', 'users or groups selected', '个用户或组已选择', '個用戶或群組已選擇', 'Selected principal count suffix in the row-access editor.'),
        ('row_access_select_principals', 'Valitse vähintään yksi käyttäjä tai ryhmä.', 'Select at least one user or group.', '请至少选择一个用户或组。', '請至少選擇一個用戶或群組。', 'Prompt shown before row-access actions can be edited.'),
        ('row_access_maximum_principals', 'Valitse enintään $count käyttäjää tai ryhmää kerrallaan.', 'Select at most $count users or groups at a time.', '一次最多选择 $count 个用户或组。', '每次最多選擇 $count 個用戶或群組。', 'Principal-count limit for one row-access transaction.'),
        ('row_access_maximum_assignments', 'Pienennä valinta enintään $count rivi–käyttöoikeuskohteeseen.', 'Reduce the selection to at most $count row-and-principal targets.', '请将选择减少到最多 $count 个行与权限主体组合。', '請將選擇減少到最多 $count 個列與權限主體組合。', 'Cartesian row and principal limit for one transaction.'),
        ('row_access_no_change', 'Ei muutosta', 'No change', '不更改', '不變更', 'Bulk row-access action state that leaves existing direct rules unchanged.'),
        ('row_access_allow', 'Salli', 'Allow', '允许', '允許', 'Explicit allow effect in the row-access editor.'),
        ('row_access_deny', 'Estä', 'Deny', '拒绝', '拒絕', 'Explicit deny effect in the row-access editor.'),
        ('row_access_remove_direct', 'Poista suora sääntö', 'Remove direct rule', '移除直接规则', '移除直接規則', 'Bulk row-access action state that restores inherited behavior.'),
        ('row_access_inherited', 'Peritty (ei suoraa sääntöä)', 'Inherited (no direct rule)', '继承（无直接规则）', '繼承（無直接規則）', 'Current state when selected rows have no direct rule for the principal.'),
        ('row_access_mixed', 'Useita nykytiloja', 'Mixed current states', '多种当前状态', '多種目前狀態', 'Summary for selected rows whose direct rule states differ.'),
        ('row_access_read', 'Luku', 'Read', '读取', '讀取', 'Read action label in the row-access editor.'),
        ('row_access_update', 'Muokkaus', 'Update', '更新', '更新', 'Update action label in the row-access editor.'),
        ('row_access_delete', 'Poisto', 'Delete', '删除', '刪除', 'Delete action label in the row-access editor.'),
        ('row_access_reason', 'Muutoksen perustelu', 'Reason for change', '更改原因', '變更原因', 'Optional audit reason in the row-access editor.'),
        ('row_access_selected_rows', 'Valitut rivit: $count', 'Selected rows: $count', '已选行：$count', '已選列：$count', 'Selected-row count in the row-access editor.'),
        ('row_access_select_first', 'Valitse ensin vähintään yksi rivi.', 'Select at least one row first.', '请先选择至少一行。', '請先選擇至少一列。', 'Warning when the row-access editor has no stable selected rows.'),
        ('row_access_maximum_rows', 'Valitse enintään $count riviä kerrallaan.', 'Select at most $count rows at a time.', '一次最多选择 $count 行。', '每次最多選擇 $count 列。', 'Warning when the row-access editor exceeds its transactional row limit.'),
        ('row_access_no_principals', 'Sopivia käyttäjiä tai ryhmiä ei ole.', 'No eligible users or groups are available.', '没有可用的用户或组。', '沒有可用的用戶或群組。', 'Error when the row-access editor has no eligible principal.'),
        ('row_access_load_failed', 'Rivioikeuksia ei voitu ladata.', 'Row access rules could not be loaded.', '无法加载行权限规则。', '無法載入列權限規則。', 'Fail-closed row-access editor load error.'),
        ('row_access_save_failed', 'Rivioikeuksia ei voitu tallentaa.', 'Row permissions could not be updated.', '无法更新行权限。', '無法更新列權限。', 'Fail-closed row-access editor save error.'),
        ('row_access_invalid_response', 'Rivioikeusvastaus oli puutteellinen. Mitään ei muutettu.', 'The row access response was incomplete. Nothing was changed.', '行权限响应不完整。未进行任何更改。', '列權限回應不完整。未進行任何變更。', 'Fail-closed notice for incomplete or mismatched row-access readback.'),
        ('save_row_permissions', 'Tallenna rivioikeudet', 'Save row permissions', '保存行权限', '儲存列權限', 'Submit label in the row-access editor.'),
        ('row_permissions_updated', 'Rivioikeudet päivitettiin', 'Row permissions updated', '行权限已更新', '列權限已更新', 'Success notice after a bulk row-access transaction.'),
        ('permission_category_content', 'Sisältö', 'Content', '内容', '內容', 'Permission category title.'),
        ('permission_category_distribution', 'Jakelu', 'Distribution', '分发', '發佈', 'Permission category title.'),
        ('permission_category_workflow', 'Työnkulku', 'Workflow', '工作流', '工作流程', 'Permission category title.'),
        ('permission_category_administration', 'Hallinta', 'Administration', '管理', '管理', 'Permission category title.'),
        ('permission_action_create', 'Luonti', 'Create', '创建', '建立', 'Normalized dataset-scope permission action.'),
        ('permission_action_read', 'Luku', 'Read', '读取', '讀取', 'Normalized row-scope permission action.'),
        ('permission_action_update', 'Muokkaus', 'Update', '更新', '更新', 'Normalized row-scope permission action.'),
        ('permission_action_delete', 'Poisto', 'Delete', '删除', '刪除', 'Normalized row-scope permission action.'),
        ('permission_action_export', 'Vienti', 'Export', '导出', '匯出', 'Normalized distribution permission action.'),
        ('permission_action_manage_permissions', 'Oikeuksien hallinta', 'Manage permissions', '管理权限', '管理權限', 'Normalized system permission action.'),
        ('permission_action_delegate', 'Oikeuksien delegointi', 'Delegate permissions', '委派权限', '委派權限', 'Normalized system permission action.'),
        ('field_set_source_group', 'Ryhmäkohtainen oletus on käytössä', 'Group default in use', '正在使用组默认设置', '正在使用群組預設設定', 'Effective view-field source label.'),
        ('view_field_assignments', 'Näkymien kenttäkohdistukset', 'View field assignments', '视图字段分配', '檢視欄位分配', 'Administrator tool title and navigation label.'),
        ('view_field_assignments_description', 'Valitse datasetti ja näkymä, ja määritä sitten yhteinen kenttäjärjestys koko sivustolle tai valituille käyttäjäryhmille.', 'Choose a dataset and view, then set the shared field order for the site or selected user groups.', '选择数据集和视图，然后为整个站点或所选用户组设置共享字段顺序。', '揀選資料集同檢視，然後為全站或所選用戶群組設定共用欄位次序。', 'Administrator tool description.'),
        ('view_field_assignments_instructions', 'Valitse datasetti puurakenteesta ladataksesi sen näkymäkentät.', 'Select a dataset from the tree to load its view fields.', '从树中选择数据集以加载其视图字段。', '請喺樹狀清單揀選資料集，以載入檢視欄位。', 'Initial administrator tool instructions.'),
        ('view_field_assignments_view', 'Näkymä', 'View', '视图', '檢視', 'View selector label.'),
        ('view_field_assignments_groups', 'Käyttäjäryhmät', 'User groups', '用户组', '用戶群組', 'Group selector label.'),
        ('view_field_assignments_group_placeholder', 'Valitse käyttäjäryhmät', 'Select user groups', '选择用户组', '揀選用戶群組', 'Group multiselect placeholder.'),
        ('view_field_assignments_group_search', 'Etsi käyttäjäryhmiä', 'Search user groups', '搜索用户组', '搜尋用戶群組', 'Group multiselect search placeholder.'),
        ('view_field_assignments_select_group', 'Valitse vähintään yksi käyttäjäryhmä ennen tallennusta tai perinnän palautusta.', 'Select at least one user group before saving or restoring inheritance.', '保存或恢复继承前，请至少选择一个用户组。', '儲存或還原繼承之前，請至少揀一個用戶群組。', 'Empty target warning.'),
        ('view_field_assignments_select_field', 'Jätä jokaiselle valitulle ryhmälle vähintään yksi näkyvä kenttä ennen tallennusta.', 'Keep at least one visible field for every selected group before saving.', '保存前，请为每个所选组保留至少一个可见字段。', '儲存之前，請為每個所選群組保留至少一個顯示欄位。', 'Fail-closed validation message for group field variants.'),
        ('view_field_assignments_target_site', 'Koskee koko sivustoa', 'Applies to the whole site', '应用于整个站点', '套用到全站', 'Site-default target summary.'),
        ('view_field_assignments_target_groups', 'Koskee vain valittuja ryhmiä', 'Applies only to the selected groups', '仅应用于所选组', '只套用到所選群組', 'Explicit group target summary.'),
        ('view_field_assignments_name', 'Kenttäjoukon nimi', 'Field collection name', '字段集合名称', '欄位集合名稱', 'Shared field-set name label.'),
        ('view_field_assignments_priority', 'Ryhmäprioriteetti', 'Group priority', '组优先级', '群組優先次序', 'Group precedence label.'),
        ('view_field_assignments_priority_help_label', 'Selitä ryhmäprioriteetti', 'Explain group priority', '说明组优先级', '說明群組優先次序', 'Accessible label for the group-priority help disclosure.'),
        ('view_field_assignments_priority_help', 'Suurempi numero voittaa, kun käyttäjä kuuluu useaan ryhmään, joilla on eri kenttäkohdistukset. Käyttäjän oma valinta ohittaa silti kaikki ryhmät, ja ryhmäkohtainen kohdistus ohittaa koko sivuston oletuksen. Jos ryhmäprioriteetit ovat samat, pienemmän numerotunnisteen ryhmä voittaa aina samalla tavalla. Käytä tavallisesti arvoa 0 ja muuta sitä vain, kun ryhmäjäsenyydet menevät tarkoituksella päällekkäin.', 'A larger number wins when a user belongs to several groups with different field assignments. A personal choice still wins over every group, and every group wins over the site default. If group priorities are equal, the group with the smaller numeric ID wins deterministically. Keep 0 for ordinary assignments and change it only when group memberships overlap intentionally.', '当用户属于多个且字段分配不同的组时，较大的数字优先。用户个人选择仍优先于所有组，任何组分配都优先于站点默认值。若组优先级相同，则数字 ID 较小的组以确定方式胜出。普通分配请保留 0，仅在组成员关系有意重叠时更改。', '當用戶屬於多個而且欄位分配唔同嘅群組時，較大數字優先。用戶個人選擇仍然優先過所有群組，而任何群組分配都優先過全站預設。如果群組優先次序相同，數字 ID 較細嘅群組會穩定勝出。一般分配請保留 0，只喺群組成員關係有意重疊時先更改。', 'Long-form explanation of view-field assignment precedence.'),
        ('view_field_assignments_fields', 'Kentät', 'Fields', '字段', '欄位', 'Field list heading.'),
        ('view_field_assignments_search_fields', 'Etsi kenttiä', 'Search fields', '搜索字段', '搜尋欄位', 'Field search placeholder.'),
        ('view_field_assignments_visible', 'Näkyvissä', 'Visible', '可见', '顯示', 'Per-field visibility label.'),
        ('view_field_assignments_drag', 'Vedä järjestääksesi', 'Drag to reorder', '拖动排序', '拖動排序', 'Field drag-handle tooltip.'),
        ('view_field_assignments_move_up', 'Siirrä ylös', 'Move up', '上移', '上移', 'Field move-up accessible label.'),
        ('view_field_assignments_move_down', 'Siirrä alas', 'Move down', '下移', '下移', 'Field move-down accessible label.'),
        ('view_field_assignments_mixed_warning', 'Valituilla ryhmillä on eri kohdistukset. Viiva säilyttää kentän nykyisen arvon kullakin ryhmällä; valittu tai tyhjä asettaa yhden arvon kaikille valituille ryhmille.', 'The selected groups use different assignments. A dash keeps that field''s current value for each group; checked or empty applies one value to every selected group.', '所选组使用不同的分配。横线会为每个组保留该字段的当前值；选中或清空会对所有所选组应用同一值。', '所選群組使用唔同分配。橫線會為每個群組保留該欄位而家嘅值；剔選或清空就會向所有所選群組套用同一個值。', 'Warning and behavior explanation for mixed group field assignments.'),
        ('view_field_assignments_mixed_confirm', 'Tallennetaanko yhteiset muutokset ja säilytetäänkö viivalla näkyvien kenttien nykyiset ryhmäkohtaiset arvot?', 'Save the shared changes while preserving each group''s current value for fields that still show a dash?', '是否保存共享更改，并保留仍显示横线的字段在各组中的当前值？', '要唔要儲存共用變更，同時保留仍然顯示橫線嘅欄位喺各群組而家嘅值？', 'Confirmation for transactional mixed group field assignment saves.'),
        ('view_field_assignments_mixed_value', 'Eri arvot', 'Different values', '不同的值', '唔同值', 'Placeholder for a group setting whose selected targets have different values.'),
        ('view_field_assignments_save', 'Tallenna kohdistus', 'Save assignment', '保存分配', '儲存分配', 'Save action label.'),
        ('view_field_assignments_restore', 'Palauta perintä', 'Restore inheritance', '恢复继承', '還原繼承', 'Restore inherited assignment action.'),
        ('view_field_assignments_restore_confirm', 'Poistetaanko valittu kohdistus ja palautetaanko perityt kentät?', 'Remove the selected assignment and restore inherited fields?', '移除所选分配并恢复继承字段？', '移除所選分配並還原繼承欄位？', 'Restore inherited assignment confirmation.'),
        ('view_field_assignments_loading', 'Ladataan kenttäkohdistuksia…', 'Loading field assignments…', '正在加载字段分配…', '載入緊欄位分配…', 'Loading status.'),
        ('view_field_assignments_load_error', 'Kenttäkohdistuksia ei voitu ladata. Mitään ei muutettu.', 'Field assignments could not be loaded. Nothing was changed.', '无法加载字段分配。未进行任何更改。', '未能載入欄位分配。冇作出任何更改。', 'Fail-closed load error.'),
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
SELECT lang_key,
       fi,
       en,
       ch,
       yue,
       'Filterest DB 9.7.0 public bootstrap: ' || usage_explanation
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
    WHERE creation_spec LIKE 'Filterest DB 9.7.0 public bootstrap:%'
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

WITH selected_keys AS (
    SELECT id,
           lang_key,
           regexp_replace(
               creation_spec,
               '^Filterest DB 9\.7\.0 public bootstrap: ',
               ''
           ) AS usage_explanation
    FROM public.system_lang_keys
    WHERE creation_spec LIKE 'Filterest DB 9.7.0 public bootstrap:%'
)
INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT id,
       CASE
           WHEN lang_key = 'common' OR lang_key LIKE 'system\_%' ESCAPE '\' THEN 'schema'
           ELSE 'code'
       END,
       CASE
           WHEN lang_key = 'common' OR lang_key LIKE 'system\_%' ESCAPE '\'
               THEN 'system_db_tables'
           WHEN lang_key LIKE 'client_delivery\_%' ESCAPE '\'
               OR lang_key = 'client_delivery_mode'
               THEN 'frontend/core_components/admin_tools/card_visibility_view.js'
           WHEN lang_key = 'field_set_source_group'
               THEN 'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js'
           WHEN lang_key = 'view_field_assignments'
               OR lang_key LIKE 'view_field_assignments\_%' ESCAPE '\'
               THEN 'frontend/core_components/admin_tools/view_field_assignments_view.js'
           ELSE 'frontend/core_components/admin_tools/row_access_editor.js'
       END,
       CASE
           WHEN lang_key = 'common' OR lang_key LIKE 'system\_%' ESCAPE '\' THEN lang_key
           ELSE ''
       END,
       usage_explanation,
       CURRENT_DATE
FROM selected_keys
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
