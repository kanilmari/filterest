-- 20260902000002_add_row_access_rules.sql
-- Adds normalized permission actions and exact-row allow/deny exceptions.
-- Bridges dataset permissions, user/group principals, generic reads, and bulk administration.
-- Exists so selected rows can receive auditable read/update/delete rules without view-specific ACL logic.
-- VERSION_DB: 9.7.0

CREATE TABLE IF NOT EXISTS public.system_permission_categories (
    id              BIGSERIAL PRIMARY KEY,
    category_key    VARCHAR(64)  NOT NULL UNIQUE,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_categories_key
        CHECK (category_key ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE IF NOT EXISTS public.system_permission_actions (
    id              BIGSERIAL PRIMARY KEY,
    category_id     BIGINT       NOT NULL REFERENCES public.system_permission_categories(id),
    action_key      VARCHAR(64)  NOT NULL UNIQUE,
    scope_type      VARCHAR(32)  NOT NULL,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_actions_key
        CHECK (action_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_system_permission_actions_scope
        CHECK (scope_type IN ('dataset', 'row', 'system'))
);

CREATE TABLE IF NOT EXISTS public.system_row_access_rules (
    id              BIGSERIAL PRIMARY KEY,
    table_uid       INTEGER      NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    row_id          BIGINT       NOT NULL,
    user_id         BIGINT       REFERENCES public.system_users(id) ON DELETE CASCADE,
    group_id        BIGINT       REFERENCES public.system_user_groups(id) ON DELETE CASCADE,
    action_id       BIGINT       NOT NULL REFERENCES public.system_permission_actions(id),
    effect          VARCHAR(16)  NOT NULL,
    reason          TEXT,
    valid_from      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    created_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    updated_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rules_row_id CHECK (row_id > 0),
    CONSTRAINT ck_system_row_access_rules_principal
        CHECK ((user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1),
    CONSTRAINT ck_system_row_access_rules_effect CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT ck_system_row_access_rules_validity
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT uq_system_row_access_rules_target
        UNIQUE NULLS NOT DISTINCT (table_uid, row_id, user_id, group_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_evaluation
    ON public.system_row_access_rules (table_uid, row_id, action_id, effect);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_user
    ON public.system_row_access_rules (user_id, table_uid, row_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_group
    ON public.system_row_access_rules (group_id, table_uid, row_id)
    WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.system_row_access_rule_events (
    id                  BIGSERIAL PRIMARY KEY,
    change_set_id       VARCHAR(36) NOT NULL,
    actor_user_id       BIGINT      REFERENCES public.system_users(id) ON DELETE SET NULL,
    table_uid           INTEGER     NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    principal_type      VARCHAR(16) NOT NULL,
    principal_id        BIGINT      NOT NULL,
    row_ids             BIGINT[]    NOT NULL,
    changes             JSONB       NOT NULL,
    reason              TEXT,
    affected_rule_count INTEGER     NOT NULL DEFAULT 0,
    created             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rule_events_change_set
        CHECK (change_set_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT ck_system_row_access_rule_events_principal
        CHECK (principal_type IN ('user', 'group') AND principal_id > 0),
    CONSTRAINT ck_system_row_access_rule_events_rows
        CHECK (cardinality(row_ids) BETWEEN 1 AND 200),
    CONSTRAINT ck_system_row_access_rule_events_changes
        CHECK (jsonb_typeof(changes) = 'object'),
    CONSTRAINT ck_system_row_access_rule_events_count
        CHECK (affected_rule_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_target
    ON public.system_row_access_rule_events (table_uid, created DESC);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_actor
    ON public.system_row_access_rule_events (actor_user_id, created DESC);

CREATE OR REPLACE FUNCTION public.set_row_access_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    target_table REGCLASS;
    trigger_name TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'public.system_permission_categories'::regclass,
        'public.system_permission_actions'::regclass,
        'public.system_row_access_rules'::regclass
    ]
    LOOP
        trigger_name := 'update_' || replace(target_table::text, '.', '_') || '_timestamp';
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = trigger_name
              AND tgrelid = target_table
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp()',
                trigger_name,
                target_table
            );
        END IF;
    END LOOP;
END $$;

INSERT INTO public.system_config (
    key, boolean_value, text_value, value_type, creation_spec
)
VALUES (
    'postgresql_rls_backend_enabled',
    FALSE,
    'false',
    2,
    'Global readiness gate for future PostgreSQL RLS rollout. False never disables application-layer row authorization.'
)
ON CONFLICT (key) DO NOTHING;

WITH desired_categories(category_key, label_lang_key, sort_order) AS (
    VALUES
        ('content', 'permission_category_content', 10),
        ('distribution', 'permission_category_distribution', 20),
        ('workflow', 'permission_category_workflow', 30),
        ('administration', 'permission_category_administration', 40)
)
INSERT INTO public.system_permission_categories (
    category_key, label_lang_key, sort_order, enabled
)
SELECT category_key, label_lang_key, sort_order, TRUE
FROM desired_categories
ON CONFLICT (category_key) DO UPDATE
SET label_lang_key = EXCLUDED.label_lang_key,
    sort_order = EXCLUDED.sort_order,
    enabled = TRUE,
    updated = now();

WITH desired_actions(category_key, action_key, scope_type, label_lang_key, sort_order) AS (
    VALUES
        ('content', 'create', 'dataset', 'permission_action_create', 10),
        ('content', 'read', 'row', 'permission_action_read', 20),
        ('content', 'update', 'row', 'permission_action_update', 30),
        ('content', 'delete', 'row', 'permission_action_delete', 40),
        ('distribution', 'export', 'dataset', 'permission_action_export', 10),
        ('administration', 'manage_permissions', 'system', 'permission_action_manage_permissions', 10),
        ('administration', 'delegate', 'system', 'permission_action_delegate', 20)
)
INSERT INTO public.system_permission_actions (
    category_id, action_key, scope_type, label_lang_key, sort_order, enabled
)
SELECT categories.id,
       desired.action_key,
       desired.scope_type,
       desired.label_lang_key,
       desired.sort_order,
       TRUE
FROM desired_actions AS desired
JOIN public.system_permission_categories AS categories
  ON categories.category_key = desired.category_key
ON CONFLICT (action_key) DO UPDATE
SET category_id = EXCLUDED.category_id,
    scope_type = EXCLUDED.scope_type,
    label_lang_key = EXCLUDED.label_lang_key,
    sort_order = EXCLUDED.sort_order,
    enabled = TRUE,
    updated = now();

CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(
    target_table_name TEXT,
    target_row_id BIGINT,
    actor_user_id BIGINT,
    requested_action TEXT,
    broader_policy_allows BOOLEAN,
    actor_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN actor_is_admin THEN TRUE
        ELSE COALESCE((
            SELECT CASE
                WHEN bool_or(rules.effect = 'deny') THEN FALSE
                WHEN bool_or(rules.effect = 'allow') THEN TRUE
                ELSE NULL
            END
            FROM public.system_row_access_rules AS rules
            JOIN public.system_permission_actions AS actions
              ON actions.id = rules.action_id
             AND actions.enabled IS TRUE
             AND actions.scope_type = 'row'
            JOIN public.system_db_tables AS tables
              ON tables.table_uid = rules.table_uid
            WHERE tables.table_name = target_table_name
              AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
              AND rules.row_id = target_row_id
              AND actions.action_key = requested_action
              AND rules.valid_from <= now()
              AND (rules.valid_until IS NULL OR rules.valid_until > now())
              AND (
                  rules.user_id = actor_user_id
                  OR rules.group_id IN (
                      SELECT memberships.group_id
                      FROM public.system_user_group_memberships AS memberships
                      WHERE memberships.user_id = actor_user_id
                  )
              )
        ), COALESCE(broader_policy_allows, FALSE))
    END;
$$;

COMMENT ON TABLE public.system_permission_categories IS
    'Translatable UI grouping for normalized permission actions; categories never change enforcement semantics.';
COMMENT ON TABLE public.system_permission_actions IS
    'Stable permission-action registry. Existing-row editing uses only enabled actions whose scope_type is row.';
COMMENT ON TABLE public.system_row_access_rules IS
    'Exact-row user/group allow or deny exceptions layered over broader dataset and legacy row policies; deny wins.';
COMMENT ON TABLE public.system_row_access_rule_events IS
    'Append-only principal audit rows; every multi-principal transaction shares one change_set_id.';
COMMENT ON FUNCTION public.resolve_effective_row_access(TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN) IS
    'Resolves one row action: admin bypass, explicit deny, explicit allow, then the broader application policy. The RLS backend feature flag never bypasses this layer.';

WITH desired_function(name, route, creation_spec) AS (
    VALUES (
        'system_table_tools.AdminRowAccessRulesHandler',
        '/api/admin/row-access-rules',
        'Administrator-only exact-row access rule read and fail-closed bulk mutation API.'
    )
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT name, FALSE, now(), now(), 'system_table_tools', FALSE,
       creation_spec, 120, 20, route, FALSE
FROM desired_function
ON CONFLICT (name) DO UPDATE
SET disabled = FALSE,
    updated = now(),
    package = 'system_table_tools',
    specific_table_related = FALSE,
    creation_spec = EXCLUDED.creation_spec,
    rate_limit_amount = 120,
    rate_limit_minutes = 20,
    url_route_endpoint = EXCLUDED.url_route_endpoint,
    ui_only = FALSE;

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest DB 9.7.0 bulk row access administrator API',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'system_table_tools.AdminRowAccessRulesHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DO $$
DECLARE
    role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['admin_user', 'readeronly']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
                'GRANT SELECT ON TABLE public.system_permission_categories, public.system_permission_actions, public.system_row_access_rules, public.system_row_access_rule_events TO %I',
                role_name
            );
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT INSERT, UPDATE, DELETE ON TABLE public.system_row_access_rules TO admin_user;
        GRANT INSERT ON TABLE public.system_row_access_rule_events TO admin_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_row_access_rules_id_seq,
            public.system_row_access_rule_events_id_seq
        TO admin_user;
    END IF;
END $$;

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
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
        ('permission_action_delegate', 'Oikeuksien delegointi', 'Delegate permissions', '委派权限', '委派權限', 'Normalized system permission action.')
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

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.0', 'Added normalized permission actions and auditable exact-row user/group allow-deny rules.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.7.0'
);
