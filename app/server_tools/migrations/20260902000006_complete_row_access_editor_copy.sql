-- 20260902000006_complete_row_access_editor_copy.sql
-- Completes translated copy used by the row-access editor around the principal picker.
-- Bridges early DB 9.7.0 development installs with the complete localized modal.
-- Exists so grouped choices, state summaries, and failure messages never fall back to English.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('row_access_groups', 'Ryhmät', 'Groups', '组', '群組', 'Group principal option heading in the row-access editor.'),
        ('row_access_users', 'Käyttäjät', 'Users', '用户', '用戶', 'User principal option heading in the row-access editor.'),
        ('row_access_inherited', 'Peritty (ei suoraa sääntöä)', 'Inherited (no direct rule)', '继承（无直接规则）', '繼承（無直接規則）', 'Current state when selected rows have no direct rule for the principal.'),
        ('row_access_selected_rows', 'Valitut rivit: $count', 'Selected rows: $count', '已选行：$count', '已選列：$count', 'Selected-row count in the row-access editor.'),
        ('row_access_select_first', 'Valitse ensin vähintään yksi rivi.', 'Select at least one row first.', '请先选择至少一行。', '請先選擇至少一列。', 'Warning when the row-access editor has no stable selected rows.'),
        ('row_access_maximum_rows', 'Valitse enintään $count riviä kerrallaan.', 'Select at most $count rows at a time.', '一次最多选择 $count 行。', '每次最多選擇 $count 列。', 'Warning when the row-access editor exceeds its transactional row limit.'),
        ('row_access_no_principals', 'Sopivia käyttäjiä tai ryhmiä ei ole.', 'No eligible users or groups are available.', '没有可用的用户或组。', '沒有可用的用戶或群組。', 'Error when the row-access editor has no eligible principal.'),
        ('row_access_load_failed', 'Rivioikeuksia ei voitu ladata.', 'Row access rules could not be loaded.', '无法加载行权限规则。', '無法載入列權限規則。', 'Fail-closed row-access editor load error.'),
        ('row_access_save_failed', 'Rivioikeuksia ei voitu tallentaa.', 'Row permissions could not be updated.', '无法更新行权限。', '無法更新列權限。', 'Fail-closed row-access editor save error.')
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
