-- 20260902000005_add_row_access_principal_picker_copy.sql
-- Adds translated copy for the searchable multi-principal row-access picker.
-- Bridges early DB 9.7.0 development installs with the final editor behavior.
-- Exists so all supported languages explain grouped search and transactional limits.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('row_access_principal', 'Käyttäjät tai ryhmät', 'Users or groups', '用户或组', '用戶或群組', 'Principal multiselect label in the row-access editor.'),
        ('row_access_choose_principals', 'Valitse käyttäjiä tai ryhmiä…', 'Select users or groups…', '选择用户或组…', '選擇用戶或群組…', 'Placeholder for the row-access principal multiselect.'),
        ('row_access_search_principals', 'Hae nimellä, käyttäjänimellä tai ID:llä…', 'Search by name, username, or ID…', '按姓名、用户名或 ID 搜索…', '按姓名、用戶名稱或 ID 搜尋…', 'Search placeholder for the row-access principal multiselect.'),
        ('row_access_no_matching_principals', 'Ei vastaavia käyttäjiä tai ryhmiä', 'No matching users or groups', '没有匹配的用户或组', '沒有符合的用戶或群組', 'Empty search result in the row-access principal multiselect.'),
        ('row_access_clear_principals', 'Tyhjennä valitut käyttäjät ja ryhmät', 'Clear selected users and groups', '清除所选用户和组', '清除所選用戶和群組', 'Accessible clear action for the row-access principal multiselect.'),
        ('row_access_principals_selected', 'käyttäjää tai ryhmää valittu', 'users or groups selected', '个用户或组已选择', '個用戶或群組已選擇', 'Selected principal count suffix in the row-access editor.'),
        ('row_access_select_principals', 'Valitse vähintään yksi käyttäjä tai ryhmä.', 'Select at least one user or group.', '请至少选择一个用户或组。', '請至少選擇一個用戶或群組。', 'Prompt shown before row-access actions can be edited.'),
        ('row_access_maximum_principals', 'Valitse enintään $count käyttäjää tai ryhmää kerrallaan.', 'Select at most $count users or groups at a time.', '一次最多选择 $count 个用户或组。', '每次最多選擇 $count 個用戶或群組。', 'Principal-count limit for one row-access transaction.'),
        ('row_access_maximum_assignments', 'Pienennä valinta enintään $count rivi–käyttöoikeuskohteeseen.', 'Reduce the selection to at most $count row-and-principal targets.', '请将选择减少到最多 $count 个行与权限主体组合。', '請將選擇減少到最多 $count 個列與權限主體組合。', 'Cartesian row and principal limit for one transaction.')
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

COMMENT ON TABLE public.system_row_access_rule_events IS
    'Append-only principal audit rows; every multi-principal transaction shares one change_set_id.';
