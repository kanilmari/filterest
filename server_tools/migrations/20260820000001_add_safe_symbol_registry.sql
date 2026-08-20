-- 20260820000001_add_safe_symbol_registry.sql
-- Registers the administrator symbol-assignment API and safe dataset key constraint.
-- Bridges filesystem SVG allowlisting with dataset and field metadata permissions.
-- Exists so database rows retain only validated symbol keys instead of SVG or paths.
-- VERSION_DB: 9.2.2

UPDATE public.system_db_tables
SET icon_key = NULL
WHERE icon_key IS NOT NULL
  AND (
      btrim(icon_key) = ''
      OR icon_key <> btrim(icon_key)
      OR icon_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
  );

UPDATE public.system_column_details
SET card_detail_icon_key = NULL
WHERE card_detail_icon_key IS NOT NULL
  AND (
      btrim(card_detail_icon_key) = ''
      OR card_detail_icon_key <> btrim(card_detail_icon_key)
      OR card_detail_icon_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
  );

ALTER TABLE public.system_db_tables
    DROP CONSTRAINT IF EXISTS system_db_tables_icon_key_chk;

ALTER TABLE public.system_db_tables
    ADD CONSTRAINT system_db_tables_icon_key_chk CHECK (
        icon_key IS NULL
        OR icon_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    );

ALTER TABLE public.system_column_details
    DROP CONSTRAINT IF EXISTS system_column_details_card_detail_icon_key_chk;

ALTER TABLE public.system_column_details
    ADD CONSTRAINT system_column_details_card_detail_icon_key_chk CHECK (
        card_detail_icon_key IS NULL
        OR card_detail_icon_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    );

COMMENT ON COLUMN public.system_db_tables.icon_key IS
    'Optional safe key resolved through the filesystem SVG symbol registry. Raw SVG and paths are not accepted.';

COMMENT ON COLUMN public.system_column_details.card_detail_icon_key IS
    'Optional safe key resolved through the filesystem SVG symbol registry. Raw SVG remains legacy read compatibility only.';

WITH desired_function (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES (
        'symbol_registry.AdminHandler',
        'symbol_registry',
        FALSE,
        '/api/admin/symbols'
    )
), missing_function AS (
    SELECT desired.*
    FROM desired_function AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
)
INSERT INTO public.system_functions (
    name,
    disabled,
    created,
    updated,
    package,
    specific_table_related,
    creation_spec,
    rate_limit_amount,
    rate_limit_minutes,
    url_route_endpoint,
    ui_only
)
SELECT
    missing.name,
    FALSE,
    now(),
    now(),
    missing.package,
    missing.specific_table_related,
    'Filterest DB 9.2.2 safe symbol registry',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_function AS missing;

UPDATE public.system_functions
SET disabled = FALSE,
    updated = now(),
    package = 'symbol_registry',
    specific_table_related = FALSE,
    creation_spec = 'Filterest DB 9.2.2 safe symbol registry',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = '/api/admin/symbols',
    ui_only = FALSE
WHERE name = 'symbol_registry.AdminHandler';

INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    creation_spec,
    target_table_uid
)
SELECT
    groups.id,
    functions.id,
    'public',
    'Filterest DB 9.2.2 safe symbol registry',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'symbol_registry.AdminHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DELETE FROM public.system_group_table_func_rights AS rights
USING public.system_functions AS functions
WHERE functions.id = rights.function_id
  AND functions.name = 'symbol_registry.AdminHandler'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    ('symbols', 'Symbolit', 'Symbols', '符号', '符號', 'Administrator filesystem symbol registry.'),
    ('symbols_description', 'Liitä tarkistettuja SVG-tiedostoja dataset-välilehtiin ja korttikenttiin. Tietokantaan tallennetaan vain symboliavain.', 'Assign reviewed SVG files to dataset tabs and card fields. The database stores only the symbol key.', '将已审核的 SVG 文件分配给数据集标签和卡片字段。数据库只存储符号键。', '將已審核嘅 SVG 檔案分配畀資料集分頁同卡片欄位。資料庫只儲存符號鍵。', 'Description for the safe symbol registry.'),
    ('symbol_target_type', 'Kohteen tyyppi', 'Target type', '目标类型', '目標類型', 'Target selector label in the Symbols tool.'),
    ('symbol_target_dataset', 'Datasetti', 'Dataset', '数据集', '資料集', 'Dataset target option in the Symbols tool.'),
    ('symbol_target_field', 'Kenttä', 'Field', '字段', '欄位', 'Field target option in the Symbols tool.'),
    ('current_symbol', 'Nykyinen symboli', 'Current symbol', '当前符号', '目前符號', 'Current assignment label in the Symbols tool.'),
    ('symbol_library', 'Symbolikirjasto', 'Symbol library', '符号库', '符號庫', 'Filesystem registry heading in the Symbols tool.'),
    ('save_symbol_assignment', 'Tallenna symboli', 'Save symbol', '保存符号', '儲存符號', 'Save action in the Symbols tool.'),
    ('clear_symbol_assignment', 'Poista symbolivalinta', 'Clear symbol', '清除符号', '清除符號', 'Clear action in the Symbols tool.')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT
    keys.id,
    'javascript',
    'frontend/core_components/admin_tools/symbol_registry_view.js',
    '',
    'Renders the administrator-only safe symbol registry and assignment tool.',
    CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'symbols', 'symbols_description', 'symbol_target_type', 'symbol_target_dataset',
    'symbol_target_field', 'current_symbol', 'symbol_library',
    'save_symbol_assignment', 'clear_symbol_assignment'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.system_db_version (version, description)
SELECT '9.2.2', 'Added safe filesystem SVG symbol registry and administrator assignment tool'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.2.2'
);
