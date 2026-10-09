-- Generated dummy seed data for the testing fixture bundle.
-- The rows below are harmless placeholders, not production data.

INSERT INTO public.system_user_groups (id, name, created, updated, creation_spec) VALUES
  (1, 'admins', '2026-03-29 00:00:00+00', '2026-05-21 00:00:00+00', 'public fixture seed'),
  (2, 'users', '2026-03-29 00:00:00+00', '2026-05-21 00:00:00+00', 'public fixture seed'),
  (3, 'guests', '2026-03-29 00:00:00+00', '2026-05-21 00:00:00+00', 'public fixture seed');

INSERT INTO public.system_users (id, username, full_name, created, updated, enabled, privileged, main_group_id, creation_spec, bio_social_medias, website, admin_access_allowed) VALUES
  (1, 'system_guest', 'System Guest', '2026-03-29 00:00:00+00', '2026-08-04 00:00:00+00', TRUE, FALSE, 3, 'Anonymous browsing identity required by the Filterest runtime', '', '', FALSE);

INSERT INTO public.system_user_group_memberships (user_id, group_id, created, updated, id, creation_spec) VALUES
  (1, 3, '2026-03-29 00:00:00', '2026-08-04 00:00:00', 1001, 'public fixture seed');

INSERT INTO public.system_table_folders (id, folder_name, folder_description, created, updated, parent_id, creation_spec, is_current_project, admin_user_id, tab_order_json) VALUES
  (1, 'database', 'Curated public Filterest fixtures', '2026-03-29', '2026-08-04', NULL, 'public fixture seed', TRUE, NULL, '[{"tab_id":"palvelukatalogi","sort_order":1},{"tab_id":"riskienhallinta","sort_order":2},{"tab_id":"dokumentaatio","sort_order":3},{"tab_id":"tiketit","sort_order":4}]'::jsonb);

INSERT INTO public.system_db_tables (id, table_name, description, table_uid, cached_oid, folder_id, created, updated, creation_spec, default_view_id, schema_name, multi_lang_embeddings, is_default, filterbar_visible_by_default, is_removable, is_main_table, is_about_table, fk_display_column, icon_key) VALUES
  (101, 'system_users', 'Filterest users', 101, NULL, 1, '2026-03-29 00:00:00', '2026-08-04 00:00:00', 'public fixture seed', NULL, 'public', FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, 'full_name', 'users'),
  (102, 'system_config', 'Fixture config', 102, NULL, 1, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', NULL, 'public', FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, 'key', 'settings');


INSERT INTO public.system_config (id, key, json_value, created, updated, creation_spec, boolean_value, text_value, int_value, value_type) VALUES
  (3001, 'login_to_browse', '{"value": false}'::jsonb, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', FALSE, 'false', NULL, 2),
  (3002, 'site_name', '{"value": ""}'::jsonb, '2026-03-29 00:00:00', '2026-08-04 00:00:00', 'Administrator-owned browser-facing identity selected during First Run.', NULL, '', NULL, 6);









INSERT INTO public.system_config (id, key, json_value, created, updated, creation_spec, boolean_value, text_value, int_value, value_type) VALUES
  (3003, 'results_load_amount', '{"value": 50}'::jsonb, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', NULL, '50', 50, 1),
  (3004, 'instance_kind', '{"value": "filterest_sibling"}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', NULL, 'filterest_sibling', NULL, 6),
  (3005, 'overwrite_possible', '{"value": true}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', TRUE, 'true', NULL, 2),
  (3006, 'dev_rate_limiting_off', '{"value": true}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', TRUE, 'true', NULL, 2),
  (3007, 'use_minified_js_css_in_dev_env', '{"value": false}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', FALSE, 'false', NULL, 2),
  (3008, 'first_run', '{"value": true}'::jsonb, '2026-08-03 00:00:00', '2026-08-03 00:00:00', 'Controls the one-time browser form for creating the first login-ready administrator. It is closed atomically after successful account creation.', TRUE, 'true', NULL, 2),
  (3009, 'installation_environment', '{"value": ""}'::jsonb, '2026-08-04 00:00:00', '2026-08-04 00:00:00', 'User-facing installation purpose selected during First Run. Empty preserves the deployment-defined fallback until First Run saves an explicit choice.', NULL, '', NULL, 6),
  (3010, 'registration_enabled', '{"value": true}'::jsonb, '2026-08-19 00:00:00', '2026-08-19 00:00:00', 'Administrator-owned self-registration availability setting.', TRUE, 'true', NULL, 2),
  (3011, 'view_admin_cover_image_test_palette', '{"value": true}'::jsonb, '2026-08-20 00:00:00', '2026-08-20 00:00:00', 'Temporary administrator-only dataset cover-image test palette switch.', TRUE, 'true', NULL, 2),
  (3012, 'favicon', '{"value": ""}'::jsonb, '2026-08-22 00:00:00', '2026-08-22 00:00:00', 'Optional favicon PNG filename from frontend/icons/site_favicons; empty uses site-name initials and then Filterest F.', NULL, '', NULL, 6);

-- K205 preserves ordinary accounts' existing name policy on every fresh site.
INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
VALUES ('display_name_may_equal_login_name', true, '{"value":true}', 'true', 2,
    'Ordinary accounts may use the same display and login name; administrators must use different names.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_functions (
  id, name, disabled, created, updated, "package", specific_table_related,
  creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
) VALUES
  (4001, 'system_table_tools.GetGroupedTables', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 200, 20, '/api/datasets', FALSE),
  (4002, 'router.GetDatasetAliasesHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'router', FALSE, 'public fixture seed', 200, 20, '/api/dataset-aliases', FALSE),
  (4003, 'system_table_tools.GetFilterbarSectionLayoutHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 200, 20, '/api/filterbar-section-layout', FALSE),
  (4010, 'dtt_1_row_read.GetResultsHandlerWrapper', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/get-results', FALSE),
  (4011, 'dtt_1_row_read.GetRowCountHandlerWrapper', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/get-row-count', FALSE),
  (4012, 'dtt_1_row_read.GetFilterOptionsHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/get-filter-options', FALSE),
  (4013, 'dtt_1_row_read.GetIntelligentResultsHandlerWrapper', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/get-intelligent-results', FALSE),
  (4014, 'dtt_1_row_read.GetResultsVector', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/get-results-vector', FALSE),
  (4015, 'dtt_3_table_read.GetTableViewHandlerWrapper', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_3_table_read', TRUE, 'public fixture seed', 200, 20, '/api/get-metadata', FALSE),
  (4016, 'dtt_2_column_crud.GetTableColumnsHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_2_column_crud', TRUE, 'public fixture seed', 200, 20, '/api/dataset-columns/', FALSE),
  (4017, 'dtt_1_row_read.GetDynamicChildItemsHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/fetch-dynamic-children', FALSE),
  (4020, 'dtt_crud_workflows.CreateTableHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'dtt_crud_workflows', FALSE, 'public fixture seed', 200, 20, '/api/create_dataset', FALSE),
  (4021, 'dtt_crud_workflows.ModifyColumnsHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'dtt_crud_workflows', TRUE, 'public fixture seed', 200, 20, '/api/modify-columns', FALSE),
  (4022, 'dtt_3_table_delete.DropTableHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'dtt_3_table_delete', TRUE, 'public fixture seed', 200, 20, '/api/drop-dataset', FALSE),
  (4023, 'system_table_tools.GetCardVisibilityHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 200, 20, '/api/card-visibility/', FALSE),
  (4024, 'system_table_tools.UpdateCardVisibilityHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 200, 20, '/api/card-visibility/update', FALSE),
  (4025, 'lang.GetPublicUILanguagesHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'lang', FALSE, 'public fixture seed', 200, 20, '/api/ui-languages', FALSE),
  (4026, 'lang.AdminUILanguagesHandler', FALSE, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'lang', FALSE, 'public fixture seed', 200, 20, '/api/admin/ui-languages', FALSE),
  (4027, 'system_table_tools.GetDatasetSortDefaultHandler', FALSE, '2026-08-18 00:00:00', '2026-08-18 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 300, 20, '/api/dataset-sort-default', FALSE),
  (4028, 'system_table_tools.SaveDatasetSortDefaultHandler', FALSE, '2026-08-18 00:00:00', '2026-08-18 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 300, 20, '/api/admin/dataset-sort-default', FALSE),
  (4029, 'system_table_tools.GetAdminUIFeatureFlagsHandler', FALSE, '2026-08-20 00:00:00', '2026-08-20 00:00:00', 'system_table_tools', FALSE, 'public fixture seed', 200, 20, '/api/admin/ui-feature-flags', FALSE);

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT group_ids.user_group_id, functions.id, 'public', 'public fixture seed', NULL
FROM (VALUES (1), (2), (3)) AS group_ids(user_group_id)
JOIN public.system_functions functions
  ON functions.name IN (
    'system_table_tools.GetGroupedTables',
    'router.GetDatasetAliasesHandler',
    'system_table_tools.GetFilterbarSectionLayoutHandler'
  );

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT 1, functions.id, 'public', 'public fixture seed', NULL
FROM public.system_functions functions
WHERE functions.name IN (
  'dtt_crud_workflows.CreateTableHandler',
  'system_table_tools.GetCardVisibilityHandler',
  'system_table_tools.UpdateCardVisibilityHandler',
  'lang.AdminUILanguagesHandler',
  'system_table_tools.SaveDatasetSortDefaultHandler',
  'system_table_tools.GetAdminUIFeatureFlagsHandler'
);

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT 1, functions.id, 'public', 'public fixture seed', 102
FROM public.system_functions functions
WHERE functions.disabled IS FALSE
  AND COALESCE(functions.specific_table_related, TRUE) IS TRUE;

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, creation_spec) VALUES
  ('select_menu_language', 'Valitse kieli', 'Select language', '选择语言', 'public fixture seed'),
  ('login', 'Kirjaudu', 'Login', '登录', 'public fixture seed'),
  ('forgot_password', 'Unohtuiko salasana?', 'Forgot password?', 'Forgot password?', 'public fixture seed'),
  ('back_to_login', 'Takaisin kirjautumiseen', 'Back to login', 'Back to login', 'public fixture seed'),
  ('resend_code', 'Lähetä koodi uudelleen', 'Resend code', 'Resend code', 'public fixture seed'),
  ('search', 'Haku', 'Search', 'Search', 'public fixture seed'),
  ('sort_by', 'Järjestä', 'Sort by', 'Sort by', 'public fixture seed'),
  ('search_relevance', 'Hakurelevanssi', 'Search relevance', 'Search relevance', 'public fixture seed'),
  ('reset_search', 'Tyhjennä haku', 'Reset search', 'Reset search', 'public fixture seed'),
  ('filters', 'Suodattimet', 'Filters', 'Filters', 'public fixture seed'),
  ('filterbar_filter_results', 'Suodata tuloksia', 'Filter results', '筛选结果', 'public fixture seed'),
  ('filterbar_view_content_as', 'Näytä sisältö muodossa…', 'View content as…', '内容显示方式…', 'public fixture seed'),
  ('filterbar_add_manage_content', 'Lisää ja hallitse sisältöä', 'Add & manage content', '添加和管理内容', 'public fixture seed'),
  ('filterbar_select_visible_fields', 'Valitse näkyvät kentät', 'Select visible fields', '选择可见字段', 'public fixture seed'),
  ('text_search', 'Tekstihaku', 'Text search', 'Text search', 'public fixture seed'),
  ('created', 'Luotu', 'Created', 'Created', 'public fixture seed'),
  ('updated', 'Päivitetty', 'Updated', 'Updated', 'public fixture seed'),
  ('header', 'Otsikko', 'Header', 'Header', 'public fixture seed'),
  ('search_for_header', 'Hae otsikosta', 'Search for header', 'Search for header', 'public fixture seed'),
  ('description', 'Kuvaus', 'Description', 'Description', 'public fixture seed'),
  ('search_for_description', 'Hae kuvauksesta', 'Search for description', 'Search for description', 'public fixture seed'),
  ('id', 'Id', 'Id', 'Id', 'public fixture seed'),
  ('user_id', 'Käyttäjän id', 'User id', 'User id', 'public fixture seed'),
  ('cached_image', 'Kuva', 'Image', 'Image', 'public fixture seed'),
  ('search_for_cached_image', 'Hae kuvasta', 'Search for image', 'Search for image', 'public fixture seed'),
  ('openai_embedding', 'OpenAI-upotus', 'OpenAI embedding', 'OpenAI embedding', 'public fixture seed'),
  ('search_for_openai_embedding', 'Hae OpenAI-upotuksesta', 'Search for OpenAI embedding', 'Search for OpenAI embedding', 'public fixture seed'),
  ('keywords_static', 'Avainsanat', 'Keywords', 'Keywords', 'public fixture seed'),
  ('search_for_keywords_static', 'Hae avainsanoista', 'Search for keywords', 'Search for keywords', 'public fixture seed'),
  ('type_of_operation', 'Toiminnan tyyppi', 'Type of operation', 'Type of operation', 'public fixture seed'),
  ('search_for_type_of_operation', 'Hae toiminnan tyypistä', 'Search for type of operation', 'Search for type of operation', 'public fixture seed'),
  ('website', 'Verkkosivusto', 'Website', 'Website', 'public fixture seed'),
  ('search_for_website', 'Hae verkkosivustosta', 'Search for website', 'Search for website', 'public fixture seed'),
  ('contact_details', 'Yhteystiedot', 'Contact details', 'Contact details', 'public fixture seed'),
  ('search_for_contact_details', 'Hae yhteystiedoista', 'Search for contact details', 'Search for contact details', 'public fixture seed'),
  ('association_type_id', 'Yhdistystyypin id', 'Association type id', 'Association type id', 'public fixture seed'),
  ('assoc_t_name_cached', 'Yhdistystyypin nimi', 'Association type name', 'Association type name', 'public fixture seed'),
  ('search_for_assoc_t_name_cached', 'Hae yhdistystyypin nimestä', 'Search for association type name', 'Search for association type name', 'public fixture seed'),
  ('cached_username', 'Käyttäjänimi', 'Username', 'Username', 'public fixture seed'),
  ('search_for_cached_username', 'Hae käyttäjänimestä', 'Search for username', 'Search for username', 'public fixture seed'),
  ('locality', 'Paikkakunta', 'Locality', 'Locality', 'public fixture seed'),
  ('search_for_locality', 'Hae paikkakunnasta', 'Search for locality', 'Search for locality', 'public fixture seed'),
  ('national_corporation_identifier', 'Y-tunnus', 'National corporation identifier', 'National corporation identifier', 'public fixture seed'),
  ('search_for_national_corporation_identifier', 'Hae y-tunnuksesta', 'Search for national corporation identifier', 'Search for national corporation identifier', 'public fixture seed'),
  ('view_count', 'Näyttökerrat', 'View count', 'View count', 'public fixture seed'),
  ('paid_views_left', 'Maksettuja näyttökertoja jäljellä', 'Paid views left', 'Paid views left', 'public fixture seed'),
  ('tools', 'Työkalut', 'Tools', 'Tools', 'public fixture seed'),
  ('delete_selected', 'Poista valitut', 'Delete selected', 'Delete selected', 'public fixture seed'),
  ('manage_table_short', 'Hallinnoi', 'Manage', 'Manage', 'public fixture seed'),
  ('show_more', 'Näytä lisää', 'Show more', 'Show more', 'public fixture seed'),
  ('picture_of_target', 'Kuva', 'Picture', 'Picture', 'public fixture seed'),
  ('picture_missing', 'Kuva puuttuu', 'Picture missing', 'Picture missing', 'public fixture seed'),
  ('sort_newest', 'Uusimmat ensin', 'Newest first', 'Newest first', 'public fixture seed'),
  ('sort_oldest', 'Vanhimmat ensin', 'Oldest first', 'Oldest first', 'public fixture seed'),
  ('sort_updated_newest', 'Viimeksi päivitetyt ensin', 'Recently updated first', 'Recently updated first', 'public fixture seed'),
  ('sort_updated_oldest', 'Vanhimmin päivitetyt ensin', 'Least recently updated first', 'Least recently updated first', 'public fixture seed'),
  ('field_sets', 'Kenttäjoukot', 'Field sets', 'Field sets', 'public fixture seed'),
  ('field_set_fields_placeholder', 'Valitse kentät', 'Select fields', 'Select fields', 'public fixture seed'),
  ('search_fields', 'Hae kenttiä', 'Search fields', 'Search fields', 'public fixture seed'),
  ('fields_selected', 'Kenttiä valittu', 'Fields selected', 'Fields selected', 'public fixture seed'),
  ('save_field_set', 'Tallenna kenttäjoukko', 'Save field set', 'Save field set', 'public fixture seed'),
  ('update_field_set', 'Päivitä kenttäjoukko', 'Update field set', 'Update field set', 'public fixture seed'),
  ('clear_selections', 'Tyhjennä valinnat', 'Clear selections', 'Clear selections', 'public fixture seed'),
  ('more_actions', 'Lisätoiminnot', 'More actions', 'More actions', 'public fixture seed'),
  ('save_as_new_field_set', 'Tallenna uutena kenttäjoukkona', 'Save as new field set', 'Save as new field set', 'public fixture seed'),
  ('delete_field_set', 'Poista kenttäjoukko', 'Delete field set', 'Delete field set', 'public fixture seed'),
  ('select_field_set', 'Valitse kenttäjoukko', 'Select field set', 'Select field set', 'public fixture seed'),
  ('select_field_set_first', 'Valitse ensin kenttäjoukko', 'Select a field set first', 'Select a field set first', 'public fixture seed'),
  ('show_hide_column', 'Näytä tai piilota sarake', 'Show or hide column', 'Show or hide column', 'public fixture seed')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

UPDATE public.system_lang_keys
SET yue = CASE lang_key
    WHEN 'select_menu_language' THEN '選擇語言'
    WHEN 'login' THEN '登入'
    WHEN 'forgot_password' THEN '唔記得密碼？'
    WHEN 'back_to_login' THEN '返回登入'
    WHEN 'resend_code' THEN '重新傳送驗證碼'
    WHEN 'search' THEN '搜尋'
    WHEN 'sort_by' THEN '排序方式'
    WHEN 'search_relevance' THEN '搜尋相關度'
    WHEN 'reset_search' THEN '清除搜尋'
    WHEN 'filters' THEN '篩選器'
    WHEN 'filterbar_filter_results' THEN '篩選結果'
    WHEN 'filterbar_view_content_as' THEN '內容顯示方式…'
    WHEN 'filterbar_add_manage_content' THEN '新增及管理內容'
    WHEN 'filterbar_select_visible_fields' THEN '選擇顯示欄位'
    WHEN 'text_search' THEN '文字搜尋'
    WHEN 'created' THEN '建立時間'
    WHEN 'updated' THEN '更新時間'
    WHEN 'header' THEN '標題'
    WHEN 'description' THEN '描述'
    WHEN 'show_more' THEN '顯示更多'
    WHEN 'tools' THEN '工具'
    WHEN 'more_actions' THEN '更多操作'
    ELSE COALESCE(NULLIF(yue, ''), en)
END
WHERE yue IS NULL OR yue = '';

-- Separate public sign-in visibility from server-enforced administrator-only access.
INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT defaults.key, defaults.enabled, jsonb_build_object('value', defaults.enabled),
       defaults.enabled::text, 2, defaults.description
FROM (VALUES
    ('show_login_button', TRUE, 'Show visitor sign-in entry points. Direct /login remains available when hidden.'),
    ('only_admin_can_login', FALSE, 'Allow sign-in only for enabled administrators with administrator access; also disables effective self-registration.')
) AS defaults(key, enabled, description)
WHERE NOT EXISTS (SELECT 1 FROM public.system_config AS existing WHERE existing.key = defaults.key);
-- runtime.seed.sql
-- Seeds only the public runtime identity and version rows needed on first use.
-- Bridges generated release metadata and the reduced public-safe runtime schema.
-- Exists separately from multilingual mock content so runtime readiness stays explicit.

INSERT INTO public.system_about (id, title, description, admin_approved)
VALUES (
    4,
    'Filterest privacy notice',
    'This generated local preview contains synthetic demonstration data only.',
    TRUE
);

INSERT INTO public.system_config (key, json_value, creation_spec)
SELECT
    'production_update_notice',
    '{
      "schema_version": 1,
      "notice_id": "",
      "state": "cleared",
      "announced_at": "",
      "starts_at": "",
      "expires_at": "",
      "updated_at": ""
    }'::jsonb,
    'Manager-controlled fixed-schema administrator production-update notice; no operator-authored display text.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_config WHERE key = 'production_update_notice'
);

INSERT INTO public.system_table_views (name, view_key, status)
VALUES
    ('table', 'table', 'active'),
    ('card', 'card', 'active'),
    ('normal', 'normal', 'active'),
    ('transposed', 'transposed', 'active'),
    ('tree', 'tree', 'active'),
    ('ticket', 'ticket', 'active'),
    ('product_card', 'product_card', 'active'),
    ('calendar', 'calendar', 'active'),
    ('map', 'map', 'active'),
    ('price_chart', 'price_chart', 'active'),
    ('settings', 'settings', 'active'),
    ('cloud_management', 'cloud_management', 'active')
ON CONFLICT (view_key) DO NOTHING;

WITH desired_tables (table_name, display_name, description, fk_display_column) AS (
    VALUES
        ('system_row_groups', 'Row Groups', 'Reusable multilingual row classification groups', 'slug'),
        ('system_row_group_memberships', 'Row Group Memberships', 'Generic assignments from dataset rows to reusable groups', 'id'),
        ('system_column_field_sets', 'Field Collections', 'Reusable personal and shared dataset field collections', 'name'),
        ('system_column_field_set_members', 'Field Collection Members', 'Ordered columns belonging to reusable field collections', 'column_uid'),
        ('system_view_field_set_assignments', 'View Field Assignments', 'Personal and site-default field collections selected for dataset views', 'id'),
        ('system_user_visual_preferences', 'User Visual Preferences', 'Allowlisted account-owned visual preferences', 'theme_mode')
)
INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, folder_id, schema_name,
    fk_display_column, filterbar_visible_by_default, is_removable,
    display_name, sql_dump_policy
)
SELECT desired.table_name,
       desired.description,
       classes.oid::integer,
       folders.id,
       'public',
       desired.fk_display_column,
       FALSE,
       FALSE,
       desired.display_name,
       'all'
FROM desired_tables AS desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
LEFT JOIN LATERAL (
    SELECT id
    FROM public.system_table_folders
    WHERE folder_name = 'system'
    ORDER BY id
    LIMIT 1
) AS folders ON TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid integer;
BEGIN
    FOR table_record IN
        SELECT unnest(ARRAY[
            'system_row_groups',
            'system_row_group_memberships',
            'system_column_field_sets',
            'system_column_field_set_members',
            'system_view_field_set_assignments',
            'system_user_visual_preferences'
        ]) AS table_name
    LOOP
        SELECT table_uid INTO registered_table_uid
        FROM public.system_db_tables
        WHERE table_name = table_record.table_name
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
        LIMIT 1;

        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
        )
        SELECT registered_table_uid,
               columns.column_name,
               columns.data_type,
               columns.ordinal_position,
               FALSE,
               now(),
               now()
        FROM information_schema.columns AS columns
        WHERE registered_table_uid IS NOT NULL
          AND columns.table_schema = 'public'
          AND columns.table_name = table_record.table_name
          AND NOT EXISTS (
              SELECT 1
              FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END LOOP;

    UPDATE public.system_column_details AS details
    SET is_multilingual = TRUE,
        editable_in_ui = FALSE,
        updated = now()
    FROM public.system_db_tables AS tables
    WHERE tables.table_uid = details.table_uid
      AND tables.table_name = 'system_row_groups'
      AND details.column_name IN ('title', 'description');

    UPDATE public.system_column_details AS details
    SET editable_in_ui = FALSE,
        updated = now()
    FROM public.system_db_tables AS tables
    WHERE tables.table_uid = details.table_uid
      AND tables.table_name IN ('system_row_groups', 'system_row_group_memberships');

    SELECT table_uid INTO registered_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_table_views'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LIMIT 1;

    INSERT INTO public.system_column_details (
        table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
    )
    SELECT registered_table_uid,
           columns.column_name,
           columns.data_type,
           columns.ordinal_position,
           FALSE,
           now(),
           now()
    FROM information_schema.columns AS columns
    WHERE registered_table_uid IS NOT NULL
      AND columns.table_schema = 'public'
      AND columns.table_name = 'system_table_views'
      AND columns.column_name = 'view_key'
      AND NOT EXISTS (
          SELECT 1
          FROM public.system_column_details AS existing
          WHERE existing.table_uid = registered_table_uid
            AND existing.column_name = columns.column_name
      );
END $$;

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
        ('system_table_tools.AdminRowGroupsHandler', '/api/admin/row-groups', 'Admin list/create API for reusable row groups.'),
        ('system_table_tools.AdminRowGroupMembershipsHandler', '/api/admin/row-group-memberships', 'Admin assignment API for generic row group memberships.'),
        ('system_table_tools.SavePersonalDatasetSortDefaultHandler', '/api/dataset-sort-default/personal', 'Saves a dataset sorting default owned by the authenticated user.'),
        ('system_table_tools.GetViewFieldSetsHandler', '/api/view-field-sets', 'Lists effective and reusable field collections for one authenticated dataset view.'),
        ('system_table_tools.SavePersonalViewFieldSetHandler', '/api/view-field-sets/personal/save', 'Saves and activates a field collection owned by the authenticated user.'),
        ('system_table_tools.AssignPersonalViewFieldSetHandler', '/api/view-field-sets/personal/assign', 'Selects a personal or shared field collection for the authenticated user.'),
        ('system_table_tools.ResetPersonalViewFieldSetHandler', '/api/view-field-sets/personal/reset', 'Removes a personal assignment so the site default is inherited.'),
        ('system_table_tools.DeletePersonalViewFieldSetHandler', '/api/view-field-sets/personal/delete', 'Deletes a field collection owned by the authenticated user.'),
        ('system_table_tools.SaveSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/save', 'Saves and activates an administrator-managed site-default field collection.'),
        ('system_table_tools.AssignSiteViewFieldSetHandler', '/api/admin/view-field-sets/site/assign', 'Selects a shared field collection as a site default.'),
        ('system_table_tools.DeleteSharedViewFieldSetHandler', '/api/admin/view-field-sets/shared/delete', 'Deletes an administrator-managed shared field collection.')
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT desired.name, FALSE, now(), now(), 'system_table_tools', FALSE,
       desired.creation_spec, 200, 20, desired.route, FALSE
FROM desired_functions AS desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_functions AS existing WHERE existing.name = desired.name
);

INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT
    'auth.UserVisualPreferenceHandler',
    FALSE,
    now(),
    now(),
    'auth',
    FALSE,
    'Authenticated-user-owned allowlisted visual preferences.',
    240,
    20,
    '/api/user-visual-preference',
    FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_functions AS existing
    WHERE existing.name = 'auth.UserVisualPreferenceHandler'
);

WITH desired_functions (name, route, creation_spec) AS (
    VALUES
        ('router.systemUpdateNoticeHandler', '/system/update-notice', 'Manager-authenticated production-update notice state transition.'),
        ('router.adminUpdateNoticeStreamHandler', '/api/admin/update-notice/stream', 'Administrator-only bounded production-update notice stream.')
)
INSERT INTO public.system_functions (
    name, disabled, created, updated, package, specific_table_related,
    creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only
)
SELECT desired.name, FALSE, now(), now(), 'router', FALSE,
       desired.creation_spec, 200, 20, desired.route, FALSE
FROM desired_functions AS desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_functions AS existing WHERE existing.name = desired.name
);

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator row-group API',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.AdminRowGroupsHandler',
      'system_table_tools.AdminRowGroupMembershipsHandler'
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

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator production-update notice stream',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'router.adminUpdateNoticeStreamHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

INSERT INTO public.system_group_table_func_rights (
    user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT groups.id,
       functions.id,
       'public',
       'Filterest public bootstrap administrator field collection API',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.SaveSiteViewFieldSetHandler',
      'system_table_tools.AssignSiteViewFieldSetHandler',
      'system_table_tools.DeleteSharedViewFieldSetHandler'
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

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT USAGE ON SCHEMA public TO readeronly;
        GRANT SELECT ON TABLE public.system_table_views TO readeronly;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO readeronly;
        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO readeronly;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT ON TABLE public.system_table_views TO admin_user;
        GRANT SELECT, INSERT, UPDATE ON TABLE
            public.system_user_visual_preferences
        TO admin_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO admin_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq
        TO admin_user;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT USAGE ON SCHEMA public TO basic_user;
        GRANT SELECT ON TABLE public.system_table_views TO basic_user;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO basic_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO basic_user;
        GRANT SELECT, INSERT, UPDATE ON TABLE
            public.system_dataset_sort_defaults,
            public.system_user_visual_preferences
        TO basic_user;
        GRANT USAGE, SELECT ON SEQUENCE
            public.system_column_field_sets_id_seq,
            public.system_view_field_set_assignments_id_seq,
            public.system_dataset_sort_defaults_id_seq
        TO basic_user;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        GRANT USAGE ON SCHEMA public TO guest_user;
        GRANT SELECT ON TABLE public.system_table_views TO guest_user;
        GRANT SELECT ON TABLE
            public.system_row_groups,
            public.system_row_group_memberships
        TO guest_user;
        GRANT SELECT ON TABLE
            public.system_column_field_sets,
            public.system_column_field_set_members,
            public.system_view_field_set_assignments
        TO guest_user;
        REVOKE ALL PRIVILEGES ON TABLE
            public.system_user_visual_preferences
        FROM guest_user;
    END IF;
END $$;

-- Administrator-only reversible dataset visibility; preserves all existing rights.
INSERT INTO public.system_functions
 (name, package, disabled, specific_table_related, url_route_endpoint, ui_only,
  rate_limit_amount, rate_limit_minutes, creation_spec)
VALUES ('system_table_tools.AdminDatasetUIVisibilityHandler', 'system_table_tools', FALSE, FALSE,
 '/api/admin/dataset-ui-visibility', FALSE, 200, 20, 'Administrator dataset UI hide and restore.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.system_group_table_func_rights
 (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
SELECT 1, id, 'public', NULL, 'Administrator dataset UI hide and restore.'
FROM public.system_functions f
WHERE f.name = 'system_table_tools.AdminDatasetUIVisibilityHandler'
 AND NOT EXISTS (
  SELECT 1 FROM public.system_group_table_func_rights rights
  WHERE rights.user_group_id = 1 AND rights.function_id = f.id
   AND rights.target_schema_name = 'public' AND rights.target_table_uid IS NULL
 )
ON CONFLICT DO NOTHING;

-- The version row is written last, by the acceptance block the generator appends,
-- and only after every completion marker and final check of the import has passed.

-- Administrator coding agents require an explicit production opt-in.
INSERT INTO public.system_config (key, value_type, boolean_value, text_value, json_value)
VALUES ('coding_agent_dev_only', 2, TRUE, 'true', '{"value":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
-- Filterest public bootstrap: metadata and multilingual content for the
-- established mock services, risks, documentation, and tickets workspace.

UPDATE public.system_table_folders
SET is_current_project = FALSE,
    tab_order_json = '[]'::jsonb,
    updated = CURRENT_DATE
WHERE id = 1;

-- A single ordinary example user gives the starter rows a human-readable
-- author without creating login credentials. First Run still creates the
-- installation administrator separately.
INSERT INTO public.system_users
    (id, username, full_name, created, updated, enabled, privileged,
     main_group_id, creation_spec, bio_social_medias, website,
     admin_access_allowed)
VALUES
  (2, 'teppo_tekija', 'Teppo Tekijä', '2026-08-05 00:00:00+00',
   '2026-08-05 00:00:00+00', TRUE, FALSE, 2,
   'Synthetic public example user without login credentials', '', '', FALSE);

INSERT INTO public.system_user_group_memberships
    (user_id, group_id, created, updated, id, creation_spec)
VALUES
  (2, 2, '2026-08-05 00:00:00', '2026-08-05 00:00:00', 1002,
   'public fixture seed');

INSERT INTO public.system_table_folders
    (id, folder_name, folder_description, created, updated, parent_id,
     creation_spec, is_current_project, admin_user_id, tab_order_json)
VALUES
  (2, 'system', 'Platform configuration and administration metadata', CURRENT_DATE, CURRENT_DATE, 1, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (3, 'development', 'Development-time datasets and tools', CURRENT_DATE, CURRENT_DATE, 1, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (4, 'apps', 'Application and project workspaces', CURRENT_DATE, CURRENT_DATE, 1, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  -- The front-page resolver opens the first current-project content tab. Keep
  -- documentation first without marking it undeletable through is_default.
  (5, 'filterest', 'Filterest public example workspace', CURRENT_DATE, CURRENT_DATE, 4, 'public fixture seed', TRUE, 2,
   '[{"tab_id":"dokumentaatio","sort_order":1},{"tab_id":"palvelukatalogi","sort_order":2},{"tab_id":"riskienhallinta","sort_order":3},{"tab_id":"tiketit","sort_order":4},{"tab_id":"system_users","sort_order":5},{"tab_id":"static:user","sort_order":6},{"tab_id":"static:logout","sort_order":7}]'::jsonb),
  (6, 'users_and_groups', 'Users, groups, and memberships', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (7, 'logs', 'Runtime and transaction logs', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (8, 'mgmt_helpers', 'Database-management helper metadata', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (9, 'functions_and_rights', 'Functions and group permissions', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (10, 'about', 'Product and privacy information', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (11, 'lang', 'Language keys and their sources', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (12, 'tables', 'Dataset and folder metadata', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (13, 'columns', 'Column metadata and user column settings', CURRENT_DATE, CURRENT_DATE, 2, 'public fixture seed', FALSE, NULL, '[]'::jsonb),
  (14, 'other_tables', 'Other platform and relation tables', CURRENT_DATE, CURRENT_DATE, 1, 'public fixture seed', FALSE, NULL, '[]'::jsonb);

UPDATE public.system_db_tables
SET folder_id = CASE table_name
        WHEN 'system_users' THEN 6
        WHEN 'system_config' THEN 2
        ELSE folder_id
    END,
    fk_display_column = CASE table_name
        WHEN 'system_users' THEN 'full_name'
        ELSE fk_display_column
    END,
    updated = CURRENT_TIMESTAMP
WHERE table_name IN ('system_users', 'system_config');

INSERT INTO public.system_db_tables
    (id, table_name, description, table_uid, cached_oid, folder_id, created, updated,
     creation_spec, default_view_id, schema_name, display_name, multi_lang_embeddings,
     is_default, filterbar_visible_by_default, is_removable, is_main_table,
     is_about_table, fk_display_column, icon_key)
VALUES
  (7, 'palvelukatalogi', 'Disposable multilingual mock services', 7, NULL, 5, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Services', FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, 'palvelu', 'service'),
  (10, 'tiketit', 'Disposable multilingual mock tickets', 10, NULL, 5, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Tickets', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'otsikko', 'task'),
  (8, 'riskienhallinta', 'Disposable multilingual mock risks', 8, NULL, 5, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Risks', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'riski', 'warning'),
  (9, 'dokumentaatio', 'Disposable multilingual mock documentation', 9, NULL, 5, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Documents', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'otsikko', 'article'),
  (300, 'palvelukatalogi_assets', 'Shared image assets for services', 300, NULL, 14, '2026-08-05 00:00:00', '2026-08-05 00:00:00', 'public fixture seed', NULL, 'public', 'Service assets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'filename', 'image'),
  (301, 'riskienhallinta_assets', 'Shared image assets for risks', 301, NULL, 14, '2026-08-05 00:00:00', '2026-08-05 00:00:00', 'public fixture seed', NULL, 'public', 'Risk assets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'filename', 'image'),
  (302, 'dokumentaatio_assets', 'Shared image assets for documentation', 302, NULL, 14, '2026-08-05 00:00:00', '2026-08-05 00:00:00', 'public fixture seed', NULL, 'public', 'Documentation assets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'filename', 'image'),
  (303, 'tiketit_assets', 'Shared image assets for tickets', 303, NULL, 14, '2026-08-05 00:00:00', '2026-08-05 00:00:00', 'public fixture seed', NULL, 'public', 'Ticket assets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'filename', 'image'),
  (74, 'palvelukatalogi_riskienhallinta_relation', 'Mock service and risk links', 74, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Services and risks', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'palvelu_id', NULL),
  (105, 'palvelukatalogi_dokumentaatio_relation', 'Mock service and documentation links', 105, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Services and documentation', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'palvelu_id', NULL),
  (75, 'palvelukatalogi_tiketit_relation', 'Mock service and ticket links', 75, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Services and tickets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'palvelu_id', NULL),
  (76, 'riskienhallinta_dokumentaatio_relation', 'Mock risk and documentation links', 76, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Risks and documentation', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'riski_id', NULL),
  (77, 'riskienhallinta_tiketit_relation', 'Mock risk and ticket links', 77, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Risks and tickets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'riski_id', NULL),
  (56, 'dokumentaatio_tiketit_relation', 'Mock documentation and ticket links', 56, NULL, 14, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'public fixture seed', NULL, 'public', 'Documentation and tickets', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'dokumentaatio_id', NULL),
  (201, 'system_about', 'Product information', 201, NULL, 10, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'About', FALSE, FALSE, TRUE, FALSE, FALSE, TRUE, NULL, 'info'),
  (202, 'system_lang_keys', 'Language keys', 202, NULL, 11, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Language keys', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'lang_key', 'language'),
  (203, 'system_column_control', 'Column control', 203, NULL, 13, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Column control', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'columns'),
  (204, 'system_db_tables', 'Dataset metadata', 204, NULL, 12, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Database tables', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'table_name', 'table'),
  (205, 'system_table_folders', 'Dataset folders', 205, NULL, 12, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Table folders', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'folder_name', 'folder'),
  (206, 'system_db_version', 'Database version history', 206, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Database version', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'version', 'history'),
  (207, 'system_foreign_key_relations_m_m', 'Many-to-many relation metadata', 207, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Foreign-key relations M:M', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'link'),
  (208, 'system_child_tab_config', 'Child-tab configuration', 208, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Child tab configuration', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'settings'),
  (209, 'spatial_ref_sys', 'Spatial reference systems', 209, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Spatial reference systems', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'srid', 'map'),
  (211, 'system_audit_log', 'Audit log', 211, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Audit log', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'history'),
  (212, 'system_user_groups', 'User groups', 212, NULL, 6, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'User groups', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'name', 'users'),
  (213, 'system_group_table_func_rights', 'Group function permissions', 213, NULL, 9, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Group table-function rights', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'permissions'),
  (214, 'ai_chat_conversations', 'AI chat conversations', 214, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'AI chat conversations', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'chat'),
  (215, 'system_lang_keys_archive', 'Language-key archive', 215, NULL, 11, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Language-key archive', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'lang_key', 'archive'),
  (216, 'payments', 'Payment records', 216, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Payments', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'payment'),
  (217, 'system_functions', 'Registered functions', 217, NULL, 9, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'System functions', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'name', 'function'),
  (218, 'system_column_details', 'Column metadata', 218, NULL, 13, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Column details', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'column_name', 'columns'),
  (219, 'system_lang_key_sources', 'Language-key sources', 219, NULL, 11, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Language-key sources', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'source'),
  (220, 'system_user_group_memberships', 'User-group memberships', 220, NULL, 6, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'User group memberships', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'users'),
  (221, 'system_transaction_log', 'Transaction log', 221, NULL, 7, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Transaction log', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'history'),
  (222, 'system_foreign_key_relations_1_m', 'One-to-many relation metadata', 222, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Foreign-key relations 1:M', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'link'),
  (223, 'system_table_row_view_counts', 'Row-view counters', 223, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Table row view counts', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'counter'),
  (224, 'system_table_views', 'Dataset view configuration', 224, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Table views', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'view'),
  (225, 'system_schema_migrations', 'Applied schema migrations', 225, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Schema migrations', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'filename', 'history'),
  (226, 'system_languages', 'Canonical UI-language registry and site availability controls', 226, NULL, 11, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'public fixture seed', NULL, 'public', 'Languages', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'native_name', 'language'),
  (227, 'system_lang_key_translations', 'Normalized translations for stable UI language keys', 227, NULL, 11, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'public fixture seed', NULL, 'public', 'Language key translations', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'translation', 'language'),
  (228, 'system_embedding_refresh_jobs', 'Content-free durable queue for refreshing row embeddings after committed data changes', 228, NULL, 8, '2026-08-17 00:00:00', '2026-08-17 00:00:00', 'public fixture seed', NULL, 'public', 'Embedding refresh jobs', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, 'refresh'),
  (229, 'system_dataset_sort_defaults', 'Per-dataset site-wide and authenticated-user-specific default sorting', 229, NULL, 8, '2026-08-18 00:00:00', '2026-08-25 00:00:00', 'public fixture seed', NULL, 'public', 'Dataset Sort Defaults', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'sort_column', 'settings'),
  (230, 'system_dataset_media', 'Dataset-level cover and content-background image registry', 230, NULL, 8, '2026-08-19 00:00:00', '2026-08-19 00:00:00', 'public fixture seed', NULL, 'public', 'Dataset Media', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'original_name', 'image');

INSERT INTO public.system_functions
    (id, name, disabled, created, updated, package, specific_table_related,
     creation_spec, rate_limit_amount, rate_limit_minutes, url_route_endpoint, ui_only)
VALUES
  (2010, 'Services', FALSE, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'app', TRUE, 'public fixture seed', 0, 0, '/palvelukatalogi', TRUE),
  (2012, 'Tickets', FALSE, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'app', TRUE, 'public fixture seed', 0, 0, '/tiketit', TRUE),
  (2013, 'Risks', FALSE, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'app', TRUE, 'public fixture seed', 0, 0, '/riskienhallinta', TRUE),
  (2014, 'Documents', FALSE, '2026-07-17 00:00:00', '2026-07-17 00:00:00', 'app', TRUE, 'public fixture seed', 0, 0, '/dokumentaatio', TRUE);

INSERT INTO public.system_column_details
    (table_uid, column_name, column_label, data_type, card_element, co_number,
     fco_number, sco_number, lang_key, creation_spec, show_key_on_card,
     show_value_on_card, hide_on_small_card, hide_in_filter_panel, is_multilingual,
     card_detail_icon_key)
VALUES
  (101, 'full_name', 'Full name', 'text', 'header', 1, 1, 1, 'full_name', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL),
  (101, 'username', 'Username', 'text', 'details10', 2, 2, 2, 'username', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, FALSE, 'user'),

  (7, 'palvelu', 'Service', 'text', 'header', 1, 1, 1, 'palvelu', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (7, 'kuvaus', 'Description', 'text', 'description', 2, 2, 2, 'kuvaus', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (7, 'cached_image', 'Image', 'image', 'image', 3, NULL, NULL, 'cached_image', 'public fixture seed', FALSE, TRUE, FALSE, TRUE, FALSE, NULL),
  (7, 'omistava_tiimi', 'Owning team', 'text', 'details10', 4, 3, 3, 'omistava_tiimi', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'user'),
  (7, 'palvelutaso', 'Service level', 'text', 'details20', 5, 4, 4, 'palvelutaso', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'layers'),
  (7, 'tila', 'Status', 'text', 'details30', 6, 5, 5, 'tila', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'check-circle'),
  (7, 'vastuuhenkilo', 'Owner', 'text', 'details40', 7, 6, 6, 'vastuuhenkilo', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'user'),
  (7, 'cached_username', 'Username', 'character varying', 'username', 9, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL),

  (8, 'riski', 'Risk', 'text', 'header', 1, 1, 1, 'riski', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (8, 'alentamistoimet', 'Mitigation', 'text', 'description', 2, 2, 2, 'alentamistoimet', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (8, 'cached_image', 'Image', 'image', 'image', 3, NULL, NULL, 'cached_image', 'public fixture seed', FALSE, TRUE, FALSE, TRUE, FALSE, NULL),
  (8, 'kuvaus', 'Description', 'text', 'details10', 4, 3, 3, 'kuvaus', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'file-text'),
  (8, 'vaikutus', 'Impact', 'text', 'details20', 5, 4, 4, 'vaikutus', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'alert-circle'),
  (8, 'riskitaso', 'Risk level', 'text', 'details30', 6, 5, 5, 'riskitaso', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'alert-circle'),
  (8, 'tila', 'Status', 'text', 'details40', 7, 6, 6, 'tila', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'check-circle'),
  (8, 'omistava_tiimi', 'Owning team', 'text', 'details', 8, 7, 7, 'omistava_tiimi', 'public fixture seed', TRUE, TRUE, TRUE, FALSE, TRUE, 'user'),
  (8, 'todennakoisyys', 'Likelihood', 'text', 'details', 9, 8, 8, 'todennakoisyys', 'public fixture seed', TRUE, TRUE, TRUE, FALSE, TRUE, 'ruler'),
  (8, 'palvelu_id', 'Service ID', 'integer', 'hidden', 10, NULL, NULL, 'palvelu_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (8, 'cached_username', 'Username', 'character varying', 'username', 12, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL),

  (9, 'otsikko', 'Document', 'text', 'header', 1, 1, 1, 'otsikko', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (9, 'ohje', 'Guidance', 'text', 'description', 2, 2, 2, 'ohje', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (9, 'cached_image', 'Image', 'image', 'image', 3, NULL, NULL, 'cached_image', 'public fixture seed', FALSE, TRUE, FALSE, TRUE, FALSE, NULL),
  (9, 'kohdetiimi', 'Target team', 'text', 'details10', 4, 3, 3, 'kohdetiimi', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'user'),
  (9, 'voimassaolo', 'Validity', 'text', 'details20', 5, 4, 4, 'voimassaolo', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'check-circle'),
  (9, 'paivitetty', 'Reviewed', 'date', 'details30', 6, 5, 5, 'paivitetty', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, FALSE, 'calendar'),
  (9, 'palvelu_id', 'Service ID', 'integer', 'hidden', 7, NULL, NULL, 'palvelu_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (9, 'cached_username', 'Username', 'character varying', 'username', 9, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL),

  (10, 'otsikko', 'Ticket', 'text', 'header', 1, 1, 1, 'otsikko', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (10, 'kuvaus', 'Description', 'text', 'description', 2, 2, 2, 'kuvaus', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (10, 'cached_image', 'Image', 'image', 'image', 3, NULL, NULL, 'cached_image', 'public fixture seed', FALSE, TRUE, FALSE, TRUE, FALSE, NULL),
  (10, 'vastuutiimi', 'Responsible team', 'text', 'details10', 4, 3, 3, 'vastuutiimi', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'user'),
  (10, 'tila', 'Status', 'text', 'details20', 5, 4, 4, 'tila', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'check-circle'),
  (10, 'prioriteetti', 'Priority', 'text', 'details30', 6, 5, 5, 'prioriteetti', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'alert-circle'),
  (10, 'pyyntotyyppi', 'Request type', 'text', 'details40', 7, 6, 6, 'pyyntotyyppi', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'layers'),
  (10, 'maarapaiva', 'Due date', 'date', 'details', 8, 7, 7, 'maarapaiva', 'public fixture seed', TRUE, TRUE, TRUE, FALSE, FALSE, 'calendar'),
  (10, 'palvelu_id', 'Service ID', 'integer', 'hidden', 9, NULL, NULL, 'palvelu_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (10, 'riski_id', 'Risk ID', 'integer', 'hidden', 10, NULL, NULL, 'riski_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (10, 'dokumentaatio_id', 'Document ID', 'integer', 'hidden', 11, NULL, NULL, 'dokumentaatio_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (10, 'cached_username', 'Username', 'character varying', 'username', 13, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL);

-- Actor metadata uses the same fields as upgrade registration (000002). The
-- cached name keeps its role until group B. co_number follows the physical column.
INSERT INTO public.system_column_details
    (table_uid, column_name, data_type, co_number, lang_key, card_element, insertable,
     editable_in_ui, hide_in_filter_panel, show_value_on_card, creation_spec)
SELECT registry.table_uid, actor.column_name, format_type(attribute.atttypid, attribute.atttypmod),
       attribute.attnum, actor.column_name, 'hidden', FALSE, FALSE, TRUE, TRUE, actor.spec
  FROM public.system_db_tables AS registry
 CROSS JOIN (VALUES ('created_by', 'WL58 row creator'), ('owner_id', 'WL58 row owner')) AS actor(column_name, spec)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = to_regclass(format('public.%I', registry.table_name)) AND attribute.attname = actor.column_name
 WHERE registry.table_name IN ('palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit');
-- Register every language-registry field for the built-in administration
-- views. These rows are presentation metadata only; editing remains disabled
-- until the dedicated Site settings -> Languages UI is implemented.
INSERT INTO public.system_column_details (
    table_uid,
    column_name,
    column_label,
    data_type,
    card_element,
    co_number,
    lang_key,
    creation_spec,
    show_key_on_card,
    show_value_on_card,
    editable_in_ui
)
SELECT registered.table_uid,
       columns.column_name,
       initcap(replace(columns.column_name, '_', ' ')),
       columns.data_type,
       'details',
       columns.ordinal_position,
       columns.column_name,
       'public normalized language metadata seed',
       FALSE,
       TRUE,
       FALSE
FROM information_schema.columns AS columns
JOIN public.system_db_tables AS registered
  ON registered.table_name = columns.table_name
 AND registered.schema_name = columns.table_schema
WHERE columns.table_schema = 'public'
  AND columns.table_name IN (
      'system_languages',
      'system_lang_key_translations',
      'system_embedding_refresh_jobs',
      'system_dataset_sort_defaults',
      'system_dataset_media'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_column_details AS existing
      WHERE existing.table_uid = registered.table_uid
        AND existing.column_name = columns.column_name
  )
ORDER BY registered.table_uid, columns.ordinal_position;

-- The embedding switches live on existing metadata tables, so register only
-- their newly added fields without manufacturing a second metadata source.
INSERT INTO public.system_column_details (
    table_uid,
    column_name,
    column_label,
    data_type,
    card_element,
    co_number,
    lang_key,
    creation_spec,
    show_key_on_card,
    show_value_on_card,
    editable_in_ui
)
SELECT registered.table_uid,
       columns.column_name,
       initcap(replace(columns.column_name, '_', ' ')),
       columns.data_type,
       'details',
       columns.ordinal_position,
       columns.column_name,
       'public embedding policy metadata seed',
       FALSE,
       TRUE,
       FALSE
FROM information_schema.columns AS columns
JOIN public.system_db_tables AS registered
  ON registered.table_name = columns.table_name
 AND registered.schema_name = columns.table_schema
WHERE columns.table_schema = 'public'
  AND (
      (columns.table_name = 'system_column_details'
       AND columns.column_name = 'external_embedding_allowed')
      OR
      (columns.table_name = 'system_db_tables'
       AND columns.column_name IN (
           'external_embedding_enabled',
           'external_embedding_policy_configured'
       ))
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_column_details AS existing
      WHERE existing.table_uid = registered.table_uid
        AND existing.column_name = columns.column_name
  )
ORDER BY registered.table_uid, columns.ordinal_position;

UPDATE public.system_column_details
SET insertable = FALSE
WHERE table_uid IN (7, 8, 9, 10)
  AND column_name = 'cached_username';

-- The file-upload relationship uses the same metadata contract as the runtime
-- Asset linking tool. It enables click and drag-and-drop image uploads while
-- keeping the parent row cached_image preview in sync.
WITH asset_relations(child_table, parent_table, fk_column, source_uid, target_uid) AS (
  VALUES
    ('palvelukatalogi_assets', 'palvelukatalogi', 'palvelukatalogi_id', 300, 7),
    ('riskienhallinta_assets', 'riskienhallinta', 'riskienhallinta_id', 301, 8),
    ('dokumentaatio_assets', 'dokumentaatio', 'dokumentaatio_id', 302, 9),
    ('tiketit_assets', 'tiketit', 'tiketit_id', 303, 10)
)
INSERT INTO public.system_foreign_key_relations_1_m
    (source_table_uid, target_table_uid, source_column_name, target_column_name,
     reference_direction, insert_new_source_with_target, target_insert_specs)
SELECT source_uid,
       target_uid,
       fk_column,
       'id',
       child_table || '->' || parent_table,
       TRUE,
       jsonb_build_object(
         'file_upload', jsonb_build_object(
           'enabled', TRUE,
           'profile_key', 'asset_linking',
           'asset_kinds', jsonb_build_array('image'),
           'allowed_file_types', jsonb_build_array(
             'jpg', 'jpeg', 'jfif', 'bmp', 'png', 'webp', 'avif',
             'gif', 'ico', 'tif', 'tiff', 'heic', 'heif'
           ),
           'filename_column', 'filename',
           'max_file_size_mb', 10,
           'target_directory', 'media',
           'cache_targets', jsonb_build_array(
             jsonb_build_object('table', parent_table, 'column', 'cached_image')
           ),
           'profiles', jsonb_build_object(
             'image', jsonb_build_object(
               'enabled', TRUE,
               'asset_kinds', jsonb_build_array('image'),
               'allowed_file_types', jsonb_build_array(
                 'jpg', 'jpeg', 'jfif', 'bmp', 'png', 'webp', 'avif',
                 'gif', 'ico', 'tif', 'tiff', 'heic', 'heif'
               ),
               'max_file_size_mb', 10,
               'target_directory', 'media',
               'cache_targets', jsonb_build_array(
                 jsonb_build_object('table', parent_table, 'column', 'cached_image')
               )
             )
           )
         )
       )
FROM asset_relations;

INSERT INTO public.palvelukatalogi
    (id, created_by, owner_id, cached_username, palvelu, kuvaus, omistava_tiimi,
     palvelutaso, tila, vastuuhenkilo)
VALUES (
    1,
    2,
    2,
    'teppo_tekija',
    json_build_object(
        'en', 'Design the services people can rely on',
        'fi', 'Muotoile palvelut, joihin ihmiset voivat luottaa',
        'yue', '設計大家可以信賴嘅服務'
    )::text,
    json_build_object(
        'en', 'Use Services to describe what your organization offers, who owns it, and what people can expect. This sample row and the whole table can be deleted; create one or several new tables whenever another structure fits your work better.',
        'fi', 'Kuvaa Palvelut-taulussa, mitä organisaatiosi tarjoaa, kuka palvelun omistaa ja mitä käyttäjät voivat odottaa. Voit poistaa tämän esimerkkirivin tai koko taulun ja luoda yhden tai useita uusia tauluja aina, kun jokin toinen rakenne palvelee työtäsi paremmin.',
        'yue', '喺服務資料表描述機構提供乜嘢、由邊個負責，同埋使用者可以期待乜嘢。你可以刪除呢個示例資料列或者成個資料表，亦可以按工作需要建立一個或多個新資料表。'
    )::text,
    json_build_object('en', 'Your organization', 'fi', 'Sinun organisaatiosi', 'yue', '你嘅機構')::text,
    json_build_object('en', 'Define the promise', 'fi', 'Määritä palvelulupaus', 'yue', '訂明服務承諾')::text,
    json_build_object('en', 'Example', 'fi', 'Esimerkki', 'yue', '示例')::text,
    json_build_object('en', 'Choose an owner', 'fi', 'Valitse omistaja', 'yue', '選擇負責人')::text
);

INSERT INTO public.riskienhallinta
    (id, created_by, owner_id, cached_username, palvelu_id, riski, kuvaus, vaikutus, riskitaso, tila,
     omistava_tiimi, todennakoisyys, alentamistoimet)
VALUES (
    1,
    2,
    2,
    'teppo_tekija',
    1,
    json_build_object(
        'en', 'Make uncertainty actionable',
        'fi', 'Muuta epävarmuus toiminnaksi',
        'yue', '將不確定性變成行動'
    )::text,
    json_build_object(
        'en', 'Capture an uncertain event, its causes, and the consequence that matters so the right people can decide what to do.',
        'fi', 'Kirjaa epävarma tapahtuma, sen syyt ja merkityksellinen seuraus, jotta oikeat ihmiset voivat päättää tarvittavista toimista.',
        'yue', '記錄不確定事件、成因同重要後果，等合適嘅人可以決定下一步。'
    )::text,
    json_build_object('en', 'Define the consequence', 'fi', 'Määritä seuraus', 'yue', '訂明後果')::text,
    json_build_object('en', 'Assess it together', 'fi', 'Arvioi yhdessä', 'yue', '一齊評估')::text,
    json_build_object('en', 'Example', 'fi', 'Esimerkki', 'yue', '示例')::text,
    json_build_object('en', 'Choose an owner', 'fi', 'Valitse omistaja', 'yue', '選擇負責人')::text,
    json_build_object('en', 'Estimate honestly', 'fi', 'Arvioi rehellisesti', 'yue', '如實估計')::text,
    json_build_object(
        'en', 'Use Risks to agree on ownership and practical mitigation instead of merely listing worries. This sample risk and the whole table are disposable; keep the structure, reshape it, or replace it with new tables that fit your decisions.',
        'fi', 'Sopikaa Riskit-taulussa omistajuudesta ja käytännön hallintatoimista pelkän huolilistan sijaan. Voit poistaa tämän esimerkkiriskin tai koko taulun, muokata rakennetta tai korvata sen päätöksillesi paremmin sopivilla uusilla tauluilla.',
        'yue', '用風險資料表協定負責人同實際緩解措施，而唔係淨係列出憂慮。你可以刪除呢個示例風險或者成個資料表、調整結構，或者建立更配合決策嘅新資料表。'
    )::text
);

INSERT INTO public.dokumentaatio
    (id, created_by, owner_id, cached_username, palvelu_id, otsikko, kohdetiimi,
     ohje, paivitetty, voimassaolo)
VALUES
  (
    1,
    2,
    2,
    'teppo_tekija',
    1,
    json_build_object('en', 'Start here', 'fi', 'Aloita tästä', 'yue', '由此開始')::text,
    json_build_object('en', 'New administrators', 'fi', 'Uudet ylläpitäjät', 'yue', '新管理員')::text,
    json_build_object(
        'en', 'This small workspace is yours to reshape. Every example row is synthetic, and every content row, document, and content table can be edited or deleted. Create one new table or several connected tables when you are ready to model your own work.',
        'fi', 'Tämä pieni työtila on sinun muokattavissasi. Kaikki esimerkkirivit ovat synteettisiä, ja jokaisen sisältörivin, dokumentin sekä sisältötaulun voi muokata tai poistaa. Luo yksi uusi taulu tai useita toisiinsa liittyviä tauluja, kun olet valmis mallintamaan oman työsi.',
        'yue', '呢個細小工作區由你自由重塑。所有示例資料都係合成內容，而每個內容資料列、文件同內容資料表都可以編輯或刪除。準備好建立自己嘅工作模型時，可以新增一個資料表或者多個互相關聯嘅資料表。'
    )::text,
    DATE '2026-08-04',
    json_build_object('en', 'Current', 'fi', 'Voimassa', 'yue', '現行')::text
  ),
  (
    2,
    2,
    2,
    'teppo_tekija',
    NULL,
    json_build_object('en', 'First dataset', 'fi', 'Ensimmäinen tietoaineisto', 'yue', '第一個資料集')::text,
    json_build_object('en', 'Workspace builders', 'fi', 'Työtilan rakentajat', 'yue', '工作區建立者')::text,
    json_build_object(
        'en', 'Begin with one list people already understand. Give every column a clear purpose, choose the full-name or title field that heads each card, and add multilingual fields only where readers truly need them. You can delete this guide, any other row, or an entire table after it has served its purpose.',
        'fi', 'Aloita yhdestä listasta, jonka ihmiset jo ymmärtävät. Anna jokaiselle sarakkeelle selkeä tarkoitus, valitse korttien otsikkona toimiva nimi- tai otsikkokenttä ja lisää monikielisiä kenttiä vain todelliseen tarpeeseen. Voit poistaa tämän ohjeen, minkä tahansa muun rivin tai kokonaisen taulun, kun se on täyttänyt tehtävänsä.',
        'yue', '由一張大家已經明白嘅清單開始。為每個欄位設定清楚用途、選擇用作卡片標題嘅全名或者標題欄位，只喺讀者真正需要時加入多語言欄位。呢份指引、任何其他資料列或者成個資料表完成用途後都可以刪除。'
    )::text,
    DATE '2026-08-04',
    json_build_object('en', 'Current', 'fi', 'Voimassa', 'yue', '現行')::text
  ),
  (
    3,
    2,
    2,
    'teppo_tekija',
    NULL,
    json_build_object(
        'en', 'Browse, filter and manage data',
        'fi', 'Selaa, suodata ja hallitse tietoja',
        'yue', '瀏覽、篩選同管理資料'
    )::text,
    json_build_object('en', 'Filterest administrators', 'fi', 'Filterest-ylläpitäjät', 'yue', 'Filterest 管理員')::text,
    json_build_object(
        'en', 'Open a table from the navigation, switch between cards and rows, search and filter, then open one item and make a harmless edit. The sample service, risk, ticket, documents, and even their tables are safe to remove; the point is to leave you with the workspace your work actually needs.',
        'fi', 'Avaa taulu navigaatiosta, vaihda kortti- ja rivinäkymien välillä, hae ja suodata sekä avaa lopuksi yksi kohde ja tee vaaraton muokkaus. Esimerkkipalvelun, -riskin, -tiketin, dokumentit ja jopa niiden taulut voi turvallisesti poistaa; tavoitteena on jättää jäljelle juuri sinun työhösi sopiva työtila.',
        'yue', '由導覽開啟資料表、喺卡片同資料列檢視之間切換、搜尋同篩選，再開啟一項內容作一次無害修改。示例服務、風險、工單、文件，甚至相關資料表都可以安全刪除；重點係最後留下真正配合你工作需要嘅工作區。'
    )::text,
    DATE '2026-08-04',
    json_build_object('en', 'Current', 'fi', 'Voimassa', 'yue', '現行')::text
  );

INSERT INTO public.tiketit
    (id, created_by, owner_id, cached_username, palvelu_id, riski_id, dokumentaatio_id,
     otsikko, vastuutiimi, maarapaiva, tila, prioriteetti, pyyntotyyppi, kuvaus)
VALUES (
    1,
    2,
    2,
    'teppo_tekija',
    1,
    1,
    3,
    json_build_object(
        'en', 'Turn a request into visible work',
        'fi', 'Muuta pyyntö näkyväksi työksi',
        'yue', '將請求變成可見工作'
    )::text,
    json_build_object('en', 'Choose a responsible team', 'fi', 'Valitse vastuutiimi', 'yue', '選擇負責團隊')::text,
    NULL,
    json_build_object('en', 'Example', 'fi', 'Esimerkki', 'yue', '示例')::text,
    json_build_object('en', 'Set the priority', 'fi', 'Aseta prioriteetti', 'yue', '設定優先次序')::text,
    json_build_object('en', 'Choose a workflow', 'fi', 'Valitse työnkulku', 'yue', '選擇工作流程')::text,
    json_build_object(
        'en', 'Use Tickets to give requests an owner, state, priority, and next step so work does not disappear into messages. This sample ticket and the whole table can be deleted; keep it only if a ticket workflow helps, or create different tables for the work you really manage.',
        'fi', 'Anna Tiketit-taulussa pyynnöille omistaja, tila, prioriteetti ja seuraava askel, jotta työ ei huku viesteihin. Voit poistaa tämän esimerkkitiketin tai koko taulun; säilytä se vain, jos tikettityönkulku auttaa, tai luo hallitsemallesi työlle paremmin sopivat taulut.',
        'yue', '用工單資料表為請求設定負責人、狀態、優先次序同下一步，避免工作消失喺訊息之中。你可以刪除呢個示例工單或者成個資料表；只喺工單流程有幫助時保留，否則可以為真正管理嘅工作建立其他資料表。'
    )::text
);

-- User-reviewed starter-row images captured from the verified asset-linking
-- upload flow. IDs, parent links, source metadata, ordering, and primary flags
-- match the accepted Filterest preview. The first startup for a strictly newer
-- media revision materializes only missing runtime copies. The completed
-- revision never overwrites or recreates operator-managed copies on restart.
INSERT INTO public.palvelukatalogi_assets
    (id, palvelukatalogi_id, asset_kind, filename, original_name, mime_type,
     size_bytes, title, description, sort_order, is_primary, metadata_json,
     created, updated)
VALUES (
    1, 1, 'image', '7_1_1.jpg',
    'service-collaboration.jpg', 'image/jpeg', 610101,
    'Service collaboration', NULL, 0, TRUE, NULL,
    TIMESTAMPTZ '2026-08-05 09:45:43.961655+03:00',
    TIMESTAMPTZ '2026-08-05 09:45:43.961655+03:00'
);

INSERT INTO public.riskienhallinta_assets
    (id, riskienhallinta_id, asset_kind, filename, original_name, mime_type,
     size_bytes, title, description, sort_order, is_primary, metadata_json,
     created, updated)
VALUES (
    1, 1, 'image', '8_1_1.jpg',
    'risk-workshop.jpg',
    'image/jpeg', 1091024,
    'Risk workshop',
    NULL, 0, FALSE, NULL,
    TIMESTAMPTZ '2026-08-05 09:51:48.525668+03:00',
    TIMESTAMPTZ '2026-08-05 09:51:48.525668+03:00'
);

INSERT INTO public.tiketit_assets
    (id, tiketit_id, asset_kind, filename, original_name, mime_type,
     size_bytes, title, description, sort_order, is_primary, metadata_json,
     created, updated)
VALUES (
    1, 1, 'image', '10_1_1.jpg',
    'ticket-teamwork.jpg',
    'image/jpeg', 498575,
    'Ticket teamwork',
    NULL, 0, FALSE, NULL,
    TIMESTAMPTZ '2026-08-05 09:56:43.752346+03:00',
    TIMESTAMPTZ '2026-08-05 09:56:43.752346+03:00'
);

INSERT INTO public.palvelukatalogi_riskienhallinta_relation (palvelu_id, riski_id)
VALUES (1, 1);
INSERT INTO public.palvelukatalogi_dokumentaatio_relation (palvelu_id, dokumentaatio_id)
VALUES (1, 1);
INSERT INTO public.palvelukatalogi_tiketit_relation (palvelu_id, tiketti_id)
VALUES (1, 1);
INSERT INTO public.riskienhallinta_dokumentaatio_relation (riski_id, dokumentaatio_id)
VALUES (1, 1);
INSERT INTO public.riskienhallinta_tiketit_relation (riski_id, tiketti_id)
VALUES (1, 1);
INSERT INTO public.dokumentaatio_tiketit_relation (dokumentaatio_id, tiketti_id)
VALUES (3, 1);

-- Bind starter rows to reviewed image names. Startup fills only missing files
-- for these names and never overwrites an existing mutable runtime copy.
UPDATE public.palvelukatalogi SET cached_image = '7_1_1.jpg' WHERE id = 1;
UPDATE public.riskienhallinta SET cached_image = '8_1_1.jpg' WHERE id = 1;
UPDATE public.dokumentaatio
SET cached_image = CASE id
    WHEN 1 THEN '9_1_1.png'
    WHEN 2 THEN '9_2_1.png'
    WHEN 3 THEN '9_3_1.png'
END
WHERE id IN (1, 2, 3);
UPDATE public.tiketit SET cached_image = '10_1_1.jpg' WHERE id = 1;

SELECT setval(pg_get_serial_sequence('public.palvelukatalogi','id'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('public.riskienhallinta','id'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('public.dokumentaatio','id'), 3, TRUE);
SELECT setval(pg_get_serial_sequence('public.tiketit','id'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('public.palvelukatalogi_assets','id'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('public.riskienhallinta_assets','id'), 1, TRUE);
SELECT setval(pg_get_serial_sequence('public.tiketit_assets','id'), 1, TRUE);
-- Filterest public bootstrap: menus and field labels for the established mock
-- workspace. Cantonese is stored in the first-class yue language column.

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('palvelukatalogi', 'Palvelut', 'Services', '服务', '服務', 'public fixture seed'),
  ('palvelukatalogi_front_page', 'Palvelut', 'Services', '服务', '服務', 'public fixture seed'),
  ('search_slogan_palvelukatalogi', 'Löydä palveluja nimen, omistajan tai palvelutason perusteella.', 'Find services by name, owner, or service level.', '按名称、负责人或服务级别查找服务。', '按名稱、負責人或者服務級別搵服務。', 'public fixture seed'),
  ('search_for_palvelukatalogi', 'Hae palveluja nimellä, omistajalla tai palvelutasolla', 'Search services by name, owner, or service level', '按名称、负责人或服务级别搜索服务', '按名稱、負責人或者服務級別搜尋服務', 'public fixture seed'),
  ('add_row_palvelukatalogi', 'Lisää palvelu', 'Add service', '添加服务', '新增服務', 'public fixture seed'),

  ('tiketit', 'Tiketit', 'Tickets', '工单', '工單', 'public fixture seed'),
  ('tiketit_front_page', 'Tiketit', 'Tickets', '工单', '工單', 'public fixture seed'),
  ('search_slogan_tiketit', 'Löydä tikettejä otsikon, tilan, prioriteetin tai vastuutiimin perusteella.', 'Find tickets by title, status, priority, or responsible team.', '按标题、状态、优先级或负责团队查找工单。', '按標題、狀態、優先次序或者負責團隊搵工單。', 'public fixture seed'),
  ('search_for_tiketit', 'Hae tikettejä otsikolla, tilalla, prioriteetilla tai vastuutiimillä', 'Search tickets by title, status, priority, or responsible team', '按标题、状态、优先级或负责团队搜索工单', '按標題、狀態、優先次序或者負責團隊搜尋工單', 'public fixture seed'),
  ('add_row_tiketit', 'Lisää tiketti', 'Add ticket', '添加工单', '新增工單', 'public fixture seed'),

  ('riskienhallinta', 'Riskit', 'Risks', '风险', '風險', 'public fixture seed'),
  ('riskienhallinta_front_page', 'Riskit', 'Risks', '风险', '風險', 'public fixture seed'),
  ('search_slogan_riskienhallinta', 'Löydä riskejä vaikutuksen, riskitason tai vastuutiimin perusteella.', 'Find risks by impact, risk level, or responsible team.', '按影响、风险等级或负责团队查找风险。', '按影響、風險等級或者負責團隊搵風險。', 'public fixture seed'),
  ('search_for_riskienhallinta', 'Hae riskejä vaikutuksella, riskitasolla tai vastuutiimillä', 'Search risks by impact, risk level, or responsible team', '按影响、风险等级或负责团队搜索风险', '按影響、風險等級或者負責團隊搜尋風險', 'public fixture seed'),
  ('add_row_riskienhallinta', 'Lisää riski', 'Add risk', '添加风险', '新增風險', 'public fixture seed'),

  ('dokumentaatio', 'Dokumentaatio', 'Documentation', '文档', '文件', 'public fixture seed'),
  ('dokumentaatio_front_page', 'Dokumentaatio', 'Documentation', '文档', '文件', 'public fixture seed'),
  ('search_slogan_dokumentaatio', 'Löydä ohjeita otsikon, kohdetiimin tai voimassaolon perusteella.', 'Find guidance by title, audience, or validity.', '按标题、目标团队或有效性查找文档。', '按標題、目標團隊或者有效性搵文件。', 'public fixture seed'),
  ('search_for_dokumentaatio', 'Hae ohjeita otsikolla, kohdetiimillä tai voimassaololla', 'Search guidance by title, audience, or validity', '按标题、目标团队或有效性搜索文档', '按標題、目標團隊或者有效性搜尋文件', 'public fixture seed'),
  ('add_row_dokumentaatio', 'Lisää dokumentti', 'Add document', '添加文档', '新增文件', 'public fixture seed'),

  -- Image-asset datasets use curated public labels instead of exposing their
  -- technical table names or generated "front page" search copy.
  ('palvelukatalogi_assets', 'Palvelukuvat', 'Service images', '服务图片', '服務圖片', 'public fixture seed'),
  ('palvelukatalogi_assets_front_page', 'Palvelukuvat', 'Service images', '服务图片', '服務圖片', 'public fixture seed'),
  ('search_slogan_palvelukatalogi_assets', 'Hallinnoi palveluihin liitettyjä kuvia ja niiden kuvauksia.', 'Manage images linked to services and their descriptions.', '管理与服务关联的图片及其说明。', '管理同服務相關嘅圖片同說明。', 'public fixture seed'),
  ('search_for_palvelukatalogi_assets', 'Hae palvelukuvia tiedostonimellä tai kuvauksella', 'Search service images by filename or description', '按文件名或说明搜索服务图片', '按檔案名稱或者說明搜尋服務圖片', 'public fixture seed'),

  ('riskienhallinta_assets', 'Riskikuvat', 'Risk images', '风险图片', '風險圖片', 'public fixture seed'),
  ('riskienhallinta_assets_front_page', 'Riskikuvat', 'Risk images', '风险图片', '風險圖片', 'public fixture seed'),
  ('search_slogan_riskienhallinta_assets', 'Hallinnoi riskejä, vaikutuksia ja hallintatoimia havainnollistavia kuvia.', 'Manage images that illustrate risks, impacts, and mitigating actions.', '管理用于说明风险、影响和应对措施的图片。', '管理用嚟說明風險、影響同應對措施嘅圖片。', 'public fixture seed'),
  ('search_for_riskienhallinta_assets', 'Hae riskikuvia tiedostonimellä tai kuvauksella', 'Search risk images by filename or description', '按文件名或说明搜索风险图片', '按檔案名稱或者說明搜尋風險圖片', 'public fixture seed'),

  ('dokumentaatio_assets', 'Dokumentaation kuvat', 'Documentation images', '文档图片', '文件圖片', 'public fixture seed'),
  ('dokumentaatio_assets_front_page', 'Dokumentaation kuvat', 'Documentation images', '文档图片', '文件圖片', 'public fixture seed'),
  ('search_slogan_dokumentaatio_assets', 'Hallinnoi ohjeissa ja dokumentaatiossa käytettäviä kuvia sekä niiden kuvauksia.', 'Manage images used in guidance and documentation, together with their descriptions.', '管理指南和文档中使用的图片及其说明。', '管理指南同文件使用嘅圖片同說明。', 'public fixture seed'),
  ('search_for_dokumentaatio_assets', 'Hae dokumentaation kuvia tiedostonimellä tai kuvauksella', 'Search documentation images by filename or description', '按文件名或说明搜索文档图片', '按檔案名稱或者說明搜尋文件圖片', 'public fixture seed'),

  ('tiketit_assets', 'Tikettien kuvat', 'Ticket images', '工单图片', '工單圖片', 'public fixture seed'),
  ('tiketit_assets_front_page', 'Tikettien kuvat', 'Ticket images', '工单图片', '工單圖片', 'public fixture seed'),
  ('search_slogan_tiketit_assets', 'Hallinnoi tiketteihin liitettyjä kuvakaappauksia, kuvia ja kuvauksia.', 'Manage screenshots, images, and descriptions linked to tickets.', '管理与工单关联的截图、图片和说明。', '管理同工單相關嘅螢幕截圖、圖片同說明。', 'public fixture seed'),
  ('search_for_tiketit_assets', 'Hae tikettien kuvia tiedostonimellä tai kuvauksella', 'Search ticket images by filename or description', '按文件名或说明搜索工单图片', '按檔案名稱或者說明搜尋工單圖片', 'public fixture seed'),

  ('palvelu', 'Palvelu', 'Service', '服务', '服務', 'public fixture seed'),
  ('kuvaus', 'Kuvaus', 'Description', '描述', '描述', 'public fixture seed'),
  ('omistava_tiimi', 'Omistava tiimi', 'Owning team', '负责团队', '負責團隊', 'public fixture seed'),
  ('palvelutaso', 'Palvelutaso', 'Service level', '服务级别', '服務級別', 'public fixture seed'),
  ('tila', 'Tila', 'Status', '状态', '狀態', 'public fixture seed'),
  ('vastuuhenkilo', 'Vastuuhenkilö', 'Owner', '负责人', '負責人', 'public fixture seed'),
  ('riski', 'Riski', 'Risk', '风险', '風險', 'public fixture seed'),
  ('vaikutus', 'Vaikutus', 'Impact', '影响', '影響', 'public fixture seed'),
  ('riskitaso', 'Riskitaso', 'Risk level', '风险级别', '風險級別', 'public fixture seed'),
  ('todennakoisyys', 'Todennäköisyys', 'Likelihood', '可能性', '可能性', 'public fixture seed'),
  ('alentamistoimet', 'Hallintatoimet', 'Mitigation', '缓解措施', '緩解措施', 'public fixture seed'),
  ('otsikko', 'Otsikko', 'Title', '标题', '標題', 'public fixture seed'),
  ('kohdetiimi', 'Kohdetiimi', 'Target team', '目标团队', '目標團隊', 'public fixture seed'),
  ('ohje', 'Ohje', 'Guidance', '指南', '指引', 'public fixture seed'),
  ('paivitetty', 'Katselmoitu', 'Reviewed', '审核日期', '審查日期', 'public fixture seed'),
  ('voimassaolo', 'Voimassaolo', 'Validity', '有效性', '有效性', 'public fixture seed'),
  ('vastuutiimi', 'Vastuutiimi', 'Responsible team', '负责团队', '負責團隊', 'public fixture seed'),
  ('maarapaiva', 'Määräpäivä', 'Due date', '截止日期', '截止日期', 'public fixture seed'),
  ('prioriteetti', 'Prioriteetti', 'Priority', '优先级', '優先次序', 'public fixture seed'),
  ('pyyntotyyppi', 'Pyyntötyyppi', 'Request type', '请求类型', '請求類型', 'public fixture seed'),
  ('cached_image', 'Kuva', 'Image', '图片', '圖片', 'public fixture seed'),
  ('cached_username', 'Käyttäjänimi', 'Username', '用户名', '用戶名稱', 'public fixture seed'),
  ('search_for_cached_username', 'Hae käyttäjänimellä', 'Search by username', '按用户名搜索', '按用戶名稱搜尋', 'public fixture seed'),
  ('sort_images_first', 'Kuvalliset ensin', 'Rows with images first', '有图片的行优先', '有圖片嘅資料列優先', 'public fixture seed'),

  -- Travel datasets keep exact bilingual navigation names before and after
  -- the planned app_ technical-prefix normalization. Other locales fall back
  -- to English until project-owned translations are authored and reviewed.
  ('travel_info', 'Matkainfo', 'Travel info', '', '', 'curated bilingual travel dataset label'),
  ('travel_info_front_page', 'Matkainfo', 'Travel information', '', '', 'curated bilingual travel dataset hero label'),
  ('app_travel_info', 'Matkainfo', 'Travel info', '', '', 'curated bilingual travel dataset label'),
  ('travel_deals', 'Matkatarjoukset', 'Travel deals', '', '', 'curated bilingual travel dataset label'),
  ('app_travel_deals', 'Matkatarjoukset', 'Travel deals', '', '', 'curated bilingual travel dataset label'),

  -- Calendar presentation controls are product-owned copy. They must be
  -- available before the view renders; the public runtime never calls AI to
  -- repair missing translations.
  ('calendar_month', 'Kuukausi', 'Month', '月', '月', 'public fixture seed'),
  ('calendar_week', 'Viikko', 'Week', '周', '週', 'public fixture seed'),
  ('calendar_day', 'Päivä', 'Day', '日', '日', 'public fixture seed'),
  ('calendar_agenda', 'Agenda', 'Agenda', '日程', '議程', 'public fixture seed'),
  ('calendar_today', 'Tänään', 'Today', '今天', '今日', 'public fixture seed'),
  ('calendar_no_events', 'Ei tapahtumia', 'No events', '没有事件', '冇活動', 'public fixture seed'),
  ('calendar_no_date_column', 'Kalenterille sopivaa päivämääräkenttää ei löytynyt', 'No calendar date column found', '未找到日历日期字段', '搵唔到日曆日期欄位', 'public fixture seed'),

  -- Shared navigation and tool labels rendered by the public application shell.
  ('account', 'Tili', 'Account', '账户', '帳戶', 'public fixture seed'),
  ('logout', 'Kirjaudu ulos', 'Logout', '退出登录', '登出', 'public fixture seed'),
  ('privacy_notice_login_acceptance', 'Kirjautuaksesi sinun on hyväksyttävä tietosuojaseloste.', 'To sign in, you must accept the privacy notice.', '登录前，您必须接受隐私声明。', '登入前，你必須接受私隱聲明。', 'Single linked sentence beside the sign-in privacy acceptance checkbox.'),
  ('privacy_notice_login_acceptance_prefix', 'Kirjautuaksesi sinun on hyväksyttävä ', 'To sign in, you must accept the ', '登录前，您必须接受', '登入前，你必須接受', 'Plain-text prefix before the linked privacy notice name; spacing is intentional for languages that use it.'),
  ('privacy_notice_login_acceptance_link', 'tietosuojaseloste', 'privacy notice', '隐私声明', '私隱聲明', 'Only the privacy notice name linked to the notice modal in the login acceptance sentence.'),
  ('privacy_notice_login_acceptance_suffix', '.', '.', '。', '。', 'Plain-text locale-specific sentence terminator after the linked privacy notice name.'),
  ('filter_mode_exact_value', 'Tarkka arvo', 'Exact value', '精确值', '精確值', 'Tooltip and accessible name for the filter mode that matches one exact value.'),
  ('filter_mode_range', 'Arvoväli', 'Range', '范围', '範圍', 'Tooltip and accessible name for the filter mode that matches a lower-to-upper range.'),
  ('filter_mode_condition_expression', 'Ehto tai lauseke', 'Condition or expression', '条件或表达式', '條件或運算式', 'Tooltip and accessible name for the filter mode that accepts a condition or expression.'),
  ('system_config', 'Järjestelmäasetukset', 'System configuration', '系统配置', '系統設定', 'public fixture seed'),
  ('users', 'Käyttäjät', 'Users', '用户', '用戶', 'public fixture seed'),
  ('system_users_front_page', 'Käyttäjät', 'Users', '用户', '用戶', 'public fixture seed'),
  ('search_slogan_system_users', 'Löydä käyttäjiä nimen, käyttäjätunnuksen tai käyttöoikeusryhmän perusteella.', 'Find users by name, username, or permission group.', '按姓名、用户名或权限组查找用户。', '按姓名、用戶名稱或者權限群組搵用戶。', 'public fixture seed'),
  ('search_for_system_users', 'Hae käyttäjiä nimellä, käyttäjätunnuksella tai käyttöoikeusryhmällä', 'Search users by name, username, or permission group', '按姓名、用户名或权限组搜索用户', '按姓名、用戶名稱或者權限群組搜尋用戶', 'public fixture seed'),
  ('admin_and_development_tools', 'Ylläpidon ja kehityksen työkalut', 'Admin and development tools', '管理和开发工具', '管理及開發工具', 'public fixture seed'),
  ('admin_tools', 'Ylläpidon työkalut', 'Admin tools', '管理工具', '管理工具', 'public fixture seed'),
  ('permissions', 'Käyttöoikeudet', 'Permissions', '权限', '權限', 'public fixture seed'),
  ('table_tools', 'Taulutyökalut', 'Table tools', '表格工具', '資料表工具', 'public fixture seed'),
  ('create_table', 'Luo taulu', 'Create table', '创建表格', '建立資料表', 'public fixture seed'),
  ('foreign_keys', 'Vierasavaimet', 'Foreign keys', '外键', '外鍵', 'public fixture seed'),
  ('asset_linking', 'Assettien linkitys', 'Asset linking', '资源关联', '資產連結', 'public fixture seed'),
  ('card_visibility', 'Korttien näkyvyys', 'Card visibility', '卡片可见性', '卡片顯示設定', 'public fixture seed'),
  ('service_catalog_moderation', 'Palvelukatalogin moderointi', 'Service catalog moderation', '服务目录审核', '服務目錄審核', 'public fixture seed'),
  ('child_tab_config', 'Alivälilehtien asetukset', 'Child tab configuration', '子标签页配置', '子分頁設定', 'public fixture seed'),
  ('dataset_alias_management', 'Tietojoukkoaliasten hallinta', 'Dataset alias management', '数据集别名管理', '資料集別名管理', 'public fixture seed'),
  ('dataset_header_config', 'Tietojoukko-otsikoiden asetukset', 'Dataset header configuration', '数据集标题配置', '資料集標題設定', 'public fixture seed'),
  ('maintenance', 'Ylläpito', 'Maintenance', '维护', '維護', 'public fixture seed'),
  ('add_notification_trigger', 'Lisää ilmoituslaukaisin', 'Add notification trigger', '添加通知触发器', '新增通知觸發器', 'public fixture seed'),
  ('refresh_embeddings', 'Päivitä upotukset', 'Refresh embeddings', '刷新嵌入', '更新嵌入資料', 'public fixture seed'),
  ('check_json_columns', 'Tarkista JSON-sarakkeet', 'Check JSON columns', '检查 JSON 列', '檢查 JSON 欄位', 'public fixture seed'),
  ('database_consistency', 'Tietokannan eheys', 'Database consistency', '数据库一致性', '資料庫一致性', 'public fixture seed'),
  ('empty_rows', 'Tyhjät rivit', 'Empty rows', '空行', '空白資料列', 'public fixture seed'),
  ('fix_media_subfolders', 'Korjaa median alikansiot', 'Fix media subfolders', '修复媒体子文件夹', '修正媒體子資料夾', 'public fixture seed'),
  ('check_and_fix_all_datasets', 'Tarkista ja korjaa kaikki aineistot', 'Check & fix all datasets', '检查并修复所有数据集', '檢查並修正所有資料集', 'public fixture seed'),
  ('check_all_media_subfolders', 'Tarkista kaikki aineistot', 'Check all datasets', '检查所有数据集', '檢查所有資料集', 'public fixture seed'),
  ('fk_cache_triggers', 'Vierasavainvälimuistin laukaisimet', 'Foreign-key cache triggers', '外键缓存触发器', '外鍵快取觸發器', 'public fixture seed'),
  ('translation_helper', 'Käännösavustaja', 'Translation helper', '翻译助手', '翻譯助手', 'public fixture seed'),
  ('text_index_maintenance', 'Teksti-indeksien ylläpito', 'Text index maintenance', '文本索引维护', '文字索引維護', 'public fixture seed'),
  ('user_tools', 'Käyttäjän työkalut', 'User tools', '用户工具', '用戶工具', 'public fixture seed'),
  ('create', 'Luo', 'Create', '创建', '建立', 'public fixture seed'),
  ('user', 'Käyttäjä', 'User', '用户', '用戶', 'public fixture seed'),
  ('register', 'Rekisteröidy', 'Register', '注册', '註冊', 'public fixture seed'),
  ('database', 'Tietokanta', 'Database', '数据库', '資料庫', 'public fixture seed'),
  ('system', 'Järjestelmä', 'System', '系统', '系統', 'public fixture seed'),
  ('development', 'Kehitys', 'Development', '开发', '開發', 'public fixture seed'),
  ('apps', 'Sovellukset', 'Apps', '应用', '應用程式', 'public fixture seed'),
  ('filterest', 'Filterest', 'Filterest', 'Filterest', 'Filterest', 'public fixture seed'),
  ('users_and_groups', 'Käyttäjät ja ryhmät', 'Users and groups', '用户与用户组', '用戶同群組', 'public fixture seed'),
  ('logs', 'Lokit', 'Logs', '日志', '日誌', 'public fixture seed'),
  ('mgmt_helpers', 'Hallinnan apurakenteet', 'Management helpers', '管理辅助项', '管理輔助項目', 'public fixture seed'),
  ('functions_and_rights', 'Toiminnot ja oikeudet', 'Functions and rights', '功能与权限', '功能同權限', 'public fixture seed'),
  ('about', 'Tietoja', 'About', '关于', '關於', 'public fixture seed'),
  ('lang', 'Kielet', 'Language', '语言', '語言', 'public fixture seed'),
  ('tables', 'Taulut', 'Tables', '表格', '資料表', 'public fixture seed'),
  ('columns', 'Sarakkeet', 'Columns', '列', '欄位', 'public fixture seed'),
  ('other_tables', 'Muut taulut', 'Other tables', '其他表格', '其他資料表', 'public fixture seed'),

  -- Public runtime tables and fixture relations shown in the database tree.
  ('ai_chat_conversations', 'AI-keskustelut', 'AI chat conversations', 'AI 聊天记录', 'AI 對話', 'public fixture seed'),
  ('dokumentaatio_tiketit_relation', 'Dokumenttien ja tikettien relaatiot', 'Document and ticket relations', '文档与工单关系', '文件與工單關係', 'public fixture seed'),
  ('palvelukatalogi_dokumentaatio_relation', 'Palvelujen ja dokumenttien relaatiot', 'Service and document relations', '服务与文档关系', '服務與文件關係', 'public fixture seed'),
  ('palvelukatalogi_riskienhallinta_relation', 'Palvelujen ja riskien relaatiot', 'Service and risk relations', '服务与风险关系', '服務與風險關係', 'public fixture seed'),
  ('palvelukatalogi_tiketit_relation', 'Palvelujen ja tikettien relaatiot', 'Service and ticket relations', '服务与工单关系', '服務與工單關係', 'public fixture seed'),
  ('payments', 'Maksut', 'Payments', '付款', '付款', 'public fixture seed'),
  ('riskienhallinta_dokumentaatio_relation', 'Riskien ja dokumenttien relaatiot', 'Risk and document relations', '风险与文档关系', '風險與文件關係', 'public fixture seed'),
  ('riskienhallinta_tiketit_relation', 'Riskien ja tikettien relaatiot', 'Risk and ticket relations', '风险与工单关系', '風險與工單關係', 'public fixture seed'),
  ('spatial_ref_sys', 'Koordinaattijärjestelmät', 'Spatial reference systems', '空间参考系统', '空間參考系統', 'public fixture seed'),
  ('system_about', 'Tietoa', 'About', '关于', '關於', 'public fixture seed'),
  ('system_audit_log', 'Auditointiloki', 'Audit log', '审计日志', '稽核記錄', 'public fixture seed'),
  ('system_child_tab_config', 'Alivälilehtien asetukset', 'Child tab configuration', '子标签页配置', '子分頁設定', 'public fixture seed'),
  ('system_column_control', 'Sarakkeiden hallinta', 'Column control', '列控制', '欄位控制', 'public fixture seed'),
  ('system_column_details', 'Sarakkeiden tiedot', 'Column details', '列详情', '欄位詳細資料', 'public fixture seed'),
  ('system_db_tables', 'Tietokannan taulut', 'Database tables', '数据库表', '資料庫資料表', 'public fixture seed'),
  ('system_db_version', 'Tietokantaversio', 'Database version', '数据库版本', '資料庫版本', 'public fixture seed'),
  ('system_embedding_refresh_jobs', 'Embedding-päivitysjono', 'Embedding refresh jobs', '嵌入刷新任务', '嵌入重新整理工作', 'public fixture seed'),
  ('system_dataset_sort_defaults', 'Taulujen lajitteluoletukset', 'Dataset Sort Defaults', '数据表排序默认值', '資料表排序預設值', 'public fixture seed'),
  ('system_dataset_media', 'Tietojoukkojen kuvat', 'Dataset Media', '数据集媒体', '資料集媒體', 'public fixture seed'),
  ('system_foreign_key_relations_1_m', 'Vierasavainrelaatiot 1:M', 'Foreign-key relations 1:M', '外键关系 1:M', '外鍵關係 1:M', 'public fixture seed'),
  ('system_foreign_key_relations_m_m', 'Vierasavainrelaatiot M:M', 'Foreign-key relations M:M', '外键关系 M:M', '外鍵關係 M:M', 'public fixture seed'),
  ('system_functions', 'Järjestelmätoiminnot', 'System functions', '系统功能', '系統功能', 'public fixture seed'),
  ('system_group_table_func_rights', 'Ryhmien taulutoimintojen oikeudet', 'Group table-function rights', '组表功能权限', '群組資料表功能權限', 'public fixture seed'),
  ('system_languages', 'Kielet', 'Languages', '语言', '語言', 'Static database-tree label for the canonical UI-language registry; authored for every supported locale so normal navigation never requests an AI translation.'),
  ('system_lang_key_translations', 'Kieliavainten käännökset', 'Language key translations', '语言键翻译', '語言鍵翻譯', 'Static database-tree label for normalized UI language-key translations; authored for every supported locale so normal navigation never requests an AI translation.'),
  ('system_lang_keys', 'Kieliavaimet', 'Language keys', '语言键', '語言鍵', 'public fixture seed'),
  ('system_lang_keys_archive', 'Kieliavainarkisto', 'Language-key archive', '语言键归档', '語言鍵封存', 'public fixture seed'),
  ('system_lang_key_sources', 'Kieliavainlähteet', 'Language-key sources', '语言键来源', '語言鍵來源', 'public fixture seed'),
  ('system_schema_migrations', 'Skeemamigraatiot', 'Schema migrations', '架构迁移', '結構描述遷移', 'public fixture seed'),
  ('system_table_folders', 'Taulukansiot', 'Table folders', '表格文件夹', '資料表資料夾', 'public fixture seed'),
  ('system_table_row_view_counts', 'Rivien näyttökerrat', 'Table row view counts', '表行查看次数', '資料列檢視次數', 'public fixture seed'),
  ('system_table_views', 'Taulunäkymät', 'Table views', '表格视图', '資料表檢視', 'public fixture seed'),
  ('system_transaction_log', 'Tapahtumaloki', 'Transaction log', '事务日志', '交易記錄', 'public fixture seed'),
  ('system_column_field_sets', 'Kenttäkokoelmat', 'Field collections', '字段集合', '欄位集合', 'public fixture seed'),
  ('system_column_field_set_members', 'Kenttäkokoelmien kentät', 'Field collection members', '字段集合成员', '欄位集合成員', 'public fixture seed'),
  ('system_view_field_set_assignments', 'Näkymien kenttäkokoelmat', 'View field assignments', '视图字段分配', '檢視欄位指派', 'public fixture seed'),
  ('system_user_visual_preferences', 'Käyttäjän ulkoasuvalinnat', 'User Visual Preferences', '用户视觉偏好', '用戶視覺偏好', 'Static database-tree label for account-owned visual preferences.'),
  ('theme_toggle_system', 'Teema: järjestelmän mukaan', 'Theme: system', '主题：跟随系统', '主題：跟隨系統', 'Accessible label for the system theme state.'),
  ('theme_toggle_dark', 'Teema: tumma', 'Theme: dark', '主题：深色', '主題：深色', 'Accessible label for the dark theme state.'),
  ('theme_toggle_light', 'Teema: vaalea', 'Theme: light', '主题：浅色', '主題：淺色', 'Accessible label for the light theme state.'),
  ('theme_toggle_locked_light', 'Teema: lukittu vaaleaksi', 'Theme: locked light', '主题：锁定浅色', '主題：鎖定淺色', 'Accessible label for the site-locked light theme state.'),
  ('theme_toggle_locked_dark', 'Teema: lukittu tummaksi', 'Theme: locked dark', '主题：锁定深色', '主題：鎖定深色', 'Accessible label for the site-locked dark theme state.'),
  ('edit_site_field_default', 'Muokkaa sivuston oletusta', 'Edit site default', '编辑站点默认字段', '編輯網站預設欄位', 'public fixture seed'),
  ('edit_personal_field_selection', 'Palaa omaan valintaan', 'Return to personal selection', '返回个人字段选择', '返回個人欄位選擇', 'public fixture seed'),
  ('return_to_site_default', 'Palaa sivuston oletukseen', 'Return to site default', '继承站点默认值', '使用網站預設值', 'public fixture seed'),
  ('site_default_restored', 'Sivuston oletus palautettu', 'Site default restored', '已恢复站点默认值', '已恢復網站預設值', 'public fixture seed'),
  ('shared', 'Jaettu', 'Shared', '共享', '共用', 'public fixture seed'),
  ('field_set_fields_placeholder', 'Kentät kenttäjoukossa', 'Fields in collection', '字段集中的字段', '欄位集中的欄位', 'public fixture seed'),
  ('fields_selected', 'kenttää valittu', 'fields selected', '个字段已选择', '個欄位已選取', 'public fixture seed'),
  ('system_user_group_memberships', 'Käyttäjäryhmien jäsenyydet', 'User group memberships', '用户组成员关系', '用戶群組成員關係', 'public fixture seed'),
  ('system_user_groups', 'Käyttäjäryhmät', 'User groups', '用户组', '用戶群組', 'public fixture seed'),
  ('system_users', 'Järjestelmän käyttäjät', 'System users', '系统用户', '系統用戶', 'public fixture seed'),
  ('views', 'Näkymät', 'Views', '视图', '檢視', 'public fixture seed'),
  ('geography_columns', 'Maantieteelliset sarakkeet', 'Geography columns', '地理列', '地理欄位', 'public fixture seed'),
  ('geometry_columns', 'Geometriasarakkeet', 'Geometry columns', '几何列', '幾何欄位', 'public fixture seed'),

  -- Article fields, generated relation labels, search labels, and child-tab actions.
  ('palvelu_id', 'Palvelun id', 'Service id', '服务 ID', '服務 ID', 'public fixture seed'),
  ('open_in_new_tab', 'Avaa uudessa välilehdessä', 'Open in new tab', '在新标签页中打开', '喺新分頁開啟', 'public fixture seed'),
  ('palvelu_name', 'Palvelun nimi', 'Service name', '服务名称', '服務名稱', 'public fixture seed'),
  ('dokumentaatio_id', 'Dokumentin id', 'Document id', '文档 ID', '文件 ID', 'public fixture seed'),
  ('dokumentaatio_name', 'Dokumentin nimi', 'Document name', '文档名称', '文件名稱', 'public fixture seed'),
  ('kuva', 'Kuva', 'Image', '图片', '圖片', 'public fixture seed'),
  ('riski_id', 'Riskin id', 'Risk id', '风险 ID', '風險 ID', 'public fixture seed'),
  ('riski_name', 'Riskin nimi', 'Risk name', '风险名称', '風險名稱', 'public fixture seed'),
  ('edit', 'Muokkaa', 'Edit', '编辑', '編輯', 'public fixture seed'),
  ('cancel', 'Peruuta', 'Cancel', '取消', '取消', 'public fixture seed'),
  ('delete', 'Poista', 'Delete', '删除', '刪除', 'public fixture seed'),
  ('riski_name (ln)', 'Riskin nimi', 'Risk name', '风险名称', '風險名稱', 'public fixture seed'),
  ('search_for_riski_name (ln)', 'Hae riskin nimestä', 'Search risk name', '搜索风险名称', '搜尋風險名稱', 'public fixture seed'),
  ('palvelu_name (ln)', 'Palvelun nimi', 'Service name', '服务名称', '服務名稱', 'public fixture seed'),
  ('search_for_palvelu_name (ln)', 'Hae palvelun nimestä', 'Search service name', '搜索服务名称', '搜尋服務名稱', 'public fixture seed'),
  ('dokumentaatio_name (ln)', 'Dokumentin nimi', 'Document name', '文档名称', '文件名稱', 'public fixture seed'),
  ('search_for_dokumentaatio_name (ln)', 'Hae dokumentin nimestä', 'Search document name', '搜索文档名称', '搜尋文件名稱', 'public fixture seed'),
  ('search_for_riski_id', 'Hae riskin id:stä', 'Search risk id', '搜索风险 ID', '搜尋風險 ID', 'public fixture seed'),
  ('search_for_maarapaiva', 'Hae määräpäivästä', 'Search due date', '搜索截止日期', '搜尋截止日期', 'public fixture seed'),
  ('search_for_id', 'Hae id:stä', 'Search id', '搜索 ID', '搜尋 ID', 'public fixture seed'),
  ('search_for_palvelu_id', 'Hae palvelun id:stä', 'Search service id', '搜索服务 ID', '搜尋服務 ID', 'public fixture seed'),
  ('search_for_dokumentaatio_id', 'Hae dokumentin id:stä', 'Search document id', '搜索文档 ID', '搜尋文件 ID', 'public fixture seed'),
  ('search_for_kuva', 'Hae kuvasta', 'Search image', '搜索图片', '搜尋圖片', 'public fixture seed'),
  ('search_for_created', 'Hae luontiajasta', 'Search creation time', '搜索创建时间', '搜尋建立時間', 'public fixture seed'),
  ('search_for_updated', 'Hae päivitysajasta', 'Search update time', '搜索更新时间', '搜尋更新時間', 'public fixture seed'),
  ('chat_for_table', 'Keskustelu – $table_name', 'Chat – $table_name', '$table_name 表聊天', '$table_name 資料表傾偈', 'public fixture seed'),
  ('chat_welcome_message', 'Miten voin auttaa tämän taulun kanssa?', 'How can I help with this table?', '我能如何协助处理此表？', '我可以點樣幫你處理呢個資料表？', 'public fixture seed'),
  ('delete_history', 'Poista keskusteluhistoria', 'Delete chat history', '删除聊天记录', '刪除對話記錄', 'public fixture seed'),
  ('open', 'Avaa', 'Open', '打开', '開啟', 'public fixture seed'),
  ('showing_first_50', 'Näytetään ensimmäiset 50 riviä', 'Showing the first 50 rows', '显示前 50 行', '顯示首 50 個資料列', 'public fixture seed'),
  ('name', 'Nimi', 'Name', '名称', '名稱', 'public fixture seed'),
  ('comments', 'Kommentit', 'Comments', '评论', '留言', 'public fixture seed'),
  ('write_comment', 'Kirjoita kommentti', 'Write a comment', '撰写评论', '撰寫留言', 'public fixture seed'),
  ('send', 'Lähetä', 'Send', '发送', '傳送', 'public fixture seed'),

  ('row_article_section_details', 'Tiedot', 'Details', '详细信息', '詳細資料', 'public fixture seed'),
  ('row_article_section_task_progress', 'Edistyminen', 'Progress', '进度', '進度', 'public fixture seed'),
  ('row_article_section_images', 'Kuvat', 'Images', '图片', '圖片', 'public fixture seed'),
  ('row_article_section_attachments', 'Liitteet', 'Attachments', '附件', '附件', 'public fixture seed'),
  ('row_article_section_related_rows', 'Liittyvät rivit', 'Related rows', '关联行', '關聯資料列', 'public fixture seed'),
  ('search_for_palvelu', 'Hae palvelusta', 'Search service', '搜索服务', '搜尋服務', 'public fixture seed'),
  ('search_for_kuvaus', 'Hae kuvauksesta', 'Search description', '搜索描述', '搜尋描述', 'public fixture seed'),
  ('search_for_omistava_tiimi', 'Hae omistavasta tiimistä', 'Search owning team', '搜索负责团队', '搜尋負責團隊', 'public fixture seed'),
  ('search_for_palvelutaso', 'Hae palvelutasosta', 'Search service level', '搜索服务级别', '搜尋服務級別', 'public fixture seed'),
  ('search_for_tila', 'Hae tilasta', 'Search status', '搜索状态', '搜尋狀態', 'public fixture seed'),
  ('search_for_vastuuhenkilo', 'Hae vastuuhenkilöstä', 'Search owner', '搜索负责人', '搜尋負責人', 'public fixture seed'),
  ('search_for_riski', 'Hae riskistä', 'Search risk', '搜索风险', '搜尋風險', 'public fixture seed'),
  ('search_for_vaikutus', 'Hae vaikutuksesta', 'Search impact', '搜索影响', '搜尋影響', 'public fixture seed'),
  ('search_for_riskitaso', 'Hae riskitasosta', 'Search risk level', '搜索风险级别', '搜尋風險級別', 'public fixture seed'),
  ('search_for_todennakoisyys', 'Hae todennäköisyydestä', 'Search likelihood', '搜索可能性', '搜尋可能性', 'public fixture seed'),
  ('search_for_alentamistoimet', 'Hae hallintatoimista', 'Search mitigation', '搜索缓解措施', '搜尋緩解措施', 'public fixture seed'),
  ('search_for_otsikko', 'Hae otsikosta', 'Search title', '搜索标题', '搜尋標題', 'public fixture seed'),
  ('search_for_kohdetiimi', 'Hae kohdetiimistä', 'Search target team', '搜索目标团队', '搜尋目標團隊', 'public fixture seed'),
  ('search_for_ohje', 'Hae ohjeesta', 'Search guidance', '搜索指南', '搜尋指引', 'public fixture seed'),
  ('search_for_voimassaolo', 'Hae voimassaolosta', 'Search validity', '搜索有效性', '搜尋有效性', 'public fixture seed'),
  ('search_for_vastuutiimi', 'Hae vastuutiimistä', 'Search responsible team', '搜索负责团队', '搜尋負責團隊', 'public fixture seed'),
  ('search_for_prioriteetti', 'Hae prioriteetista', 'Search priority', '搜索优先级', '搜尋優先次序', 'public fixture seed'),
  ('search_for_pyyntotyyppi', 'Hae pyyntötyypistä', 'Search request type', '搜索请求类型', '搜尋請求類型', 'public fixture seed')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

-- Public runtime metadata columns. Finnish and English values are aligned with
-- the current Filterest VPS where available; Chinese values are curated here so
-- generated instances never need AI translation for ordinary dataset metadata.
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('id', 'Tunniste', 'ID', 'ID', 'ID', 'public fixture metadata seed'),
  ('created', 'Luotu', 'Created', '创建时间', '建立時間', 'public fixture metadata seed'),
  ('updated', 'Päivitetty', 'Updated', '更新时间', '更新時間', 'public fixture metadata seed'),
  ('description', 'Kuvaus', 'Description', '描述', '描述', 'curated shared row-description label'),
  ('link', 'Linkki', 'Link', '链接', '連結', 'curated shared row-link label'),
  ('keywords', 'Avainsanat', 'Keywords', '关键词', '關鍵字', 'curated shared row-keywords label'),
  ('admin_access_allowed', 'Kelpaa ylläpitäjäksi', 'Admin eligible', '可担任管理员', '可擔任管理員', 'public fixture metadata seed'),
  ('admin_approved', 'Hyväksytty', 'Approved', '已批准', '已批准', 'public fixture metadata seed'),
  ('admin_user_id', 'Järjestelmänvalvojan käyttäjätunnus', 'Admin user ID', '管理员用户 ID', '管理員用戶 ID', 'public fixture metadata seed'),
  ('amount_cents', 'Summa (sentteinä)', 'Amount (cents)', '金额（分）', '金額（仙）', 'public fixture metadata seed'),
  ('applied_at', 'Käytetty', 'Applied at', '应用时间', '套用時間', 'public fixture metadata seed'),
  ('app_name', 'Sovelluksen nimi', 'App name', '应用名称', '應用程式名稱', 'public fixture metadata seed'),
  ('archived_at', 'Arkistoitu', 'Archived at', '归档时间', '封存時間', 'public fixture metadata seed'),
  ('auth_name', 'Auktoriteetin nimi', 'Authority name', '授权机构名称', '授權機構名稱', 'public fixture metadata seed'),
  ('auth_srid', 'Auktoriteetin SRID', 'Authority SRID', '授权机构 SRID', '授權機構 SRID', 'public fixture metadata seed'),
  ('bio_social_medias', 'Bio', 'Bio', '个人简介', '個人簡介', 'public fixture metadata seed'),
  ('boolean_value', 'Totuusarvo', 'Boolean value', '布尔值', '布林值', 'public fixture metadata seed'),
  ('bridging_col_a', 'Yhdistävä sarake A', 'Bridging column A', '桥接列 A', '橋接欄位 A', 'public fixture metadata seed'),
  ('bridging_col_b', 'Yhdistävä sarake B', 'Bridging column B', '桥接列 B', '橋接欄位 B', 'public fixture metadata seed'),
  ('bridging_table_name', 'Yhdistävän taulun nimi', 'Bridging table name', '桥接表名称', '橋接資料表名稱', 'public fixture metadata seed'),
  ('bridging_table_uid', 'Välitaulun UID', 'Bridging table UID', '桥接表 UID', '橋接資料表 UID', 'public fixture metadata seed'),
  ('cached_name_col_in_src', '@nimen sarake lähteessä', '@name column in source', '源表中的缓存名称列', '來源資料表嘅快取名稱欄位', 'public fixture metadata seed'),
  ('cached_oid', '@OID', 'Cached OID', '缓存 OID', '快取 OID', 'public fixture metadata seed'),
  ('card_detail_capitalization', 'Kortin yksityiskohdan kapitalisointi', 'Card detail capitalization', '卡片详情首字母大写', '卡片詳細資料首字母大寫', 'public fixture metadata seed'),
  ('card_detail_icon_key', 'Kortin yksityiskohdan kuvakeavain', 'Card detail icon key', '卡片详情图标键', '卡片詳細資料圖示鍵', 'public fixture metadata seed'),
  ('card_detail_icon_svg', 'Kortin yksityiskohdan kuvake SVG', 'Card detail icon SVG', '卡片详情图标 SVG', '卡片詳細資料圖示 SVG', 'public fixture metadata seed'),
  ('card_detail_label_mode', 'Kortin yksityiskohdan otsikon tila', 'Card detail label mode', '卡片详情标签模式', '卡片詳細資料標籤模式', 'public fixture metadata seed'),
  ('card_details_layout', 'Kortin tietojen asettelu', 'Card details layout', '卡片详情布局', '卡片詳細資料版面', 'public fixture metadata seed'),
  ('card_element', 'Kortin elementti', 'Card element', '卡片元素', '卡片元素', 'public fixture metadata seed'),
  ('card_style_variant', 'Kortin tyylivariantti', 'Card style variant', '卡片样式变体', '卡片樣式變體', 'public fixture metadata seed'),
  ('ch', 'Kiina', 'Chinese', '简体中文', '簡體中文', 'public fixture metadata seed'),
  ('column_label', 'Sarakkeen otsikko', 'Column label', '列标签', '欄位標籤', 'public fixture metadata seed'),
  ('column_name', 'Sarakkeen nimi', 'Column name', '列名', '欄位名稱', 'public fixture metadata seed'),
  ('column_uid', 'Sarakkeen UID', 'Column UID', '列 UID', '欄位 UID', 'public fixture metadata seed'),
  ('column_width_px', 'Sarakkeen leveys (px)', 'Column width (px)', '列宽（像素）', '欄位寬度（像素）', 'public fixture metadata seed'),
  ('co_number', 'CO-numero', 'CO number', 'CO 编号', 'CO 編號', 'public fixture metadata seed'),
  ('created_at', 'Luotu', 'Created at', '创建时间', '建立時間', 'public fixture metadata seed'),
  ('creation_spec', 'Tiedot luomisesta', 'Creation specification', '创建说明', '建立規格', 'public fixture metadata seed'),
  ('currency', 'Valuutta', 'Currency', '货币', '貨幣', 'public fixture metadata seed'),
  ('customer_email', 'Asiakkaan sähköposti', 'Customer email', '客户电子邮件', '客戶電郵', 'public fixture metadata seed'),
  ('dataset', 'Aineisto', 'Dataset', '数据集', '資料集', 'public fixture metadata seed'),
  ('data_type', 'Datatyyppi', 'Data type', '数据类型', '資料類型', 'public fixture metadata seed'),
  ('default_view_id', 'Näkymän oletustunnus', 'Default view ID', '默认视图 ID', '預設檢視 ID', 'public fixture metadata seed'),
  ('details', 'Tiedot', 'Details', '详细信息', '詳細資料', 'public fixture metadata seed'),
  ('disabled', 'Pois käytöstä', 'Disabled', '已禁用', '已停用', 'public fixture metadata seed'),
  ('display_name', 'Näyttönimi', 'Display name', '显示名称', '顯示名稱', 'public fixture metadata seed'),
  ('duration_ms', 'Kesto (ms)', 'Duration (ms)', '持续时间（毫秒）', '持續時間（毫秒）', 'public fixture metadata seed'),
  ('editable_in_ui', 'Muokattavissa käyttöliittymässä', 'Editable in UI', '可在界面中编辑', '可喺介面編輯', 'public fixture metadata seed'),
  ('en', 'Englanti', 'English', '英语', '英文', 'public fixture metadata seed'),
  ('enabled', 'Käytössä', 'Enabled', '已启用', '已啟用', 'public fixture metadata seed'),
  ('error_message', 'Virheilmoitus', 'Error message', '错误消息', '錯誤訊息', 'public fixture metadata seed'),
  ('external_order_id', 'Ulkoinen tilaus-ID', 'External order ID', '外部订单 ID', '外部訂單 ID', 'public fixture metadata seed'),
  ('fco_number', 'FCO-numero', 'FCO number', 'FCO 编号', 'FCO 編號', 'public fixture metadata seed'),
  ('fi', 'Suomi', 'Finnish', '芬兰语', '芬蘭文', 'public fixture metadata seed'),
  ('filename', 'Tiedostonimi', 'Filename', '文件名', '檔案名稱', 'public fixture metadata seed'),
  ('filterbar_visible_by_default', 'Suodatinpalkki oletuksena näkyvissä', 'Filter bar visible by default', '默认显示筛选栏', '預設顯示篩選列', 'public fixture metadata seed'),
  ('fk_display_column', 'Viiteavaimen näyttösarake', 'FK display column', '外键显示列', '外鍵顯示欄位', 'public fixture metadata seed'),
  ('folder_description', 'Kansion kuvaus', 'Folder description', '文件夹描述', '資料夾描述', 'public fixture metadata seed'),
  ('folder_id', 'Kansion tunnus', 'Folder ID', '文件夹 ID', '資料夾 ID', 'public fixture metadata seed'),
  ('folder_name', 'Kansion nimi', 'Folder name', '文件夹名称', '資料夾名稱', 'public fixture metadata seed'),
  ('full_name', 'Koko nimi', 'Full name', '全名', '全名', 'public fixture metadata seed'),
  ('function_id', 'Toiminnon tunniste', 'Function ID', '功能 ID', '功能 ID', 'public fixture metadata seed'),
  ('group_id', 'Ryhmä ID', 'Group ID', '用户组 ID', '群組 ID', 'public fixture metadata seed'),
  ('handler_name', 'Käsittelijän nimi', 'Handler name', '处理程序名称', '處理程式名稱', 'public fixture metadata seed'),
  ('hidden', 'Piilotettu', 'Hidden', '已隐藏', '已隱藏', 'public fixture metadata seed'),
  ('hide_everywhere', 'Piilota kaikkialla', 'Hide everywhere', '在所有位置隐藏', '喺所有位置隱藏', 'public fixture metadata seed'),
  ('hide_false_null_on_big_crd', 'Piilota epätosi/tyhjä isossa kortissa', 'Hide false/null on big card', '在文章视图中隐藏假值或空值', '喺文章檢視隱藏假值或空值', 'public fixture metadata seed'),
  ('hide_false_null_on_sml_crd', 'Piilota epätosi/tyhjä pienessä kortissa', 'Hide false/null on small card', '在小卡片中隐藏假值或空值', '喺細卡片隱藏假值或空值', 'public fixture metadata seed'),
  ('hide_in_filter_panel', 'Piilota suodatinpaneelissa', 'Hide in filter panel', '在筛选面板中隐藏', '喺篩選面板隱藏', 'public fixture metadata seed'),
  ('hide_on_bg_crd_if_not_own', 'Piilota isossa kortissa, jos ei oma', 'Hide on big card if not own', '非本人记录时在文章视图中隐藏', '唔係自己記錄時喺文章檢視隱藏', 'public fixture metadata seed'),
  ('hide_on_small_card', 'Piilota pienessä kortissa', 'Hide on small card', '在小卡片中隐藏', '喺細卡片隱藏', 'public fixture metadata seed'),
  ('http_method', 'HTTP-menetelmä', 'HTTP method', 'HTTP 方法', 'HTTP 方法', 'public fixture metadata seed'),
  ('icon_key', 'Kuvakkeen avain', 'Icon key', '图标键', '圖示鍵', 'public fixture metadata seed'),
  ('insertable', 'Lisättävä', 'Insertable', '可插入', '可新增', 'public fixture metadata seed'),
  ('insert_expln_langkey', 'Lisää selitys', 'Insert explanation', '插入说明', '新增說明', 'public fixture metadata seed'),
  ('insert_new_source_with_target', 'Lisää uusi lähde kohteella', 'Insert new source with target', '使用目标插入新来源', '使用目標新增來源', 'public fixture metadata seed'),
  ('insert_new_target_with_source', 'Lisää uusi kohde lähteellä', 'Insert new target with source', '使用来源插入新目标', '使用來源新增目標', 'public fixture metadata seed'),
  ('instance_id', 'Instanssin tunniste', 'Instance ID', '实例 ID', '執行個體 ID', 'public fixture metadata seed'),
  ('int_value', 'Kokonaisluku', 'Integer value', '整数值', '整數值', 'public fixture metadata seed'),
  ('ip_address', 'IP-osoite', 'IP address', 'IP 地址', 'IP 位址', 'public fixture metadata seed'),
  ('is_about_table', 'Onko tietoja-taulu', 'Is about table', '是信息表', '係資訊資料表', 'public fixture metadata seed'),
  ('is_current_project', 'On nykyinen projekti', 'Is current project', '是当前项目', '係目前專案', 'public fixture metadata seed'),
  ('is_default', 'On oletus', 'Is default', '是默认值', '係預設值', 'public fixture metadata seed'),
  ('is_hidden', 'On piilotettu', 'Is hidden', '已隐藏', '已隱藏', 'public fixture metadata seed'),
  ('is_main_table', 'Onko päätaulu', 'Is main table', '是主表', '係主要資料表', 'public fixture metadata seed'),
  ('is_multilingual', 'On monikielinen', 'Is multilingual', '支持多语言', '支援多語言', 'public fixture metadata seed'),
  ('is_removable', 'On poistettavissa', 'Is removable', '可删除', '可刪除', 'public fixture metadata seed'),
  ('json_value', 'JSON-arvo', 'JSON value', 'JSON 值', 'JSON 值', 'public fixture metadata seed'),
  ('key', 'Avain', 'Key', '键', '鍵', 'public fixture metadata seed'),
  ('lang_key', 'Avain', 'Key', '语言键', '語言鍵', 'public fixture metadata seed'),
  ('lang_key_id', 'Kieliavaimen tunniste', 'Language key ID', '语言键 ID', '語言鍵 ID', 'public fixture metadata seed'),
  ('lang_key_type', 'Kieliavaintyyppi', 'Language key type', '语言键类型', '語言鍵類型', 'public fixture metadata seed'),
  ('last_seen', 'Viimeksi nähty', 'Last seen', '最后出现时间', '最後出現時間', 'public fixture metadata seed'),
  ('main_group_id', 'Pääryhmän tunniste', 'Main group ID', '主用户组 ID', '主要群組 ID', 'public fixture metadata seed'),
  ('mandatory', 'Pakollinen', 'Mandatory', '必填', '必填', 'public fixture metadata seed'),
  ('messages', 'Viestit', 'Messages', '消息', '訊息', 'public fixture metadata seed'),
  ('metadata', 'Metatiedot', 'Metadata', '元数据', '中繼資料', 'public fixture metadata seed'),
  ('method', 'Menetelmä', 'Method', '方法', '方法', 'public fixture metadata seed'),
  ('multi_lang_embeddings', 'Monikieliset upotteet', 'Multilingual embeddings', '多语言嵌入', '多語言嵌入', 'public fixture metadata seed'),
  ('must_be_true_unless_own', 'Täytyy olla tosi, ellei oma', 'Must be true unless own', '除本人记录外必须为真', '除自己記錄外必須為真', 'public fixture metadata seed'),
  ('name_col_in_tgt', 'Nimisarake kohteessa', 'Name column in target', '目标中的名称列', '目標入面嘅名稱欄位', 'public fixture metadata seed')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('operation_type', 'Toiminnon tyyppi', 'Operation type', '操作类型', '操作類型', 'public fixture metadata seed'),
  ('original_created', 'Alkuperäinen luontiaika', 'Original created', '原始创建时间', '原始建立時間', 'public fixture metadata seed'),
  ('original_id', 'Alkuperäinen ID', 'Original ID', '原始 ID', '原始 ID', 'public fixture metadata seed'),
  ('original_updated', 'Alkuperäinen päivitysaika', 'Original updated', '原始更新时间', '原始更新時間', 'public fixture metadata seed'),
  ('orphan_since', 'Orpo siitä lähtien', 'Orphan since', '成为孤立项的时间', '成為孤立項目嘅時間', 'public fixture metadata seed'),
  ('package', 'Paketti', 'Package', '包', '套件', 'public fixture metadata seed'),
  ('paid_at', 'Maksettu', 'Paid at', '付款时间', '付款時間', 'public fixture metadata seed'),
  ('parent_id', 'Vanhempi-ID', 'Parent ID', '父级 ID', '上層 ID', 'public fixture metadata seed'),
  ('parent_table', 'Päätaulu', 'Parent table', '父表', '上層資料表', 'public fixture metadata seed'),
  ('payment_token', 'Maksutunniste', 'Payment token', '支付令牌', '付款權杖', 'public fixture metadata seed'),
  ('predecessor_id', 'Edeltäjän ID', 'Predecessor ID', '前置项 ID', '前置項目 ID', 'public fixture metadata seed'),
  ('preview', 'Esikatselu', 'Preview', '预览', '預覽', 'public fixture metadata seed'),
  ('privileged', 'Etuoikeutettu', 'Privileged', '特权用户', '特權用戶', 'public fixture metadata seed'),
  ('proj4text', 'PROJ.4-teksti', 'PROJ.4 text', 'PROJ.4 文本', 'PROJ.4 文字', 'public fixture metadata seed'),
  ('rate_limit_amount', 'Rajoituksen määrä', 'Rate limit amount', '速率限制数量', '速率限制數量', 'public fixture metadata seed'),
  ('rate_limit_minutes', 'Rajoituksen minuutit', 'Rate limit minutes', '速率限制分钟数', '速率限制分鐘數', 'public fixture metadata seed'),
  ('reference_direction', 'Viittauksen suunta', 'Reference direction', '引用方向', '參照方向', 'public fixture metadata seed'),
  ('revolut_checkout_url', 'Revolut-kassan URL', 'Revolut checkout URL', 'Revolut 结账 URL', 'Revolut 結帳 URL', 'public fixture metadata seed'),
  ('revolut_order_id', 'Revolut-tilaus-ID', 'Revolut order ID', 'Revolut 订单 ID', 'Revolut 訂單 ID', 'public fixture metadata seed'),
  ('row_id', 'Rivitunnus', 'Row ID', '行 ID', '資料列 ID', 'public fixture metadata seed'),
  ('row_policy_owner_column', 'Rivipolitiikan omistajasarake', 'Row-policy owner column', '行策略所有者列', '資料列政策擁有者欄位', 'public fixture metadata seed'),
  ('schema_name', 'Skeeman nimi', 'Schema name', '模式名称', '結構描述名稱', 'public fixture metadata seed'),
  ('sco_number', 'SCO-numero', 'SCO number', 'SCO 编号', 'SCO 編號', 'public fixture metadata seed'),
  ('search_placeholder', 'Hakupaikkamerkki', 'Search placeholder', '搜索占位文本', '搜尋預留位置文字', 'public fixture metadata seed'),
  ('search_slogan', 'Hakuiskulause', 'Search slogan', '搜索提示语', '搜尋提示語', 'public fixture metadata seed'),
  ('search_vector_simple', 'Yksinkertainen hakuvektori', 'Simple search vector', '简单搜索向量', '簡單搜尋向量', 'public fixture metadata seed'),
  ('show_key_on_card', 'Näytä avain kortilla', 'Show key on card', '在卡片上显示键', '喺卡片顯示鍵', 'public fixture metadata seed'),
  ('show_value_on_card', 'Näytä arvo kortissa', 'Show value on card', '在卡片上显示值', '喺卡片顯示值', 'public fixture metadata seed'),
  ('sort_order', 'Lajittelujärjestys', 'Sort order', '排序顺序', '排序次序', 'public fixture metadata seed'),
  ('source_column_name', 'Lähdesarakkeen nimi', 'Source column name', '源列名称', '來源欄位名稱', 'public fixture metadata seed'),
  ('source_high', 'Lähde korkea', 'Source high', '高优先级来源', '高優先級來源', 'public fixture metadata seed'),
  ('source_insert_specs', 'Lähteen lisäyksen määrittelyt', 'Source insert specifications', '来源插入规范', '來源新增規格', 'public fixture metadata seed'),
  ('source_low', 'Lähde matala', 'Source low', '低优先级来源', '低優先級來源', 'public fixture metadata seed'),
  ('source_table_uid', 'Lähdetaulun UID', 'Source table UID', '源表 UID', '來源資料表 UID', 'public fixture metadata seed'),
  ('source_type', 'Lähteen tyyppi', 'Source type', '来源类型', '來源類型', 'public fixture metadata seed'),
  ('specific_table_related', 'Tiettyyn tauluun liittyvä', 'Specific table related', '与特定表相关', '同特定資料表相關', 'public fixture metadata seed'),
  ('sql_dump_policy', 'SQL dump -käytäntö', 'SQL dump policy', 'SQL 转储策略', 'SQL 傾印政策', 'public fixture metadata seed'),
  ('srid', 'SRID', 'SRID', 'SRID', 'SRID', 'public fixture metadata seed'),
  ('srtext', 'Paikkaviitteen määritelmä', 'Spatial reference text', '空间参考文本', '空間參照文字', 'public fixture metadata seed'),
  ('status', 'Tila', 'Status', '状态', '狀態', 'public fixture metadata seed'),
  ('success', 'Onnistui', 'Success', '成功', '成功', 'public fixture metadata seed'),
  ('tab_key', 'Välilehden avain', 'Tab key', '标签页键', '分頁鍵', 'public fixture metadata seed'),
  ('table_a_column', 'Taulun A sarake', 'Table A column', '表 A 的列', '資料表 A 嘅欄位', 'public fixture metadata seed'),
  ('table_a_uid', 'Taulun A UID', 'Table A UID', '表 A UID', '資料表 A UID', 'public fixture metadata seed'),
  ('table_b_column', 'Taulun B sarake', 'Table B column', '表 B 的列', '資料表 B 嘅欄位', 'public fixture metadata seed'),
  ('table_b_uid', 'Taulun B UID', 'Table B UID', '表 B UID', '資料表 B UID', 'public fixture metadata seed'),
  ('table_name', 'Taulun nimi', 'Table name', '表名', '資料表名稱', 'public fixture metadata seed'),
  ('table_uid', 'Taulun UID', 'Table UID', '表 UID', '資料表 UID', 'public fixture metadata seed'),
  ('tab_order', 'Välilehtien järjestys', 'Tab order', '标签页顺序', '分頁次序', 'public fixture metadata seed'),
  ('tab_order_json', 'Välilehtien järjestys JSON', 'Tab order JSON', '标签页顺序 JSON', '分頁次序 JSON', 'public fixture metadata seed'),
  ('target_column_name', 'Kohdesarakkeen nimi', 'Target column name', '目标列名称', '目標欄位名稱', 'public fixture metadata seed'),
  ('target_insert_specs', 'Kohteen lisäyksen määrittelyt', 'Target insert specifications', '目标插入规范', '目標新增規格', 'public fixture metadata seed'),
  ('target_schema_name', 'Kohdeskeeman nimi', 'Target schema name', '目标模式名称', '目標結構描述名稱', 'public fixture metadata seed'),
  ('target_table_uid', 'Kohdetaulun UID', 'Target table UID', '目标表 UID', '目標資料表 UID', 'public fixture metadata seed'),
  ('text_value', 'Tekstiarvo', 'Text value', '文本值', '文字值', 'public fixture metadata seed'),
  ('tiketti_id', 'Tiketin ID', 'Ticket ID', '工单 ID', '工單 ID', 'public fixture metadata seed'),
  ('title', 'Otsikko', 'Title', '标题', '標題', 'public fixture metadata seed'),
  ('ui_only', 'Vain käyttöliittymä', 'UI only', '仅限界面', '只限介面', 'public fixture metadata seed'),
  ('updated_at', 'Päivitetty', 'Updated at', '更新时间', '更新時間', 'public fixture metadata seed'),
  ('url_path', 'URL-polku', 'URL path', 'URL 路径', 'URL 路徑', 'public fixture metadata seed'),
  ('url_route_endpoint', 'URL-reitin päätepiste', 'URL route endpoint', 'URL 路由端点', 'URL 路由端點', 'public fixture metadata seed'),
  ('usage_explanation', 'Käyttöselite', 'Usage explanation', '使用说明', '使用說明', 'public fixture metadata seed'),
  ('user_group_id', 'Käyttäjäryhmän tunnus', 'User group ID', '用户组 ID', '用戶群組 ID', 'public fixture metadata seed'),
  ('email', 'Sähköposti', 'Email', '电子邮件', '電郵', 'public fixture metadata seed'),
  ('password', 'Salasana', 'Password', '密码', '密碼', 'public fixture metadata seed'),
  ('username', 'Käyttäjätunnus', 'Username', '用户名', '用戶名稱', 'public fixture metadata seed'),
  ('value_type', 'Arvon tyyppi', 'Value type', '值类型', '值類型', 'public fixture metadata seed'),
  ('version', 'Versio', 'Version', '版本', '版本', 'public fixture metadata seed'),
  ('viewed_by_user_id', 'Katsottu käyttäjätunnuksella', 'Viewed by user ID', '查看者用户 ID', '檢視者用戶 ID', 'public fixture metadata seed'),
  ('visible', 'Näkyvä', 'Visible', '可见', '可見', 'public fixture metadata seed'),
  ('webhook_received_at', 'Webhook vastaanotettu', 'Webhook received at', '收到 Webhook 的时间', '收到 Webhook 嘅時間', 'public fixture metadata seed'),
  ('previous_image', 'Edellinen kuva', 'Previous image', '上一张图片', '上一張圖片', 'Accessible label for moving to the previous image in an image-first article.'),
  ('next_image', 'Seuraava kuva', 'Next image', '下一张图片', '下一張圖片', 'Accessible label for moving to the next image in an image-first article.'),
  ('previous_row', 'Edellinen tietue', 'Previous record', '上一条记录', '上一筆資料', 'Accessible label for experimental navigation to the previous permitted result row.'),
  ('next_row', 'Seuraava tietue', 'Next record', '下一条记录', '下一筆資料', 'Accessible label for experimental navigation to the next permitted result row.'),
  ('open_article', 'Avaa artikkeli', 'Open article', '打开文章', '開啟文章', 'Accessible label for opening an image-first article from its card image.'),
  ('article_records', 'Artikkelin tietueet', 'Article records', '文章记录', '文章資料', 'Accessible navigation-region label for moving between permitted result rows.'),
  ('yue', 'Kantoninkiina', 'Cantonese', '粤语', '粵語', 'public fixture metadata seed')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

-- A fresh public installation asks its owner to choose the first login-ready
-- administrator. These labels mirror the upgrade migration so the reduced
-- deterministic bootstrap works without opening the general migration gate.
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('first_run_admin_title', 'Luo ensimmäinen pääkäyttäjä', 'Create the first administrator', '创建首位管理员', '建立第一位管理員', 'Public first-run administrator setup label.'),
  ('first_run_admin_description', 'Valitse tämän asennuksen sivuston nimi ja pääkäyttäjän tunnukset. Sähköpostia käytetään myös tilin palautukseen ja viesteihin.', 'Choose the site name and administrator credentials for this installation. Email is also used for account recovery and messages.', '为此安装设置站点名称和管理员凭据。电子邮件也用于账户恢复和消息。', '為此安裝設定網站名稱及管理員登入資料。電郵亦用於帳戶復原及訊息。', 'Public first-run administrator setup label.'),
  ('first_run_admin_submit', 'Luo pääkäyttäjä', 'Create administrator', '创建管理员', '建立管理員', 'Public first-run administrator setup label.'),
  ('confirm_password', 'Vahvista salasana', 'Confirm password', '确认密码', '確認密碼', 'Public first-run administrator setup label.'),
  ('first_run_username_invalid', 'Käytä 3–64 merkkiä: kirjaimia, numeroita, pisteitä, alaviivoja tai yhdysmerkkejä.', 'Use 3–64 characters: letters, numbers, dots, underscores, or hyphens.', '请输入 3–64 个字符，可使用字母、数字、句点、下划线或连字符。', '請輸入 3–64 個字元，可使用字母、數字、句號、底線或連字號。', 'Public first-run administrator validation label.'),
  ('first_run_email_invalid', 'Anna kelvollinen sähköpostiosoite.', 'Enter a valid email address.', '请输入有效的电子邮件地址。', '請輸入有效的電郵地址。', 'Public first-run administrator validation label.'),
  ('first_run_password_invalid', 'Käytä 12–128 merkin pituista salasanaa.', 'Use a password containing 12–128 characters.', '密码长度须为 12–128 个字符。', '密碼長度須為 12–128 個字元。', 'Public first-run administrator validation label.'),
  ('first_run_password_mismatch', 'Salasanat eivät täsmää.', 'The passwords do not match.', '两次输入的密码不一致。', '兩次輸入的密碼不一致。', 'Public first-run administrator validation label.'),
  ('first_run_admin_creation_failed', 'Pääkäyttäjää ei voitu luoda. Mitään asetusmuutoksia ei tallennettu.', 'The administrator could not be created. No setup changes were saved.', '无法创建管理员，未保存任何设置更改。', '無法建立管理員，未儲存任何設定變更。', 'Public first-run administrator failure label.'),
  ('form_sections', 'Lomakkeen osiot', 'Form sections', '表单部分', '表格部分', 'Public reusable form navigation label.'),
  ('previous', 'Edellinen', 'Previous', '上一步', '上一步', 'Public reusable form navigation label.'),
  ('next', 'Seuraava', 'Next', '下一步', '下一步', 'Public reusable form navigation label.'),
  ('back', 'Takaisin', 'Back', '返回', '返回', 'Public reusable form navigation label.'),
  ('proceed', 'Jatka', 'Proceed', '继续', '繼續', 'Public reusable form navigation label.'),
  ('first_run_welcome', 'Tervetuloa Filterestiin!', 'Welcome to Filterest!', '欢迎使用 Filterest！', '歡迎使用 Filterest！', 'Public First Run label.'),
  ('first_run_site_name', 'Sivuston nimi', 'Site name', '站点名称', '網站名稱', 'Public First Run label.'),
  ('first_run_site_name_invalid', 'Anna sivustolle 1–100 merkkiä pitkä nimi.', 'Enter a site name containing 1–100 characters.', '请输入 1–100 个字符的站点名称。', '請輸入 1–100 個字元的網站名稱。', 'Public First Run validation label.'),
  ('first_run_section_settings', 'Ympäristö', 'Environment', '环境', '環境', 'Public First Run label.'),
  ('first_run_section_credentials', 'Tunnukset', 'Credentials', '登录凭据', '登入資料', 'Public First Run label.'),
  ('first_run_settings_title', 'Määritä työympäristö', 'Set up your workspace', '设置工作区', '設定工作區', 'Public First Run label.'),
  ('first_run_settings_description', 'Valitse asennuksen käyttötarkoitus ja tapa, jolla ensimmäinen pääkäyttäjä varmentaa kirjautumiset.', 'Choose how this installation is used and how the first administrator verifies sign-ins.', '选择此安装的用途以及首位管理员验证登录的方式。', '選擇此安裝的用途，以及首位管理員驗證登入的方式。', 'Public First Run label.'),
  ('first_run_environment_legend', 'Ympäristö', 'Environment', '环境', '環境', 'Public First Run label.'),
  ('environment_development', 'Devaus', 'Development', '开发', '開發', 'Public First Run label.'),
  ('environment_development_description', 'Sovelluksen kehittämiseen ja muuttamiseen.', 'For building and changing the application.', '用于构建和修改应用程序。', '用於建構及修改應用程式。', 'Public First Run label.'),
  ('environment_testing', 'Testaus', 'Testing', '测试', '測試', 'Public First Run label.'),
  ('environment_testing_description', 'Devausta vastaavaan testaukseen.', 'For testing in a development-like environment.', '用于类似开发环境的测试。', '用於類似開發環境的測試。', 'Public First Run label.'),
  ('environment_qa', 'QA', 'QA', 'QA', 'QA', 'Public First Run label.'),
  ('environment_qa_description', 'Laadunvarmistukseen ja julkaisujen tarkistukseen.', 'For quality assurance and release verification.', '用于质量保证和发布验证。', '用於品質保證及發佈驗證。', 'Public First Run label.'),
  ('environment_production', 'Tuotanto', 'Production', '生产', '正式環境', 'Public First Run label.'),
  ('environment_production_description', 'Oikeille käyttäjille ja tuotantodatalle.', 'For real users and live data.', '用于真实用户和正式数据。', '用於真實使用者及正式資料。', 'Public First Run label.'),
  ('first_run_verification_legend', 'Kirjautumisen varmennus', 'Sign-in verification', '登录验证', '登入驗證', 'Public First Run label.'),
  ('verification_none', 'Ei lisävarmennusta', 'No additional verification', '无额外验证', '不作額外驗證', 'Public First Run label.'),
  ('verification_none_description', 'Kirjaudu vain käyttäjätunnuksella ja salasanalla.', 'Sign in with username and password only.', '仅使用用户名和密码登录。', '只使用使用者名稱及密碼登入。', 'Public First Run label.'),
  ('verification_fixed_pin', 'Kiinteä PIN', 'Fixed PIN', '固定 PIN', '固定 PIN', 'Public First Run label.'),
  ('verification_fixed_pin_description', 'Käytä samaa yksityistä 4–8 numeron PIN-koodia jokaisella kirjautumisella.', 'Use the same private 4–8 digit PIN at every sign-in.', '每次登录都使用同一个私密的 4–8 位数字 PIN。', '每次登入都使用同一個私密的 4–8 位數字 PIN。', 'Public First Run label.'),
  ('verification_authenticator', 'Autentikaattorisovellus', 'Authenticator app', '身份验证器应用', '驗證器應用程式', 'Public First Run label.'),
  ('verification_authenticator_description', 'Toimii standardia TOTP:tä tukevilla sovelluksilla, myös Google Authenticatorilla.', 'Works with standard TOTP apps, including Google Authenticator.', '适用于标准 TOTP 应用，包括 Google Authenticator。', '適用於標準 TOTP 應用程式，包括 Google Authenticator。', 'Public First Run label.'),
  ('verification_email', 'Sähköposti', 'Email', '电子邮件', '電郵', 'Public First Run label.'),
  ('verification_email_description', 'Lähettää kertakäyttökoodin Postmarkin kautta. Vaatii ilmaisen ulkoisen Postmark-tilin.', 'Sends a one-time code through Postmark. Requires a free external Postmark account.', '通过 Postmark 发送一次性代码。需要免费的外部 Postmark 账户。', '透過 Postmark 傳送一次性驗證碼。需要免費的外部 Postmark 帳戶。', 'Public First Run label.'),
  ('fixed_pin', 'Kiinteä PIN', 'Fixed PIN', '固定 PIN', '固定 PIN', 'Public First Run label.'),
  ('confirm_fixed_pin', 'Vahvista kiinteä PIN', 'Confirm fixed PIN', '确认固定 PIN', '確認固定 PIN', 'Public First Run label.'),
  ('authenticator_setup_key', 'Lisää tämä käyttöönottoavain autentikaattorisovellukseesi:', 'Add this setup key to your authenticator app:', '将此设置密钥添加到身份验证器应用中：', '將此設定密鑰加入驗證器應用程式：', 'Public First Run label.'),
  ('authenticator_confirmation_code', 'Vahvista käyttöönotto syöttämällä nykyinen 6-numeroinen koodi', 'Enter the current 6-digit code to confirm setup', '输入当前的 6 位代码以确认设置', '輸入目前的 6 位驗證碼以確認設定', 'Public First Run label.'),
  ('verification_fixed_pin_prompt', 'Syötä kiinteä PIN-koodisi.', 'Enter your fixed PIN.', '输入固定 PIN。', '輸入固定 PIN。', 'Public login verification prompt.'),
  ('verification_authenticator_prompt', 'Syötä autentikaattorisovelluksen nykyinen koodi.', 'Enter the current code from your authenticator app.', '输入身份验证器应用中的当前代码。', '輸入驗證器應用程式中的目前驗證碼。', 'Public login verification prompt.'),
  ('verification_email_prompt', 'Vahvistuskoodi lähetetty: $site_name', 'Verification code sent: $site_name', '验证代码已发送：$site_name', '驗證碼已傳送：$site_name', 'Public login verification prompt.'),
  ('first_run_environment_invalid', 'Valitse ympäristö.', 'Choose an environment.', '请选择环境。', '請選擇環境。', 'Public First Run validation label.'),
  ('first_run_verification_invalid', 'Valitse kirjautumisen varmennustapa.', 'Choose a sign-in verification method.', '请选择登录验证方式。', '請選擇登入驗證方式。', 'Public First Run validation label.'),
  ('first_run_fixed_pin_invalid', 'Käytä kiinteässä PIN-koodissa 4–8 numeroa.', 'Use 4–8 digits for the fixed PIN.', '固定 PIN 需使用 4–8 位数字。', '固定 PIN 需使用 4–8 位數字。', 'Public First Run validation label.'),
  ('first_run_fixed_pin_mismatch', 'Kiinteät PIN-koodit eivät täsmää.', 'The fixed PIN values do not match.', '两次输入的固定 PIN 不一致。', '兩次輸入的固定 PIN 不一致。', 'Public First Run validation label.'),
  ('first_run_totp_invalid', 'Vahvista autentikaattorin käyttöönotto kelvollisella nykyisellä koodilla.', 'Confirm the authenticator setup with a valid current code.', '请使用有效的当前代码确认身份验证器设置。', '請使用有效的目前驗證碼確認驗證器設定。', 'Public First Run validation label.'),
  ('first_run_postmark_required', 'Sähköpostivarmennus vaatii suojattuun ympäristötiedostoon POSTMARK_API_KEY- ja EMAIL_FROM_ADDRESS-arvot.', 'Email verification requires POSTMARK_API_KEY and EMAIL_FROM_ADDRESS in the protected environment file.', '电子邮件验证需要在受保护的环境文件中设置 POSTMARK_API_KEY 和 EMAIL_FROM_ADDRESS。', '電郵驗證需要在受保護的環境檔案中設定 POSTMARK_API_KEY 及 EMAIL_FROM_ADDRESS。', 'Public First Run validation label.')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

-- Field labels for the canonical language registry and its normalized values.
-- Seed these before derived search labels so the fresh installation never
-- needs a page-load AI request for the new administration fields.
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('site_settings', 'Sivustoasetukset', 'Site settings', '站点设置', '網站設定', 'Admin navigation group for site-wide settings.'),
  ('site_languages', 'Sivuston kielet', 'Site languages', '站点语言', '網站語言', 'Admin view for the canonical site-language registry.'),
  ('site_languages_description', 'Valitse sivuston kielet, yksi oletuskieli, selkeät varakielet ja julkisessa kielivalitsimessa näkyvät tarkistetut kielet.', 'Choose the site languages, one default, explicit fallbacks, and which reviewed languages may appear publicly.', '选择站点语言、一个默认语言、明确的后备语言，以及可在公共语言选择器中显示的已审核语言。', '選擇網站語言、一個預設語言、明確嘅後備語言，同埋可以喺公開語言選擇器顯示嘅已審核語言。', 'Explanation above the administrator-owned site-language registry.'),
  ('language', 'Kieli', 'Language', '语言', '語言', 'Column heading in the site-language registry.'),
  ('default_language', 'Oletuskieli', 'Default language', '默认语言', '預設語言', 'The one root language used by the site.'),
  ('fallback_language', 'Varakieli', 'Fallback language', '后备语言', '後備語言', 'Explicit fallback used when a translation is unavailable.'),
  ('translation_coverage', 'Käännösten kattavuus', 'Translation coverage', '翻译覆盖率', '翻譯覆蓋程度', 'Coverage status shown in the site-language registry.'),
  ('public_selector', 'Julkinen kielivalitsin', 'Public language selector', '公共语言选择器', '公開語言選擇器', 'Whether an approved language may appear in the public selector.'),
  ('save', 'Tallenna', 'Save', '保存', '儲存', 'Shared save action.'),
  ('saving', 'Tallennetaan…', 'Saving…', '正在保存…', '儲存緊…', 'Progress copy while site-language settings are saved.'),
  ('settings_saved', 'Asetukset tallennettu.', 'Settings saved.', '设置已保存。', '設定已儲存。', 'Confirmation after settings are saved.'),
  ('save_failed', 'Tallennus epäonnistui.', 'Save failed.', '保存失败。', '儲存失敗。', 'Safe generic failure copy for a settings update.'),
  ('load_failed', 'Lataus epäonnistui.', 'Loading failed.', '加载失败。', '載入失敗。', 'Safe generic failure copy for a settings view load.'),
  ('language_code', 'Kielikoodi', 'Language code', '语言代码', '語言代碼', 'Canonical language registry field.'),
  ('english_name', 'Englanninkielinen nimi', 'English name', '英文名称', '英文名稱', 'Canonical language registry field.'),
  ('native_name', 'Omankielinen nimi', 'Native name', '本地名称', '本地名稱', 'Canonical language registry field.'),
  ('script_code', 'Kirjoitusjärjestelmän koodi', 'Script code', '文字代码', '文字代碼', 'Canonical language registry field.'),
  ('region_code', 'Aluekoodi', 'Region code', '地区代码', '地區代碼', 'Canonical language registry field.'),
  ('is_enabled', 'Käytössä sivustolla', 'Enabled on site', '在网站上启用', '在網站上啟用', 'Canonical language registry field.'),
  ('fallback_language_code', 'Varakieli', 'Fallback language', '后备语言', '後備語言', 'Canonical language registry field.'),
  ('coverage_status', 'Käännöskattavuus', 'Translation coverage', '翻译覆盖率', '翻譯覆蓋率', 'Canonical language registry field.'),
  ('review_status', 'Tarkistustila', 'Review status', '审核状态', '審核狀態', 'Canonical language registry field.'),
  ('public_selector_ready', 'Valmis kielivalitsimeen', 'Ready for language selector', '可用于语言选择器', '可用於語言選擇器', 'Canonical language registry field.'),
  ('translation', 'Käännös', 'Translation', '翻译', '翻譯', 'Normalized translation field.'),
  ('source_kind', 'Käännöksen alkuperä', 'Translation source', '翻译来源', '翻譯來源', 'Normalized translation field.')
ON CONFLICT (lang_key) DO NOTHING;

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec) VALUES
  ('external_embedding_allowed', 'Sallittu ulkoiseen embeddingiin', 'Allowed for external embeddings', '允许用于外部嵌入', '允許用於外部嵌入', 'Per-field administrator choice for the configured external embedding provider.'),
  ('external_embedding_enabled', 'Ulkoiset embeddingit käytössä', 'External embeddings enabled', '已启用外部嵌入', '已啟用外部嵌入', 'Per-table administrator switch for the configured external embedding provider.'),
  ('external_embedding_policy_configured', 'Embedding-kenttävalinta määritetty', 'Embedding field policy configured', '已配置嵌入字段策略', '已設定嵌入欄位政策', 'Technical marker showing that the administrator has saved an explicit field selection.'),
  ('generation', 'Sukupolvi', 'Generation', '生成版本', '產生版本', 'Content-free embedding refresh queue field.'),
  ('attempt_count', 'Yritysten määrä', 'Attempt count', '尝试次数', '嘗試次數', 'Content-free embedding refresh queue field.'),
  ('available_at', 'Käsiteltävissä', 'Available at', '可处理时间', '可處理時間', 'Content-free embedding refresh queue field.'),
  ('lease_token', 'Työvarauksen tunniste', 'Lease token', '租约令牌', '租約權杖', 'Content-free embedding refresh queue field.'),
  ('lease_expires_at', 'Työvaraus päättyy', 'Lease expires at', '租约到期时间', '租約到期時間', 'Content-free embedding refresh queue field.'),
  ('last_error_code', 'Viimeisin virhekoodi', 'Last error code', '最后错误代码', '最後錯誤代碼', 'Content-free embedding refresh queue field.'),
  ('embedding_external_fields', 'Ulkoiseen embedding-palveluun lähetettävät kentät', 'Fields sent to the external embedding provider', '发送到外部嵌入服务的字段', '傳送到外部嵌入服務嘅欄位', 'Admin label for selecting technically eligible dataset fields for the configured external embedding provider.'),
  ('embedding_enable_dataset', 'Salli ulkoiset embeddingit tälle taululle', 'Enable external embeddings for this table', '为此表启用外部嵌入', '為此資料表啟用外部嵌入', 'Admin switch that enables external embedding processing for one public-schema dataset.'),
  ('embedding_external_warning', 'Kun taulu otetaan käyttöön, sen teknisesti sopivat tekstikentät ovat aluksi valittuina. Poista valinta kentistä, joita et halua lähettää määritetylle ulkoiselle embedding-palvelulle. Restricted-skeeman kenttiä ei voi valita tässä.', 'When a table is enabled, its technically eligible text fields are initially selected. Clear any fields you do not want sent to the configured external embedding provider. Restricted-schema fields cannot be selected here.', '启用表后，技术上适用的文本字段将默认被选中。请取消选择不希望发送到已配置外部嵌入服务的字段。此处无法选择受限架构中的字段。', '啟用資料表後，技術上適用嘅文字欄位會預設揀選。請取消揀選唔想傳送到已設定外部嵌入服務嘅欄位。受限制綱要嘅欄位無法喺呢度揀選。', 'Explanation beside the administrator-owned table and field policy for external embedding generation.'),
  ('embedding_save_field_policy', 'Tallenna embedding-asetukset', 'Save embedding settings', '保存嵌入设置', '儲存嵌入設定', 'Admin action that saves the table switch and explicit field selection.'),
  ('embedding_field_policy_saved', 'Embedding-asetukset tallennettu ja päivitys jonotettu', 'Embedding settings saved and refresh queued', '嵌入设置已保存，刷新已排队', '嵌入設定已儲存，重新整理已排程', 'Confirmation after enabled embedding settings are saved and refresh work is queued.')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    updated = now(),
    creation_spec = EXCLUDED.creation_spec;

-- Filter inputs derive predictable labels from their already translated field
-- name. Existing hand-written labels (including the four example apps) win.
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT 'search_for_' || base.lang_key,
       'Hae: ' || base.fi,
       'Search: ' || base.en,
       '搜索：' || base.ch,
       '搜尋：' || base.yue,
       'public fixture metadata seed'
FROM (
    SELECT DISTINCT COALESCE(NULLIF(details.lang_key, ''), details.column_name) AS lang_key
    FROM public.system_column_details details
) required
JOIN public.system_lang_keys base ON base.lang_key = required.lang_key
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys existing
    WHERE existing.lang_key = 'search_for_' || base.lang_key
);

-- Every registered public dataset receives stable page-title and global-search
-- labels from its translated table name, again preserving curated overrides.
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT derived.lang_key,
       derived.fi,
       derived.en,
       derived.ch,
       derived.yue,
       'public fixture metadata seed'
FROM (
    SELECT 'search_for_' || tables.table_name AS lang_key,
           'Hae: ' || base.fi AS fi,
           'Search: ' || base.en AS en,
           '搜索：' || COALESCE(NULLIF(base.ch, ''), base.en) AS ch,
           '搜尋：' || COALESCE(NULLIF(base.yue, ''), NULLIF(base.ch, ''), base.en) AS yue
    FROM public.system_db_tables tables
    JOIN public.system_lang_keys base ON base.lang_key = tables.table_name
    UNION ALL
    SELECT tables.table_name || '_front_page' AS lang_key,
           base.fi AS fi,
           base.en AS en,
           COALESCE(NULLIF(base.ch, ''), base.en) AS ch,
           COALESCE(NULLIF(base.yue, ''), NULLIF(base.ch, ''), base.en) AS yue
    FROM public.system_db_tables tables
    JOIN public.system_lang_keys base ON base.lang_key = tables.table_name
) derived
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys existing
    WHERE existing.lang_key = derived.lang_key
);

-- Fresh installs receive exactly the same five-locale registry as an upgraded
-- database. Only semantically proven legacy values are copied. In particular,
-- Cantonese yue text is not relabelled as reviewed Hong Kong Chinese (zh-HK).
INSERT INTO public.system_languages (
    language_code,
    english_name,
    native_name,
    script_code,
    region_code,
    is_enabled,
    is_default,
    fallback_language_code,
    coverage_status,
    review_status,
    public_selector_ready,
    sort_order
) VALUES
  ('en',    'English',                              'English',              'Latn', NULL, TRUE,  TRUE,  NULL, 'complete',    'approved',     TRUE,   10),
  ('fi',    'Finnish',                              'Suomi',                'Latn', NULL, TRUE,  FALSE, 'en', 'complete',    'approved',     TRUE,   20),
  ('zh-CN', 'Chinese (Simplified, Mainland China)', '简体中文（中国大陆）',   'Hans', 'CN', FALSE, FALSE, 'en', 'partial',     'needs_review', FALSE,  30),
  ('zh-TW', 'Chinese (Traditional, Taiwan)',        '繁體中文（台灣）',     'Hant', 'TW', FALSE, FALSE, 'en', 'not_started', 'unreviewed',   FALSE,  40),
  ('zh-HK', 'Chinese (Traditional, Hong Kong)',     '繁體中文（香港）',     'Hant', 'HK', FALSE, FALSE, 'en', 'not_started', 'unreviewed',   FALSE,  50)
ON CONFLICT (language_code) DO NOTHING;

WITH legacy_translations AS (
    SELECT source.id AS lang_key_id,
           'en'::TEXT AS language_code,
           source.en AS translation,
           'legacy_en'::TEXT AS source_kind,
           'approved'::TEXT AS review_status
    FROM public.system_lang_keys AS source
    UNION ALL
    SELECT source.id, 'fi'::TEXT, source.fi, 'legacy_fi'::TEXT, 'approved'::TEXT
    FROM public.system_lang_keys AS source
    UNION ALL
    SELECT source.id, 'zh-CN'::TEXT, source.ch, 'legacy_ch'::TEXT, 'needs_review'::TEXT
    FROM public.system_lang_keys AS source
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT source.lang_key_id,
       source.language_code,
       source.translation,
       source.source_kind,
       source.review_status
FROM legacy_translations AS source
WHERE NULLIF(btrim(source.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;

-- The two language-model table labels are authored static navigation copy,
-- not candidates for runtime AI fallback. Seed every canonical locale row;
-- the legacy columns above remain available during the compatibility period.
WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('system_languages', 'en', 'Languages', 'approved'),
        ('system_languages', 'fi', 'Kielet', 'approved'),
        ('system_languages', 'zh-CN', '语言', 'needs_review'),
        ('system_languages', 'zh-TW', '語言', 'needs_review'),
        ('system_languages', 'zh-HK', '語言', 'needs_review'),
        ('system_lang_key_translations', 'en', 'Language key translations', 'approved'),
        ('system_lang_key_translations', 'fi', 'Kieliavainten käännökset', 'approved'),
        ('system_lang_key_translations', 'zh-CN', '语言键翻译', 'needs_review'),
        ('system_lang_key_translations', 'zh-TW', '語言鍵翻譯', 'needs_review'),
        ('system_lang_key_translations', 'zh-HK', '語言鍵翻譯', 'needs_review'),
        ('system_column_field_sets', 'en', 'Field collections', 'approved'),
        ('system_column_field_sets', 'fi', 'Kenttäkokoelmat', 'approved'),
        ('system_column_field_sets', 'zh-CN', '字段集合', 'needs_review'),
        ('system_column_field_sets', 'zh-TW', '欄位集合', 'needs_review'),
        ('system_column_field_sets', 'zh-HK', '欄位集合', 'needs_review'),
        ('system_column_field_set_members', 'en', 'Field collection members', 'approved'),
        ('system_column_field_set_members', 'fi', 'Kenttäkokoelmien kentät', 'approved'),
        ('system_column_field_set_members', 'zh-CN', '字段集合成员', 'needs_review'),
        ('system_column_field_set_members', 'zh-TW', '欄位集合成員', 'needs_review'),
        ('system_column_field_set_members', 'zh-HK', '欄位集合成員', 'needs_review'),
        ('system_view_field_set_assignments', 'en', 'View field assignments', 'approved'),
        ('system_view_field_set_assignments', 'fi', 'Näkymien kenttäkokoelmat', 'approved'),
        ('system_view_field_set_assignments', 'zh-CN', '视图字段分配', 'needs_review'),
        ('system_view_field_set_assignments', 'zh-TW', '檢視欄位指派', 'needs_review'),
        ('system_view_field_set_assignments', 'zh-HK', '檢視欄位指派', 'needs_review'),
        ('system_user_visual_preferences', 'en', 'User Visual Preferences', 'approved'),
        ('system_user_visual_preferences', 'fi', 'Käyttäjän ulkoasuvalinnat', 'approved'),
        ('system_user_visual_preferences', 'zh-CN', '用户视觉偏好', 'needs_review'),
        ('system_user_visual_preferences', 'zh-TW', '用戶視覺偏好', 'needs_review'),
        ('system_user_visual_preferences', 'zh-HK', '用戶視覺偏好', 'needs_review'),
        ('theme_toggle_system', 'en', 'Theme: system', 'approved'),
        ('theme_toggle_system', 'fi', 'Teema: järjestelmän mukaan', 'approved'),
        ('theme_toggle_system', 'zh-CN', '主题：跟随系统', 'needs_review'),
        ('theme_toggle_system', 'zh-TW', '主題：跟隨系統', 'needs_review'),
        ('theme_toggle_system', 'zh-HK', '主題：跟隨系統', 'needs_review'),
        ('theme_toggle_dark', 'en', 'Theme: dark', 'approved'),
        ('theme_toggle_dark', 'fi', 'Teema: tumma', 'approved'),
        ('theme_toggle_dark', 'zh-CN', '主题：深色', 'needs_review'),
        ('theme_toggle_dark', 'zh-TW', '主題：深色', 'needs_review'),
        ('theme_toggle_dark', 'zh-HK', '主題：深色', 'needs_review'),
        ('theme_toggle_light', 'en', 'Theme: light', 'approved'),
        ('theme_toggle_light', 'fi', 'Teema: vaalea', 'approved'),
        ('theme_toggle_light', 'zh-CN', '主题：浅色', 'needs_review'),
        ('theme_toggle_light', 'zh-TW', '主題：淺色', 'needs_review'),
        ('theme_toggle_light', 'zh-HK', '主題：淺色', 'needs_review'),
        ('theme_toggle_locked_light', 'en', 'Theme: locked light', 'approved'),
        ('theme_toggle_locked_light', 'fi', 'Teema: lukittu vaaleaksi', 'approved'),
        ('theme_toggle_locked_light', 'zh-CN', '主题：锁定浅色', 'needs_review'),
        ('theme_toggle_locked_light', 'zh-TW', '主題：鎖定淺色', 'needs_review'),
        ('theme_toggle_locked_light', 'zh-HK', '主題：鎖定淺色', 'needs_review'),
        ('theme_toggle_locked_dark', 'en', 'Theme: locked dark', 'approved'),
        ('theme_toggle_locked_dark', 'fi', 'Teema: lukittu tummaksi', 'approved'),
        ('theme_toggle_locked_dark', 'zh-CN', '主题：锁定深色', 'needs_review'),
        ('theme_toggle_locked_dark', 'zh-TW', '主題：鎖定深色', 'needs_review'),
        ('theme_toggle_locked_dark', 'zh-HK', '主題：鎖定深色', 'needs_review'),
        ('edit_site_field_default', 'en', 'Edit site default', 'approved'),
        ('edit_site_field_default', 'fi', 'Muokkaa sivuston oletusta', 'approved'),
        ('edit_site_field_default', 'zh-CN', '编辑站点默认字段', 'needs_review'),
        ('edit_site_field_default', 'zh-TW', '編輯網站預設欄位', 'needs_review'),
        ('edit_site_field_default', 'zh-HK', '編輯網站預設欄位', 'needs_review'),
        ('edit_personal_field_selection', 'en', 'Return to personal selection', 'approved'),
        ('edit_personal_field_selection', 'fi', 'Palaa omaan valintaan', 'approved'),
        ('edit_personal_field_selection', 'zh-CN', '返回个人字段选择', 'needs_review'),
        ('edit_personal_field_selection', 'zh-TW', '返回個人欄位選擇', 'needs_review'),
        ('edit_personal_field_selection', 'zh-HK', '返回個人欄位選擇', 'needs_review'),
        ('return_to_site_default', 'en', 'Return to site default', 'approved'),
        ('return_to_site_default', 'fi', 'Palaa sivuston oletukseen', 'approved'),
        ('return_to_site_default', 'zh-CN', '继承站点默认值', 'needs_review'),
        ('return_to_site_default', 'zh-TW', '使用網站預設值', 'needs_review'),
        ('return_to_site_default', 'zh-HK', '使用網站預設值', 'needs_review'),
        ('site_default_restored', 'en', 'Site default restored', 'approved'),
        ('site_default_restored', 'fi', 'Sivuston oletus palautettu', 'approved'),
        ('site_default_restored', 'zh-CN', '已恢复站点默认值', 'needs_review'),
        ('site_default_restored', 'zh-TW', '已恢復網站預設值', 'needs_review'),
        ('site_default_restored', 'zh-HK', '已恢復網站預設值', 'needs_review'),
        ('shared', 'en', 'Shared', 'approved'),
        ('shared', 'fi', 'Jaettu', 'approved'),
        ('shared', 'zh-CN', '共享', 'needs_review'),
        ('shared', 'zh-TW', '共用', 'needs_review'),
        ('shared', 'zh-HK', '共用', 'needs_review'),
        ('field_set_fields_placeholder', 'en', 'Fields in collection', 'approved'),
        ('field_set_fields_placeholder', 'fi', 'Kentät kenttäjoukossa', 'approved'),
        ('field_set_fields_placeholder', 'zh-CN', '字段集中的字段', 'needs_review'),
        ('field_set_fields_placeholder', 'zh-TW', '欄位集中的欄位', 'needs_review'),
        ('field_set_fields_placeholder', 'zh-HK', '欄位集中的欄位', 'needs_review'),
        ('fields_selected', 'en', 'fields selected', 'approved'),
        ('fields_selected', 'fi', 'kenttää valittu', 'approved'),
        ('fields_selected', 'zh-CN', '个字段已选择', 'needs_review'),
        ('fields_selected', 'zh-TW', '個欄位已選取', 'needs_review'),
        ('fields_selected', 'zh-HK', '個欄位已選取', 'needs_review'),
        ('filter_mode_exact_value', 'en', 'Exact value', 'approved'),
        ('filter_mode_exact_value', 'fi', 'Tarkka arvo', 'approved'),
        ('filter_mode_exact_value', 'zh-CN', '精确值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-TW', '精確值', 'needs_review'),
        ('filter_mode_exact_value', 'zh-HK', '精確值', 'needs_review'),
        ('filter_mode_range', 'en', 'Range', 'approved'),
        ('filter_mode_range', 'fi', 'Arvoväli', 'approved'),
        ('filter_mode_range', 'zh-CN', '范围', 'needs_review'),
        ('filter_mode_range', 'zh-TW', '範圍', 'needs_review'),
        ('filter_mode_range', 'zh-HK', '範圍', 'needs_review'),
        ('filter_mode_condition_expression', 'en', 'Condition or expression', 'approved'),
        ('filter_mode_condition_expression', 'fi', 'Ehto tai lauseke', 'approved'),
        ('filter_mode_condition_expression', 'zh-CN', '条件或表达式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-TW', '條件或運算式', 'needs_review'),
        ('filter_mode_condition_expression', 'zh-HK', '條件或運算式', 'needs_review'),
        ('previous_image', 'en', 'Previous image', 'approved'),
        ('previous_image', 'fi', 'Edellinen kuva', 'approved'),
        ('previous_image', 'zh-CN', '上一张图片', 'needs_review'),
        ('previous_image', 'zh-TW', '上一張圖片', 'needs_review'),
        ('previous_image', 'zh-HK', '上一張圖片', 'needs_review'),
        ('next_image', 'en', 'Next image', 'approved'),
        ('next_image', 'fi', 'Seuraava kuva', 'approved'),
        ('next_image', 'zh-CN', '下一张图片', 'needs_review'),
        ('next_image', 'zh-TW', '下一張圖片', 'needs_review'),
        ('next_image', 'zh-HK', '下一張圖片', 'needs_review'),
        ('previous_row', 'en', 'Previous record', 'approved'),
        ('previous_row', 'fi', 'Edellinen tietue', 'approved'),
        ('previous_row', 'zh-CN', '上一条记录', 'needs_review'),
        ('previous_row', 'zh-TW', '上一筆資料', 'needs_review'),
        ('previous_row', 'zh-HK', '上一筆資料', 'needs_review'),
        ('next_row', 'en', 'Next record', 'approved'),
        ('next_row', 'fi', 'Seuraava tietue', 'approved'),
        ('next_row', 'zh-CN', '下一条记录', 'needs_review'),
        ('next_row', 'zh-TW', '下一筆資料', 'needs_review'),
        ('next_row', 'zh-HK', '下一筆資料', 'needs_review'),
        ('open_article', 'en', 'Open article', 'approved'),
        ('open_article', 'fi', 'Avaa artikkeli', 'approved'),
        ('open_article', 'zh-CN', '打开文章', 'needs_review'),
        ('open_article', 'zh-TW', '開啟文章', 'needs_review'),
        ('open_article', 'zh-HK', '開啟文章', 'needs_review'),
        ('article_records', 'en', 'Article records', 'approved'),
        ('article_records', 'fi', 'Artikkelin tietueet', 'approved'),
        ('article_records', 'zh-CN', '文章记录', 'needs_review'),
        ('article_records', 'zh-TW', '文章資料', 'needs_review'),
        ('article_records', 'zh-HK', '文章資料', 'needs_review')
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
        authored.language_code,
        authored.translation,
        authored.review_status
    FROM authored_translations AS authored
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = authored.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    resolved.lang_key_id,
    resolved.language_code,
    resolved.translation,
    'manual',
    resolved.review_status
FROM resolved
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js',
       '',
       'Per-view personal and site-default field collection controls.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'edit_site_field_default',
    'edit_personal_field_selection',
    'return_to_site_default',
    'site_default_restored',
    'shared',
    'field_set_fields_placeholder',
    'fields_selected'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/theme.js',
       '',
       'Localized accessible theme-toggle states.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'theme_toggle_system',
    'theme_toggle_dark',
    'theme_toggle_light',
    'theme_toggle_locked_light',
    'theme_toggle_locked_dark'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
-- db_9_7_0.seed.sql
-- Seeds DB 9.7.0 runtime metadata, normalized actions, routes, and database-role grants.
-- Bridges fresh-install schema objects with accepted administrator workflows #874 and #879.
-- Exists so first use has the same fail-closed capabilities as a migrated installation.

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
ON CONFLICT (key) DO UPDATE
SET boolean_value = FALSE,
    text_value = 'false',
    value_type = 2,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

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

WITH desired_tables (table_name, display_name, description, fk_display_column) AS (
    VALUES
        ('system_permission_categories', 'Permission Categories', 'Translatable grouping for normalized permission actions', 'category_key'),
        ('system_permission_actions', 'Permission Actions', 'Stable dataset, row, and system permission actions', 'action_key'),
        ('system_row_access_rules', 'Row Access Rules', 'Exact-row user and group allow-deny rules', 'id'),
        ('system_row_access_rule_events', 'Row Access Rule Events', 'Append-only audit events for row-access changes', 'id')
)
INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, folder_id, schema_name,
    fk_display_column, filterbar_visible_by_default, is_removable,
    display_name, sql_dump_policy
)
SELECT desired.table_name,
       desired.description,
       classes.oid::integer,
       folders.id,
       'public',
       desired.fk_display_column,
       FALSE,
       FALSE,
       desired.display_name,
       'all'
FROM desired_tables AS desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
LEFT JOIN LATERAL (
    SELECT id
    FROM public.system_table_folders
    WHERE folder_name = 'system'
    ORDER BY id
    LIMIT 1
) AS folders ON TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid INTEGER;
BEGIN
    FOR table_record IN
        SELECT unnest(ARRAY[
            'system_permission_categories',
            'system_permission_actions',
            'system_row_access_rules',
            'system_row_access_rule_events'
        ]) AS table_name
    LOOP
        SELECT table_uid INTO registered_table_uid
        FROM public.system_db_tables
        WHERE table_name = table_record.table_name
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
        LIMIT 1;

        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
        )
        SELECT registered_table_uid,
               columns.column_name,
               columns.data_type,
               columns.ordinal_position,
               FALSE,
               now(),
               now()
        FROM information_schema.columns AS columns
        WHERE registered_table_uid IS NOT NULL
          AND columns.table_schema = 'public'
          AND columns.table_name = table_record.table_name
          AND NOT EXISTS (
              SELECT 1
              FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END LOOP;
END $$;

-- Technical vectors stay available to backend ranking and filtering but do not
-- become ordinary result fields serialized to an authorized browser client.
UPDATE public.system_column_details AS details
SET client_delivery_mode = 'server_only',
    updated = now()
FROM public.system_db_tables AS tables
JOIN information_schema.columns AS columns
  ON columns.table_schema = COALESCE(NULLIF(tables.schema_name, ''), 'public')
 AND columns.table_name = tables.table_name
WHERE details.table_uid = tables.table_uid
  AND details.column_name = columns.column_name
  AND details.column_name <> 'id'
  AND (
      columns.udt_name IN ('vector', 'tsvector')
      OR lower(details.column_name) ~ '(^|_)(embedding|embeddings|search_vector)(_|$)'
  );

WITH desired_functions(name, route, package_name, ui_only, creation_spec) AS (
    VALUES
        (
            'system_table_tools.AdminRowAccessRulesHandler',
            '/api/admin/row-access-rules',
            'system_table_tools',
            FALSE,
            'Administrator-only exact-row access rule read and fail-closed bulk mutation API.'
        ),
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
       'Filterest DB 9.7.0 accepted administrator access-control workflows',
       NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'system_table_tools.AdminRowAccessRulesHandler',
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
-- Seeds field-collection ownership and inheritance copy before the first view opens.
-- Connects the field selector to reviewed Finnish/English and existing legacy fallbacks.
-- Preserves nonempty site-authored translations and records each key's actual UI source.
-- Shared by fresh public bootstrap and the matching additive upgrade migration.

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('field_set_owner_personal', 'Henkilökohtainen', 'Personal', '个人', '個人', 'Labels a field collection owned only by the current user.'),
        ('field_set_source_personal', 'Henkilökohtainen ohitus on käytössä', 'Personal override in use', '正在使用个人覆盖设置', '正在使用個人覆寫設定', 'Explains that the user''s personal field selection overrides inherited defaults.'),
        ('field_set_source_group', 'Ryhmäkohtainen oletus on käytössä', 'Group default in use', '正在使用组默认设置', '正在使用群組預設設定', 'Explains that the effective field selection comes from a user-group default.'),
        ('field_set_source_site', 'Sivuston oletus on käytössä', 'Site default in use', '正在使用站点默认设置', '正在使用網站預設設定', 'Explains that the effective field selection comes from the site default.'),
        ('field_set_source_metadata', 'Metadatan oletus on käytössä', 'Metadata default in use', '正在使用元数据默认设置', '正在使用中繼資料預設設定', 'Explains that the effective field selection comes from column metadata.'),
        ('field_set_editing_site_default', 'Muokataan sivuston oletusta (vain jaetut kenttäjoukot)', 'Editing site default (shared collections only)', '正在编辑站点默认设置（仅限共享集合）', '正在編輯網站預設設定（只限共用集合）', 'Explains why only shared field collections are editable as the site default.'),
        ('field_set_assignment_unavailable', 'Tallennettu kenttäjoukkovalinta ei ole käytettävissä. Palvelimen turvallinen kenttävalinta on edelleen käytössä.', 'The saved field collection is unavailable. The server''s safe field selection remains in use.', '已保存的字段集合不可用。服务器的安全字段选择仍在使用。', '已儲存嘅欄位集合用唔到。伺服器嘅安全欄位選擇仍然使用中。', 'Explains that the server keeps a safe field selection when a saved collection is unavailable.'),
        ('use_site_default', 'Käytä sivuston oletusta', 'Use site default', '使用站点默认设置', '使用網站預設設定', 'Restores inherited site defaults after removing a personal field selection.'),
        ('use_metadata_default', 'Käytä metadatan oletusta', 'Use metadata default', '使用元数据默认设置', '使用中繼資料預設設定', 'Restores column-metadata defaults when no site field selection exists.'),
        ('field_set_inheritance_restored', 'Oma ohitus poistettiin', 'Personal override removed', '已移除个人覆盖设置', '已移除個人覆寫設定', 'Confirms that a personal field-selection override was removed.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    ch = CASE WHEN NULLIF(btrim(system_lang_keys.ch), '') IS NULL THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
    yue = CASE WHEN NULLIF(btrim(system_lang_keys.yue), '') IS NULL THEN EXCLUDED.yue ELSE system_lang_keys.yue END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.ch), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.yue), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

-- Only reviewed locales are published into the normalized translation catalog.
-- Existing Chinese/Cantonese fallbacks remain in their legacy fields; this change
-- does not claim a new locale review or map Cantonese to an unreviewed region.
WITH selected_keys AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE lang_key IN (
        'field_set_owner_personal',
        'field_set_source_personal',
        'field_set_source_group',
        'field_set_source_site',
        'field_set_source_metadata',
        'field_set_editing_site_default',
        'field_set_assignment_unavailable',
        'use_site_default',
        'use_metadata_default',
        'field_set_inheritance_restored'
    )
), authored_translations AS (
    SELECT keys.id AS lang_key_id, copy.language_code, copy.translation
    FROM selected_keys AS keys
    CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en))
        AS copy(language_code, translation)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js',
       '',
       keys.creation_spec,
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'field_set_owner_personal',
    'field_set_source_personal',
    'field_set_source_group',
    'field_set_source_site',
    'field_set_source_metadata',
    'field_set_editing_site_default',
    'field_set_assignment_unavailable',
    'use_site_default',
    'use_metadata_default',
    'field_set_inheritance_restored'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET last_seen = CURRENT_DATE;
-- label_value_layout.lang_keys.sql
-- Retains wrapping translations and tracks the four live site-selector keys.
-- Connects fresh installations to the site-wide appearance control after WL52.
-- Keeps retired copy without false code sources, for normal orphan archival.

-- BEGIN label/value layout language seed (shared with fresh bootstrap).
WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
    ('label_value_layout', 'Kentän otsikon ja arvon asettelu', 'Field label and value layout', 'Names the site-wide field wrapping choice, separately from field placement and visibility.'),
    ('label_value_layout_inherit', 'Nykyinen oletus', 'Current default', 'Restores each renderer''s existing behavior without an explicit column layout.'),
    ('label_value_layout_auto', 'Automaattinen', 'Automatic', 'Lets the configured field pair wrap according to text and available space.'),
    ('label_value_layout_inline', 'Rinnakkain', 'Side by side', 'Keeps the label and value in adjacent areas while allowing text to wrap.'),
    ('label_value_layout_stacked', 'Allekkain', 'Stacked', 'Places the field value below its label.'),
    ('label_value_layout_help', 'Otsikon ja arvon asettelu on sarakkeen yhteinen oletus korttien ja artikkelien tietokentille. Se ei muuta kentän paikkaa tai näkyvyyttä. Nykyinen oletus säilyttää näkymän aiemman toiminnan.', 'Label and value layout is the shared column default for card and article detail fields. It does not change field placement or visibility. Current default preserves the previous behavior of each view.', 'Explains the shared default and the unchanged placement, visibility and inherited behavior.'),
    ('label_value_layout_readback_failed', 'Asetuksen tallennusta ei voitu varmistaa. Lataa asetukset uudelleen.', 'The saved setting could not be verified. Reload the settings.', 'Reports a mismatch when reading the saved field layout back through the API.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key IN ('label_value_layout', 'label_value_layout_inherit', 'label_value_layout_auto', 'label_value_layout_inline', 'label_value_layout_stacked', 'label_value_layout_help', 'label_value_layout_readback_failed')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
-- Inherit/help/readback copy belonged to the retired column editor. Keep its
-- translations, but do not invent live sources; the startup orphan lifecycle
-- owns retirement. Old installations' unreferenced code sources expire normally.
SELECT id, 'code', 'frontend/core_components/admin_tools/site_label_value_layout_control.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('label_value_layout', 'label_value_layout_auto', 'label_value_layout_inline', 'label_value_layout_stacked')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- END label/value layout language seed.
-- article_view.seed.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

-- 20260908000004_add_article_view_and_field_settings.sql
-- Registers an independent article view and the clear field-settings route.
-- Bridges existing view assignments and permissions with compatible UI names.
-- Preserves existing card choices, legacy assignments, and administrator translations.
-- VERSION_DB: 9.7.7

-- Retain a legacy article dimension's identity and all FK-backed settings.
UPDATE public.system_table_views
SET view_key = 'article_view'
WHERE id = (
    SELECT id FROM public.system_table_views
    WHERE view_key IN ('article', 'big_card', 'row_article')
    ORDER BY CASE view_key WHEN 'article' THEN 0 WHEN 'big_card' THEN 1 ELSE 2 END, id
    LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.system_table_views WHERE view_key = 'article_view');

INSERT INTO public.system_table_views (name, view_key, status)
VALUES ('article_view', 'article_view', 'active')
ON CONFLICT (view_key) DO NOTHING;

-- If several old aliases existed, retain their records and fill only missing
-- canonical targets. Explicit article settings take precedence over aliases.
INSERT INTO public.system_view_field_set_assignments
    (user_id, group_id, table_uid, view_id, field_set_id, group_priority, created_by, created, updated)
SELECT old.user_id, old.group_id, old.table_uid, canonical.id,
       old.field_set_id, old.group_priority, old.created_by, old.created, old.updated
FROM public.system_view_field_set_assignments old
JOIN public.system_table_views legacy ON legacy.id = old.view_id
CROSS JOIN public.system_table_views canonical
WHERE legacy.view_key IN ('article', 'big_card', 'row_article')
  AND canonical.view_key = 'article_view'
ORDER BY CASE legacy.view_key WHEN 'article' THEN 0 WHEN 'big_card' THEN 1 ELSE 2 END, old.id
ON CONFLICT DO NOTHING;

WITH desired(name, route) AS (
    VALUES ('ui.view.article_view', '/ui/view/article_view'),
           ('ui.admin.view_field_settings', '/ui/admin/view_field_settings')
)
INSERT INTO public.system_functions
    (name, package, disabled, specific_table_related, url_route_endpoint, ui_only,
     rate_limit_amount, rate_limit_minutes, creation_spec)
SELECT name, 'frontend', FALSE, FALSE, route, TRUE, 200, 20,
       'Independent article presentation and compatible field-settings navigation.'
FROM desired
ON CONFLICT (name) DO NOTHING;

-- Preserve exactly the existing route audience, including target scoping.
-- Old routes remain available to saved bookmarks and permission integrations.
INSERT INTO public.system_group_table_func_rights
    (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
SELECT rights.user_group_id, current_route.id, rights.target_schema_name,
       rights.target_table_uid, 'Preserved audience for the canonical article/settings route.'
FROM public.system_group_table_func_rights rights
JOIN public.system_functions old_route ON old_route.id = rights.function_id
JOIN public.system_functions current_route ON current_route.name = CASE old_route.name
    WHEN 'ui.view.card' THEN 'ui.view.article_view'
    WHEN 'ui.admin.view_field_assignments' THEN 'ui.admin.view_field_settings' END
WHERE old_route.name IN ('ui.view.card', 'ui.admin.view_field_assignments')
  AND NOT EXISTS (
      SELECT 1 FROM public.system_group_table_func_rights existing
      WHERE existing.user_group_id = rights.user_group_id
        AND existing.function_id = current_route.id
        AND existing.target_schema_name IS NOT DISTINCT FROM rights.target_schema_name
        AND existing.target_table_uid IS NOT DISTINCT FROM rights.target_table_uid
  )
ON CONFLICT DO NOTHING;

WITH authored(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES ('view_field_settings', 'Näkymien kenttäasetukset', 'View field settings',
            '视图字段设置', '檢視欄位設定', 'Canonical navigation title for per-view field settings.'),
           ('view_article', 'Artikkeli', 'Article', '文章', '文章',
            'Independent article presentation with its own field settings.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec FROM authored
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    ch = CASE WHEN NULLIF(btrim(system_lang_keys.ch), '') IS NULL THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
    yue = CASE WHEN NULLIF(btrim(system_lang_keys.yue), '') IS NULL THEN EXCLUDED.yue ELSE system_lang_keys.yue END
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.ch), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.yue), '') IS NULL;

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
-- Legacy ch/yue fields remain intact; they are not normalized language codes.
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en))
    AS copy(language_code, translation)
WHERE keys.lang_key IN ('view_field_settings', 'view_article')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;
-- column_supported_views.seed.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

INSERT INTO public.system_db_tables (
    table_name,
    description,
    cached_oid,
    folder_id,
    schema_name,
    fk_display_column,
    filterbar_visible_by_default,
    is_removable,
    display_name,
    sql_dump_policy,
    default_view_id
)
SELECT
    'system_column_supported_views',
    'Read-only filterable matrix of registered columns and supported views',
    classes.oid::INTEGER,
    (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_table_views'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    ),
    'public',
    'column_name',
    TRUE,
    FALSE,
    'Column Supported Views',
    'none',
    (
        SELECT id
        FROM public.system_table_views
        WHERE view_key = 'table'
        LIMIT 1
    )
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE classes.relname = 'system_column_supported_views'
  AND classes.relkind = 'v'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_db_tables AS existing
      WHERE existing.table_name = 'system_column_supported_views'
        AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
  );

UPDATE public.system_db_tables AS target
SET description = 'Read-only filterable matrix of registered columns and supported views',
    cached_oid = classes.oid::INTEGER,
    folder_id = COALESCE(target.folder_id, (
        SELECT metadata.folder_id
        FROM public.system_db_tables AS metadata
        WHERE metadata.table_name = 'system_table_views'
          AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
        LIMIT 1
    )),
    schema_name = 'public',
    fk_display_column = 'column_name',
    filterbar_visible_by_default = TRUE,
    is_removable = FALSE,
    display_name = 'Column Supported Views',
    sql_dump_policy = 'none',
    default_view_id = COALESCE(target.default_view_id, (
        SELECT id
        FROM public.system_table_views
        WHERE view_key = 'table'
        LIMIT 1
    )),
    updated = now()
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace
 AND schemas.nspname = 'public'
WHERE target.table_name = 'system_column_supported_views'
  AND COALESCE(NULLIF(target.schema_name, ''), 'public') = 'public'
  AND classes.relname = 'system_column_supported_views'
  AND classes.relkind = 'v';

DO $$
DECLARE
    matrix_table_uid INTEGER;
BEGIN
    SELECT table_uid
    INTO matrix_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_column_supported_views'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LIMIT 1;

    IF matrix_table_uid IS NULL THEN
        RAISE EXCEPTION 'column support matrix registration failed';
    END IF;

    INSERT INTO public.system_column_details (
        table_uid,
        column_name,
        data_type,
        co_number,
        editable_in_ui,
        is_multilingual,
        created,
        updated
    )
    SELECT
        matrix_table_uid,
        columns.column_name,
        columns.data_type,
        columns.ordinal_position,
        FALSE,
        FALSE,
        now(),
        now()
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'system_column_supported_views'
      AND NOT EXISTS (
          SELECT 1
          FROM public.system_column_details AS existing
          WHERE existing.table_uid = matrix_table_uid
            AND existing.column_name = columns.column_name
      )
    ORDER BY columns.ordinal_position;

    UPDATE public.system_column_details
    SET editable_in_ui = FALSE,
        is_multilingual = FALSE,
        hide_everywhere = FALSE,
        hide_in_filter_panel = FALSE,
        client_delivery_mode = 'include',
        updated = now()
    WHERE table_uid = matrix_table_uid;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO readeronly;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO admin_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO basic_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        GRANT SELECT ON TABLE public.system_column_supported_views TO guest_user;
    END IF;
END $$;

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
    'Filterest DB 9.7.3 administrator column support matrix read access',
    matrix.table_uid
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name IN (
      'dtt_1_row_read.GetResultsHandlerWrapper',
      'dtt_1_row_read.GetRowCountHandlerWrapper',
      'dtt_1_row_read.GetFilterOptionsHandler',
      'dtt_3_table_read.GetTableViewHandlerWrapper',
      'dtt_2_column_crud.GetTableColumnsHandler'
  )
JOIN public.system_db_tables AS matrix
  ON matrix.table_name = 'system_column_supported_views'
 AND COALESCE(NULLIF(matrix.schema_name, ''), 'public') = 'public'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid = matrix.table_uid
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('system_column_supported_views', 'Sarakkeiden tuetut näkymät', 'Column Supported Views', '列支持的视图', '欄位支援的檢視', 'Dataset title for the read-only column-to-view support matrix.'),
        ('view_key', 'Näkymäavain', 'View key', '视图键', '檢視鍵', 'Stable registered view identifier in the support matrix.'),
        ('view_status', 'Näkymän tila', 'View status', '视图状态', '檢視狀態', 'Registered view lifecycle status in the support matrix.'),
        ('is_supported', 'Tuettu näkymässä', 'Supported in view', '在视图中受支持', '喺檢視中支援', 'Effective column support flag in the support matrix.'),
        ('support_state', 'Tuen tila', 'Support state', '支持状态', '支援狀態', 'Deterministic reason behind the effective support flag.'),
        ('is_filterable', 'Suodatettavissa', 'Filterable', '可筛选', '可篩選', 'Whether the column is available to the ordinary filter panel.'),
        ('supported', 'Tuettu', 'Supported', '受支持', '支援', 'Support-matrix state for a client-visible column.'),
        ('server_only', 'Vain palvelimella', 'Server only', '仅限服务器', '只限伺服器', 'Support-matrix state for data intentionally withheld from client projections.'),
        ('hidden_everywhere', 'Piilotettu kaikkialla', 'Hidden everywhere', '全局隐藏', '全域隱藏', 'Support-matrix state for globally hidden presentation metadata.'),
        ('hidden_on_card', 'Piilotettu korteissa', 'Hidden on cards', '在卡片中隐藏', '喺卡片中隱藏', 'Support-matrix state for columns hidden by the card default.')
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
    WHERE lang_key IN (
        'system_column_supported_views',
        'view_key',
        'view_status',
        'is_supported',
        'support_state',
        'is_filterable',
        'supported',
        'server_only',
        'hidden_everywhere',
        'hidden_on_card'
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
       'migration',
       'server_tools/migrations/20260906000002_add_column_view_support_matrix.sql',
       '',
       'Column-to-supported-view matrix dataset and field labels.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'system_column_supported_views',
    'view_key',
    'view_status',
    'is_supported',
    'support_state',
    'is_filterable',
    'supported',
    'server_only',
    'hidden_everywhere',
    'hidden_on_card'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
-- media_library.lang_keys.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.


WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
    ('media_library_choose', 'Käytä olemassa olevaa kuvaa', 'Use an existing image', 'Existing-image reuse: choose.'),
    ('media_library_close', 'Sulje kuvalista', 'Close image list', 'Existing-image reuse: close.'),
    ('media_library_clear', 'Poista valinta', 'Clear selection', 'Existing-image reuse: clear.'),
    ('media_library_next', 'Lisää kuvia', 'More images', 'Existing-image reuse: next.'),
    ('media_library_loading', 'Ladataan kuvia…', 'Loading images…', 'Existing-image reuse: loading.'),
    ('media_library_scope', 'Valitse saman aineiston kuva. Kuva ja sen nykyiset kuvatekstit liitetään, kun tallennat rivin.', 'Choose an image from this dataset. Its current captions are copied when you save the row.', 'Existing-image reuse: scope.'),
    ('media_library_unavailable', 'Kuvaa ei voi käyttää uudelleen näillä oikeuksilla.', 'This image cannot be reused with these permissions.', 'Existing-image reuse: unavailable.'),
    ('media_library_empty', 'Uudelleenkäytettäviä kuvia ei löytynyt.', 'No reusable images were found.', 'Existing-image reuse: empty.'),
    ('media_library_selected', 'Valittu kuva', 'Selected image', 'Existing-image reuse: selected.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/reusable_components/media_library_picker/media_library_picker.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- Supplies reviewed web-image picker copy for existing and fresh installations.
-- Connects the picker URL, clipboard help and original-page link to the language catalog.
-- Preserves nonempty site-authored copy while seeding missing Finnish and English text.
-- Shared by the incremental migration and the independent public bootstrap.

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('image_source_picker_help', 'Liitä Unsplash-, Pexels- tai Pixabay-kuvasivun osoite. Kuva ja sen lähdetieto tallennetaan vain tälle uudelle riville.', 'Paste an Unsplash, Pexels, or Pixabay photo-page URL. The image and its credit will be saved only with this new row.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_source_url', 'Kuvasivun osoite', 'Image page URL', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('see_original_page', 'Katso alkuperäinen sivu', 'See original page', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('paste_and_preview', 'Liitä ja esikatsele', 'Paste & preview', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_help', 'Voit liittää osoitteen suoraan kenttään. Selain voi pyytää erillisen Liitä-vahvistuksen, kun käytät painiketta.', 'You can paste the URL directly into the field. Your browser may ask for a separate Paste confirmation when using the button.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_unavailable', 'Leikepöytää ei voitu lukea. Liitä kuvasivun osoite kenttään ja valitse Esikatsele.', 'The clipboard could not be read. Paste the photo-page URL into the field and choose Preview.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_clipboard_empty', 'Leikepöydällä ei ole osoitetta. Kopioi kuvasivun osoite tai kirjoita se kenttään.', 'The clipboard is empty. Copy a photo-page URL or enter it in the field.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_source_url_invalid', 'Anna kokonainen HTTPS-kuvasivun osoite.', 'Enter a complete HTTPS photo-page URL.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_preview_failed', 'Kuvan esikatselu epäonnistui. Tarkista kuvasivun osoite ja yritä uudelleen.', 'The image preview failed. Check the photo-page URL and try again.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_provider_unsupported', 'Tätä kuvapalvelua ei tueta. Käytä yllä mainittua kuvapalvelua.', 'This image provider is not supported. Use one of the providers listed above.', 'Web-image picker URL, clipboard action, or preview feedback.'),
        ('image_provider_unavailable', 'Kuvapalvelu ei ole juuri nyt käytettävissä. Voit yrittää myöhemmin uudelleen.', 'The image provider is not available right now. Please try again later.', 'Web-image picker URL, clipboard action, or preview feedback.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

WITH selected_keys AS (
    SELECT id, fi, en FROM public.system_lang_keys
    WHERE lang_key IN (
        'image_source_picker_help',
        'image_source_url',
        'see_original_page',
        'paste_and_preview',
        'image_clipboard_help',
        'image_clipboard_unavailable',
        'image_clipboard_empty',
        'image_source_url_invalid',
        'image_preview_failed',
        'image_provider_unsupported',
        'image_provider_unavailable'
    )
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM selected_keys AS keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id, 'code',
       'frontend/reusable_components/image_source_picker/image_source_picker.js', '',
       keys.creation_spec, CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'image_source_picker_help',
    'image_source_url',
    'see_original_page',
    'paste_and_preview',
    'image_clipboard_help',
    'image_clipboard_unavailable',
    'image_clipboard_empty',
    'image_source_url_invalid',
    'image_preview_failed',
    'image_provider_unsupported',
    'image_provider_unavailable'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- Seeds the notice explaining automatic text-search results without selected filters.
-- Connects the common search presentation to reviewed Finnish and English copy.
-- Preserves every existing nonempty site translation and never changes user data.
-- Shared by the public bootstrap and the corresponding additive upgrade migration.

INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
VALUES (
    'search_results_without_filters',
    'Valituilla suodattimilla ei löytynyt tekstiosumia. Näytetään tulokset ilman suodattimia. Valinnat säilyvät seuraavaa hakua varten.',
    'No text matches with the selected filters. Showing results without filters. Your selections are kept for the next search.',
    'Explains that authorized text results are shown without optional filters while retaining the selected filters for the next query.'
)
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys AS keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key = 'search_results_without_filters'
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT id, 'code', 'frontend/core_components/filterbar/text_search/dataset_search_executor.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key = 'search_results_without_filters'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- article_editor.lang_keys.sql
-- Supplies reviewed copy for one multilingual article content field.
-- Connects existing sites and the fresh public bootstrap to the same editor labels.
-- Preserves all nonempty site-authored translations and review metadata.

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('article_edit_languages', 'Muokkaa kieliversioita', 'Edit language versions', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_field', 'Kenttä', 'Field', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_help', 'Muokkaa yhtä kenttää eri kielillä. Voit säätää tekstialueen korkeutta alareunasta vetämällä. Muiden kielten tekstit säilyvät.', 'Edit one field across languages. Drag the lower edge of a text area to resize it. Other languages are preserved.', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_save_failed', 'Tallennus epäonnistui. Muutoksesi ovat yhä tässä; yritä uudelleen tai peru.', 'Saving failed. Your changes are still here; retry or cancel.', 'One-field multilingual article editor with preserved drafts and translations.'),
        ('article_language_load_failed', 'Kenttää ei voitu ladata. Yritä uudelleen.', 'The field could not be loaded. Try again.', 'One-field multilingual article editor with preserved drafts and translations.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

WITH selected_keys AS (
    SELECT id, fi, en FROM public.system_lang_keys
    WHERE lang_key IN (
        'article_edit_languages',
        'article_language_field',
        'article_language_help',
        'article_language_save_failed',
        'article_language_load_failed'
    )
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM selected_keys AS keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id, 'code',
       'frontend/core_components/table_views/article_view/article_language_editor.js', '',
       keys.creation_spec, CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
        'article_edit_languages',
        'article_language_field',
        'article_language_help',
        'article_language_save_failed',
        'article_language_load_failed'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- dataset_rights.seed.sql
-- Grants the starter groups their read and structure rights on the seeded datasets.
-- Bridges the datasets several reviewed seed fragments create with the permission
-- rows that decide who may read, filter and change each of them.
-- Exists as its own fragment because a right names the dataset it is granted on:
-- it can only be seeded once that dataset row exists, and these grants reach
-- across fragments, so they are assembled last. The foreign key restored in
-- database version 9.9.0 turns that ordering from a convention into a rule.

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT 1, functions.id, 'public', 'public fixture seed', table_uids.table_uid
FROM (VALUES (7), (8), (9), (10)) AS table_uids(table_uid)
JOIN public.system_functions functions
  ON functions.name IN (
    'dtt_crud_workflows.ModifyColumnsHandler',
    'dtt_3_table_delete.DropTableHandler'
  );

INSERT INTO public.system_group_table_func_rights (
  user_group_id, function_id, target_schema_name, creation_spec, target_table_uid
)
SELECT group_ids.user_group_id, functions.id, 'public', 'public fixture seed', table_uids.table_uid
FROM (VALUES (1), (2), (3)) AS group_ids(user_group_id)
CROSS JOIN (VALUES
  (7), (8), (9), (10),
  (56), (74), (75), (76), (77), (105),
  (300), (301), (302), (303)
) AS table_uids(table_uid)
JOIN public.system_functions functions
  ON functions.name IN (
    'dtt_1_row_read.GetResultsHandlerWrapper',
    'dtt_1_row_read.GetRowCountHandlerWrapper',
    'dtt_1_row_read.GetFilterOptionsHandler',
    'dtt_1_row_read.GetIntelligentResultsHandlerWrapper',
    'dtt_1_row_read.GetResultsVector',
    'dtt_3_table_read.GetTableViewHandlerWrapper',
    'dtt_2_column_crud.GetTableColumnsHandler',
    'dtt_1_row_read.GetDynamicChildItemsHandler'
  );
-- 20260919000009_seed_developer_workflow_metadata.sql
-- Seeds product-owned workflow vocabularies, table metadata, and interface labels.
-- Bridges the developer schema with generic dataset discovery and multilingual UI paths.
-- Exists so fresh installations work without inheriting any maintainer's ticket data.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

WITH desired(
    slug, lang_key, title, description, sort_order,
    is_active, is_terminal, is_claimable
) AS (
    VALUES
        ('new', 'dev_agent_task_status_new', 'New',
         'Work exists but has not yet been claimed and is ready for the active inbox.',
         10, TRUE, FALSE, TRUE),
        ('backlog', 'dev_agent_task_status_backlog', 'Backlog',
         'Work is intentionally parked outside the immediate inbox but remains claimable.',
         15, TRUE, FALSE, TRUE),
        ('backlog_later', 'dev_agent_task_status_backlog_later', 'Backlog / Later',
         'Work belongs in backlog and is explicitly deferred for later.',
         16, TRUE, FALSE, TRUE),
        ('backlog_nice_to_have', 'dev_agent_task_status_backlog_nice_to_have', 'Backlog / Nice To Have',
         'Work belongs in backlog and is intentionally marked as optional or lower-desirability.',
         17, TRUE, FALSE, TRUE),
        ('in_progress', 'dev_agent_task_status_in_progress', 'In Progress',
         'Work is actively being handled by a human or agent.',
         20, TRUE, FALSE, FALSE),
        ('on_hold', 'dev_agent_task_status_on_hold', 'On Hold',
         'Work is paused because of a blocker, timing issue, or dependency.',
         30, TRUE, FALSE, TRUE),
        ('awaiting_human_decision', 'dev_agent_task_status_awaiting_human_decision', 'Awaiting Human Decision',
         'Work is blocked until a human makes a real decision or approval.',
         40, TRUE, FALSE, FALSE),
        ('done', 'dev_agent_task_status_done', 'Done',
         'Work has been completed and accepted as finished.',
         50, FALSE, TRUE, FALSE),
        ('rejected', 'dev_agent_task_status_rejected', 'Rejected',
         'Work will not be pursued in its current form.',
         60, FALSE, TRUE, FALSE),
        ('aborted', 'dev_agent_task_status_aborted', 'Aborted',
         'Work was started and then intentionally stopped, superseded, or merged elsewhere before completion.',
         65, FALSE, TRUE, FALSE),
        ('archived', 'dev_agent_task_status_archived', 'Archived',
         'Work is intentionally kept only for historical reference.',
         70, FALSE, TRUE, FALSE),
        ('to_be_deleted', 'dev_agent_task_status_to_be_deleted', 'To Be Deleted',
         'Work is marked for deletion or cleanup after retention checks.',
         80, FALSE, TRUE, FALSE)
)
INSERT INTO public.dev_agent_task_statuses (
    slug, lang_key, title, description, sort_order,
    is_active, is_terminal, is_claimable
)
SELECT desired.slug, desired.lang_key, desired.title, desired.description,
       desired.sort_order, desired.is_active, desired.is_terminal, desired.is_claimable
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_statuses AS existing
    WHERE existing.slug = desired.slug
);

WITH desired(
    slug, lang_key, title, description, sort_order,
    is_completion_status, is_terminal
) AS (
    VALUES
        ('todo', 'dev_agent_task_todo_status_todo', 'Todo',
         'Work has not yet been verified as implemented.', 10, FALSE, FALSE),
        ('partially_done', 'dev_agent_task_todo_status_partially_done', 'Partially Done',
         'Some meaningful implementation exists, but the component is incomplete or too broad to close.',
         20, FALSE, FALSE),
        ('needs_review', 'dev_agent_task_todo_status_needs_review', 'Needs Review',
         'Implementation may exist, but the current evidence is not strong enough to mark it done.',
         30, FALSE, FALSE),
        ('not_applicable', 'dev_agent_task_todo_status_not_applicable', 'Not Applicable',
         'The component is intentionally outside the current product scope or does not fit this app model.',
         40, FALSE, TRUE),
        ('done', 'dev_agent_task_todo_status_done', 'Done',
         'Implementation exists and the todo can be treated as completed independently from the parent ticket.',
         50, TRUE, TRUE)
)
INSERT INTO public.dev_agent_task_todo_statuses (
    slug, lang_key, title, description, sort_order,
    is_completion_status, is_terminal
)
SELECT desired.slug, desired.lang_key, desired.title, desired.description,
       desired.sort_order, desired.is_completion_status, desired.is_terminal
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_todo_statuses AS existing
    WHERE existing.slug = desired.slug
);

WITH desired(slug, title, description, sort_order) AS (
    VALUES
        ('frontend', 'Frontend', 'Frontend UI and JavaScript work.', 10),
        ('backend', 'Backend', 'Go backend and API work.', 20),
        ('database', 'Database', 'Schema, migrations, and query work.', 30),
        ('security', 'Security', 'Security hardening, auth, and access control.', 40),
        ('stability', 'Stability', 'Reliability, error handling, and resilience.', 50),
        ('testing', 'Testing', 'Test coverage, E2E, and test infrastructure.', 60),
        ('documentation', 'Documentation', 'Docs, comments, and knowledge capture.', 70)
)
INSERT INTO public.dev_agent_task_groups (slug, title, description, sort_order)
SELECT desired.slug, desired.title, desired.description, desired.sort_order
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_groups AS existing
    WHERE existing.slug = desired.slug
);

-- Add the final references to an older installation without rejecting legacy
-- rows. Clean installations validate each constraint immediately; an older
-- installation with an orphan keeps its row and receives a NOT VALID guard for
-- all new writes until that historical inconsistency is reviewed separately.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_dev_agent_tasks_issue_type'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT chk_dev_agent_tasks_issue_type
            CHECK (issue_type IN ('task', 'incident', 'bug', 'epic')) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dev_agent_tasks_parent_id_fkey'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT dev_agent_tasks_parent_id_fkey
            FOREIGN KEY (parent_id) REFERENCES public.dev_agent_tasks(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_tasks_queue_id'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT fk_dev_agent_tasks_queue_id
            FOREIGN KEY (queue_id) REFERENCES public.dev_agent_task_queues(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_tasks_status'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT fk_dev_agent_tasks_status
            FOREIGN KEY (status) REFERENCES public.dev_agent_task_statuses(slug)
            ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_task_todos_status'
          AND conrelid = 'public.dev_agent_task_todos'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_task_todos
            ADD CONSTRAINT fk_dev_agent_task_todos_status
            FOREIGN KEY (status) REFERENCES public.dev_agent_task_todo_statuses(slug)
            ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks
        WHERE issue_type NOT IN ('task', 'incident', 'bug', 'epic')
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT chk_dev_agent_tasks_issue_type;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS child
        WHERE child.parent_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.dev_agent_tasks AS parent WHERE parent.id = child.parent_id)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT dev_agent_tasks_parent_id_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS tasks
        WHERE tasks.queue_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.dev_agent_task_queues AS queues WHERE queues.id = tasks.queue_id)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT fk_dev_agent_tasks_queue_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS tasks
        WHERE NOT EXISTS (SELECT 1 FROM public.dev_agent_task_statuses AS statuses WHERE statuses.slug = tasks.status)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT fk_dev_agent_tasks_status;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_task_todos AS todos
        WHERE NOT EXISTS (SELECT 1 FROM public.dev_agent_task_todo_statuses AS statuses WHERE statuses.slug = todos.status)
    ) THEN
        ALTER TABLE public.dev_agent_task_todos VALIDATE CONSTRAINT fk_dev_agent_task_todos_status;
    END IF;
END $$;

WITH desired(
    table_name, display_name, description, fk_display_column,
    filterbar_visible, sql_dump_policy, icon_key
) AS (
    VALUES
        ('dev_agent_tasks', 'Agent Tasks', 'Database-backed development tickets', 'title', TRUE, 'schema_only', 'task'),
        ('dev_agent_task_statuses', 'Agent Task Statuses', 'Workflow status registry for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_todo_statuses', 'Agent Task Todo Statuses', 'Status registry for structured ticket todos', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_queues', 'Agent Task Queues', 'Optional queue registry for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_groups', 'Agent Task Groups', 'Reusable classification groups for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_group_relations', 'Agent Task Group Relations', 'Links between development tickets and task groups', 'id', FALSE, 'schema_only', NULL),
        ('dev_agent_task_runs', 'Agent Task Runs', 'Local worker execution history for development tickets', 'run_id', FALSE, 'schema_only', NULL),
        ('dev_agent_task_todos', 'Agent Task Todos', 'Structured checklist rows for development tickets', 'todo_text', TRUE, 'schema_only', NULL),
        ('dev_agent_tasks_assets', 'Agent Task Assets', 'Images and attachments linked to development tickets', 'filename', FALSE, 'schema_only', NULL),
        ('dev_agent_worklines', 'Agent Worklines', 'Stable development workline identities', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_workline_reports', 'Agent Workline Reports', 'Immutable reports for development worklines', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_workline_tasks', 'Agent Workline Tasks', 'Optional links between worklines and tickets', 'id', TRUE, 'schema_only', NULL),
        ('dev_agent_handover_reports', 'Agent Handover Reports', 'Canonical handover manifests', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_handover_report_items', 'Agent Handover Report Items', 'Ordered report references in a handover', 'id', TRUE, 'schema_only', NULL),
        ('dev_agent_release_goals', 'Agent Release Goals', 'Versioned release decisions for worklines', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_release_goal_contracts', 'Agent Release Goal Contracts', 'Per-workline completion rules for a release goal', 'id', TRUE, 'schema_only', NULL)
)
INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, schema_name, fk_display_column,
    filterbar_visible_by_default, is_removable, display_name,
    sql_dump_policy, icon_key
)
SELECT desired.table_name, desired.description, classes.oid::INTEGER, 'public',
       desired.fk_display_column, desired.filterbar_visible, FALSE,
       desired.display_name, desired.sql_dump_policy, desired.icon_key
FROM desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

UPDATE public.system_db_tables AS metadata
SET cached_oid = classes.oid::INTEGER,
    updated = now()
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE metadata.table_name = classes.relname
  AND metadata.table_name LIKE 'dev_agent_%'
  AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
  AND metadata.cached_oid IS DISTINCT FROM classes.oid::INTEGER;

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid INTEGER;
BEGIN
    FOR table_record IN
        SELECT table_name
        FROM public.system_db_tables
        WHERE table_name IN (
            'dev_agent_tasks',
            'dev_agent_task_statuses',
            'dev_agent_task_todo_statuses',
            'dev_agent_task_queues',
            'dev_agent_task_groups',
            'dev_agent_task_group_relations',
            'dev_agent_task_runs',
            'dev_agent_task_todos',
            'dev_agent_tasks_assets',
            'dev_agent_worklines',
            'dev_agent_workline_reports',
            'dev_agent_workline_tasks',
            'dev_agent_handover_reports',
            'dev_agent_handover_report_items',
            'dev_agent_release_goals',
            'dev_agent_release_goal_contracts'
        )
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LOOP
        SELECT table_uid INTO registered_table_uid
        FROM public.system_db_tables
        WHERE table_name = table_record.table_name
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
        LIMIT 1;

        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, created, updated
        )
        SELECT registered_table_uid, columns.column_name, columns.data_type,
               columns.ordinal_position, now(), now()
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = table_record.table_name
          AND NOT EXISTS (
              SELECT 1 FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END LOOP;
END $$;

-- Reports, handovers, and release contracts are changed only through their
-- dedicated APIs; the generic table editor remains read-only for them.
UPDATE public.system_column_details AS details
SET editable_in_ui = FALSE,
    updated = now()
FROM public.system_db_tables AS tables
WHERE tables.table_uid = details.table_uid
  AND tables.table_name IN (
      'dev_agent_task_runs',
      'dev_agent_worklines',
      'dev_agent_workline_reports',
      'dev_agent_workline_tasks',
      'dev_agent_handover_reports',
      'dev_agent_handover_report_items',
      'dev_agent_release_goals',
      'dev_agent_release_goal_contracts'
  );

WITH authored(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dev_agent_tasks', 'Agentin tehtävät', 'Agent tasks', 'Database-tree label for development tickets.'),
        ('dev_agent_task_statuses', 'Agentin tehtävien tilat', 'Agent task statuses', 'Database-tree label for ticket statuses.'),
        ('dev_agent_task_todo_statuses', 'Agentin tehtävälistan tilat', 'Agent task todo statuses', 'Database-tree label for ticket todo statuses.'),
        ('dev_agent_task_queues', 'Agentin tehtäväjonot', 'Agent task queues', 'Database-tree label for ticket queues.'),
        ('dev_agent_task_groups', 'Agentin tehtäväryhmät', 'Agent task groups', 'Database-tree label for ticket groups.'),
        ('dev_agent_task_group_relations', 'Agentin tehtäväryhmien suhteet', 'Agent task group relations', 'Database-tree label for ticket group links.'),
        ('dev_agent_task_runs', 'Agentin tehtävien suoritukset', 'Agent task runs', 'Database-tree label for ticket run history.'),
        ('dev_agent_task_todos', 'Agentin tehtävän muistilista', 'Agent task todos', 'Database-tree label for structured ticket todos.'),
        ('dev_agent_tasks_assets', 'Agentin tehtävien liitteet', 'Agent task assets', 'Database-tree label for ticket assets.'),
        ('dev_agent_worklines', 'Agenttien työlinjat', 'Agent worklines', 'Database-tree label for stable development worklines.'),
        ('dev_agent_workline_reports', 'Agenttien työlinjaraportit', 'Agent workline reports', 'Database-tree label for workline reports.'),
        ('dev_agent_workline_tasks', 'Agenttien työlinjojen tiketit', 'Agent workline tasks', 'Database-tree label for workline ticket links.'),
        ('dev_agent_handover_reports', 'Agenttien handover-raportit', 'Agent handover reports', 'Database-tree label for handover reports.'),
        ('dev_agent_handover_report_items', 'Agenttien handover-raporttien kohdat', 'Agent handover report items', 'Database-tree label for handover items.'),
        ('dev_agent_release_goals', 'Agenttien julkaisutavoitteet', 'Agent release goals', 'Database-tree label for release goals.'),
        ('dev_agent_release_goal_contracts', 'Agenttien julkaisutavoitteiden ehdot', 'Agent release goal contracts', 'Database-tree label for release-goal contracts.'),
        ('workline_observatory', 'Työlinjojen tilannekuva', 'Workline observatory', 'Navigation label for the workline observatory.'),
        ('dev_agent_task_status_new', 'Uusi', 'New', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog', 'Backlog', 'Backlog', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog_later', 'Backlog / myöhemmin', 'Backlog / Later', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog_nice_to_have', 'Backlog / kiva jos ehtii', 'Backlog / Nice To Have', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_in_progress', 'Työn alla', 'In Progress', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_on_hold', 'Tauolla', 'On Hold', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_awaiting_human_decision', 'Odottaa ihmisen päätöstä', 'Awaiting Human Decision', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_done', 'Valmis', 'Done', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_rejected', 'Hylätty', 'Rejected', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_aborted', 'Keskeytetty', 'Aborted', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_archived', 'Arkistoitu', 'Archived', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_to_be_deleted', 'Poistettava', 'To Be Deleted', 'Development-ticket workflow status.'),
        ('dev_agent_task_todo_status_todo', 'Tekemättä', 'Todo', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_partially_done', 'Osittain tehty', 'Partially Done', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_needs_review', 'Tarkistettava', 'Needs Review', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_not_applicable', 'Ei sovellu', 'Not Applicable', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_done', 'Valmis', 'Done', 'Development-ticket todo status.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT authored.lang_key, authored.fi, authored.en, authored.creation_spec
FROM authored
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = authored.lang_key
);

WITH selected AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE lang_key LIKE 'dev_agent_%' OR lang_key = 'workline_observatory'
), authored AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation
    FROM selected
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
    WHERE translations.translation IS NOT NULL
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT authored.lang_key_id, authored.language_code, authored.translation,
       'manual', 'approved'
FROM authored
JOIN public.system_languages AS languages
  ON languages.language_code = authored.language_code
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = authored.lang_key_id
      AND existing.language_code = authored.language_code
);

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low,
    usage_explanation, last_seen
)
SELECT keys.id, 'schema', 'developer_workflow', keys.lang_key,
       'Developer ticket and workline database interface.', CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE (keys.lang_key LIKE 'dev_agent_%' OR keys.lang_key = 'workline_observatory')
  AND NOT EXISTS (
      SELECT 1 FROM public.system_lang_key_sources AS existing
      WHERE existing.lang_key_id = keys.id
        AND existing.source_type = 'schema'
        AND existing.source_high = 'developer_workflow'
  );

DO $$
DECLARE
    table_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        FOREACH table_name IN ARRAY ARRAY[
            'dev_agent_tasks', 'dev_agent_task_statuses',
            'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_task_group_relations',
            'dev_agent_task_runs', 'dev_agent_task_todos',
            'dev_agent_tasks_assets', 'dev_agent_worklines',
            'dev_agent_workline_reports', 'dev_agent_workline_tasks',
            'dev_agent_handover_reports', 'dev_agent_handover_report_items',
            'dev_agent_release_goals', 'dev_agent_release_goal_contracts'
        ]
        LOOP
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO readeronly', table_name);
        END LOOP;
    END IF;
END $$;
-- row_actor_metadata.seed.sql
-- Gives the creator and owner columns this release adds to the development tables the
-- metadata an upgrade gives them: hidden on cards and in the filter panel, never
-- insertable or editable, with their own language keys.
-- Bridges the schema completion source, which adds the columns before any seed, and the
-- development metadata seed, which then describes every physical column generically.
-- Exists because a new installation must equal an upgraded one: on upgrade the data step
-- 000004 creates these rows itself. The six creator columns older than 9.10.0 keep the
-- row the development seed gives them, as they do on upgrade.
UPDATE public.system_column_details AS details
   SET card_element = 'hidden',
       insertable = FALSE,
       editable_in_ui = FALSE,
       hide_in_filter_panel = TRUE,
       show_value_on_card = TRUE,
       lang_key = details.column_name,
       creation_spec = CASE details.column_name WHEN 'created_by' THEN 'WL58 row creator' ELSE 'WL58 row owner' END,
       updated = now()
  FROM public.system_db_tables AS registry
 WHERE registry.table_uid = details.table_uid
   AND ((details.column_name = 'owner_id' AND registry.table_name IN (
            'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_tasks', 'dev_agent_task_todos', 'dev_agent_worklines',
            'dev_agent_workline_reports', 'dev_agent_handover_reports', 'dev_agent_release_goals',
            'dev_agent_release_goal_contracts'))
     OR (details.column_name = 'created_by' AND registry.table_name IN (
            'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_tasks')));
-- 20260919000005_seed_dataset_form_dimension_language_keys.sql
-- Adds the interface copy for the dataset dimensions both dataset forms now offer.
-- Bridges the shared folder, reading-rights, picture, deletion-protection and
-- foreign-key controls with the installation's own language keys.
-- Exists so those controls read from language keys instead of hardcoded copy.
-- Finnish and English are served from the columns of system_lang_keys, so the
-- authored copy is written there first and mirrored into the normalized table.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dataset_folder_unavailable', 'Kansioita ei voitu lukea.', 'The folders could not be read.',
         'Dataset dimensions: the navigation folders could not be read.'),
        ('dataset_folder_save_failed', 'Kansion tallennus epäonnistui.', 'The folder could not be saved.',
         'Dataset dimensions: moving the dataset to another folder failed.'),
        ('dataset_folder_move_anyway', 'Siirrä silti', 'Move anyway',
         'Dataset dimensions: confirms a folder move the server asked about.'),
        ('dataset_permissions_loading', 'Luetaan lukuoikeuksia…', 'Reading the rights…',
         'Dataset dimensions: status while the dataset reading rights are being read.'),
        ('dataset_permissions_unavailable', 'Lukuoikeuksia ei voitu lukea.', 'The rights could not be read.',
         'Dataset dimensions: the dataset reading rights could not be read.'),
        ('dataset_permissions_save_failed', 'Lukuoikeuksien tallennus epäonnistui.', 'The rights could not be saved.',
         'Dataset dimensions: saving the dataset reading rights failed.'),
        ('dataset_images_unavailable', 'Kuva-asetusta ei voitu lukea.', 'The picture setting could not be read.',
         'Dataset dimensions: the picture-attachment setting could not be read.'),
        ('dataset_images_save_failed', 'Kuva-asetuksen tallennus epäonnistui.', 'The picture setting could not be saved.',
         'Dataset dimensions: saving the picture-attachment setting failed.'),
        ('dataset_deletion_protection_unavailable', 'Poistosuojausta ei voitu lukea.',
         'The deletion protection could not be read.',
         'Dataset dimensions: the deletion protection could not be read.'),
        ('dataset_foreign_keys_title', 'Linkit toisiin aineistoihin', 'Links to other datasets',
         'Dataset dimensions: heading of the links to other datasets.'),
        ('dataset_foreign_keys_none', 'Tällä aineistolla ei ole vielä linkkejä.', 'This dataset has no links yet.',
         'Dataset dimensions: the dataset has no links to other datasets yet.'),
        ('dataset_foreign_keys_unavailable', 'Linkkejä ei voitu lukea.', 'The links could not be read.',
         'Dataset dimensions: the links to other datasets could not be read.'),
        ('dataset_foreign_key_save_failed', 'Linkin lisääminen epäonnistui.', 'The link could not be added.',
         'Dataset dimensions: adding a link to another dataset failed.'),
        ('manage_table_settings_need_attention',
         'Sarakkeet tallennettiin. Yksi aineiston asetus jäi kesken – katso lomakkeen viesti.',
         'The columns were saved. One dataset setting still needs attention — see the message in the form.',
         'Dataset dimensions: the columns saved, but one dataset setting did not.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE creation_spec LIKE 'Dataset dimensions:%'
), authored_translations AS (
    SELECT selected.id AS lang_key_id, translations.language_code, translations.translation
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
    WHERE translations.translation IS NOT NULL
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();
-- 20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql
-- Seeds interface copy that until now existed only as frontend fallback text.
-- Bridges the failed-request notices of the global fetch monitor and the dataset
-- form (its column table and folder hint) with the language keys of the installation.
-- Exists because the notices were hardcoded Finnish, two column headings had no
-- runtime row, and the folder hint still held wording made from the name of its key.
-- A nonempty translation is never overwritten; only that exact unreviewed
-- wording gives way. Running the file again changes nothing. The public
-- bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- 1. Wording generated from the name of a key before its copy was written was
--    never reviewed. Where a site still holds exactly that wording, it counts
--    as missing copy: it is withdrawn here and filled in step 2 like any empty
--    value. Any other text, a reviewed translation included, stays as it is.
WITH superseded_placeholders(lang_key, fi, en) AS (
    VALUES
        ('table_folder_hint', 'Taulukon kansion vihje', 'Table folder hint')
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_placeholders AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    updated = now()
FROM superseded_placeholders AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en);

-- 2. Add the missing keys, fill only empty columns, and mirror the served
--    Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('server_error_notice',
         'Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen.',
         'The service ran into an error. Please try again in a moment.',
         '服务出现错误。请稍后再试。',
         '服務出咗錯。請稍後再試。',
         'Failed-request notice: the service answered with a server error (5xx). The status code follows in parentheses.'),
        ('network_error_notice',
         'Palveluun ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.',
         'The service could not be reached. Check your connection and try again.',
         '无法连接到服务。请检查网络连接后重试。',
         '連唔到服務。請檢查網絡連線再試。',
         'Failed-request notice: the request never reached the service, for example because the connection was lost.'),
        ('dataset_column_type_parameters',
         'Pituus / tarkkuus',
         'Length / precision',
         '长度 / 精度',
         '長度 / 精度',
         'Dataset form: heading of the column table''s length or precision column.'),
        ('actions',
         'Toiminnot',
         'Actions',
         '操作',
         '操作',
         'Heading of a column holding row or item actions, for example in the dataset form''s column table.'),
        ('table_folder_hint',
         'Valitse olemassa oleva kansio tai luo uusi. Oletuskansio on database / other_tables.',
         'Choose an existing folder or create one. The default folder is database / other_tables.',
         '选择现有文件夹或创建新文件夹。默认文件夹为 database / other_tables。',
         '選擇現有資料夾或建立新資料夾。預設資料夾係 database / other_tables。',
         'Dataset form: hint under the folder selector of a new dataset.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260922000004_seed_request_notice_and_interface_language_keys.sql
-- Seeds the failed-request notices the API pipeline shows for 4xx, 429 and 503.
-- Bridges the notices of request_failure_notice.js with the language keys of the
-- installation, beside server_error_notice and network_error_notice (20260922000001).
-- Exists because the rate-limit notice was Finnish only, the maintenance notice
-- chose between hardcoded Finnish and English, and other refusals showed the
-- route name and the raw server text.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same rows. The other interface copy of this release follows in
-- 20260922000005.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- Add the missing keys, fill only empty columns, and mirror the served
-- Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('request_failed_notice',
         'Pyyntöä ei voitu suorittaa.',
         'The request could not be completed.',
         '无法完成请求。',
         '完成唔到呢個請求。',
         'Failed-request notice: the service refused or could not complete the request (4xx). The status code follows in parentheses.'),
        ('rate_limit_notice',
         'Pyyntöjä tuli liian monta. Odota hetki ja yritä uudelleen.',
         'Too many requests. Wait a moment and try again.',
         '请求过多。请稍等片刻后重试。',
         '請求太多。請等一陣再試。',
         'Failed-request notice: the service refused the request because too many were sent in a short time (429).'),
        ('service_unavailable_notice',
         'Palvelu on hetkellisesti huoltotilassa. Yritä pian uudelleen.',
         'The service is temporarily under maintenance. Please retry shortly.',
         '服务正在临时维护。请稍后重试。',
         '服務暫時維護緊。請稍後再試。',
         'Failed-request notice: the service is temporarily unavailable, for example during maintenance or an update (503).')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260922000005_seed_interface_language_keys_of_9_8_1.sql
-- Seeds the interface copy the other 9.8.1 changes added as frontend fallback text.
-- Bridges the dataset form, the shared confirm and input dialogs and the other
-- screens changed in this release with the language keys of the installation.
-- Exists so every label, hint and question reads in the languages of the site
-- from its own translations, and so copy an earlier seed or a generated
-- placeholder wrote gives way to its reviewed successor.
-- A nonempty translation is never overwritten; only the exact superseded wording
-- listed in step 1 gives way. Running the file again changes nothing. The public
-- bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales. Placeholders such as
-- {folder}, {dataset}, $count and $table_name are filled by the page and stay
-- literal in every language.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- 1. Wording that is withdrawn where a site still holds exactly it: copy an
--    earlier seed wrote before it was rewritten, and wording generated from
--    the name of a key. It then counts as missing copy and is filled in step 2
--    like any empty value. Any other text, a reviewed translation included,
--    stays as it is. NULL matches nothing.
WITH superseded_copy(lang_key, fi, en, ch, yue) AS (
    VALUES
        -- Seeded by 20260922000001, before new datasets defaulted to the folder of the current project.
        ('table_folder_hint', 'Valitse olemassa oleva kansio tai luo uusi. Oletuskansio on database / other_tables.', 'Choose an existing folder or create one. The default folder is database / other_tables.', '选择现有文件夹或创建新文件夹。默认文件夹为 database / other_tables。', '選擇現有資料夾或建立新資料夾。預設資料夾係 database / other_tables。'),
        -- Generated from the name of the key and its machine translation, never reviewed.
        ('confirm_save_permissions', 'Vahvista tallennusoikeudet', 'Confirm save permissions', NULL, NULL)
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_copy AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    ch = CASE WHEN keys.ch = superseded.ch THEN NULL ELSE keys.ch END,
    yue = CASE WHEN keys.yue = superseded.yue THEN NULL ELSE keys.yue END,
    updated = now()
FROM superseded_copy AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en
    OR keys.ch = superseded.ch OR keys.yue = superseded.yue);

-- 2. Add the missing keys, fill only empty columns, and mirror the served
--    Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Dataset form: folder of a new dataset (dataset_form_translation_fallbacks.js).
        ('table_folder_hint',
         'Uusi aineisto tallennetaan oletuksena nykyisen projektin kansioon, jolloin se näkyy sivuston navigaatiossa. Jos projektia ei ole valittu, oletus on database / other_tables. Muiden kansioiden aineistot eivät näy navigaatiossa.',
         'By default a new dataset goes into the current project''s folder, where it appears in the site navigation. Without a current project the default is database / other_tables. Datasets in other folders do not appear in the navigation.',
         '新数据集默认放入当前项目的文件夹，并显示在网站导航中。如果没有当前项目，默认文件夹为 database / other_tables。其他文件夹中的数据集不会显示在导航中。',
         '新資料集預設會放入目前項目嘅資料夾，並會喺網站導覽顯示。如果冇目前項目，預設資料夾係 database / other_tables。其他資料夾入面嘅資料集唔會喺導覽顯示。',
         'Dataset form: hint under the folder selector of a new dataset.'),
        ('dataset_folder_for_new_dataset',
         'Valitse kansio uudelle taululle',
         'Choose a folder for the new dataset',
         '为新数据集选择文件夹',
         '為新資料集選擇資料夾',
         'Dataset form: label of the folder choice of a new dataset, where a new folder can also be created.'),
        ('dataset_folder_option_current_project',
         '{folder} (nykyinen projekti)',
         '{folder} (current project)',
         '{folder}（当前项目）',
         '{folder}（目前項目）',
         'Dataset form: folder option that is the folder of the current project. {folder} is the folder name.'),
        ('dataset_new_folder_open',
         'Uusi kansio…',
         'New folder…',
         '新建文件夹…',
         '新增資料夾…',
         'Dataset form: button that opens the fields for creating a new folder.'),
        ('dataset_new_folder_cancel',
         'Älä luo uutta kansiota',
         'Don''t create a new folder',
         '不新建文件夹',
         '唔新增資料夾',
         'Dataset form: button that closes the new-folder fields without creating a folder.'),
        ('dataset_new_folder_parent',
         'Uuden kansion yläkansio',
         'Parent folder of the new folder',
         '新文件夹的上级文件夹',
         '新資料夾嘅上層資料夾',
         'Dataset form: label of the parent-folder selector of a new folder.'),
        ('dataset_new_folder_name_required',
         'Anna uudelle kansiolle nimi tai valitse, ettei uutta kansiota luoda.',
         'Name the new folder, or choose not to create one.',
         '请为新文件夹命名，或选择不新建文件夹。',
         '請為新資料夾命名，或者揀唔新增資料夾。',
         'Dataset form: validation message when the new-folder fields are open but the name is empty.'),
        ('dataset_select_target',
         'Valitse aineisto',
         'Choose a dataset',
         '选择数据集',
         '選擇資料集',
         'Dataset form: placeholder of the selector that chooses the dataset a foreign key refers to.'),
        ('dataset_created_in_folder',
         'Aineisto {dataset} luotiin kansioon {folder}.',
         'Dataset {dataset} was created in the folder {folder}.',
         '数据集 {dataset} 已创建在文件夹 {folder} 中。',
         '資料集 {dataset} 已經建立喺資料夾 {folder}。',
         'Dataset form: success notice after creation. {dataset} and {folder} are the dataset and folder names.'),
        ('dataset_created_outside_navigation',
         'Se ei näy sivuston navigaatiossa, koska navigaatio näyttää vain nykyisen projektin kansiossa suoraan olevat aineistot. Voit siirtää sen aineiston hallinnasta.',
         'It will not appear in the site navigation, which lists only the datasets directly in the current project''s folder. You can move it in the dataset''s Manage table dialog.',
         '它不会显示在网站导航中，因为导航只列出直接位于当前项目文件夹中的数据集。您可以在数据集的管理窗口中移动它。',
         '佢唔會喺網站導覽顯示，因為導覽只會列出直接喺目前項目資料夾入面嘅資料集。你可以喺資料集嘅管理視窗移動佢。',
         'Dataset form: note after creation when the new dataset is outside the folder the site navigation lists.'),
        ('dataset_open',
         'Avaa aineisto',
         'Open dataset',
         '打开数据集',
         '開啟資料集',
         'Dataset form: button in the creation notice that opens the new dataset.'),
        -- Shared confirm and input dialogs (confirm_prompt_translation_fallbacks.js).
        ('confirm',
         'Vahvista',
         'Confirm',
         '确认',
         '確認',
         'Confirm dialog: default confirming button.'),
        ('continue',
         'Jatka',
         'Continue',
         '继续',
         '繼續',
         'Input dialog: button that continues with the entered value, as in the current-password prompt.'),
        ('confirm_current_password_message',
         'Vahvista muutos antamalla nykyinen salasanasi.',
         'Enter your current password to confirm this change.',
         '请输入当前密码以确认此更改。',
         '請輸入而家嘅密碼確認呢個更改。',
         'User profile: prompt asking for the current password before an account change.'),
        ('confirm_delete_folder',
         'Poistetaanko tämä kansio? Vain tyhjän kansion voi poistaa.',
         'Delete this folder? Only empty folders can be deleted.',
         '要删除此文件夹吗？只能删除空文件夹。',
         '要刪除呢個資料夾嗎？只可以刪除空資料夾。',
         'Navigation tree: question before deleting a folder.'),
        ('tree_move_project_title',
         'Siirretäänkö toiseen projektiin?',
         'Move to another project?',
         '移动到另一个项目？',
         '移去另一個項目？',
         'Navigation tree: title of the question before moving an item to another project.'),
        ('tree_move_folder_to_project',
         'Siirretäänkö tämä kansio toiseen projektiin? Kaikki kansion taulut siirtyvät sen mukana.',
         'Move this folder to another project? All tables inside it move with it.',
         '要将此文件夹移动到另一个项目吗？其中的所有表都会一起移动。',
         '要將呢個資料夾移去另一個項目嗎？入面所有表都會一齊移動。',
         'Navigation tree: question before moving a folder to another project.'),
        ('tree_move_table_to_project',
         'Siirretäänkö tämä taulu toiseen projektiin? Taulun projekti vaihtuu.',
         'Move this table to another project? This changes which project includes the table.',
         '要将此表移动到另一个项目吗？这会改变包含该表的项目。',
         '要將呢個表移去另一個項目嗎？咁會改變包含呢個表嘅項目。',
         'Navigation tree: question before moving a table to another project.'),
        ('tree_move_tab_visibility_title',
         'Muutetaanko välilehtien näkyvyyttä?',
         'Change tab visibility?',
         '更改标签页可见性？',
         '更改分頁可見性？',
         'Navigation tree: title of the question before a move that changes the main tabs of a project.'),
        ('tree_move_table_to_root',
         'Siirretäänkö tämä taulu projektin juureen? Se näkyy projektin päävälilehdissä.',
         'Move this table to the project root? It will appear in the project''s main tabs.',
         '要将此表移动到项目根目录吗？它将显示在项目的主标签页中。',
         '要將呢個表移去項目根目錄嗎？佢會喺項目嘅主分頁度顯示。',
         'Navigation tree: question before moving a table to the root of its project.'),
        ('tree_move_table_to_subfolder',
         'Siirretäänkö tämä taulu alikansioon? Se pysyy projektissa, mutta poistuu projektin päävälilehdistä.',
         'Move this table into a subfolder? It stays in the project but leaves the project''s main tabs.',
         '要将此表移动到子文件夹吗？它仍在项目中，但会从项目的主标签页中移除。',
         '要將呢個表移入子資料夾嗎？佢仍然喺項目入面，但會喺項目嘅主分頁度消失。',
         'Navigation tree: question before moving a table into a subfolder of its project.'),
        ('tree_move_confirm',
         'Siirrä',
         'Move',
         '移动',
         '移動',
         'Navigation tree: confirming button of a move question.'),
        ('confirm_delete_rows',
         'Poistetaanko $count riviä?',
         'Delete $count rows?',
         '要删除 $count 行吗？',
         '要刪除 $count 行嗎？',
         'Admin tools: question before deleting rows. $count is the number of rows.'),
        ('confirm_archive_unknown_storage_roots',
         'Arkistoidaanko kaikki tuntemattomat tallennustilan juurikansiot storage_deleted-kansioon?',
         'Archive all unknown storage root folders into the storage_deleted folder?',
         '要将所有未知的存储根文件夹归档到 storage_deleted 文件夹吗？',
         '要將所有未知嘅儲存根資料夾封存去 storage_deleted 資料夾嗎？',
         'Admin tools: question before archiving unknown storage root folders.'),
        ('confirm_purge_archived_storage_roots',
         'Poistetaanko pysyvästi kaikki arkistoidut storage_deleted-juurikansiot, joilla ei enää ole käytössä olevaa aineistoa?',
         'Permanently delete all archived storage_deleted root folders that no longer have a live dataset?',
         '要永久删除所有不再对应在用数据集的已归档 storage_deleted 根文件夹吗？',
         '要永久刪除所有已經冇對應在用資料集嘅已封存 storage_deleted 根資料夾嗎？',
         'Admin tools: question before permanently deleting archived storage root folders.'),
        ('confirm_save_child_tab_config',
         'Tallennetaanko muutokset ennen taulun vaihtoa?',
         'Save changes before switching tables?',
         '切换表之前保存更改吗？',
         '切換表之前要唔要儲存變更？',
         'Admin tools: question before switching tables with unsaved child-tab settings.'),
        ('confirm_save_child_tab_config_on_exit',
         'Tallennetaanko muutokset ennen muokkauksen lopettamista?',
         'Save changes before you stop editing?',
         '停止编辑前保存更改吗？',
         '停止編輯之前要唔要儲存變更？',
         'Admin tools: question before leaving the child-tab settings with unsaved changes.'),
        ('confirm_save_card_visibility',
         'Tallennetaanko muutokset ennen taulun vaihtoa?',
         'Save changes before switching tables?',
         '切换表之前保存更改吗？',
         '切換表之前要唔要儲存變更？',
         'Admin tools: question before switching tables with unsaved card visibility settings.'),
        ('confirm_delete_foreign_key',
         'Poistetaanko valittu viiteavain?',
         'Delete the selected foreign key?',
         '要删除所选外键吗？',
         '要刪除所選外鍵嗎？',
         'Admin tools: question before deleting a foreign key.'),
        ('confirm_fix_all_issues',
         'Korjataanko kaikki korjattavissa olevat ongelmat? Tätä ei voi perua.',
         'Fix all fixable issues? This cannot be undone.',
         '要修复所有可修复的问题吗？此操作无法撤销。',
         '要修復所有可以修復嘅問題嗎？呢個操作無法撤銷。',
         'Admin tools: question before fixing every fixable database consistency issue.'),
        ('asset_linking_remove_images_confirm',
         'Poistetaanko taulun "$table_name" kuvaliitokset pysyvästi? Alla näkyvä kuvataulu ja KAIKKI ladatut kuvat poistetaan.',
         'Permanently remove image assets for "$table_name"? The image table below and ALL uploaded images are deleted.',
         '要永久移除“$table_name”的图片资源吗？下方的图片表和所有已上传的图片都会被删除。',
         '要永久移除「$table_name」嘅圖片資源嗎？下面嘅圖片表同所有已上載嘅圖片都會被刪除。',
         'Admin tools: question before removing the image assets of a table. $table_name is the table.'),
        ('asset_linking_remove_attachments_confirm',
         'Poistetaanko taulun "$table_name" liitekytkentä pysyvästi? Alla näkyvä jaettu liitetaulu poistetaan, jos mikään muu liiteprofiili ei enää käytä sitä.',
         'Permanently remove attachment linking for "$table_name"? The shared asset table below is deleted if no other asset profile still uses it.',
         '要永久移除“$table_name”的附件关联吗？如果没有其他资源配置仍在使用，下方的共享资源表将被删除。',
         '要永久移除「$table_name」嘅附件關聯嗎？如果冇其他資源設定仲用緊，下面嘅共用資源表會被刪除。',
         'Admin tools: question before removing the attachment linking of a table. $table_name is the table.'),
        ('confirm_delete_image',
         'Poistetaanko tämä kuva?',
         'Delete this image?',
         '要删除此图片吗？',
         '要刪除呢張圖片嗎？',
         'Article view: question before deleting an image.'),
        ('confirm_delete_attachment',
         'Poistetaanko tämä liite?',
         'Delete this attachment?',
         '要删除此附件吗？',
         '要刪除呢個附件嗎？',
         'Article view: question before deleting an attachment.'),
        -- Dataset chat: the two coding-agent modes and their availability (table_chat_coding_agent_copy.js). Keys an earlier seed wrote in Finnish and English only keep that description and gain Chinese and Cantonese.
        ('coding_agent_mode_code_workspace',
         'Koodityötila (Codex)',
         'Code workspace (Codex)',
         '代码工作区 (Codex)',
         '程式碼工作區 (Codex)',
         'Dataset chat: name of the mode that edits the code of this machine, in the selector, the waiting message and the answer footer.'),
        ('coding_agent_mode_site_assistant',
         'Sivustoavustaja (Codex)',
         'Site assistant (Codex)',
         '站点助手 (Codex)',
         '網站助手 (Codex)',
         'Dataset chat: name of the API-only site assistant mode, in the selector, the waiting message and the answer footer.'),
        ('coding_agent_code_workspace_started',
         'Koodityötila aloitti työn.',
         'Code workspace started working.',
         '代码工作区已开始工作。',
         '程式碼工作區開始咗工作。',
         'Dataset chat: first waiting message of the code workspace.'),
        ('coding_agent_code_workspace_context',
         'Codex lukee keskustelua ja tämän koneen koodia.',
         'Codex is reading the chat and this machine''s code.',
         'Codex 正在阅读对话和本机代码。',
         'Codex 睇緊對話同呢部機嘅程式碼。',
         'Dataset chat: code workspace waiting message about reading the chat and the code.'),
        ('coding_agent_code_workspace_scope',
         'Koodityötila voi muokata tämän koneen koodia, ajaa testejä ja käynnistää kehityspalvelimen uudelleen.',
         'Code workspace may edit this machine''s code, run tests and restart the development server.',
         '代码工作区可以编辑本机代码、运行测试并重启开发服务器。',
         '程式碼工作區可以改呢部機嘅程式碼、行測試同重新啟動開發伺服器。',
         'Dataset chat: code workspace waiting message about what it may change.'),
        ('coding_agent_code_workspace_working',
         'Koodityötila työskentelee edelleen.',
         'Code workspace is still working.',
         '代码工作区仍在工作。',
         '程式碼工作區仲做緊。',
         'Dataset chat: continuing waiting message of the code workspace.'),
        ('coding_agent_code_workspace_duration',
         'Pitkä koodityö voi kestää enintään 40 minuuttia. Palvelimen uudelleenkäynnistys ei keskeytä sitä.',
         'Long code work may take up to 40 minutes. A server restart does not interrupt it.',
         '较长的代码工作最多可能需要 40 分钟。重启服务器不会中断它。',
         '長嘅程式碼工作最多可能要 40 分鐘。重新啟動伺服器唔會打斷佢。',
         'Dataset chat: duration guidance for the code workspace.'),
        ('coding_agent_not_running',
         'Koodausagentin ajuri ei ole käynnissä. Käynnistä se kehityskoneella komennolla ./ctl agent start.',
         'The coding agent runner is not running. On the development machine, start it with ./ctl agent start.',
         '编码代理运行器未运行。请在开发机器上用 ./ctl agent start 启动它。',
         '編碼代理執行器冇行緊。喺開發機用 ./ctl agent start 啟動佢。',
         'Dataset chat: the coding agent runner is not running on the development machine.'),
        ('coding_agent_sign_in_required',
         'Codex ei ole kirjautunut tällä koneella. Kirjaudu komennolla codex login ja tarkista ./ctl agent check.',
         'Codex is not signed in on this machine. Sign in with codex login, then run ./ctl agent check.',
         'Codex 尚未在本机登录。请用 codex login 登录，然后运行 ./ctl agent check。',
         'Codex 未喺呢部機登入。用 codex login 登入，再行 ./ctl agent check。',
         'Dataset chat: Codex is not signed in on the development machine.'),
        ('coding_agent_answered_by',
         'Vastasi',
         'Answered by',
         '回答者',
         '回答者',
         'Dataset chat: prefix of the answer footer naming the mode that answered.'),
        ('site_assistant_started',
         'Sivustoavustaja aloitti työn.',
         'Site assistant started working.',
         '站点助手已开始工作。',
         '網站助手開始咗工作。',
         'Dataset chat: first waiting message for the API-only site assistant.'),
        ('site_assistant_context',
         'Sivustoavustaja lukee keskustelua ja sivuston kontekstia.',
         'Site assistant is reading the chat and site context.',
         '站点助手正在阅读对话和站点上下文。',
         '網站助手睇緊對話同網站內容。',
         'Dataset chat: site assistant waiting message about reading context.'),
        ('site_assistant_scope',
         'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
         'Site assistant may inspect the site and prepare API changes for your approval.',
         '站点助手可以检查站点并准备 API 更改供您批准。',
         '網站助手可以檢查網站同準備 API 更改俾你批准。',
         'Dataset chat: site assistant waiting message about its approved API boundary.'),
        ('site_assistant_working',
         'Sivustoavustaja työskentelee edelleen.',
         'Site assistant is still working.',
         '站点助手仍在工作。',
         '網站助手仲做緊。',
         'Dataset chat: continuing waiting message for the site assistant.'),
        ('site_assistant_duration',
         'Pitkä sivustoavustajan työ voi kestää enintään 40 minuuttia.',
         'Long site-assistant jobs may take up to 40 minutes.',
         '较长的站点助手工作最多可能需要 40 分钟。',
         '長嘅網站助手工作最多可能要 40 分鐘。',
         'Dataset chat: duration guidance for the site assistant.'),
        ('coding_agent_service_label',
         'Tekoälypalvelu',
         'AI service',
         'AI 服务',
         'AI 服務',
         'Dataset chat: label of the AI service selector.'),
        ('coding_agent_service_api',
         'API-tekoäly',
         'API AI',
         'API AI',
         'API AI',
         'Dataset chat: AI service option that answers from dataset reads.'),
        ('coding_agent_checking',
         'Tarkistetaan saatavuutta…',
         'Checking availability…',
         '正在检查可用性…',
         '檢查緊可唔可以用…',
         'Dataset chat: status while assistant availability is being read.'),
        ('coding_agent_not_ready',
         'Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.',
         'Coding agent is not ready. An administrator must finish its setup.',
         '编码代理尚未就绪。管理员必须完成设置。',
         '編碼代理未準備好。管理員要完成設定。',
         'Dataset chat: assistant is permitted but its runner setup is unfinished.'),
        ('coding_agent_dev_only',
         'Koodausagentti on rajattu kehitysympäristöön.',
         'Coding agent is restricted to development.',
         '编码代理仅限开发环境使用。',
         '編碼代理只限開發環境用。',
         'Dataset chat: assistant is allowed only in the development environment.'),
        ('coding_agent_job_pending',
         'Työ on yhä käynnissä. Keskustelun avaaminen jatkaa sen tilan seurantaa.',
         'A job is still running. Reopening this chat resumes its status.',
         '任务仍在运行。重新打开此对话将继续显示其状态。',
         '工作仲行緊。再打開呢個對話會繼續顯示佢嘅狀態。',
         'Dataset chat: an assistant job continues after the chat is closed.'),
        ('coding_agent_job_failed',
         'Työ keskeytyi tai epäonnistui. Sen loki säilyy ylläpitäjälle.',
         'The job stopped or failed. Its log remains available to the administrator.',
         '任务已停止或失败。其日志仍可供管理员查看。',
         '工作停咗或者失敗咗。佢嘅記錄仍然俾管理員睇到。',
         'Dataset chat: an assistant job ended without an answer.'),
        -- Embedding status view of the administration (embedding_status_translation_fallbacks.js).
        ('embedding_status_title',
         'Upotusten tila',
         'Embedding status',
         '嵌入状态',
         '嵌入狀態',
         'Embedding status view: title.'),
        ('embedding_status_intro',
         'Tästä näet, mitkä aineistot on upotettu, kuinka kattavasti ja millä mallilla. Näkymä vain lukee tietoja.',
         'See which datasets are embedded, how completely and with which model. This view only reads.',
         '查看哪些数据集已嵌入、覆盖程度以及使用的模型。此视图只读取数据。',
         '睇吓邊啲資料集已經嵌入、覆蓋幾多，同埋用咗邊個模型。呢個畫面只會讀取資料。',
         'Embedding status view: introduction under the title.'),
        ('embedding_status_loading',
         'Luetaan upotusten tilaa…',
         'Reading the embedding status…',
         '正在读取嵌入状态…',
         '讀緊嵌入狀態…',
         'Embedding status view: status while the view is read.'),
        ('embedding_status_unavailable',
         'Upotusten tilaa ei voitu lukea.',
         'The embedding status could not be read.',
         '无法读取嵌入状态。',
         '讀取唔到嵌入狀態。',
         'Embedding status view: message when the status could not be read.'),
        ('embedding_status_empty',
         'Yhtään aineistoa ei löytynyt.',
         'No datasets found.',
         '未找到数据集。',
         '搵唔到資料集。',
         'Embedding status view: message when no dataset exists.'),
        ('embedding_status_provider',
         'Palvelu',
         'Provider',
         '服务商',
         '服務供應商',
         'Embedding status view: label of the embedding provider.'),
        ('embedding_status_model',
         'Malli',
         'Model',
         '模型',
         '模型',
         'Embedding status view: label of the embedding model.'),
        ('embedding_status_dimensions',
         '$count ulottuvuutta',
         '$count dimensions',
         '$count 维',
         '$count 維',
         'Embedding status view: vector size of the model. $count is the number of dimensions.'),
        ('embedding_status_key_configured',
         'API-avain asetettu',
         'API key configured',
         '已配置 API 密钥',
         '已設定 API 金鑰',
         'Embedding status view: the API key of the provider is set.'),
        ('embedding_status_key_missing',
         'API-avain puuttuu',
         'API key missing',
         '缺少 API 密钥',
         '欠缺 API 金鑰',
         'Embedding status view: the API key of the provider is missing.'),
        ('embedding_status_column_dataset',
         'Aineisto',
         'Dataset',
         '数据集',
         '資料集',
         'Embedding status view: column heading: dataset.'),
        ('embedding_status_column_state',
         'Tila',
         'State',
         '状态',
         '狀態',
         'Embedding status view: column heading: embedding state.'),
        ('embedding_status_column_rows',
         'Upotetut rivit',
         'Embedded rows',
         '已嵌入的行',
         '已嵌入嘅行',
         'Embedding status view: column heading: embedded rows.'),
        ('embedding_status_column_changed',
         'Muuttunut upotuksen jälkeen',
         'Changed since embedding',
         '嵌入后已更改',
         '嵌入之後有改動',
         'Embedding status view: column heading: rows changed since their embedding.'),
        ('embedding_status_changed_hint',
         'Rivit, joita on muokattu kieliupotuksen luomisen jälkeen. Upotus ei ehkä enää vastaa niiden sisältöä.',
         'Rows edited after their language embedding was made. The embedding may no longer match them.',
         '在语言嵌入生成后被编辑的行。嵌入可能已不再与其内容相符。',
         '語言嵌入整好之後再被改過嘅行。嵌入可能已經唔再啱佢哋嘅內容。',
         'Embedding status view: explanation of the changed-since-embedding column.'),
        ('embedding_status_column_languages',
         'Kielet',
         'Languages',
         '语言',
         '語言',
         'Embedding status view: column heading: embedded languages.'),
        ('embedding_status_column_refreshed',
         'Viimeksi päivitetty',
         'Last refreshed',
         '上次刷新',
         '上次更新',
         'Embedding status view: column heading: time of the last refresh.'),
        ('embedding_status_column_automatic',
         'Päivittyy rivin muuttuessa',
         'Updates when a row changes',
         '行更改时自动更新',
         '行有改動時自動更新',
         'Embedding status view: column heading: whether embeddings refresh when a row changes.'),
        ('embedding_status_state_embedded',
         'Upotettu',
         'Embedded',
         '已嵌入',
         '已嵌入',
         'Embedding status view: state: every row is embedded.'),
        ('embedding_status_state_partial',
         'Osittain upotettu',
         'Partly embedded',
         '部分嵌入',
         '部分嵌入',
         'Embedding status view: state: some rows are embedded.'),
        ('embedding_status_state_none',
         'Ei upotettu',
         'Not embedded',
         '未嵌入',
         '未嵌入',
         'Embedding status view: state: no row is embedded.'),
        ('embedding_status_state_unavailable',
         'Tila ei saatavilla',
         'Status unavailable',
         '状态不可用',
         '狀態唔可用',
         'Embedding status view: state: the status of the dataset could not be read.'),
        ('embedding_status_rows_without',
         '$count ilman upotusta',
         '$count without an embedding',
         '$count 行没有嵌入',
         '$count 行未有嵌入',
         'Embedding status view: rows without an embedding. $count is the number of rows.'),
        ('embedding_status_not_tracked',
         'Ei seurata',
         'Not tracked',
         '未跟踪',
         '冇追蹤',
         'Embedding status view: value when the time of an embedding is not stored.'),
        ('embedding_status_not_tracked_hint',
         'Yleiselle upotukselle ei tallenneta aikaa, joten sen ikää tai rivin myöhempiä muutoksia ei tiedetä.',
         'The general embedding stores no time, so its age and later row changes are unknown.',
         '通用嵌入不记录时间，因此无法得知其生成时间以及之后的行更改。',
         '通用嵌入冇記錄時間，所以唔知佢幾時整，亦唔知之後行有冇改動。',
         'Embedding status view: explanation of why the general embedding has no time.'),
        ('embedding_status_general_embedding',
         'Yleinen, kaikki kielet yhdessä',
         'General, all languages together',
         '通用，所有语言合并',
         '通用，所有語言合埋',
         'Embedding status view: name of the general embedding that covers all languages.'),
        ('embedding_status_current_model',
         'Nykyinen malli',
         'Current model',
         '当前模型',
         '而家嘅模型',
         'Embedding status view: embeddings made with the current model.'),
        ('embedding_status_other_model',
         '$count tehty toisella mallilla',
         '$count made with another model',
         '$count 个由其他模型生成',
         '$count 個由其他模型整',
         'Embedding status view: embeddings made with another model. $count is their number.'),
        ('embedding_status_other_model_hint',
         'Nämä upotukset eivät vastaa nykyistä mallia, joten haku ei voi verrata niitä. Luo ne uudelleen.',
         'These embeddings do not match the current model, so search cannot compare them. Create them again.',
         '这些嵌入与当前模型不匹配，搜索无法比较它们。请重新生成。',
         '呢啲嵌入同而家嘅模型唔夾，搜尋冇辦法比較。請重新整過。',
         'Embedding status view: explanation of why embeddings of another model must be made again.'),
        ('embedding_status_orphans',
         '$count poistettujen rivien upotusta',
         '$count embeddings of deleted rows',
         '$count 个已删除行的嵌入',
         '$count 個已刪除行嘅嵌入',
         'Embedding status view: embeddings left from deleted rows. $count is their number.'),
        ('embedding_status_automatic_on',
         'Kyllä',
         'Yes',
         '是',
         '係',
         'Embedding status view: value when embeddings refresh automatically.'),
        ('embedding_status_blocker_no_embedding_storage',
         'Ei – aineistolla ei ole upotuksia',
         'No – the dataset has no embeddings',
         '否 – 数据集没有嵌入',
         '唔會 – 資料集冇嵌入',
         'Embedding status view: why automatic refresh is off: the dataset has no embeddings.'),
        ('embedding_status_blocker_provider_sending_disabled',
         'Ei – ulkoiset upotukset eivät ole käytössä tälle taululle',
         'No – external embeddings are not enabled for this table',
         '否 – 此表未启用外部嵌入',
         '唔會 – 呢個資料表未啟用外部嵌入',
         'Embedding status view: why automatic refresh is off: external embeddings are not enabled for the table.'),
        ('embedding_status_blocker_no_approved_fields',
         'Ei – yhtään kenttää ei ole sallittu lähetettäväksi',
         'No – no fields are approved for sending',
         '否 – 没有允许发送的字段',
         '唔會 – 冇批准傳送嘅欄位',
         'Embedding status view: why automatic refresh is off: no field is approved for sending.'),
        ('embedding_status_blocker_queue_unavailable',
         'Ei – päivitysjono puuttuu',
         'No – the refresh queue is missing',
         '否 – 缺少刷新队列',
         '唔會 – 欠缺更新隊列',
         'Embedding status view: why automatic refresh is off: the refresh queue is missing.'),
        ('embedding_status_pending',
         '$count odottaa',
         '$count waiting',
         '$count 个等待中',
         '$count 個等緊',
         'Embedding status view: refresh jobs waiting. $count is their number.'),
        ('embedding_status_failing',
         '$count epäonnistunut',
         '$count failing',
         '$count 个失败',
         '$count 個失敗',
         'Embedding status view: refresh jobs failing. $count is their number.'),
        -- Foreign-keys admin page and its Add dialog (foreign_keys_translation_fallbacks.js). Keys the database already holds in Finnish and English gain Chinese and Cantonese.
        ('referencing_table',
         'Viittaava taulu',
         'Referencing table',
         '引用表',
         '引用表',
         'Foreign-keys admin: label of the table that holds the referencing column.'),
        ('foreign_key_added_successfully',
         'Viiteavain lisätty onnistuneesti',
         'Foreign key added successfully',
         '外键添加成功',
         '外鍵已成功加入',
         'Foreign-keys admin: notice after a foreign key was added.'),
        ('select_table',
         'Valitse taulu',
         'Select table',
         '选择表',
         '選擇表',
         'Foreign-keys admin: placeholder of a table selector.'),
        ('fill_all_fields',
         'Täytä kaikki kentät',
         'Fill all fields',
         '请填写所有字段',
         '請填寫所有欄位',
         'Foreign-keys admin: validation message when a field of the Add dialog is empty.'),
        ('foreign_key_deleted_successfully',
         'Viiteavain poistettu onnistuneesti',
         'Foreign key deleted successfully',
         '外键删除成功',
         '外鍵已成功刪除',
         'Foreign-keys admin: notice after a foreign key was deleted.'),
        ('select_foreign_key_to_delete',
         'Valitse poistettava viiteavain',
         'Select foreign key to delete',
         '请选择要删除的外键',
         '請選擇要刪除嘅外鍵',
         'Foreign-keys admin: validation message when no foreign key is selected for deletion.'),
        ('delete_selected_foreign_key',
         'Poista valittu viiteavain',
         'Delete selected foreign key',
         '删除所选外键',
         '刪除所選外鍵',
         'Foreign-keys admin: button that deletes the selected foreign key.'),
        -- Permission editor: its save question had only wording generated from the key name.
        ('confirm_save_permissions',
         'Tallennetaanko muutetut oikeudet?',
         'Save the changed permissions?',
         '保存已更改的权限吗？',
         '要唔要儲存已更改嘅權限？',
         'Permission editor: question before saving changed permissions.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260922000006_seed_dataset_creation_warning_language_key.sql
-- Seeds the warning the dataset form shows when a dataset was created but one of
-- its later settings, such as its symbol, could not be saved.
-- Bridges the creation mode of the dataset form with the language keys of the
-- installation.
-- Exists because that warning reused the wording of the editing dialog, which
-- speaks of saved columns; the copy came after 20260922000005 was applied to the
-- development database, so it is seeded here rather than there.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same row.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- Add the missing keys, fill only empty columns, and mirror the served
-- Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Dataset form, creation mode (dataset_form_translation_fallbacks.js).
        ('dataset_created_settings_need_attention',
         'Aineisto luotiin, mutta yksi sen asetuksista jäi tallentamatta – katso lomakkeen viesti. Voit tallentaa asetuksen aineiston hallinnasta.',
         'The dataset was created, but one of its settings was not saved — see the message in the form. You can save it in the dataset''s Manage table dialog.',
         '数据集已创建，但其中一项设置未能保存——请查看表单中的提示。您可以在数据集的管理窗口中保存该设置。',
         '資料集已經建立，但其中一項設定儲存唔到——請睇表單入面嘅訊息。你可以喺資料集嘅管理視窗儲存呢項設定。',
         'Dataset form, creation mode: warning after a dataset was created but one of its later settings (such as its symbol) could not be saved.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260922000007_seed_embedding_refresh_and_dataset_header_language_keys.sql
-- Seeds the copy of the embedding refresh controls and of the dataset header settings.
-- Bridges the embedding administration page and the dataset header settings screen
-- with the language keys of the installation.
-- Exists because both screens showed hardcoded English or keys without Chinese
-- and Cantonese; the copy came after 20260922000005 was applied to the development
-- database, so it is seeded here. Shared keys these screens reuse gain the copy a
-- new installation already has, and wording generated from the name of a key or
-- left untranslated in a column gives way to it.
-- A nonempty translation is never overwritten; only the exact superseded wording
-- listed in step 1 gives way. Running the file again changes nothing. The public
-- bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales. $count is filled by the
-- page and stays literal.
-- VERSION_DB: 9.8.1
-- VERSION_DB_OWNER: 20260921000002_record_public_table_creation_release.sql

-- 1. Wording that is withdrawn where a site still holds exactly it: copy an
--    earlier seed wrote before it was rewritten, and wording generated from
--    the name of a key. It then counts as missing copy and is filled in step 2
--    like any empty value. Any other text, a reviewed translation included,
--    stays as it is. NULL matches nothing.
WITH superseded_copy(lang_key, fi, en, ch, yue) AS (
    VALUES
        -- Generated from the name of the key and its machine translation, never reviewed.
        ('dataset_header_config', 'Tietojoukon otsikon konfiguraatio', 'Dataset header config', NULL, NULL),
        -- Generated from the name of the key into the Finnish column.
        ('usage_explanation', 'Usage explanation', NULL, NULL, NULL),
        -- English left in the Chinese column.
        ('search', NULL, NULL, 'Search', NULL)
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_copy AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    ch = CASE WHEN keys.ch = superseded.ch THEN NULL ELSE keys.ch END,
    yue = CASE WHEN keys.yue = superseded.yue THEN NULL ELSE keys.yue END,
    updated = now()
FROM superseded_copy AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en
    OR keys.ch = superseded.ch OR keys.yue = superseded.yue);

-- 2. Add the missing keys, fill only empty columns, and mirror the served
--    Finnish and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Embedding administration: refresh controls (embedding_status_translation_fallbacks.js).
        ('embedding_refresh_rows_to_process',
         'Käsiteltäviä rivejä: $count',
         'Rows to process: $count',
         '待处理行数：$count',
         '待處理行數：$count',
         'Embedding administration, refresh controls: number of rows the refresh will process. $count is that number.'),
        ('embedding_refresh_loading',
         'Ladataan…',
         'Loading…',
         '正在加载…',
         '載入緊…',
         'Embedding administration, refresh controls: status while the refresh settings are read.'),
        ('embedding_refresh_field_policy_unavailable',
         'Kenttävalintaa ei voitu lukea',
         'The field selection could not be read',
         '无法读取字段选择',
         '讀取唔到欄位選擇',
         'Embedding administration, refresh controls: message when the field selection of a dataset could not be read.'),
        ('embedding_refresh_no_eligible_fields',
         'Ei sopivia tekstikenttiä',
         'No eligible text fields',
         '没有符合条件的文本字段',
         '冇合資格嘅文字欄位',
         'Embedding administration, refresh controls: message when a dataset has no text field that may be embedded.'),
        ('embedding_refresh_start',
         'Aloita upotus',
         'Start embedding',
         '开始嵌入',
         '開始嵌入',
         'Embedding administration, refresh controls: button that starts embedding.'),
        ('embedding_refresh_done',
         'Upotukset päivitetty',
         'Embeddings refreshed',
         '嵌入已刷新',
         '嵌入已更新',
         'Embedding administration, refresh controls: notice after the embeddings were refreshed.'),
        -- Dataset header settings screen (dataset_header_config_translation_fallbacks.js). Shared keys keep the fresh-install copy.
        ('dataset_header_config_intro',
         'Muokkaa tässä aineiston omia tekstejä: otsikkoa, iskulausetta ja hakukentän vihjetekstiä.',
         'Edit the dataset''s own texts here: its title, slogan and search placeholder.',
         '在此编辑数据集自己的文本：标题、标语和搜索占位文本。',
         '喺度編輯資料集自己嘅文字：標題、標語同搜尋預留位置文字。',
         'Dataset header settings: introduction of the screen.'),
        ('dataset_header_config_text_keys',
         'Aineiston tekstit',
         'Dataset texts',
         '数据集文本',
         '資料集文字',
         'Dataset header settings: heading of the dataset texts section.'),
        ('dataset_header_config_text_keys_hint',
         'Jokaisella tekstillä on valmis kieliavain, joka näkyy alla. Tallenna tänne käännökset ja tekoälylle tarkoitettu käyttöselite; aineistonäkymä käyttää näitä avaimia.',
         'Each text has a ready-made language key, shown below. Save its translations and the usage explanation for AI translation here; the dataset view keeps using these keys.',
         '每段文本都有现成的语言键，显示在下方。请在此保存其翻译以及供 AI 翻译使用的使用说明；数据集视图会继续使用这些键。',
         '每段文字都有現成嘅語言鍵，顯示喺下面。請喺度儲存佢嘅翻譯同埋畀 AI 翻譯用嘅使用說明；資料集檢視會繼續用呢啲鍵。',
         'Dataset header settings: explanation of the language keys of the dataset texts.'),
        ('dataset_header_config_slogan',
         'Iskulause',
         'Slogan',
         '标语',
         '標語',
         'Dataset header settings: label of the dataset slogan.'),
        ('dataset_header_config_usage_placeholder',
         'Kerro, mitä avain tarkoittaa ja missä sitä käytetään, jotta tekoäly osaa kääntää sen.',
         'Explain what this key means and where it is used, so AI translation gets it right.',
         '说明此键的含义和用途，以便 AI 正确翻译。',
         '講解呢個鍵嘅意思同用途，等 AI 翻譯得準確。',
         'Dataset header settings: placeholder of the usage explanation field for AI translation.'),
        ('dataset_header_config_cover_title',
         'Aineiston kansikuva',
         'Dataset cover image',
         '数据集封面图片',
         '資料集封面圖片',
         'Dataset header settings: heading of the dataset cover image section.'),
        ('dataset_header_config_cover_hint',
         'Näkyy aineiston otsikkoalueen taustalla. Kuva kuuluu vain valitulle aineistolle.',
         'Shown behind the dataset hero. The image belongs only to the selected dataset.',
         '显示在数据集标题区域的背景中。图片只属于所选数据集。',
         '顯示喺資料集標題區嘅背景。圖片只屬於所選資料集。',
         'Dataset header settings: explanation of the dataset cover image.'),
        ('dataset_header_config_background_title',
         'Aineiston sisällön tausta',
         'Dataset content background',
         '数据集内容背景',
         '資料集內容背景',
         'Dataset header settings: heading of the dataset content background section.'),
        ('dataset_header_config_background_hint',
         'Näkyy hienovaraisesti tulosmäärän ja aineiston sisällön takana, kansikuvasta riippumatta.',
         'Shown subtly behind the result count and dataset content, independently of the hero cover.',
         '淡淡地显示在结果数量和数据集内容后面，与封面图片无关。',
         '淡淡咁顯示喺結果數目同資料集內容後面，同封面圖片無關。',
         'Dataset header settings: explanation of the dataset content background.'),
        ('dataset_header_config_replace_image',
         'Vaihda kuva',
         'Replace image',
         '更换图片',
         '更換圖片',
         'Dataset header settings: button that replaces an image.'),
        ('dataset_header_config_remove_image',
         'Poista nykyinen kuva tallennettaessa',
         'Remove current image on save',
         '保存时删除当前图片',
         '儲存時刪除目前圖片',
         'Dataset header settings: option that removes the current image on save.'),
        ('dataset_header_config_no_image',
         'Kuvaa ei ole vielä ladattu.',
         'No image uploaded yet.',
         '尚未上传图片。',
         '仲未上載圖片。',
         'Dataset header settings: text when no image has been uploaded.'),
        ('dataset_header_config_no_datasets',
         'Asetettavia aineistoja ei ole.',
         'No datasets available for header configuration.',
         '没有可配置标题的数据集。',
         '冇可以設定標題嘅資料集。',
         'Dataset header settings: text when no dataset can be configured.'),
        ('dataset_header_config_not_loaded',
         'Tämän aineiston asetuksia ei saatu ladattua, joten tallennus on estetty, ettei toisen aineiston tekstejä tallennu sen päälle. Valitse aineisto uudelleen yrittääksesi uudestaan.',
         'This dataset''s settings did not load, so saving is off to keep another dataset''s texts from overwriting them. Choose the dataset again to retry.',
         '此数据集的设置未能加载，因此已停用保存，以免其他数据集的文本覆盖它们。请重新选择该数据集以重试。',
         '呢個資料集嘅設定載入唔到，所以已停用儲存，免得其他資料集嘅文字覆蓋佢哋。請重新揀選呢個資料集再試。',
         'Dataset header settings: warning that saving is off because the settings of the dataset did not load.'),
        ('dataset_header_config',
         'Tietojoukko-otsikoiden asetukset',
         'Dataset header configuration',
         '数据集标题配置',
         '資料集標題設定',
         'Admin tools: name of the dataset header settings screen.'),
        ('close',
         'Sulje',
         'Close',
         '关闭',
         '關閉',
         'Shared: button that closes a panel or dialog.'),
        ('saved',
         'Tallennettu',
         'Saved',
         '已保存',
         '已儲存',
         'Shared: status after changes were saved.'),
        ('unsaved_changes',
         'Tallentamattomat muutokset',
         'Unsaved changes',
         '未保存的更改',
         '未儲存嘅變更',
         'Shared: status when there are changes not yet saved.'),
        ('dataset',
         'Aineisto',
         'Dataset',
         '数据集',
         '資料集',
         'Shared: the word dataset, as a label.'),
        ('lang_key',
         'Avain',
         'Key',
         '语言键',
         '語言鍵',
         'Shared: label of a language key.'),
        ('title',
         'Otsikko',
         'Title',
         '标题',
         '標題',
         'Shared: label of a title.'),
        ('search_placeholder',
         'Hakupaikkamerkki',
         'Search placeholder',
         '搜索占位文本',
         '搜尋預留位置文字',
         'Shared: label of the placeholder text of a search field.'),
        ('usage_explanation',
         'Käyttöselite',
         'Usage explanation',
         '使用说明',
         '使用說明',
         'Shared: label of the usage explanation of a language key, used as context for AI translation.'),
        ('search',
         'Haku',
         'Search',
         '搜索',
         '搜尋',
         'Shared: label or button for search.'),
        ('fi',
         'Suomi',
         'Finnish',
         '芬兰语',
         '芬蘭文',
         'Language name: Finnish.'),
        ('en',
         'Englanti',
         'English',
         '英语',
         '英文',
         'Language name: English.'),
        ('ch',
         'Kiina',
         'Chinese',
         '简体中文',
         '簡體中文',
         'Language name: Chinese.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260929000001_seed_connect_two_fields_language_keys.sql
-- Seeds the copy of the links section of the dataset form and the column labels of the foreign-keys page.
-- Bridges the Connect two fields controls of the dataset form and the technical
-- foreign-keys page with the language keys of the installation.
-- Exists because the form showed copy that no language key held, and shared four
-- column labels with the technical page whose rows had Finnish and English only,
-- so a site showed the older technical wording in the form and English to a
-- reader of Chinese or Cantonese. The form now has keys of its own; the technical
-- page keeps the shared keys and their stored wording, and the four link messages
-- 20260919000005 wrote gain Chinese and Cantonese.
-- A nonempty translation is never overwritten. Running the file again changes
-- nothing. The public bootstrap runs this same file, so a new installation
-- receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.9.1
-- VERSION_DB_OWNER: 20260929000003_record_database_release_9_9_1.sql

-- Add the missing keys, fill only empty columns, and mirror the served Finnish
-- and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Dataset form, links to other datasets (dataset_form_translation_fallbacks.js).
        ('connect_two_fields',
         'Yhdistä kaksi kenttää',
         'Connect two fields',
         '连接两个字段',
         '連接兩個欄位',
         'Dataset form, links to other datasets: button that adds a link from a column of this dataset to a column of another dataset.'),
        ('connect_two_fields_explain',
         'Mitä kahden kentän yhdistäminen tarkoittaa?',
         'What does connecting two fields mean?',
         '连接两个字段是什么意思？',
         '連接兩個欄位係咩意思？',
         'Dataset form, links to other datasets: name of the information symbol that opens the explanation, read by keyboard and screen reader users.'),
        ('connect_two_fields_explanation',
         'Tämän aineiston rivi osoittaa toisen aineiston riviin, jolloin toisen rivin tiedot voidaan näyttää tässä ja arvo pysyy kelvollisena. Linkki kulkee tämän aineiston viittaavasta sarakkeesta toisen aineiston viitattavaan sarakkeeseen. Tunnetaan myös nimellä viiteavain.',
         'A row of this dataset points at a row of another dataset, so the other row''s information can be shown here and the value stays valid. The link runs from the referencing column of this dataset to the referenced column of the other one. Also known as a foreign key.',
         '本数据集中的一行指向另一个数据集中的一行，这样就能在这里显示另一行的信息，并且该值始终有效。链接从本数据集的引用列指向另一个数据集的被引用列。也称为外键。',
         '呢個資料集嘅一行會指向另一個資料集嘅一行，噉就可以喺呢度顯示嗰行嘅資料，個值亦會一直有效。連結由呢個資料集嘅引用欄位指向另一個資料集嘅被引用欄位。亦叫做外鍵。',
         'Dataset form, links to other datasets: explanation of what connecting two fields does, naming the referencing and the referenced column and the technical term foreign key.'),
        ('connect_two_fields_referencing_column',
         'Viittaava sarake',
         'Referencing column',
         '引用列',
         '引用欄位',
         'Dataset form, links to other datasets: label of the column of this dataset that points at the other dataset.'),
        ('connect_two_fields_referenced_dataset',
         'Viitattava aineisto',
         'Referenced dataset',
         '被引用的数据集',
         '被引用資料集',
         'Dataset form, links to other datasets: label of the dataset the link points at.'),
        ('connect_two_fields_referenced_column',
         'Viitattava sarake',
         'Referenced column',
         '被引用的列',
         '被引用欄位',
         'Dataset form, links to other datasets: label of the column of the other dataset the link points at.'),
        ('connect_two_fields_choose_column',
         'Valitse sarake',
         'Choose a column',
         '选择列',
         '選擇欄位',
         'Dataset form, links to other datasets: placeholder of a column selector.'),
        -- The link messages 20260919000005 wrote in Finnish and English, with its own description.
        ('dataset_foreign_keys_title',
         'Linkit toisiin aineistoihin',
         'Links to other datasets',
         '与其他数据集的链接',
         '同其他資料集嘅連結',
         'Dataset dimensions: heading of the links to other datasets.'),
        ('dataset_foreign_keys_none',
         'Tällä aineistolla ei ole vielä linkkejä.',
         'This dataset has no links yet.',
         '此数据集还没有链接。',
         '呢個資料集仲未有連結。',
         'Dataset dimensions: the dataset has no links to other datasets yet.'),
        ('dataset_foreign_keys_unavailable',
         'Linkkejä ei voitu lukea.',
         'The links could not be read.',
         '无法读取链接。',
         '讀取唔到連結。',
         'Dataset dimensions: the links to other datasets could not be read.'),
        ('dataset_foreign_key_save_failed',
         'Linkin lisääminen epäonnistui.',
         'The link could not be added.',
         '无法添加链接。',
         '加唔到連結。',
         'Dataset dimensions: adding a link to another dataset failed.'),
        -- Foreign-keys admin page (foreign_keys_translation_fallbacks.js), in the wording sites already store.
        ('referencing_column',
         'Viittaava sarake',
         'Referencing column',
         '引用列',
         '引用欄位',
         'Foreign-keys admin: label of the column that holds the reference.'),
        ('referenced_table',
         'Viitattu taulu',
         'Referenced table',
         '被引用的表',
         '被引用表',
         'Foreign-keys admin: label of the table the reference points at.'),
        ('referenced_column',
         'Viitattu sarake',
         'Referenced column',
         '被引用的列',
         '被引用欄位',
         'Foreign-keys admin: label of the column the reference points at.'),
        ('select_column',
         'Valitse sarake',
         'Select column',
         '选择列',
         '選擇欄位',
         'Foreign-keys admin and notification rules: placeholder of a column selector.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20260929000005_seed_missing_media_check_language_keys.sql
-- Seeds the copy of the missing media files section of the media maintenance screen.
-- Bridges the section (missing_media_check_panel.js, its result printer and
-- missing_media_check_translation_fallbacks.js) with the language keys of the
-- installation.
-- Exists because the copy of the section was written by a startup routine, which ran
-- at every server start outside the migrations and the public bootstrap, filled the
-- key columns without a description or the reviewed Finnish and English rows, and
-- knew nothing of the settings, notices and details this release adds. The routine
-- is retired: this file seeds its keys in the same wording, and the new keys. Only
-- the two keys of the unused-file list it wrote are reworded, to files no
-- recognised reference uses, because a picture linked from free text is not
-- recognised and such a file is not safe to remove unseen.
-- A nonempty translation is never overwritten; only the exact wording of the
-- routine listed in step 1 gives way. Running the file again changes nothing. The
-- public bootstrap runs this same file, so a new installation receives the same rows.
-- Finnish and English are served from the columns of system_lang_keys and are
-- mirrored into the normalized table as reviewed copy. Chinese (ch) and
-- Cantonese (yue) fill only their own columns, as the earlier seeds do: they
-- are not a review of the zh-CN, zh-TW or zh-HK locales.
-- VERSION_DB: 9.9.2
-- VERSION_DB_OWNER: 20260929000006_record_database_release_9_9_2.sql

-- 1. The wording the retired startup routine wrote for the unused-file list,
--    withdrawn where a site still holds exactly it. It then counts as missing
--    copy and is filled in step 2 like any empty value. Any other text, a
--    reviewed translation included, stays as it is.
WITH superseded_copy(lang_key, fi, en, ch, yue) AS (
    VALUES
        ('missing_media_check_unused_files_setting', 'Kerro myös tiedostoista, joita mikään rivi ei käytä', 'Also report files that no row uses', '同时报告没有任何行使用的文件', '同時報告冇任何行用緊嘅檔案'),
        ('missing_media_check_unused_files', 'Käyttämättömiä tiedostoja', 'Unused files', '未使用的文件', '冇用到嘅檔案')
), withdrawn_translations AS (
    DELETE FROM public.system_lang_key_translations AS stored
    USING public.system_lang_keys AS keys, superseded_copy AS superseded
    WHERE keys.id = stored.lang_key_id
      AND keys.lang_key = superseded.lang_key
      AND ((stored.language_code = 'fi' AND stored.translation = superseded.fi)
        OR (stored.language_code = 'en' AND stored.translation = superseded.en))
    RETURNING stored.lang_key_id
)
UPDATE public.system_lang_keys AS keys
SET fi = CASE WHEN keys.fi = superseded.fi THEN NULL ELSE keys.fi END,
    en = CASE WHEN keys.en = superseded.en THEN NULL ELSE keys.en END,
    ch = CASE WHEN keys.ch = superseded.ch THEN NULL ELSE keys.ch END,
    yue = CASE WHEN keys.yue = superseded.yue THEN NULL ELSE keys.yue END,
    updated = now()
FROM superseded_copy AS superseded
WHERE keys.lang_key = superseded.lang_key
  AND (keys.fi = superseded.fi OR keys.en = superseded.en
    OR keys.ch = superseded.ch OR keys.yue = superseded.yue);

-- 2. Add the missing keys, fill only empty columns, and mirror the served Finnish
--    and English into the normalized table where a row is missing.
WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        -- Heading, actions and status (missing_media_check_panel.js).
        ('missing_media_check',
         'Puuttuvat mediatiedostot',
         'Missing media files',
         '缺失的媒体文件',
         '唔見咗嘅媒體檔案',
         'Missing media files check on the media maintenance screen: heading of the section.'),
        ('missing_media_check_description',
         'Tarkistaa, ovatko rivien käyttämät kuvat ja liitteet yhä levyllä. Ei korjaa eikä poista mitään, vaan kertoo mikä puuttuu.',
         'Checks whether the pictures and attachments that rows use are still on disk. It repairs nothing and deletes nothing; it only reports what is missing.',
         '检查各行所使用的图片和附件是否仍在磁盘上。它不会修复或删除任何内容，只报告缺失的文件。',
         '檢查各行用緊嘅圖片同附件係咪仲喺磁碟上。佢唔會修復或者刪除任何嘢，只係報告咩唔見咗。',
         'Missing media files check on the media maintenance screen: explanation under the heading of what the check does, and that it repairs and deletes nothing.'),
        ('missing_media_check_run_now',
         'Tarkista nyt',
         'Check now',
         '立即检查',
         '即刻檢查',
         'Missing media files check on the media maintenance screen: button that starts a check now.'),
        ('missing_media_check_save_settings',
         'Tallenna asetukset',
         'Save settings',
         '保存设置',
         '儲存設定',
         'Missing media files check on the media maintenance screen: button that saves the settings of the check.'),
        ('missing_media_check_settings_saved',
         'Asetukset tallennettu.',
         'Settings saved.',
         '设置已保存。',
         '設定已儲存。',
         'Missing media files check on the media maintenance screen: status after the settings were saved.'),
        ('missing_media_check_running',
         'Tarkistus on käynnissä…',
         'The check is running…',
         '检查进行中…',
         '檢查進行緊…',
         'Missing media files check on the media maintenance screen: status while a check runs.'),
        ('missing_media_check_never_run',
         'Tarkistusta ei ole vielä ajettu.',
         'The check has not run yet.',
         '检查尚未运行。',
         '檢查仲未執行過。',
         'Missing media files check on the media maintenance screen: shown in place of the result when the check has never run.'),
        ('missing_media_check_disabled',
         'Tarkistus on poistettu käytöstä asetuksista.',
         'The check is switched off in the settings.',
         '该检查已在设置中关闭。',
         '呢個檢查喺設定入面已經閂咗。',
         'Missing media files check on the media maintenance screen: status when a check was asked for while the check is switched off in its settings.'),
        ('missing_media_check_settings_problem',
         'Tallennettuja asetuksia ei voitu lukea, joten näkyvissä ovat oletusarvot eikä tarkistusta ajeta. Asetusten tallentaminen korvaa tallennetun arvon.',
         'The stored settings could not be read, so the shipped defaults are shown and the check does not run. Saving the settings replaces the stored value.',
         '无法读取已保存的设置，因此显示的是默认值，检查也不会运行。保存设置会替换已保存的值。',
         '讀取唔到已儲存嘅設定，所以而家顯示緊預設值，檢查亦唔會執行。儲存設定會取代已儲存嘅值。',
         'Missing media files check on the media maintenance screen: notice that the stored settings cannot be read, so the defaults are shown and the check does not run until the settings are saved again.'),
        -- Every setting of the check, in the order the section shows them.
        ('missing_media_check_enabled_setting',
         'Tarkistus käytössä',
         'Check switched on',
         '启用检查',
         '開啟檢查',
         'Missing media files check on the media maintenance screen: setting that switches the whole check on or off.'),
        ('missing_media_check_max_rows_setting',
         'Rivien yläraja yhdessä ajossa',
         'Row limit for one run',
         '单次运行的行数上限',
         '單次執行嘅行數上限',
         'Missing media files check on the media maintenance screen: setting of the most rows one run checks, shared between the datasets.'),
        ('missing_media_check_min_rows_setting',
         'Tarkistettavia rivejä vähintään kustakin aineistosta',
         'Rows checked at least in each dataset',
         '每个数据集至少检查的行数',
         '每個資料集最少檢查嘅行數',
         'Missing media files check on the media maintenance screen: setting of the fewest rows checked in each dataset while the row limit allows it.'),
        ('missing_media_check_sampling_setting',
         'Miten suuren aineiston rivit valitaan',
         'How rows of a large dataset are picked',
         '如何挑选大型数据集中的行',
         '點樣揀大型資料集入面嘅行',
         'Missing media files check on the media maintenance screen: setting of how the rows of a dataset too large to check completely are picked, also shown with the result.'),
        ('missing_media_check_sampling_even',
         'Tasaisesti vanhimmasta uusimpaan',
         'Evenly from oldest to newest',
         '从最旧到最新均匀挑选',
         '由最舊到最新平均咁揀',
         'Missing media files check on the media maintenance screen: sampling choice that spreads the checked rows evenly from the oldest row to the newest.'),
        ('missing_media_check_sampling_random',
         'Satunnaisesti',
         'At random',
         '随机挑选',
         '隨機揀',
         'Missing media files check on the media maintenance screen: sampling choice that picks the checked rows at random.'),
        ('missing_media_check_max_seconds_setting',
         'Aikaraja sekunteina',
         'Time limit in seconds',
         '时间上限（秒）',
         '時間上限（秒）',
         'Missing media files check on the media maintenance screen: setting of the most seconds one run may take.'),
        ('missing_media_check_run_after_update_setting',
         'Tarkista kerran jokaisen päivityksen jälkeen',
         'Check once after every update',
         '每次更新后检查一次',
         '每次更新之後檢查一次',
         'Missing media files check on the media maintenance screen: setting that runs the check once by itself after an application or database update.'),
        ('missing_media_check_run_on_startup_setting',
         'Tarkista jokaisella palvelimen käynnistyksellä',
         'Check at every server start',
         '每次服务器启动时检查',
         '每次伺服器啟動嗰陣檢查',
         'Missing media files check on the media maintenance screen: setting that runs the check every time the server starts.'),
        ('missing_media_check_startup_delay_setting',
         'Odotus palvelimen käynnistyksen jälkeen sekunteina',
         'Wait after the server starts, in seconds',
         '服务器启动后等待的秒数',
         '伺服器啟動之後等候嘅秒數',
         'Missing media files check on the media maintenance screen: setting of how many seconds an automatic check waits after the server has started.'),
        ('missing_media_check_exact_count_setting',
         'Yhden aineiston rivit lasketaan tarkasti enintään',
         'Rows counted exactly in one dataset, at most',
         '每个数据集最多精确计数的行数',
         '每個資料集最多準確計算嘅行數',
         'Missing media files check on the media maintenance screen: setting of how many rows of one dataset are counted exactly; a larger dataset is estimated.'),
        ('missing_media_check_unused_files_setting',
         'Kerro myös tiedostoista, joihin mikään tunnistettu viittaus ei osoita',
         'Also report files no recognised reference uses',
         '同时报告没有被任何已识别引用使用的文件',
         '同時報告冇任何已識別引用用到嘅檔案',
         'Missing media files check on the media maintenance screen: setting that also lists stored files no recognised reference uses, that is no media row and no picture field.'),
        ('missing_media_check_max_reported_missing_setting',
         'Puuttuvia tiedostoja luetellaan enintään',
         'Missing files listed, at most',
         '最多列出的缺失文件数',
         '最多列出嘅唔見咗檔案數目',
         'Missing media files check on the media maintenance screen: setting of how many missing files the stored result lists at most, also the limit of each list of card pictures.'),
        ('missing_media_check_max_reported_unused_setting',
         'Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, luetellaan enintään',
         'Files no recognised reference uses, listed at most',
         '最多列出的没有被任何已识别引用使用的文件数',
         '最多列出嘅冇任何已識別引用用到嘅檔案數目',
         'Missing media files check on the media maintenance screen: setting of how many files no recognised reference uses the stored result lists at most.'),
        -- Summary of the last check (missing_media_check_result_printer.js).
        ('missing_media_check_last_run',
         'Viimeisin tarkistus',
         'Last check',
         '上次检查',
         '上次檢查',
         'Missing media files check on the media maintenance screen: label of the local time the last check finished.'),
        ('missing_media_check_trigger',
         'Käynnistäjä',
         'Started by',
         '启动方式',
         '啟動方式',
         'Missing media files check on the media maintenance screen: label of what started the last check, followed by an administrator, the server start or an update.'),
        ('missing_media_check_trigger_manual',
         'ylläpitäjä',
         'an administrator',
         '管理员',
         '管理員',
         'Missing media files check on the media maintenance screen: shown after Started by when an administrator started the last check.'),
        ('missing_media_check_trigger_startup',
         'palvelimen käynnistys',
         'the server start',
         '服务器启动',
         '伺服器啟動',
         'Missing media files check on the media maintenance screen: shown after Started by when the server start started the last check.'),
        ('missing_media_check_trigger_update',
         'päivitys',
         'an update',
         '更新',
         '更新',
         'Missing media files check on the media maintenance screen: shown after Started by when an application or database update started the last check.'),
        ('missing_media_check_app_version',
         'Sovelluksen versio',
         'Application version',
         '应用程序版本',
         '應用程式版本',
         'Missing media files check on the media maintenance screen: label of the application version the last check ran on.'),
        ('missing_media_check_db_version',
         'Tietokannan versio',
         'Database version',
         '数据库版本',
         '資料庫版本',
         'Missing media files check on the media maintenance screen: label of the database version the last check ran on.'),
        ('missing_media_check_datasets_checked',
         'Tarkistettuja aineistoja',
         'Datasets checked',
         '已检查的数据集',
         '已檢查嘅資料集',
         'Missing media files check on the media maintenance screen: label of how many of the datasets that hold media the last check reached.'),
        ('missing_media_check_rows_checked',
         'Tarkistettuja rivejä',
         'Rows checked',
         '已检查的行数',
         '已檢查嘅行數',
         'Missing media files check on the media maintenance screen: label of how many of the media rows the last check read.'),
        ('missing_media_check_missing_files',
         'Puuttuvia tiedostoja',
         'Missing files',
         '缺失的文件',
         '唔見咗嘅檔案',
         'Missing media files check on the media maintenance screen: label of how many files the last check found missing.'),
        ('missing_media_check_card_pictures_checked',
         'Tarkistettuja korttikuvia',
         'Card pictures checked',
         '已检查的卡片图片',
         '已檢查嘅卡片圖片',
         'Missing media files check on the media maintenance screen: label of how many values of picture fields the last check read, the card picture and every other field a card can show a picture from.'),
        ('missing_media_check_missing_card_pictures',
         'Puuttuvia korttikuvia',
         'Missing card pictures',
         '缺失的卡片图片',
         '唔見咗嘅卡片圖片',
         'Missing media files check on the media maintenance screen: label of how many pictures of picture fields the last check found missing, also the heading of their list in the details.'),
        ('missing_media_check_unused_files',
         'Tiedostoja, joihin mikään tunnistettu viittaus ei osoita',
         'Files no recognised reference uses',
         '没有被任何已识别引用使用的文件',
         '冇任何已識別引用用到嘅檔案',
         'Missing media files check on the media maintenance screen: label of how many stored files no recognised reference uses, that is no media row and no picture field, also the heading of their list.'),
        ('missing_media_check_all_present',
         'Jokainen tarkistettu tiedosto löytyi levyltä.',
         'Every checked file was found on disk.',
         '所有已检查的文件都在磁盘上找到。',
         '所有已檢查嘅檔案都喺磁碟上搵到。',
         'Missing media files check on the media maintenance screen: result when no checked file was missing and every card picture could be checked.'),
        ('missing_media_check_legacy_filename',
         'vanha tiedostonimimuoto',
         'retired filename form',
         '旧的文件名格式',
         '舊嘅檔案名格式',
         'Missing media files check on the media maintenance screen: tag on a missing file whose row stores the retired flat filename form.'),
        ('missing_media_check_unresolved_reference',
         'viittausta ei voi paikantaa levyltä',
         'the reference cannot be placed on disk',
         '无法在磁盘上定位该引用',
         '喺磁碟上定位唔到呢個引用',
         'Missing media files check on the media maintenance screen: tag on a row whose stored reference names no place in storage.'),
        -- Notices about how far the last check reached.
        ('missing_media_check_run_failed',
         'Viimeisin tarkistus epäonnistui ennen kuin se valmistui. Syyt ovat alla olevissa tiedoissa.',
         'The last check failed before it finished. The reasons are in the details below.',
         '上次检查在完成前失败。原因见下方详情。',
         '上次檢查喺完成之前失敗咗。原因喺下面嘅詳情入面。',
         'Missing media files check on the media maintenance screen: notice that the last check failed before it finished, with the reasons in the details.'),
        ('missing_media_check_datasets_exceed_budget',
         'Aineistoja on enemmän kuin työmäärän yläraja sallii rivejä, joten osa aineistoista jäi kokonaan tarkistamatta. Nosta ylärajaa.',
         'There are more datasets than the work limit allows rows, so some datasets were not checked at all. Raise the limit.',
         '数据集数量超过了工作量上限所允许的行数，因此有些数据集完全没有被检查。请提高上限。',
         '資料集嘅數量多過工作量上限容許嘅行數，所以有啲資料集完全冇檢查過。請調高上限。',
         'Missing media files check on the media maintenance screen: notice that there are more datasets than the row limit allows rows, so some datasets were not checked at all.'),
        ('missing_media_check_minimum_not_met',
         'Rivien yläraja oli liian pieni, jotta jokaisesta aineistosta olisi tarkistettu vähimmäismäärä rivejä.',
         'The row limit was too small to check the minimum number of rows in every dataset.',
         '行数上限太小，无法在每个数据集中检查最少行数。',
         '行數上限太細，冇辦法喺每個資料集檢查最少嘅行數。',
         'Missing media files check on the media maintenance screen: notice that the row limit was too small for the minimum number of rows in every dataset.'),
        ('missing_media_check_time_budget_reached',
         'Aikaraja tuli vastaan, joten tarkistus jäi kesken.',
         'The time limit was reached, so the check stopped early.',
         '已达到时间上限，因此检查提前停止。',
         '已經到咗時間上限，所以檢查提早停咗。',
         'Missing media files check on the media maintenance screen: notice that the time limit stopped the last check early.'),
        ('missing_media_check_row_budget_reached',
         'Työmäärän yläraja tuli vastaan: tarkistettiin otos, ei kaikkia rivejä.',
         'The work limit was reached: a sample was checked instead of every row.',
         '已达到工作量上限：检查的是样本，而不是全部行。',
         '已經到咗工作量上限：檢查嘅係樣本，唔係全部行。',
         'Missing media files check on the media maintenance screen: notice that the row limit made the last check read a sample instead of every row.'),
        ('missing_media_check_row_count_estimated',
         'Osa aineistoista on niin suuria, että niiden rivimäärä arvioitiin laskematta, joten niitä ei koskaan ilmoiteta kokonaan tarkistetuiksi.',
         'Some datasets are so large that their rows were estimated instead of counted, so they are never reported as fully checked.',
         '有些数据集太大，其行数是估算而非计数得出的，因此它们永远不会被报告为已完全检查。',
         '有啲資料集太大，佢哋嘅行數係估算出嚟而唔係數出嚟，所以佢哋永遠唔會被報告為完全檢查過。',
         'Missing media files check on the media maintenance screen: notice that some datasets were estimated instead of counted and are therefore never reported as fully checked.'),
        ('missing_media_check_card_pass_incomplete',
         'Korttikuvien tarkistus pysähtyi ennen kuin se oli lukenut jokaisen kuvakentän, joten osa korttikuvista jäi tarkistamatta. Sen pysäytti rivien yläraja, aikaraja tai alla olevissa tiedoissa näkyvä virhe.',
         'The card picture check stopped before it had read every picture field, so some card pictures were not checked. The row limit, the time limit or an error shown in the details below stopped it.',
         '卡片图片检查在读完每个图片字段之前就停止了，因此有些卡片图片没有被检查。导致停止的是行数上限、时间上限或下方详情中显示的错误。',
         '卡片圖片檢查喺讀晒每個圖片欄位之前已經停咗，所以有啲卡片圖片冇檢查到。令佢停低嘅係行數上限、時間上限，或者下面詳情入面顯示嘅錯誤。',
         'Missing media files check on the media maintenance screen: notice that the check of card pictures and the other picture fields stopped before every field was read, because of the row limit, the time limit or an error.'),
        ('missing_media_check_missing_list_truncated',
         'Puuttuvista tiedostoista luetellaan vain ensimmäiset $count.',
         'Only the first $count missing files are listed.',
         '只列出前 $count 个缺失的文件。',
         '只列出頭 $count 個唔見咗嘅檔案。',
         'Missing media files check on the media maintenance screen: notice that only the first $count missing files are listed; $count is a number.'),
        ('missing_media_check_unused_list_truncated',
         'Tiedostoista, joihin mikään tunnistettu viittaus ei osoita, luetellaan vain ensimmäiset $count.',
         'Only the first $count files no recognised reference uses are listed.',
         '只列出前 $count 个没有被任何已识别引用使用的文件。',
         '只列出頭 $count 個冇任何已識別引用用到嘅檔案。',
         'Missing media files check on the media maintenance screen: notice that only the first $count files no recognised reference uses are listed; $count is a number.'),
        ('missing_media_check_unused_walk_incomplete',
         'Aikaraja loppui kesken sellaisten tiedostojen etsinnän, joihin mikään tunnistettu viittaus ei osoita, joten niiden luettelo on vajaa.',
         'The time limit ran out while files no recognised reference uses were being looked for, so their list is incomplete.',
         '查找没有被任何已识别引用使用的文件期间，时间上限已到，因此该列表不完整。',
         '搵緊冇任何已識別引用用到嘅檔案嗰陣，時間上限已經到咗，所以呢份清單唔完整。',
         'Missing media files check on the media maintenance screen: notice that the time limit ran out while files no recognised reference uses were looked for, so their list is incomplete.'),
        ('missing_media_check_unused_withheld_datasets_incomplete',
         'Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, ei etsitty, koska kaikkia aineistoja ei tarkistettu kokonaan. Minkä tahansa aineiston rivi voi osoittaa mihin tahansa kansioon, joten luettelo edellyttää jokaisen aineiston ja jokaisen kuvakentän lukemista kokonaan.',
         'Files no recognised reference uses were not looked for, because not every dataset was checked completely. A row of any dataset can point into any folder, so that list needs every dataset and every picture field read in full.',
         '本次未查找“没有被任何已识别引用使用的文件”，因为并非每个数据集都已完全检查。任何数据集的行都可能指向任何文件夹，因此必须完整读取每个数据集和每个图片字段，才能列出这些文件。',
         '今次冇去搵「冇任何已識別引用用到嘅檔案」，因為唔係每個資料集都完全檢查過。任何資料集嘅行都可能指向任何資料夾，所以一定要完整讀晒每個資料集同每個圖片欄位，先可以列出呢啲檔案。',
         'Missing media files check on the media maintenance screen: notice that files no recognised reference uses were not looked for because not every dataset was checked completely; a row of any dataset can point into any folder.'),
        ('missing_media_check_unused_withheld_card_pass_incomplete',
         'Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, ei etsitty, koska kaikkia kuvakenttiä ei luettu. Minkä tahansa aineiston rivi voi osoittaa mihin tahansa kansioon, joten luettelo edellyttää jokaisen aineiston ja jokaisen kuvakentän lukemista kokonaan.',
         'Files no recognised reference uses were not looked for, because not every picture field was read. A row of any dataset can point into any folder, so that list needs every dataset and every picture field read in full.',
         '本次未查找“没有被任何已识别引用使用的文件”，因为并非每个图片字段都已读取。任何数据集的行都可能指向任何文件夹，因此必须完整读取每个数据集和每个图片字段，才能列出这些文件。',
         '今次冇去搵「冇任何已識別引用用到嘅檔案」，因為唔係每個圖片欄位都讀過。任何資料集嘅行都可能指向任何資料夾，所以一定要完整讀晒每個資料集同每個圖片欄位，先可以列出呢啲檔案。',
         'Missing media files check on the media maintenance screen: notice that files no recognised reference uses were not looked for because the card picture check did not read every picture field; a row of any dataset can point into any folder.'),
        -- The collapsible details of the last check.
        ('missing_media_check_details',
         'Viimeisimmän tarkistuksen tiedot',
         'Details of the last check',
         '上次检查的详情',
         '上次檢查嘅詳情',
         'Missing media files check on the media maintenance screen: title of the collapsible block with the details of the last check.'),
        ('missing_media_check_errors',
         'Virheet',
         'Errors',
         '错误',
         '錯誤',
         'Missing media files check on the media maintenance screen: heading of the list of errors of the last check.'),
        ('missing_media_check_unreached_datasets',
         'Aineistot, joita ei tarkistettu',
         'Datasets that were not checked',
         '未被检查的数据集',
         '冇檢查到嘅資料集',
         'Missing media files check on the media maintenance screen: heading of the list of datasets of which the last check read no row, each with its reason.'),
        ('missing_media_check_unreached_lookup_failed',
         'sen tallennuskansiota ei löytynyt',
         'its storage folder could not be found',
         '找不到其存储文件夹',
         '搵唔到佢嘅儲存資料夾',
         'Missing media files check on the media maintenance screen: reason a dataset was not checked: the storage folder of the dataset could not be found.'),
        ('missing_media_check_unreached_count_failed',
         'sen rivejä ei voitu laskea',
         'its rows could not be counted',
         '无法统计其行数',
         '數唔到佢嘅行數',
         'Missing media files check on the media maintenance screen: reason a dataset was not checked: its rows could not be counted.'),
        ('missing_media_check_unreached_read_failed',
         'sen rivejä ei voitu lukea',
         'its rows could not be read',
         '无法读取其行',
         '讀取唔到佢嘅行',
         'Missing media files check on the media maintenance screen: reason a dataset was not checked: its rows could not be read.'),
        ('missing_media_check_unreached_time_limit',
         'aikaraja loppui ensin',
         'the time limit ran out first',
         '时间上限先到了',
         '時間上限先到咗',
         'Missing media files check on the media maintenance screen: reason a dataset was not checked: the time limit ran out before it.'),
        ('missing_media_check_unreached_no_budget',
         'rivien yläraja ei jättänyt sille rivejä',
         'the row limit left no rows for it',
         '行数上限没有给它留下任何行',
         '行數上限冇留低任何行畀佢',
         'Missing media files check on the media maintenance screen: reason a dataset was not checked: the row limit left no rows for it.'),
        ('missing_media_check_column_dataset',
         'Aineisto',
         'Dataset',
         '数据集',
         '資料集',
         'Missing media files check on the media maintenance screen: column heading of the dataset name in the table of datasets.'),
        ('missing_media_check_column_rows',
         'Rivejä',
         'Rows',
         '行数',
         '行數',
         'Missing media files check on the media maintenance screen: column heading of the number of media rows of a dataset.'),
        ('missing_media_check_column_planned',
         'Suunniteltu',
         'Planned',
         '计划',
         '計劃',
         'Missing media files check on the media maintenance screen: column heading of how many rows of a dataset the check planned to read.'),
        ('missing_media_check_column_checked',
         'Tarkistettu',
         'Checked',
         '已检查',
         '已檢查',
         'Missing media files check on the media maintenance screen: column heading of how many rows of a dataset were actually checked.'),
        ('missing_media_check_column_missing',
         'Puuttuu',
         'Missing',
         '缺失',
         '唔見咗',
         'Missing media files check on the media maintenance screen: column heading of how many files of a dataset were missing.'),
        ('missing_media_check_column_complete',
         'Kokonaan tarkistettu',
         'Fully checked',
         '已完全检查',
         '完全檢查過',
         'Missing media files check on the media maintenance screen: column heading of whether every row of a dataset was checked.'),
        ('missing_media_check_column_unused',
         'Ei tunnistettua viittausta',
         'No recognised reference',
         '无已识别引用',
         '冇已識別引用',
         'Missing media files check on the media maintenance screen: column heading of how many stored files of a dataset no recognised reference uses.'),
        ('missing_media_check_yes',
         'kyllä',
         'yes',
         '是',
         '係',
         'Missing media files check on the media maintenance screen: table value: every row of the dataset was checked.'),
        ('missing_media_check_no',
         'ei',
         'no',
         '否',
         '唔係',
         'Missing media files check on the media maintenance screen: table value: not every row of the dataset was checked.'),
        ('missing_media_check_estimated',
         'arvio',
         'estimated',
         '估算',
         '估算',
         'Missing media files check on the media maintenance screen: tag after a row count that is an estimate.'),
        ('missing_media_check_unused_skipped',
         'ei etsitty',
         'not looked for',
         '未查找',
         '冇搵',
         'Missing media files check on the media maintenance screen: shown in place of the number of files no recognised reference uses, in the summary and in the table of datasets, when they were not looked for because not every row and picture field that could use them was read.'),
        -- The card picture lists of the last check, in the details.
        ('missing_media_check_kept_card_pictures',
         'Toisen rivin kansiosta säilytetyt korttikuvat',
         'Card pictures kept from another row''s folder',
         '来自其他行文件夹并被保留的卡片图片',
         '嚟自其他行資料夾、仍然保留緊嘅卡片圖片',
         'Missing media files check on the media maintenance screen: heading of the list of card pictures whose file lies in the folder of another row and which the card keeps, followed by how many there are.'),
        ('missing_media_check_kept_card_pictures_explanation',
         'Tällainen korttikuva pysyy kortissa silloinkin, kun rivillä on omia kuvia, kunnes ylläpitäjä tyhjentää korttikuvakentän.',
         'Such a card picture stays on its card, even when the row has pictures of its own, until an administrator clears the card picture field.',
         '这类卡片图片会一直留在卡片上，即使该行有自己的图片也是如此，直到管理员清空卡片图片字段为止。',
         '呢類卡片圖片會一直留喺卡片上，就算嗰行有自己嘅圖片都係噉，直到管理員清空卡片圖片欄位為止。',
         'Missing media files check on the media maintenance screen: explanation under the list of card pictures kept from the folder of another row: such a picture stays until an administrator clears the card picture field.'),
        ('missing_media_check_unchecked_card_pictures',
         'Kuvat, joita ei voitu tarkistaa',
         'Pictures that could not be checked',
         '无法检查的图片',
         '檢查唔到嘅圖片',
         'Missing media files check on the media maintenance screen: label of how many pictures of picture fields the last check could not check, because a disk or permission error hid whether their file exists, shown only when there are any; also the heading of their list in the details, followed by how many there are.'),
        ('missing_media_check_unchecked_files',
         'Tiedostot, joita ei voitu tarkistaa',
         'Files that could not be checked',
         '无法检查的文件',
         '檢查唔到嘅檔案',
         'Missing media files check on the media maintenance screen: label of how many gallery and attachment files the last check could not check, because a disk or permission error hid whether the file exists, shown only when there are any; such files are not reported as missing.'),
        ('missing_media_check_unchecked_card_pictures_explanation',
         'Levy- tai käyttöoikeusvirhe esti selvittämästä, onko tiedosto olemassa, joten näitä kuvia ei ilmoiteta puuttuviksi.',
         'A disk or permission error kept the check from telling whether these files exist, so they are not reported as missing.',
         '磁盘或权限错误使检查无法确定这些文件是否存在，因此它们不会被报告为缺失。',
         '磁碟或者權限錯誤令檢查判斷唔到呢啲檔案係咪存在，所以佢哋唔會被報告為唔見咗。',
         'Missing media files check on the media maintenance screen: explanation under the list of pictures that could not be checked: a disk or permission error hid whether the file exists, so it is not reported as missing.'),
        ('missing_media_check_card_list_truncated',
         'Näistä luetellaan vain ensimmäiset $count.',
         'Only the first $count of these are listed.',
         '这里只列出前 $count 项。',
         '呢度只列出頭 $count 項。',
         'Missing media files check on the media maintenance screen: notice under a list of card pictures that only its first $count are listed; $count is a number.'),
        ('missing_media_check_unused_files_note',
         'Pelkästään vapaassa tekstissä, esimerkiksi kuvauksen sisällä, olevaa kuvalinkkiä ei tunnisteta, joten varmista jokainen luettelon tiedosto ennen kuin poistat sen. Tarkistus itse ei poista mitään.',
         'A picture linked only from free text, for example inside a description, is not recognised, so verify each file on this list before you remove it. The check itself never deletes anything.',
         '仅在自由文本中链接的图片，例如描述中的图片，不会被识别，因此在删除此列表中的文件之前，请先逐一核实。检查本身从不删除任何内容。',
         '只喺自由文字入面連結嘅圖片，例如描述入面嘅圖片，唔會被識別，所以刪除呢個清單入面嘅檔案之前，請先逐個核實。檢查本身從來唔會刪除任何嘢。',
         'Missing media files check on the media maintenance screen: note under the list of files no recognised reference uses: a picture linked only from free text is not recognised, so each file is to be verified before removal, and the check deletes nothing.'),
        ('missing_media_check_sampling_seed',
         'Satunnaisuuden siemen',
         'Random seed',
         '随机种子',
         '隨機種子',
         'Missing media files check on the media maintenance screen: label of the number that repeats the random sample of the last check.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, creation_spec
    FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN EXCLUDED.ch ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN EXCLUDED.yue ELSE existing.yue END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL
       OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL
       OR NULLIF(btrim(existing.yue), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- One statement does not read its own writes, so the keys as they read
    -- after it are the rows written above plus the rest of the authored keys.
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en
    FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20261005000005_seed_row_actor_language_keys.sql
-- Seeds Finnish and English creator/owner labels and the seven group A refusals.
-- Bridges the protected columns and commit 3's request errors with translated UI copy.
-- Exists so the browser can explain those refusals and replace machine-generated
-- labels without overwriting a site's wording. K175 limits new copy to fi/en; K211
-- moved this seed from 000002. Empty values alone are filled, except the exact
-- generated search/sort values listed below. The same file serves fresh packages.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en, generated_fi, generated_en, creation_spec) AS (
    VALUES
        ('created_by', 'Luonut', 'Created by', NULL, NULL, 'WL58 creator/owner column interface copy.'),
        ('owner_id', 'Omistaja', 'Owner', NULL, NULL, 'WL58 creator/owner column interface copy.'),
        ('search_for_created_by', 'Etsi luojan mukaan', 'Search by creator', 'Etsi: Created by', 'Search: Created by', 'WL58 creator/owner column interface copy.'),
        ('created_by_asc', 'Luonut, nouseva', 'Created by, ascending', 'Created by, nouseva', 'Created by, ascending', 'WL58 creator/owner column interface copy.'),
        ('created_by_desc', 'Luonut, laskeva', 'Created by, descending', 'Created by, laskeva', 'Created by, descending', 'WL58 creator/owner column interface copy.'),
        ('search_for_owner_id', 'Etsi omistajan mukaan', 'Search by owner', 'Etsi: Owner ID', 'Search: Owner ID', 'WL58 creator/owner column interface copy.'),
        ('owner_id_asc', 'Omistaja, nouseva', 'Owner, ascending', 'Owner ID, nouseva', 'Owner ID, ascending', 'WL58 creator/owner column interface copy.'),
        ('owner_id_desc', 'Omistaja, laskeva', 'Owner, descending', 'Owner ID, laskeva', 'Owner ID, descending', 'WL58 creator/owner column interface copy.'),
        ('error_creator_column_not_editable', 'Rivin luojaa ei voi muuttaa.', 'The row''s creator cannot be changed.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_owner_column_not_editable', 'Rivin omistajaa ei voi muuttaa muokkaamalla. Omistajan siirto tehdään ylläpitotoimintona.', 'The row''s owner cannot be changed by editing. Ownership is transferred as a maintenance action.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_owner_column_protected', 'Luoja- ja omistajasaraketta ei voi poistaa, nimetä uudelleen eikä muuttaa, eikä niiden käyttäjäviittausta voi poistaa tai lisätä toista.', 'The creator and owner columns cannot be deleted, renamed or changed, and their user reference cannot be removed or duplicated.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_reserved_owner_column', 'Sarakenimet created_by ja owner_id on varattu luojalle ja omistajalle. Jätä ne pois tai anna niille kokonaislukutyyppi ilman oletusarvoa; ne voivat viitata vain käyttäjiin.', 'The column names created_by and owner_id are reserved for the creator and owner. Leave them out, or give them an integer type without a default value; they can only reference users.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_trigger_actor_column', 'Automaatio ei voi asettaa riville luojaa eikä omistajaa; ne tulevat aina pyynnön tekijästä.', 'An automation cannot set a row''s creator or owner; they always come from the person making the request.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_row_owner_setting_fixed', 'Tämän aineiston omistajasarake on kiinnitetty, eikä sitä voi vaihtaa asetuksista.', 'This dataset''s owner column is fixed and cannot be changed in the settings.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_internal_table_not_droppable', 'Tämä on sovelluksen sisäinen taulu, eikä sitä voi poistaa.', 'This is an internal application table and cannot be deleted.', NULL, NULL, '400 refusal reason shown by the request pipeline.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, creation_spec FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL OR existing.fi =
                       (SELECT generated_fi FROM authored_keys WHERE lang_key = EXCLUDED.lang_key)
                  THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL OR existing.en =
                       (SELECT generated_en FROM authored_keys WHERE lang_key = EXCLUDED.lang_key)
                  THEN EXCLUDED.en ELSE existing.en END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
       OR (existing.fi = (SELECT generated_fi FROM authored_keys WHERE lang_key = EXCLUDED.lang_key) AND existing.fi IS DISTINCT FROM EXCLUDED.fi)
       OR (existing.en = (SELECT generated_en FROM authored_keys WHERE lang_key = EXCLUDED.lang_key) AND existing.en IS DISTINCT FROM EXCLUDED.en)
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- A statement sees the written rows through RETURNING, not a table re-read.
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL
    OR (existing.translation IS DISTINCT FROM EXCLUDED.translation AND existing.translation = (
        SELECT CASE existing.language_code WHEN 'fi' THEN authored.generated_fi ELSE authored.generated_en END
          FROM authored_keys AS authored JOIN served_keys AS served USING (lang_key)
         WHERE served.id = existing.lang_key_id));
-- Seeds Finnish and English account-name copy (WL132, K175/K203/K205).
-- Connects the account rule, sign-in/profile flows and settings with reviewed translations.
-- Existing reviewed wording is preserved in both translation stores.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_admin_display_name_equals_login_name', 'Ylläpitäjän näyttönimen on oltava eri kuin kirjautumisnimi.', 'An administrator’s display name must differ from the login name.'),
        ('error_user_display_name_equals_login_name', 'Tällä sivustolla näyttönimen on oltava eri kuin kirjautumisnimi.', 'On this site the display name must differ from the login name.'),
        ('username_exists', 'Näyttönimi on jo käytössä.', 'The display name is already in use.'),
        ('error_identity_edit_requires_administrator', 'Vain ylläpitäjä voi muokata käyttäjä- ja oikeustietoja tässä editorissa.', 'Only an administrator may edit account and permission data in this editor.'),
        ('login_name', 'Kirjautumisnimi', 'Login name'),
        ('display_name', 'Näyttönimi', 'Display name'),
        ('login_name_help', 'Kirjautumisnimeä käytetään vain kirjautumiseen. Muut eivät näe sitä.', 'The login name is used only to sign in. Other people cannot see it.'),
        ('display_name_help', 'Näyttönimi näkyy muille käyttäjille.', 'The display name is visible to other people.'),
        ('login_name_exists', 'Kirjautumisnimi on jo käytössä.', 'The login name is already in use.'),
        ('login_name_invalid', 'Kirjautumisnimen on alettava kirjaimella tai numerolla. Käytä vain kirjaimia, numeroita, alaviivaa, pistettä tai yhdysmerkkiä.', 'Start the login name with a letter or number. Use only letters, numbers, underscores, dots or hyphens.'),
        ('login_name_reserved', 'Tämä kirjautumisnimi on varattu järjestelmälle.', 'This login name is reserved for the system.'),
        ('login_name_fixed', 'Tämän ohjelmatilin kirjautumisnimeä ei voi vaihtaa.', 'This program account has a fixed login name.'),
        ('change_login_name', 'Vaihda kirjautumisnimi', 'Change login name'),
        ('new_login_name', 'Uusi kirjautumisnimi', 'New login name'),
        ('current_password', 'Nykyinen salasana', 'Current password'),
        ('current_password_required', 'Anna nykyinen salasana.', 'Enter your current password.'),
        ('profile_password_rate_limited', 'Nykyistä salasanaa on yritetty väärin kolme kertaa viidessä minuutissa. Odota ennen uutta yritystä.', 'The current password was entered incorrectly three times in five minutes. Wait before trying again.'),
        ('current_password_incorrect', 'Nykyinen salasana on väärä.', 'The current password is incorrect.'),
        ('login_name_change_help', 'Anna nykyinen salasana. Muut kirjautumisesi päättyvät nimen vaihdon jälkeen.', 'Enter your current password. Your other sign-ins end after the name changes.'),
        ('login_name_changed', 'Kirjautumisnimi vaihdettu.', 'Login name changed.'),
        ('login_name_change_use_profile', 'Vaihda oma kirjautumisnimesi profiilisivulla nykyisellä salasanallasi.', 'Change your own login name in your profile using your current password.'),
        ('login_name_change_failed', 'Kirjautumisnimeä ei voitu vaihtaa. Yritä uudelleen.', 'The login name could not be changed. Try again.'),
        ('login_name_change_rate_limited', 'Voit yrittää kirjautumisnimen vaihtoa kolme kertaa viidessä minuutissa. Odota ennen uutta yritystä.', 'You may try to change the login name three times in five minutes. Wait before trying again.'),
        ('login_name_change_notice_subject', 'Kirjautumisnimesi on vaihdettu', 'Your login name has changed'),
        ('login_name_change_notice_body', 'Tilisi kirjautumisnimi on vaihdettu. Jos et tehnyt muutosta, ota yhteyttä sivuston ylläpitäjään.', 'Your account’s login name has changed. If you did not make this change, contact the site administrator.'),
        ('notice_email_sent', 'Ilmoitus lähetettiin sähköpostiisi.', 'A notice was sent to your email.'),
        ('notice_email_failed', 'Muutos tallennettiin, mutta sähköpostia ei voitu lähettää.', 'The change was saved, but the email could not be sent.'),
        ('notice_email_not_configured', 'Muutos tallennettiin. Sähköposti-ilmoitus ei ole käytössä.', 'The change was saved. Email notices are not configured.'),
        ('registration_welcome_subject', 'Tervetuloa', 'Welcome'),
        ('registration_welcome_body', 'Tilisi on luotu. Kirjautumisnimesi:', 'Your account has been created. Your login name:'),
        ('registration_email_sent', 'Tili luotiin ja tervetuloviesti lähetettiin sähköpostiisi.', 'The account was created and a welcome email was sent.'),
        ('registration_email_failed', 'Tili luotiin, mutta tervetuloviestiä ei voitu lähettää.', 'The account was created, but the welcome email could not be sent.'),
        ('registration_email_not_configured', 'Tili luotiin ilman tervetuloviestiä.', 'The account was created without a welcome email.'),
        ('login_name_or_email', 'Kirjautumisnimi tai sähköposti', 'Login name or email'),
        ('password_reset_send_attempted', 'Jos tili löytyy, yritämme lähettää palautuskoodin. Voit pyytää uuden koodin.', 'If the account exists, we will try to send a recovery code. You can request a new code.'),
        ('password_reset_login_name', 'Tilisi kirjautumisnimi: $login_name', 'Your account’s login name: $login_name'),
        ('sign_out_other_devices', 'Kirjaudu ulos muilta laitteilta', 'Sign out other devices'),
        ('sign_out_other_devices_help', 'Anna nykyinen salasana. Tämä kirjautuminen jatkuu, ja muut laitteet kirjautuvat ulos seuraavalla pyynnöllä.', 'Enter your current password. This sign-in continues; other devices sign out on their next request.'),
        ('other_devices_signed_out', 'Muut kirjautumisesi on päätetty. Tämä kirjautuminen jatkuu.', 'Your other sign-ins have ended. This sign-in continues.'),
        ('sign_out_other_devices_failed', 'Muita kirjautumisia ei voitu päättää. Yritä uudelleen.', 'Your other sign-ins could not be ended. Try again.'),
        ('display_name_may_equal_login_name', 'Näyttönimi saa olla sama kuin kirjautumisnimi', 'Display name may equal login name'),
        ('display_name_may_equal_login_name_help', 'Koskee tavallisia käyttäjiä. Ylläpitäjän nimet ovat aina eri. Kun asetus poistetaan käytöstä, olemassa olevat samat nimet säilyvät, kunnes käyttäjä muuttaa nimeään.', 'Applies to ordinary users. Administrators always use different names. Turning this off preserves existing equal names until a user changes a name.'),
        ('account_names_may_be_same', 'Saa olla sama', 'May be the same'),
        ('first_run_name_choice_invalid', 'Valitse, saavatko tavallisen käyttäjän nimet olla samat.', 'Choose whether ordinary users may use equal names.'),
        ('account_names_must_differ', 'On oltava eri', 'Must be different')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL132 account name copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000022_seed_favorites_language_keys.sql
-- Seeds Finnish and English personal favorite actions and labels.
-- Connects the administrator quick list and tool stars to translated copy.
-- Exists to keep favorites multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('favorites_heading', 'Suosikit', 'Favorites'),
        ('favorite_add', 'Lisää suosikkeihin', 'Add to favorites'),
        ('favorite_remove', 'Poista suosikeista', 'Remove from favorites'),
        ('favorite_save_failed', 'Suosikkia ei voitu tallentaa. Yritä uudelleen.', 'The favorite could not be saved. Try again.'),
        ('system_favorites', 'Suosikit', 'Favorites')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL142 personal favorites copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000033_seed_front_page_language_keys.sql
-- Seeds Finnish and English front page actions and labels.
-- Connects the front page and its administrator editor to translated copy.
-- Exists to keep the front page multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('front_page', 'Etusivu', 'Home'),
        ('front_page_settings', 'Etusivun asetukset', 'Home settings'),
        ('front_page_common', 'Yhteinen etusivu', 'Common home'),
        ('front_page_user_scope', 'Käyttäjän etusivu', 'User home'),
        ('front_page_inherits', 'Käyttää yhteistä etusivua', 'Inherits common home'),
        ('front_page_reset', 'Palauta yhteiseen', 'Reset to common'),
        ('front_page_copy_common', 'Kopioi yhteinen', 'Copy common'),
        ('front_page_add_block', 'Lisää lohko', 'Add block'),
        ('front_page_result_limit', 'Rivien määrä', 'Row limit'),
        ('front_page_show_all', 'Näytä kaikki', 'Show all'),
        ('front_page_no_results', 'Ei tuloksia', 'No results'),
        ('front_page_load_failed', 'Etusivua ei voitu ladata. Yritä uudelleen.', 'Home could not be loaded. Try again.'),
        ('front_page_background', 'Taustakuva', 'Background image'),
        ('front_page_remove_background', 'Poista taustakuva', 'Remove background'),
        ('front_page_default_not_saved', 'Oletuslista, ei tallennettu', 'Default list, not saved'),
        ('front_page_hidden_for_user', 'Käyttäjä ei voi lukea tätä aineistoa', 'This user cannot read this dataset'),
        ('front_page_save_conflict', 'Etusivu muuttui. Lataa uudelleen ennen tallennusta.', 'Home changed. Reload before saving.'),
        ('front_page_enabled', 'Erillinen etusivu', 'Separate home page'),
        ('front_page_button_shows_site_name', 'Sivuston nimi etusivupainikkeessa', 'Site name on the Home button'),
        ('front_page_open', 'Avaa etusivu', 'Open Home'),
        ('front_page_reload', 'Lataa uudelleen', 'Reload'),
        ('front_page_loaded', 'Etusivun asetukset ladattu.', 'Home settings loaded.'),
        ('front_page_move_up', 'Siirrä ylös', 'Move up'),
        ('front_page_move_down', 'Siirrä alas', 'Move down'),
        ('front_page_remove_block', 'Poista lohko', 'Remove block'),
        ('front_page_blocks_help', 'Enintään 20 lohkoa. Jokaisessa voi näyttää 1–20 uusinta riviä. Tyhjä lista palauttaa oletuksen.', 'Up to 20 blocks, each showing 1–20 newest rows. An empty list restores the default.'),
        ('front_page_find_user', 'Etsi käyttäjä näyttönimellä', 'Find a user by display name'),
        ('front_page_choose_user', 'Valitse käyttäjä etusivun valikosta.', 'Choose a user from the home scope menu.'),
        ('front_page_no_users', 'Näyttönimellä ei löytynyt käyttäjiä.', 'No users found by that display name.'),
        ('front_page_user_search_failed', 'Käyttäjiä ei voitu hakea. Yritä uudelleen.', 'User search failed. Try again.'),
        ('front_page_limit_invalid', 'Rivien määrän on oltava kokonaisluku 1–20.', 'The row limit must be a whole number from 1 to 20.'),
        ('front_page_blocks_invalid', 'Valitse enintään 20 eri aineistoa, joissa on uusimmat rivit -lajittelu.', 'Choose up to 20 different datasets that support newest-row sorting.'),
        ('front_page_save_failed', 'Etusivun asetuksia ei voitu tallentaa. Muutokset ovat edelleen lomakkeessa.', 'Home settings could not be saved. Your changes are still in the form.'),
        ('front_page_refresh_failed', 'Muutokset tallennettiin, mutta asetuksia ei voitu ladata. Lataa uudelleen ennen seuraavaa tallennusta.', 'Changes were saved, but settings could not be loaded. Reload before saving again.'),
        ('front_page_discard_changes', 'Hylätäänkö tallentamattomat muutokset?', 'Discard unsaved changes?'),
        ('front_page_discard', 'Hylkää muutokset', 'Discard changes'),
        ('front_page_upload_background', 'Valitse taustakuvatiedosto', 'Choose a background image file'),
        ('front_page_background_help', 'Sivuston yhteinen taustakuva. PNG, JPEG tai WebP, alle 10 Mt. Valitse kuvan kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP, under 10 MB. Set its focal point as percentages.'),
        ('front_page_background_picker_help', 'Valitse kuva sivuston yhteiseksi etusivun taustaksi liittämällä kuvapalvelun kuvasivun osoite.', 'Paste a provider photo-page URL to choose a shared Home background for the site.'),
        ('front_page_background_error', 'Tallennettu taustakuva-asetus on virheellinen. Vaihda kuva tai poista se.', 'The saved background setting is invalid. Replace or remove it.'),
        ('front_page_background_invalid', 'Valitse PNG-, JPEG- tai WebP-kuva, jonka koko on alle 10 Mt.', 'Choose a PNG, JPEG or WebP image under 10 MB.'),
        ('front_page_background_save_failed', 'Taustakuvaa ei voitu tallentaa. Tarkista kuva ja yritä uudelleen.', 'The background could not be saved. Check the image and try again.'),
        ('front_page_focal_x', 'Kohdistuspiste vasemmalta (%)', 'Focal point from the left (%)'),
        ('front_page_focal_y', 'Kohdistuspiste ylhäältä (%)', 'Focal point from the top (%)'),
        ('front_page_focal_invalid', 'Kohdistuspisteen arvojen on oltava 0–100 prosenttia.', 'Focal point values must be from 0 to 100 percent.'),
        ('system_front_page_blocks', 'Etusivun lohkot', 'Home blocks')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL143 front page copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000036_seed_row_group_classification_language_keys.sql
-- Seeds Finnish and English classification labels and the future administrator window name.
-- Connects the category ribbon and classification types to translated copy.
-- Exists to keep classifications multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_categories', 'Kategoriat', 'Categories'),
        ('row_group_class_single', 'Luokka – yksi arvo', 'Class – one value'),
        ('row_group_category_multiple', 'Kategoria – useita arvoja', 'Category – several values'),
        ('row_group_classes_and_categories', 'Luokat ja kategoriat', 'Classes and categories'),
        ('system_row_group_classifications', 'Luokittelut', 'Classifications')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL103 classification copy; S3 window texts are seeded separately.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000038_seed_row_group_window_language_keys.sql
-- Seeds Finnish and English administrator classification-window copy.
-- Connects names, assignments and recoverable editor failures to translated copy.
-- Exists to keep classifications multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_window_name_fi', 'Nimi suomeksi', 'Finnish name'),
        ('row_group_window_name_en', 'Nimi englanniksi', 'English name'),
        ('row_group_window_slug', 'Pysyvä tunniste', 'Permanent identifier'),
        ('row_group_window_type', 'Tyyppi', 'Type'),
        ('row_group_window_order', 'Järjestys', 'Order'),
        ('row_group_window_enabled', 'Käytössä', 'Enabled'),
        ('row_group_window_edit_names', 'Muokkaa nimeä ja asetuksia', 'Edit name and settings'),
        ('row_group_window_new_heading', 'Uusi luokittelu', 'New heading'),
        ('row_group_window_new_value', 'Uusi arvo', 'New value'),
        ('row_group_window_without_heading', 'Ilman luokittelua', 'Without a heading'),
        ('row_group_window_names_only', 'Valitse rivejä kohdistamista varten. Voit nyt muokata nimiä ja asetuksia.', 'Select rows to assign values. You can currently edit names and settings.'),
        ('row_group_window_selected_rows', 'Kohdista arvot valituille riveille', 'Assign values to the selected rows'),
        ('row_group_window_mixed', 'Osalla riveistä', 'On some rows'),
        ('row_group_window_clear_assignment', 'Tyhjennä tämän luokan arvot valituilta riveiltä', 'Clear this class on the selected rows'),
        ('row_group_window_maximum_rows', 'Valitse enintään 200 riviä kerralla.', 'Select at most 200 rows at a time.'),
        ('row_group_window_invalid_response', 'Palvelimen vastaus oli puutteellinen. Luokituksia ei voitu vahvistaa.', 'The server response was incomplete. Classifications could not be verified.'),
        ('row_group_window_load_failed', 'Luokkia ja kategorioita ei voitu ladata. Sulje ikkuna ja yritä uudelleen.', 'Classes and categories could not be loaded. Close the window and try again.'),
        ('row_group_window_save_failed', 'Tallennus ei onnistunut. Muokkaukset säilyivät; tarkista nimet ja tunnisteet ja yritä uudelleen. Jo tallennetut muutokset jäävät voimaan.', 'Saving failed. Your draft was kept; check names and identifiers and try again. Changes already saved remain in effect.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL103 S3 administrator classification window; Finnish and English copy (K175).' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000039_seed_row_group_panel_language_keys.sql
-- Seeds Finnish and English category-panel guidance and shared selected-tag actions.
-- Connects category disclosures and zero-result recovery to served translations.
-- Preserves reviewed site copy; this migration is source only until an authorized upgrade.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_categories_hint', 'Saman otsikon valinnat laajentavat hakua, eri otsikoiden valinnat rajaavat sitä.', 'Choices under one heading widen the search; choices under different headings narrow it.'),
        ('row_group_match_any_hint', 'Näytetään rivit, joissa on jokin valituista arvoista.', 'Shows rows that have any of the selected values.'),
        ('row_group_single_value_hint', 'Rivillä on tässä yksi arvo. Voit valita hakuun useita arvoja.', 'A row has one value here. You can select several values to search.'),
        ('row_group_selected_count', 'valittu', 'selected'),
        ('row_group_no_name_matches', 'Ei osumia.', 'No matches.'),
        ('row_group_selection_limit', 'Voit valita enintään 20 kategoria-arvoa. Poista valinta ennen uuden lisäämistä.', 'You can select up to 20 category values. Remove a selection before adding another.'),
        ('row_group_no_results_hint', 'Valinnoillasi ei löytynyt tuloksia. Poista jokin valinta tai tyhjennä kaikki.', 'No results match your selections. Remove a filter or clear all.'),
        ('selected_filters', 'Valitut:', 'Selected:'),
        ('clear_all', 'Tyhjennä kaikki', 'Clear all')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL103 S1/S2 category panel and selected filters copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000051_seed_relation_reference_language_key.sql
-- Seeds the missing stored-reference refusal in Finnish and English.
-- Connects transactional relation readers with the request pipeline's reason key.
-- Exists so a refused save is explained in the reader's language. As with WL58,
-- existing authored translations stay; empty values alone receive the new copy.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    VALUES ('error_relation_reference_missing',
            'Viitatulta riviltä puuttuu liitoksen tarvitsema arvo. Mitään rivejä ei tallennettu.',
            'A referenced row is missing the value needed for this link. No rows were saved.',
            'WL144 missing stored-reference refusal.')
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN nullif(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN nullif(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
     WHERE nullif(btrim(existing.fi), '') IS NULL OR nullif(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT id, lang_key, fi, en FROM public.system_lang_keys
     WHERE lang_key = 'error_relation_reference_missing'
       AND NOT EXISTS (SELECT 1 FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE nullif(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE nullif(btrim(existing.translation), '') IS NULL;
-- 20261005000055_seed_setting_check_language_keys.sql
-- Seeds Finnish and English setting refusals and seven duration unit names.
-- Connects shared settings checks and the duration input to translated copy.
-- Exists to explain refused saves without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_setting_duration_invalid', 'Anna asetukselle sallittu aikayksikkö ja sen rajojen sisällä oleva kokonaisluku.', 'Enter an allowed time unit and a whole number within its limits.'),
        ('duration_unit_seconds', 'sekuntia', 'seconds'),
        ('duration_unit_minutes', 'minuuttia', 'minutes'),
        ('duration_unit_hours', 'tuntia', 'hours'),
        ('duration_unit_days', 'päivää', 'days'),
        ('duration_unit_weeks', 'viikkoa', 'weeks'),
        ('duration_unit_months', 'kuukautta', 'months'),
        ('duration_unit_years', 'vuotta', 'years')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL119 setting validation and duration input copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000060_seed_shell_boot_recovery_language_keys.sql
-- Seeds Finnish and English document-loading and recovery text.
-- Connects server-rendered notices with the shared served translation model.
-- Fills only empty values so site-owned wording survives upgrades and retries.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('shell_boot_loading', 'Sivua ladataan…', 'Loading the page…'),
        ('shell_boot_failed_title', 'Sivu ei latautunut.', 'The page could not load.'),
        ('shell_boot_failed_message', 'Kokeile ladata sivu uudelleen.', 'Try reloading the page.'),
        ('shell_boot_reload', 'Lataa sivu uudelleen', 'Reload page'),
        ('shell_boot_javascript_required', 'Sovelluksen käyttö vaatii JavaScriptin. Ota JavaScript käyttöön ja lataa sivu uudelleen.', 'JavaScript is required to use this application. Enable JavaScript and reload the page.'),
        ('shell_boot_browser_unsupported', 'Tätä selainta ei tueta. Avaa sivu ajan tasalla olevalla selaimella.', 'This browser is not supported. Open the page in an up-to-date browser.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL145 standalone shell boot recovery copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
-- 20261005000075_seed_runtime_grant_refusal_language_keys.sql
-- Seeds Finnish and English runtime-grant refusals.
-- Connects transactional permission refusals to translated interface copy.
-- Exists to explain refused saves without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_runtime_grant_policy_blocked', 'Oikeuksia ei voitu tallentaa, koska aineiston tai sen riippuvuuksien oikeussäännöt on tarkistettava.', 'Permissions could not be saved because a dataset or its dependencies need a permission-policy review.'),
        ('error_runtime_grant_privilege_managed', 'Muuta tämän sovelluksen tietokantatilin oikeuksia ryhmien ja aineistojen oikeusasetuksista.', 'Change this runtime role''s permissions through group and dataset rights.'),
        ('error_trigger_source_dataset_missing', 'Automaation lähdeaineistoa ei ole olemassa.', 'The automation source dataset does not exist.'),
        ('error_trigger_target_dataset_missing', 'Automaation kohdeaineistoa ei ole olemassa.', 'The automation target dataset does not exist.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL124 runtime grant refusal copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
-- Normalized translations require nonblank text. Missing copy is represented
-- by an absent row, never an empty value; preserve every existing served row.
INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
-- 20261005000086_seed_front_page_hero_language_keys.sql
-- Seeds Finnish and English Home hero settings and video upload guidance.
-- Connects fixed language keys to the shared editor and public Home hero.
-- Replaces only untouched earlier guidance and preserves reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en, old_fi, old_en) AS (
    VALUES
        ('site_front_page_title', '', '', NULL::text, NULL::text),
        ('site_front_page_slogan', '', '', NULL::text, NULL::text),
        ('front_page_show_blocks', 'Näytä etusivun lohkot', 'Show Home boxes', NULL::text, NULL::text),
        ('front_page_hero', 'Etusivun otsikko ja iskulause', 'Home title and slogan', NULL::text, NULL::text),
        ('front_page_hero_help', 'Tyhjä otsikko käyttää sivuston nimeä. Tyhjää iskulausetta ei näytetä.', 'An empty title uses the site name. An empty slogan is hidden.', NULL::text, NULL::text),
        ('error_setting_boolean_invalid', 'Valitse asetukselle totuusarvo: käytössä tai poissa käytöstä.', 'Choose a boolean setting: enabled or disabled.', NULL::text, NULL::text),
        ('front_page_background', 'Taustakuva tai video', 'Background image or video', 'Taustakuva', 'Background image'),
        ('front_page_remove_background', 'Poista tausta', 'Remove background', 'Poista taustakuva', 'Remove background'),
        ('front_page_upload_background', 'Valitse taustakuva tai video', 'Choose a background image or video', 'Valitse taustakuvatiedosto', 'Choose a background image file'),
        ('front_page_background_help', 'Sivuston yhteinen tausta. PNG, JPEG tai WebP, alle 10 Mt; MP4 tai WebM, alle 50 Mt. Valitse kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP under 10 MiB; MP4 or WebM under 50 MiB. Set its focal point as percentages.', 'Sivuston yhteinen taustakuva. PNG, JPEG tai WebP, alle 10 Mt. Valitse kuvan kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP, under 10 MB. Set its focal point as percentages.'),
        ('front_page_background_invalid', 'Valitse PNG-, JPEG- tai WebP-kuva (alle 10 Mt) tai MP4- tai WebM-video (alle 50 Mt).', 'Choose a PNG, JPEG or WebP image (under 10 MiB) or an MP4 or WebM video (under 50 MiB).', 'Valitse PNG-, JPEG- tai WebP-kuva, jonka koko on alle 10 Mt.', 'Choose a PNG, JPEG or WebP image under 10 MB.'),
        ('front_page_background_error', 'Tallennettu tausta-asetus on virheellinen. Vaihda tausta tai poista se.', 'The saved background setting is invalid. Replace or remove it.', 'Tallennettu taustakuva-asetus on virheellinen. Vaihda kuva tai poista se.', 'The saved background setting is invalid. Replace or remove it.'),
        ('front_page_background_save_failed', 'Taustaa ei voitu tallentaa. Tarkista tiedosto ja yritä uudelleen.', 'The background could not be saved. Check the file and try again.', 'Taustakuvaa ei voitu tallentaa. Tarkista kuva ja yritä uudelleen.', 'The background could not be saved. Check the image and try again.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL156 Home hero and presentation copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key)
        OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key)
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 JOIN authored_keys authored USING (lang_key)
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL
    OR existing.translation = (SELECT CASE existing.language_code WHEN 'fi' THEN old_fi ELSE old_en END
        FROM authored_keys WHERE lang_key = (SELECT lang_key FROM public.system_lang_keys WHERE id=existing.lang_key_id));

-- Empty hero copy is intentional; register its use so catalog cleanup retains it.
INSERT INTO public.system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
SELECT id,'front_page_hero',lang_key,'front_page_hero',CURRENT_DATE,
       'Home hero: an empty title uses the site name; an empty slogan is hidden.'
FROM public.system_lang_keys WHERE lang_key IN ('site_front_page_title','site_front_page_slogan')
ON CONFLICT(lang_key_id,source_type,source_high) DO NOTHING;
-- 20261007000001_seed_row_group_match_mode_language_keys.sql
-- Seeds category match controls and guidance for readable zero-hit vocabulary.
-- Connects ANY/ALL filtering and typed API refusals to Finnish/English translations.
-- Preserves reviewed copy; the new general hint has its own key for the changed meaning.
-- VERSION_DB: 9.10.1
-- VERSION_DB_OWNER: 20261007000099_record_database_release_9_10_1.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_match_mode', 'Hakutapa', 'Match mode'),
        ('row_group_match_any', 'Vähintään yksi', 'At least one'),
        ('row_group_match_all', 'Kaikki valitut', 'All selected'),
        ('row_group_match_all_hint', 'Näytetään rivit, joissa on kaikki valitut arvot. Luvut kertovat osumat, kun arvo lisätään valintoihin.', 'Shows rows that have all selected values. Counts show matches when the value is added to the selection.'),
        ('row_group_categories_modes_hint', 'Valitse otsikosta vähintään yksi tai kaikki valitut arvot. Eri otsikoiden valinnat rajaavat hakua yhdessä. Harmaalla näkyvät arvot voi valita, vaikka osumia ei nyt ole.', 'Match at least one or all selected values under a heading. Selections under different headings narrow the search together. Dimmed values remain selectable when they have no current matches.'),
        ('row_group_invalid_filters', 'Kategoriavalinnat eivät kelpaa.', 'Invalid category filters')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL103 slice 3a.1 category match controls and scoped zero-hit guidance.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
-- 20261007000002_seed_multiselect_language_keys.sql
-- Seeds shared multiselect summaries, search recovery and clear-action copy.
-- Connects the column filter's reusable dropdown to Finnish and English translations.
-- Inserts missing copy only so upgrades and fresh bootstraps preserve reviewed wording.
-- VERSION_DB: 9.10.1
-- VERSION_DB_OWNER: 20261007000099_record_database_release_9_10_1.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('selected', 'valittu', 'selected'),
        ('excluded', 'poissuljettu', 'excluded'),
        ('no_results', 'Ei tuloksia', 'No results'),
        ('clear_selection', 'Tyhjennä valinta', 'Clear selection')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL103 slice 3b shared multiselect copy.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
-- 20261009000001_seed_front_page_description_language_key.sql
-- Seeds separate Home description and three-field editor guidance in Finnish and English.
-- Connects upgrades and fresh installations to the canonical translation stores.
-- Preserves reviewed site copy and registers intentional empty description text.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

WITH authored_keys(lang_key, fi, en, old_fi, old_en) AS (
    VALUES
        ('site_front_page_description', '', '', NULL::text, NULL::text),
        ('slogan', 'Iskulause', 'Slogan', NULL::text, NULL::text),
        ('front_page_hero', 'Etusivun otsikko, iskulause ja kuvaus', 'Home title, slogan and description', 'Etusivun otsikko ja iskulause', 'Home title and slogan'),
        ('front_page_hero_help', 'Tyhjä otsikko käyttää sivuston nimeä. Iskulause ja kuvaus voivat olla tyhjiä, monirivisiä tai käytössä yhdessä. Tyhjä teksti piilotetaan.', 'An empty title uses the site name. Slogan and description may be empty, multi-line or used together. Empty text is hidden.', 'Tyhjä otsikko käyttää sivuston nimeä. Tyhjää iskulausetta ei näytetä.', 'An empty title uses the site name. An empty slogan is hidden.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'Home title, slogan and description copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key)
        OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key)
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 JOIN authored_keys authored USING (lang_key)
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL
    OR existing.translation = (SELECT CASE existing.language_code WHEN 'fi' THEN old_fi ELSE old_en END
        FROM authored_keys WHERE lang_key = (SELECT lang_key FROM public.system_lang_keys WHERE id=existing.lang_key_id));

-- Intentional empty text must survive language-catalog cleanup.
INSERT INTO public.system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
SELECT id,'front_page_hero',lang_key,'front_page_hero',CURRENT_DATE,
       'Home description: normal-size text after the title and larger slogan. Blank lines separate paragraphs; single line breaks remain. May be empty or used independently of the slogan.'
FROM public.system_lang_keys WHERE lang_key='site_front_page_description'
ON CONFLICT(lang_key_id,source_type,source_high) DO NOTHING;
-- 20261009000002_seed_admin_version_info_language_keys.sql
-- Seeds truthful release-check actions, timing and running-database requirement copy.
-- Connects upgrades and fresh installations to the administrator's shared language keys.
-- Inserts missing Finnish/English copy only, preserving reviewed site translations.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('admin_version_info_check_releases', 'Tarkista julkaisut', 'Check releases'),
        ('admin_version_info_required_by_running_app', 'Käynnissä olevan sovelluksen vaatima', 'Required by the running application'),
        ('admin_version_info_last_attempt', 'Viimeisin tarkistusyritys', 'Last check attempt'),
        ('admin_version_info_checked_successfully', 'Tarkistettu onnistuneesti', 'Checked successfully'),
        ('admin_version_info_check_allowed_at', 'Julkaisujen tarkistus sallittu', 'Release check available at'),
        ('admin_version_info_site_operator_updates', 'Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella.', 'Updates are currently performed by the site operator.')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL157 administrator release-check copy.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
-- 20260927000001_add_absolute_sign_in_limit.sql
-- Adds the setting that decides how long one sign-in may last at the very most.
-- Bridges the administrator's settings view and the deadline stamped into every
-- new sign-in, which the shared authentication boundary then enforces.
-- Exists because a sign-in had no ceiling at all: it was renewed on every visit,
-- so one used daily never ended, and a cookie copied elsewhere could be signed
-- afresh through any of the routes that write a session -- several of them
-- reachable without signing in -- and so outlive the record of its own sign-out.
-- A deadline stamped once at sign-in cannot be pushed forward by any of them.
--
-- The three fields are one row rather than three because none of them means
-- anything alone: an amount without a unit is not a length of time, and neither
-- matters while the limit is switched off. One row also changes as one act.
-- A site that already has the setting keeps its own value; only its description
-- is refreshed. The public bootstrap seeds the same row, so a new site is born
-- with it.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

INSERT INTO public.system_config (key, json_value, text_value, value_type, creation_spec)
SELECT
    'absolute_sign_in_limit',
    -- Thirty days, chosen by the owner: long enough that an ordinary person
    -- meets it about once a month, short enough that a stolen cookie cannot be
    -- kept alive indefinitely. Changing it here governs sign-ins made after the
    -- change; a deadline already given to a sign-in is never revised, because a
    -- setting that could revise it would be a way to extend a sign-in.
    jsonb_build_object(
        'limit_enabled', TRUE,
        'limit_unit', 'days',
        'limit_amount', 30
    ),
    NULL,
    -- 5 is the JSON editor in the settings view. The text editor would let a
    -- malformed policy be saved as a string.
    5,
    'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_config WHERE key = 'absolute_sign_in_limit'
);

-- A site that already had the row keeps its policy and gets the current wording.
UPDATE public.system_config
   SET creation_spec = 'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.',
       value_type = 5,
       updated = now()
 WHERE key = 'absolute_sign_in_limit'
   AND (creation_spec IS DISTINCT FROM 'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.'
        OR value_type IS DISTINCT FROM 5);

-- A sign-in with no ceiling still has to be refusable after it is signed out, and
-- there is no honest date on which that refusal may be dropped. The column takes
-- PostgreSQL's infinity for exactly that case; every finite record is unaffected.
COMMENT ON COLUMN public.system_revoked_sign_ins.expires_at IS
    'When this record stops refusing; the row is removed by the next sign-out. It is the deadline the sign-in was given, so the record lasts exactly as long as that sign-in could still be admitted -- not as long as its cookie stays readable, which nothing here promises -- and infinity when that sign-in was given no deadline at all.';
-- 20260929000004_add_missing_media_check_setting.sql
-- Adds the settings row of the missing media files check, or brings an existing row
-- to its second shape.
-- Bridges the settings view with the check, which reads the row through
-- missing_media_check.LoadSettings and runs by itself after an update.
-- Exists because the check created the row only the first time it ran, without an
-- editor type, so a site could not see or edit the setting before that, and the
-- choices of this release had no stored value at all: how a large dataset is
-- sampled, whether the check runs after an update, and how many rows of one dataset
-- are counted exactly before the count is estimated.
-- A new installation receives the defaults, in which the check runs after an update
-- and not at every start. A site that already has the row keeps every other value it
-- stores and gains the keys it lacks, but its two run choices become those of the
-- defaults: every site runs the check after an update and not at every start, the
-- owner's decision K122 of 30.9.2026. A site that switched the whole check off keeps
-- it off. A stored value that is not a JSON object is left for the administrator to
-- replace; the check does not run on it. Running the file again changes nothing,
-- because the stamp merged last is the same in the value and in the condition. The
-- defaults and the description are those of missing_media_check.DefaultSettings and
-- settingsCreationSpec, and a Go test keeps them and the stamp equal. The public
-- bootstrap runs this same file, so a new installation is born with the row. No
-- result row is written here: the first run writes it.
-- VERSION_DB: 9.9.2
-- VERSION_DB_OWNER: 20260929000006_record_database_release_9_9_2.sql

WITH defaults(value, description) AS (
    VALUES (
        '{"schema_version": 2, "enabled": true, "max_total_rows_checked": 10000, "min_rows_per_dataset": 50, "sampling": "even", "max_run_seconds": 120, "run_on_startup": false, "run_after_update": true, "startup_delay_seconds": 30, "exact_count_max_rows": 100000, "report_unused_files": false, "max_reported_missing": 200, "max_reported_unused_files": 200}'::jsonb,
        'Settings of the missing media files check, which reports pictures and attachments that rows use but storage no longer has. It only reports: it never repairs, moves or deletes anything. enabled switches the whole check off. It runs by itself once after an application or database update when run_after_update is true, and at every server start when run_on_startup is true, startup_delay_seconds after the start. max_total_rows_checked and max_run_seconds bound one run; min_rows_per_dataset is the smallest sample of each dataset; sampling is even or random. A dataset with more than exact_count_max_rows rows is estimated instead of counted and is never reported as fully checked. report_unused_files also lists stored files that no row uses; max_reported_missing and max_reported_unused_files bound the stored lists.'
    )
), created AS (
    -- 5 is the JSON editor of the settings view: the whole object is edited at once
    -- and cannot be saved as a string.
    INSERT INTO public.system_config (key, json_value, text_value, value_type, creation_spec)
    SELECT 'missing_media_check', defaults.value, NULL, 5, defaults.description
    FROM defaults
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_config WHERE key = 'missing_media_check'
    )
    RETURNING key
)
-- One statement does not read its own writes, so a row inserted above is not
-- updated here: it already has its final value.
UPDATE public.system_config AS setting
   SET json_value = CASE
           WHEN jsonb_typeof(setting.json_value) = 'object'
           THEN defaults.value || setting.json_value || '{"schema_version": 2, "run_on_startup": false, "run_after_update": true}'::jsonb
           ELSE setting.json_value
       END,
       value_type = 5,
       creation_spec = defaults.description,
       updated = now()
  FROM defaults
 WHERE setting.key = 'missing_media_check'
   AND (setting.value_type IS DISTINCT FROM 5
        OR setting.creation_spec IS DISTINCT FROM defaults.description
        OR (jsonb_typeof(setting.json_value) = 'object'
            AND setting.json_value IS DISTINCT FROM
                defaults.value || setting.json_value || '{"schema_version": 2, "run_on_startup": false, "run_after_update": true}'::jsonb));
-- 20261005000032_add_front_page_settings.sql
-- Adds the two site-wide front page switches, disabled by default.
-- Connects the public bootstrap and administrator settings editor to the same stored defaults.
-- Exists so new and upgraded sites preserve today's opening view until explicitly enabled.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH settings(key, description) AS (
    VALUES ('separate_front_page', 'Open the optional front page at the site root instead of the first dataset.'),
           ('front_page_button_shows_site_name', 'Use the configured site name on the Home button; an empty name uses the translated label.')
)
INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT key, false, '{"value":false}'::jsonb, 'false', 2, description FROM settings
WHERE NOT EXISTS (SELECT 1 FROM public.system_config existing WHERE existing.key = settings.key);
-- 20261005000085_add_front_page_show_blocks.sql
-- Adds the site-wide Home box switch with the existing visible-box default.
-- Connects the dedicated Home editor and registered generic boolean validation.
-- Preserves an administrator's value on upgrades and repeated imports.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

INSERT INTO public.system_config(key,boolean_value,json_value,text_value,value_type,creation_spec)
SELECT 'front_page_show_blocks',true,'{"value":true}'::jsonb,'true',2,
       'Show Home dataset boxes; missing configuration also means enabled.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key='front_page_show_blocks');
-- 20261005000004_add_row_actor_columns.sql
-- Gives registered content datasets their creator and owner, keeping a site's proven
-- owner column and filling old rows only from the approved creator sources.
-- Bridges the support functions of 000001/000002 and existing datasets: the same
-- physical and metadata definitions serve upgrades, the package and dataset creation.
-- Exists because an existing owner is a rights decision, not a value to guess from a
-- column name. All preflight findings are collected before the first write. The one
-- statement also rolls back fills, trigger suspension and history together on error.
-- Repair records contain identifiers only. Table completion protects intentional NULLs
-- on a rerun; ensuring steps record only actual changes. K211 requires table_uid.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl58_row_actor_columns
-- FINAL_CHECK: public.app_check_row_actor_marks()

DO $row_actors$
DECLARE
    migration_id constant text := 'wl58_row_actor_columns';
    file_detail constant jsonb := '{"file":"20261005000004_add_row_actor_columns.sql"}';
    examples constant text[] := ARRAY['palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit'];
    fill_sources constant text[] := ARRAY['palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit', 'app_autojen_vanteet'];
    decisions jsonb := '[]';
    findings text[] := ARRAY[]::text[];
    excluded_datasets jsonb;
    item record;
    actor record;
    reference record;
    target regclass;
    owner_column text;
    reason text;
    marked_owner text;
    owner_used boolean;
    table_done boolean;
    different_count bigint;
    empty_count bigint;
    reference_count integer;
    users_id smallint := (SELECT attnum FROM pg_catalog.pg_attribute
                          WHERE attrelid = 'public.system_users'::regclass AND attname = 'id');
    folder integer;
    admins integer;
    repair_uid integer;
    saved jsonb;
    changes jsonb;
    change jsonb;
    started timestamptz;
    affected bigint;
    filled bigint;
    cleared bigint;
    total_filled bigint := 0;
    total_cleared bigint := 0;
    total_tables integer := 0;
    user_number smallint;
    clear_condition text;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);

    -- Preflight is read only, including on a completed run. A broken mark must stop
    -- a rerun, not be hidden by the ensuring functions recreating its missing column.
    SELECT coalesce(array_agg(finding), ARRAY[]::text[]) INTO findings
      FROM public.app_check_row_actor_marks() AS finding;
    SELECT json_value INTO excluded_datasets FROM public.system_config
     WHERE key = 'row_owner_column_excluded_datasets';
    IF excluded_datasets IS NOT NULL AND (jsonb_typeof(excluded_datasets) <> 'array'
        OR jsonb_path_exists(excluded_datasets, '$[*] ? (@.type() != "string")')) THEN
        findings := array_append(findings, 'system_config: row_owner_column_excluded_datasets must be an array of table names');
    END IF;
    SELECT id INTO folder FROM public.system_table_folders WHERE folder_name = 'logs' ORDER BY id LIMIT 1;
    IF folder IS NULL THEN
        SELECT folder_id INTO folder FROM public.system_db_tables
         WHERE table_name = 'system_audit_log' AND coalesce(schema_name, 'public') = 'public';
    END IF;
    SELECT id INTO admins FROM public.system_user_groups WHERE name = 'admins';
    IF folder IS NULL THEN
        findings := array_append(findings, 'system_data_repair_records: neither logs folder nor system_audit_log folder exists');
    END IF;
    IF admins IS NULL THEN
        findings := array_append(findings, 'system_data_repair_records: admins group is missing');
    END IF;

    FOR item IN
        SELECT registry.table_uid, registry.table_name, registry.row_policy_owner_column,
               coalesce(registry.schema_name, 'public') AS schema_name,
               relation.oid, relation.relkind, relation.relowner
          FROM public.system_db_tables AS registry
          LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = coalesce(registry.schema_name, 'public')
          LEFT JOIN pg_catalog.pg_class AS relation ON relation.relnamespace = namespace.oid AND relation.relname = registry.table_name
         ORDER BY registry.table_uid
    LOOP
        target := item.oid;
        reason := public.app_row_actor_side_table_reason(item.table_name);
        IF reason IS NULL THEN
            reason := CASE
                WHEN item.schema_name <> 'public' THEN 'not a public table'
                WHEN target IS NULL OR item.relkind <> 'r' OR item.table_name = 'spatial_ref_sys' THEN 'R7: extension or not an ordinary table'
                WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key
                                  JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = key.conrelid AND attribute.attnum = key.conkey[1]
                                 WHERE key.conrelid = target AND key.contype = 'p' AND cardinality(key.conkey) = 1 AND attribute.attname = 'id')
                    THEN 'not a single-column id primary key'
                WHEN EXISTS (SELECT 1 FROM public.system_foreign_key_relations_m_m WHERE bridging_table_uid = item.table_uid)
                    THEN 'R4: registered bridge'
                WHEN NOT EXISTS (
                    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
                     WHERE attribute.attrelid = target AND attribute.attnum > 0 AND NOT attribute.attisdropped
                       AND attribute.attname NOT IN ('id', 'created', 'updated', 'sort_order', 'search_vector_simple')
                       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key WHERE key.conrelid = target
                                        AND key.contype = 'f' AND key.conkey = ARRAY[attribute.attnum]))
                 AND (SELECT count(DISTINCT key.conkey[1]) FROM pg_catalog.pg_constraint AS key
                       JOIN pg_catalog.pg_class AS other ON other.oid = key.confrelid
                      WHERE key.conrelid = target AND key.contype = 'f' AND cardinality(key.conkey) = 1
                        AND other.relname NOT LIKE 'system\_%') >= 2 THEN 'R4: pure link table'
                WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS key
                              JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target AND attribute.attnum = key.conkey[1]
                             WHERE key.conrelid = target AND key.contype = 'f' AND key.confrelid = 'public.system_users'::regclass
                               AND key.confkey = ARRAY[users_id] AND cardinality(key.conkey) = 1 AND attribute.attnotnull)
                    THEN 'R6: required user reference'
                WHEN excluded_datasets ? item.table_name THEN 'R8: site exclusion'
            END;
        END IF;
        IF reason IS NOT NULL THEN
            decisions := decisions || jsonb_build_object('table_uid', item.table_uid, 'table_name', item.table_name, 'reason', reason);
            CONTINUE;
        END IF;
        IF NOT pg_has_role(current_user, item.relowner, 'MEMBER') THEN
            findings := array_append(findings, format('%s: migration role is not a member of table owner role %s', item.table_name, item.relowner));
            CONTINUE;
        END IF;
        IF item.table_uid IS NULL THEN
            findings := array_append(findings, format('%s: registry table_uid is missing', item.table_name));
        END IF;

        -- Decision A keeps a validated site owner. The pilot's owner is fixed by its
        -- database policies; it alone may have dangling owners cleared below.
        owner_column := CASE WHEN item.table_name = 'app_service_catalog' THEN 'user_id'
                             WHEN coalesce(btrim(item.row_policy_owner_column), '') IN ('', 'created_by', 'owner_id') THEN 'owner_id'
                             ELSE btrim(item.row_policy_owner_column) END;
        marked_owner := public.app_row_actor_column(target, 'owner');
        IF marked_owner IS NOT NULL AND marked_owner IS DISTINCT FROM owner_column THEN
            findings := array_append(findings, format('%s: selected owner %s differs from owner mark %s', item.table_name, owner_column, marked_owner));
        END IF;
        owner_used := FALSE;
        FOR actor IN
            SELECT wanted.column_name, attribute.attnum, attribute.atttypid, attribute.attgenerated
              FROM unnest(ARRAY['created_by', owner_column]) AS wanted(column_name)
              LEFT JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target
                AND attribute.attname = wanted.column_name AND attribute.attnum > 0 AND NOT attribute.attisdropped
        LOOP
            IF actor.attnum IS NULL AND actor.column_name NOT IN ('created_by', 'owner_id') THEN
                findings := array_append(findings, format('%s.%s: kept owner column does not exist', item.table_name, actor.column_name));
            END IF;
            IF actor.attnum IS NOT NULL AND (actor.atttypid NOT IN ('integer'::regtype, 'bigint'::regtype) OR actor.attgenerated <> '') THEN
                findings := array_append(findings, format('%s.%s: must be integer or bigint and not generated', item.table_name, actor.column_name));
            END IF;
            SELECT count(*) INTO reference_count FROM pg_catalog.pg_constraint
             WHERE conrelid = target AND contype = 'f' AND actor.attnum = ANY(conkey);
            FOR reference IN SELECT *, pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
                              WHERE conrelid = target AND contype = 'f' AND actor.attnum = ANY(conkey)
            LOOP
                IF reference_count > 1 OR reference.conkey <> ARRAY[actor.attnum]
                    OR reference.confrelid <> 'public.system_users'::regclass OR reference.confkey <> ARRAY[users_id]
                    OR reference.confdeltype <> 'n' OR reference.confmatchtype <> 's' OR reference.condeferrable THEN
                    findings := array_append(findings, format('%s.%s: incompatible foreign key %s: %s', item.table_name, actor.column_name, reference.conname, reference.definition));
                END IF;
            END LOOP;
            IF reference_count = 0 AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = target
                AND conname = public.app_row_actor_object_name('fk', item.table_name, actor.column_name)) THEN
                findings := array_append(findings, format('%s.%s: same-name constraint has another definition', item.table_name, actor.column_name));
            END IF;
            IF actor.column_name = owner_column AND actor.attnum IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I IS NOT NULL)', target, owner_column) INTO owner_used;
                IF (owner_column <> 'owner_id' AND item.table_name <> 'app_service_catalog') OR (owner_column = 'owner_id' AND owner_used) THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = target AND contype = 'f'
                                    AND conkey = ARRAY[actor.attnum] AND confrelid = 'public.system_users'::regclass
                                    AND confkey = ARRAY[users_id] AND convalidated) THEN
                        findings := array_append(findings, format('%s.%s: owner has no validated single-column foreign key to system_users(id)', item.table_name, owner_column));
                    END IF;
                END IF;
            END IF;
        END LOOP;
        -- Decision B never fills an owner column already in use, even its NULLs.
        IF owner_column = 'owner_id' AND owner_used AND btrim(item.row_policy_owner_column) = 'created_by'
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = target AND attname = 'created_by' AND NOT attisdropped) THEN
            EXECUTE format('SELECT count(*) FILTER (WHERE owner_id IS NOT NULL AND owner_id::text IS DISTINCT FROM created_by::text), '
                           'count(*) FILTER (WHERE owner_id IS NULL AND created_by IS NOT NULL) FROM %s', target)
               INTO different_count, empty_count;
            IF different_count + empty_count > 0 THEN
                findings := array_append(findings, format('%s: creator/owner conflict: different=%s, empty_owner=%s', item.table_name, different_count, empty_count));
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = target
                    AND tgname = public.app_row_actor_object_name('protect', item.table_name, 'creator')
                    AND (tgfoid <> 'public.protect_row_creator()'::regprocedure OR tgenabled NOT IN ('O', 'A'))) THEN
            findings := array_append(findings, format('%s: existing creator guard has another function or does not fire on ordinary writes', item.table_name));
        END IF;
        decisions := decisions || jsonb_build_object('table_uid', item.table_uid, 'table_name', item.table_name,
                                                     'owner_column', owner_column, 'owner_used', owner_used);
    END LOOP;
    IF cardinality(findings) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'wl58_row_actor_columns preflight refused: ' || array_to_string(findings, E'\n');
    END IF;

    -- 0. Adopt automatic registration if present. Dataset rights are limited to the
    -- admins group; row security remains the independent database-level read boundary.
    INSERT INTO public.system_db_tables (table_name, schema_name, folder_id, is_removable, creation_spec)
    SELECT 'system_data_repair_records', 'public', folder, FALSE, 'WL58 immutable repair history'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name = 'system_data_repair_records' AND coalesce(schema_name, 'public') = 'public');
    SELECT table_uid INTO repair_uid FROM public.system_db_tables
     WHERE table_name = 'system_data_repair_records' AND coalesce(schema_name, 'public') = 'public';
    UPDATE public.system_db_tables SET folder_id = folder, is_removable = FALSE
     WHERE table_uid = repair_uid AND (folder_id IS DISTINCT FROM folder OR is_removable IS DISTINCT FROM FALSE);
    INSERT INTO public.system_column_details (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui, creation_spec)
    SELECT repair_uid, attname, format_type(atttypid, atttypmod), attnum, attname, FALSE, FALSE, 'WL58 immutable repair history'
      FROM pg_catalog.pg_attribute AS attribute WHERE attrelid = 'public.system_data_repair_records'::regclass AND attnum > 0 AND NOT attisdropped
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details WHERE table_uid = repair_uid AND column_name = attribute.attname);
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = repair_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    DELETE FROM public.system_group_table_func_rights WHERE target_table_uid = repair_uid AND user_group_id <> admins;
    INSERT INTO public.system_group_table_func_rights (user_group_id, function_id, target_schema_name, target_table_uid, creation_spec)
    SELECT admins, functions.id, 'public', repair_uid, 'WL58 repair history: administrators only'
      FROM public.system_functions AS functions
     WHERE functions.name IN ('dtt_1_row_read.GetResultsHandlerWrapper', 'dtt_1_row_read.GetRowCountHandlerWrapper',
                              'dtt_1_row_read.GetFilterOptionsHandler', 'dtt_3_table_read.GetTableViewHandlerWrapper',
                              'dtt_2_column_crud.GetTableColumnsHandler')
       AND NOT EXISTS (SELECT 1 FROM public.system_group_table_func_rights WHERE target_table_uid = repair_uid
                        AND user_group_id = admins AND function_id = functions.id);

    INSERT INTO public.system_data_repair_records (migration, table_name, action, detail)
    SELECT migration_id, 'system_data_repair_records', 'excluded', file_detail || jsonb_build_object('reason', 'R1: system table')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id
                        AND table_name = 'system_data_repair_records' AND action = 'excluded');

    FOR item IN SELECT * FROM jsonb_to_recordset(decisions)
        AS chosen(table_uid integer, table_name text, reason text, owner_column text, owner_used boolean)
    LOOP
        IF item.reason IS NOT NULL THEN
            INSERT INTO public.system_data_repair_records (migration, table_name, action, detail)
            SELECT migration_id, item.table_name, 'excluded', file_detail || jsonb_build_object('reason', item.reason)
             WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id AND table_name = item.table_name AND action = 'excluded');
            CONTINUE;
        END IF;
        target := format('public.%I', item.table_name)::regclass;
        started := clock_timestamp();
        filled := 0;
        cleared := 0;
        -- 1-2. Completion only skips one-time work; the common functions still ensure.
        SELECT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id
                        AND table_name = item.table_name AND action = 'table_completed') INTO table_done;
        changes := public.app_ensure_row_actor_columns(target, item.owner_column);
        IF NOT table_done THEN
            -- 3-5. No audit/timestamp/history trigger observes these repairs. Each
            -- invalid creator (and each dangling pilot owner) is recorded by row id.
            saved := public.app_suspend_row_triggers(target);
            IF item.table_name = ANY(fill_sources) AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                WHERE attrelid = target AND attname = 'user_id' AND NOT attisdropped) THEN
                EXECUTE format('UPDATE %s AS row SET created_by = row.user_id WHERE row.created_by IS NULL AND row.user_id > 1 '
                               'AND EXISTS (SELECT 1 FROM public.system_users WHERE id = row.user_id)', target);
                GET DIAGNOSTICS affected = ROW_COUNT;
                filled := filled + affected;
                changes := changes || jsonb_build_object('action', 'backfilled', 'column', 'created_by', 'count', affected);
            END IF;
            FOR actor IN SELECT 'created_by' AS column_name UNION ALL SELECT 'user_id' WHERE item.table_name = 'app_service_catalog' LOOP
                clear_condition := format('row.%I IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.system_users WHERE id = row.%I)',
                                          actor.column_name, actor.column_name);
                IF actor.column_name = 'created_by' THEN
                    clear_condition := clear_condition || format(' OR row.%I <= 1', actor.column_name);
                END IF;
                clear_condition := clear_condition || ')';
                EXECUTE format('INSERT INTO public.system_data_repair_records (migration, table_name, row_id, column_name, old_value, action, detail) '
                    'SELECT $1, $2, row.id::text, $3, row.%1$I::text, CASE WHEN $3 = ''user_id'' THEN ''value_cleared_dangling'' WHEN row.%1$I = 1 THEN ''value_cleared_guest'' '
                    'WHEN row.%1$I = 0 THEN ''value_cleared_zero'' WHEN row.%1$I < 0 THEN ''value_cleared_negative'' ELSE ''value_cleared_dangling'' END, $4 '
                    'FROM %2$s AS row WHERE %3$s', actor.column_name, target, clear_condition)
                    USING migration_id, item.table_name, actor.column_name, file_detail;
                GET DIAGNOSTICS affected = ROW_COUNT;
                cleared := cleared + affected;
                EXECUTE format('UPDATE %s AS row SET %I = NULL WHERE %s', target, actor.column_name, clear_condition);
            END LOOP;
            IF item.owner_column = 'owner_id' AND NOT item.owner_used THEN
                EXECUTE format('UPDATE %s SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL', target);
                GET DIAGNOSTICS affected = ROW_COUNT;
                filled := filled + affected;
                changes := changes || jsonb_build_object('action', 'owner_filled_from_creator', 'column', 'owner_id', 'count', affected);
            ELSIF item.owner_column = 'owner_id' THEN
                changes := changes || jsonb_build_object('action', 'owner_column_adopted', 'column', 'owner_id');
            ELSE
                changes := changes || jsonb_build_object('action', 'kept_site_owner_setting', 'column', item.owner_column);
            END IF;
            -- Existing keys are adopted once; ensure reports additions/validations.
            FOR reference IN SELECT attribute.attname, key.conname FROM pg_catalog.pg_constraint AS key
                JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target AND key.conkey = ARRAY[attribute.attnum]
                WHERE key.conrelid = target AND key.contype = 'f' AND attribute.attname IN ('created_by', item.owner_column)
            LOOP
                changes := changes || jsonb_build_object('action', 'fk_adopted', 'column', reference.attname, 'constraint', reference.conname);
            END LOOP;
        END IF;
        -- 6-12. Physical keys, indexes, defaults and guard precede metadata and marks.
        changes := changes || public.app_ensure_row_actor_constraints(target, item.owner_column);
        changes := changes || public.app_register_row_actor_columns(item.table_uid, item.owner_column);
        IF NOT table_done THEN
            -- 13. Keep the example's old column whenever a registry, relation, stamp,
            -- view/rule or incoming database dependency still names it. Never CASCADE.
            SELECT attnum INTO user_number FROM pg_catalog.pg_attribute
             WHERE attrelid = target AND attname = 'user_id' AND NOT attisdropped;
            IF item.table_name = ANY(examples) AND user_number IS NOT NULL THEN
                reason := NULL;
                IF item.owner_column = 'user_id' OR EXISTS (SELECT 1 FROM public.system_db_tables
                    WHERE table_uid = item.table_uid AND (row_policy_owner_column = 'user_id' OR fk_display_column = 'user_id')) THEN
                    reason := 'registry owner or foreign-key display column';
                ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_depend WHERE refclassid = 'pg_class'::regclass AND refobjid = target
                               AND refobjsubid = user_number AND deptype = 'n' AND classid <> 'pg_attrdef'::regclass) THEN
                    reason := 'database dependency (including view, rule or incoming foreign key)';
                ELSIF EXISTS (SELECT 1 FROM public.system_foreign_key_relations_1_m AS relation WHERE
                       (source_table_uid = item.table_uid AND (source_column_name = 'user_id' OR cached_name_col_in_src = 'user_id'))
                    OR (target_table_uid = item.table_uid AND (target_column_name = 'user_id' OR name_col_in_tgt = 'user_id'))
                    OR ((source_table_uid = item.table_uid OR target_table_uid = item.table_uid
                         OR coalesce(source_insert_specs::text, '') LIKE '%' || item.table_name || '%'
                         OR coalesce(target_insert_specs::text, '') LIKE '%' || item.table_name || '%')
                        AND (coalesce(source_insert_specs::text, '') ~ '"user_id"' OR coalesce(target_insert_specs::text, '') ~ '"user_id"')))
                    OR EXISTS (SELECT 1 FROM public.system_foreign_key_relations_m_m WHERE
                       (table_a_uid = item.table_uid AND table_a_column = 'user_id')
                    OR (table_b_uid = item.table_uid AND table_b_column = 'user_id')
                    OR (bridging_table_uid = item.table_uid AND 'user_id' IN (bridging_col_a, bridging_col_b))) THEN
                    reason := 'relation or insertion specification';
                END IF;
                IF reason IS NULL THEN
                    DELETE FROM public.system_column_details WHERE table_uid = item.table_uid AND column_name = 'user_id';
                    EXECUTE format('ALTER TABLE %s DROP COLUMN user_id', target);
                    changes := changes || jsonb_build_object('action', 'example_user_column_dropped', 'column', 'user_id');
                ELSE
                    changes := changes || jsonb_build_object('action', 'example_user_column_kept', 'column', 'user_id', 'reason', reason);
                END IF;
            END IF;
            -- 14. The new creator trigger was not in saved; existing O/R/A/D states
            -- return exactly, including a previously disabled timestamp trigger.
            PERFORM public.app_restore_row_triggers(target, saved);
            changes := changes || jsonb_build_object('action', 'timing_ms', 'milliseconds', extract(epoch FROM clock_timestamp() - started) * 1000)
                               || jsonb_build_object('action', 'table_completed');
        END IF;
        FOR change IN SELECT value FROM jsonb_array_elements(changes) LOOP
            INSERT INTO public.system_data_repair_records (migration, table_name, column_name, old_value, new_value, action, detail)
            VALUES (migration_id, item.table_name, change->>'column', change->>'old_value', change->>'new_value', change->>'action', file_detail || change);
        END LOOP;
        total_tables := total_tables + 1;
        total_filled := total_filled + filled;
        total_cleared := total_cleared + cleared;
        RAISE NOTICE 'wl58_row_actor_columns: %, filled %, cleared %, already completed %', item.table_name, filled, cleared, table_done;
    END LOOP;
    -- 15. The current checker is 000002 on upgrade, and 000006 in the package.
    -- The later schema-only migration strengthens trigger-definition verification.
    SELECT array_agg(finding) INTO findings FROM public.app_check_row_actor_marks() AS finding;
    IF cardinality(findings) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'wl58_row_actor_columns final check refused: ' || array_to_string(findings, E'\n');
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT migration_id, 'completed', file_detail WHERE NOT EXISTS (
        SELECT 1 FROM public.system_data_repair_records WHERE migration = migration_id AND action = 'completed');
    RAISE NOTICE 'wl58_row_actor_columns: % tables, % filled values, % cleared values', total_tables, total_filled, total_cleared;
END $row_actors$;
-- 20261005000023_register_system_favorites.sql
-- Registers favorites as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so favorites cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_favorites_registry

DO $favorites_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_favorites registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_favorites', 'public', system_folder, FALSE, 'Account-owned typed favorites',
           'public.system_favorites'::regclass::oid::integer, 'target_key', FALSE, 'Favorites', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_favorites' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_favorites' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_favorites'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_favorites'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_favorites'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'system_favorites_registry', 'completed',
           jsonb_build_object('file', '20261005000023_register_system_favorites.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'system_favorites_registry' AND action = 'completed');
END
$favorites_registry$;
-- 20261005000034_register_system_front_page_blocks.sql
-- Registers front page blocks as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so front page blocks cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_front_page_blocks_registry

DO $front_page_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_front_page_blocks registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_front_page_blocks', 'public', system_folder, FALSE, 'Common and account-specific front page blocks',
           'public.system_front_page_blocks'::regclass::oid::integer, 'table_uid', FALSE, 'Home blocks', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_front_page_blocks' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_front_page_blocks' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_front_page_blocks'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_front_page_blocks'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_front_page_blocks'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'system_front_page_blocks_registry', 'completed',
           jsonb_build_object('file', '20261005000034_register_system_front_page_blocks.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'system_front_page_blocks_registry' AND action = 'completed');
END
$front_page_registry$;
-- 20261005000037_register_row_group_classifications.sql
-- Registers classification headings as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so headings cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl103_row_group_classifications_registry

DO $classifications_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_row_group_classifications registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_row_group_classifications', 'public', system_folder, FALSE, 'Multilingual row-group classification headings',
           'public.system_row_group_classifications'::regclass::oid::integer, 'slug', FALSE, 'Classifications', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_row_group_classifications' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_row_group_classifications' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_row_group_classifications'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_row_group_classifications'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_row_group_classifications'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT tables.table_uid, 'classification_id', columns.data_type, columns.ordinal_position,
           'system_row_group_classifications', FALSE, FALSE
      FROM public.system_db_tables AS tables
      JOIN information_schema.columns AS columns ON columns.table_schema = 'public'
       AND columns.table_name = 'system_row_groups' AND columns.column_name = 'classification_id'
     WHERE tables.table_name = 'system_row_groups'
       AND coalesce(NULLIF(tables.schema_name, ''), 'public') = 'public'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = tables.table_uid AND existing.column_name = 'classification_id');
    -- A fresh bootstrap may already have described this additive physical column.
    -- Give that row the same protected metadata as the upgrade inserts above.
    UPDATE public.system_column_details AS columns
       SET lang_key = 'system_row_group_classifications', insertable = FALSE, editable_in_ui = FALSE
      FROM public.system_db_tables AS tables
     WHERE columns.table_uid = tables.table_uid AND columns.column_name = 'classification_id'
       AND tables.table_name = 'system_row_groups'
       AND coalesce(NULLIF(tables.schema_name, ''), 'public') = 'public'
       AND (columns.lang_key IS DISTINCT FROM 'system_row_group_classifications'
            OR columns.insertable IS DISTINCT FROM FALSE OR columns.editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl103_row_group_classifications_registry', 'completed',
           jsonb_build_object('file', '20261005000037_register_row_group_classifications.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'wl103_row_group_classifications_registry' AND action = 'completed');
END
$classifications_registry$;
-- 20261005000050_require_registry_reference_key.sql
-- Requires the dataset registry's integer reference key and protects it in the UI.
-- Bridges stored dataset references with the registry's own column metadata.
-- Exists because a registry row number is not a dataset reference. The precheck
-- refuses missing keys before changing schema or metadata, including on a rerun.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl144_registry_reference_key
-- FINAL_CHECK: public.app_check_registry_reference_key()

DO $registry_key_precheck$
DECLARE
    missing_rows text;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    -- Held until the migration runner's transaction ends, across all later DDL.
    LOCK TABLE public.system_db_tables IN ACCESS EXCLUSIVE MODE;
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO missing_rows
      FROM public.system_db_tables WHERE table_uid IS NULL;
    IF missing_rows IS NOT NULL THEN
        RAISE EXCEPTION 'registry reference-key precheck refused: system_db_tables rows % have no table_uid; repair the registry before upgrading', missing_rows;
    END IF;
END $registry_key_precheck$;

CREATE OR REPLACE FUNCTION public.app_check_registry_reference_key()
RETURNS SETOF text
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $check$
    SELECT 'system_db_tables.table_uid must be NOT NULL'
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                        WHERE attrelid = 'public.system_db_tables'::regclass
                          AND attname = 'table_uid' AND attnotnull AND NOT attisdropped)
    UNION ALL
    SELECT 'system_db_tables contains a missing table_uid'
     WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_uid IS NULL)
    UNION ALL
    -- A fresh installation has no metadata row for this column, and the generic
    -- row editor refuses a column without one, so only an editable row is a finding.
    SELECT 'the registry reference key must not be editable in the UI'
     WHERE EXISTS (
         SELECT 1 FROM public.system_column_details AS column_detail
         JOIN public.system_db_tables AS registry ON registry.table_uid = column_detail.table_uid
          WHERE registry.table_name = 'system_db_tables'
            AND coalesce(nullif(registry.schema_name, ''), 'public') = 'public'
            AND column_detail.column_name = 'table_uid'
            AND column_detail.editable_in_ui IS DISTINCT FROM false
     );
$check$;

DO $registry_key$
DECLARE
    findings text;
BEGIN
    ALTER TABLE public.system_db_tables ALTER COLUMN table_uid SET NOT NULL;
    UPDATE public.system_column_details AS column_detail SET editable_in_ui = false
      FROM public.system_db_tables AS registry
     WHERE column_detail.table_uid = registry.table_uid
       AND registry.table_name = 'system_db_tables'
       AND coalesce(nullif(registry.schema_name, ''), 'public') = 'public'
       AND column_detail.column_name = 'table_uid'
       AND column_detail.editable_in_ui IS DISTINCT FROM false;

    SELECT string_agg(finding, '; ') INTO findings
      FROM public.app_check_registry_reference_key() AS finding;
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION 'registry reference-key final check refused: %', findings;
    END IF;
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl144_registry_reference_key', 'completed',
           '{"file":"20261005000050_require_registry_reference_key.sql"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                        WHERE migration = 'wl144_registry_reference_key' AND action = 'completed');
END $registry_key$;
-- 20261005000080_add_dataset_media_hidden.sql
-- Adds independent visibility to stored dataset cover and background images (WL153).
-- Connects the media registry and header editor with upgrade and bootstrap metadata.
-- Keeps files and links intact; the browser suppresses hidden images at display time.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: dataset_media_hidden

ALTER TABLE public.system_dataset_media
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.system_dataset_media.hidden IS
    'Suppresses presentation loading without removing the stored image or its link. Admin previews remain visible.';

-- Run after the registry exists, including in the fresh-install bootstrap seed.
DO $media_hidden_metadata$
DECLARE
    registered_table_uid INTEGER;
BEGIN
    SELECT table_uid INTO STRICT registered_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_dataset_media'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public';

    INSERT INTO public.system_column_details (
        table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
    )
    SELECT registered_table_uid, columns.column_name, columns.data_type,
           columns.ordinal_position, FALSE, now(), now()
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'system_dataset_media'
      AND columns.column_name = 'hidden'
      AND NOT EXISTS (
          SELECT 1 FROM public.system_column_details AS existing
          WHERE existing.table_uid = registered_table_uid
            AND existing.column_name = columns.column_name
      );
    UPDATE public.system_column_details SET editable_in_ui = FALSE
    WHERE table_uid = registered_table_uid AND column_name = 'hidden'
      AND editable_in_ui IS DISTINCT FROM FALSE;
END
$media_hidden_metadata$;

-- Finnish and English only (owner K175). Preserve reviewed installation copy,
-- and mirror the served columns into the normalized translations as in the
-- dataset header language-key seed of 20260922000007.
WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dataset_header_config_hide_cover_image', 'Piilota kansikuva', 'Hide cover image',
         'Dataset header settings: hide the cover without deleting its file or link.'),
        ('dataset_header_config_hide_background_image', 'Piilota taustakuva', 'Hide background image',
         'Dataset header settings: hide the content background without deleting its file or link.'),
        ('dataset_header_config_image_hidden', 'Piilotettu', 'Hidden',
         'Dataset header settings: badge on the preview of an image hidden from dataset pages.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, creation_spec FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'dataset_media_hidden', 'completed',
       jsonb_build_object('file', '20261005000080_add_dataset_media_hidden.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'dataset_media_hidden' AND action = 'completed');

-- Generated migration-ledger baseline and version row, written by this acceptance block only after
-- every completion marker is present and every final check comes back empty. These migrations are
-- already embodied by this bootstrap.
DO $filterest_acceptance$
DECLARE
    missing_markers text;
    findings text;
BEGIN
    SELECT string_agg(marker, ', ' ORDER BY marker) INTO missing_markers
      FROM unnest(ARRAY['wl58_row_actor_support', 'wl58_row_actor_marks_by_table_uid', 'wl58_row_actor_trigger_definitions', 'k116_login_names', 'password_reset_dummy_work', 'system_favorites_table', 'system_front_page_revisions_table', 'system_front_page_blocks_table', 'wl103_row_group_classifications', 'wl132_surviving_sign_in', 'wl52_drop_column_label_value_layout', 'system_dataset_appearance_table', 'wl58_row_actor_columns', 'system_favorites_registry', 'system_front_page_blocks_registry', 'wl103_row_group_classifications_registry', 'wl144_registry_reference_key', 'dataset_media_hidden']::text[]) AS marker
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records AS record
                        WHERE record.migration = marker AND record.action = 'completed');
    IF missing_markers IS NOT NULL THEN
        RAISE EXCEPTION 'bootstrap import is incomplete; missing completion markers: %', missing_markers;
    END IF;
    SELECT string_agg(finding, '; ') INTO findings FROM (
        SELECT 'public.app_check_row_actor_marks(): ' || result FROM public.app_check_row_actor_marks() AS result
        UNION ALL
        SELECT 'public.app_check_login_name_protections(): ' || result FROM public.app_check_login_name_protections() AS result
        UNION ALL
        SELECT 'public.app_check_dataset_appearance_storage(): ' || result FROM public.app_check_dataset_appearance_storage() AS result
        UNION ALL
        SELECT 'public.app_check_registry_reference_key(): ' || result FROM public.app_check_registry_reference_key() AS result
    ) AS checks (finding);
    IF findings IS NOT NULL THEN
        RAISE EXCEPTION 'bootstrap import failed its final checks: %', findings;
    END IF;
    INSERT INTO public.system_schema_migrations (filename) VALUES
      ('20260307_create_system_comments.sql'),
      ('20260717000001_harden_otp_and_add_cantonese.sql'),
      ('20260719000001_remove_generic_row_links.sql'),
      ('20260720000001_add_image_first_sorting.sql'),
      ('20260720000002_organize_filterest_public_table_folders.sql'),
      ('20260720000003_seed_filterest_public_metadata_lang_keys.sql'),
      ('20260803000001_add_first_run_admin_setup.sql'),
      ('20260804000001_add_first_run_environment_and_login_verification.sql'),
      ('20260804000002_add_first_run_site_identity.sql'),
      ('20260804000003_repair_column_presets_and_user_card_header.sql'),
      ('20260805000001_restore_filterest_public_version_head.sql'),
      ('20260816000001_seed_calendar_view_lang_keys.sql'),
      ('20260816000002_add_external_embedding_policy_queue.sql'),
      ('20260816000003_seed_filterbar_heading_lang_keys.sql'),
      ('20260817000001_add_dataset_embedding_policy_defaults.sql'),
      ('20260817000002_normalize_ui_languages.sql'),
      ('20260817000003_simplify_login_privacy_acceptance.sql'),
      ('20260817000004_default_card_field_labels_off.sql'),
      ('20260817000005_seed_create_table_image_capability_lang_keys.sql'),
      ('20260817000006_link_column_metadata_to_dataset.sql'),
      ('20260817000007_repair_filterest_admin_schema_permissions.sql'),
      ('20260817000008_seed_site_language_settings_permissions.sql'),
      ('20260817000009_repair_shared_asset_delete_cascade.sql'),
      ('20260818000001_repair_admin_filter_option_permissions.sql'),
      ('20260818000002_split_login_privacy_acceptance_link.sql'),
      ('20260818000003_seed_normalized_language_table_labels.sql'),
      ('20260818000004_deduplicate_project_tab_order.sql'),
      ('20260818000005_add_dataset_sort_defaults.sql'),
      ('20260819000001_seed_filter_mode_tooltip_lang_keys.sql'),
      ('20260819000002_add_dataset_media.sql'),
      ('20260819000003_record_dataset_media_db_release.sql'),
      ('20260819000004_add_dataset_view_settings.sql'),
      ('20260819000005_remove_dataset_view_settings.sql'),
      ('20260819000006_enable_admin_owned_registration.sql'),
      ('20260819000007_seed_admin_user_authentication_permission.sql'),
      ('20260819000008_restrict_system_config_permissions.sql'),
      ('20260820000001_add_safe_symbol_registry.sql'),
      ('20260820000002_add_admin_ui_feature_flags.sql'),
      ('20260820000003_seed_travel_dataset_presentation_defaults.sql'),
      ('20260820000004_add_site_presentation_settings.sql'),
      ('20260820000005_expand_site_presentation_settings.sql'),
      ('20260820000006_seed_fintravel_travel_labels.sql'),
      ('20260822000001_create_system_row_groups.sql'),
      ('20260822000002_add_site_favicon_setting.sql'),
      ('20260822000003_group_common_cross_dataset_tables.sql'),
      ('20260822000005_record_compatible_db_release.sql'),
      ('20260822000006_normalize_view_field_sets.sql'),
      ('20260822000007_finalize_view_field_sets.sql'),
      ('20260823000002_record_compatible_db_release.sql'),
      ('20260823000003_restrict_guest_view_field_set_writes.sql'),
      ('20260824000001_add_user_auth_generation.sql'),
      ('20260824000002_repair_row_group_runtime_permissions.sql'),
      ('20260824000003_add_production_update_notice.sql'),
      ('20260825000001_enable_personal_dataset_sort_defaults.sql'),
      ('20260826000002_record_compatible_db_release.sql'),
      ('20260826000004_record_compatible_db_release.sql'),
      ('20260901000001_harden_system_column_details_identity.sql'),
      ('20260902000001_add_group_view_field_set_assignments.sql'),
      ('20260902000002_add_row_access_rules.sql'),
      ('20260902000004_finalize_row_access_fail_closed_defaults.sql'),
      ('20260902000005_add_row_access_principal_picker_copy.sql'),
      ('20260902000006_complete_row_access_editor_copy.sql'),
      ('20260902000007_add_view_field_assignment_admin_tool.sql'),
      ('20260902000008_seed_admin_tree_language_keys.sql'),
      ('20260903000001_add_view_field_assignment_priority_help.sql'),
      ('20260903000002_refine_mixed_view_field_assignment_copy.sql'),
      ('20260905000001_add_row_existing_link_copy.sql'),
      ('20260905000002_complete_add_row_form_copy.sql'),
      ('20260905000003_complete_add_row_status_and_asset_copy.sql'),
      ('20260905000004_repair_owned_child_runtime_permissions.sql'),
      ('20260905000005_repair_owned_child_legacy_sequence_permissions.sql'),
      ('20260906000002_add_column_view_support_matrix.sql'),
      ('20260906000003_add_user_visual_preferences.sql'),
      ('20260906000004_add_card_description_line_count_setting.sql'),
      ('20260908000001_seed_field_settings_language_keys.sql'),
      ('20260908000002_add_public_site_login_policy.sql'),
      ('20260908000003_add_column_label_value_layout.sql'),
      ('20260908000004_add_article_view_and_field_settings.sql'),
      ('20260908000005_seed_search_filter_fallback_language_key.sql'),
      ('20260908000006_add_media_asset_registry.sql'),
      ('20260908000007_seed_image_picker_copy.sql'),
      ('20260908000008_restore_column_support_view_registration.sql'),
      ('20260908000009_seed_article_editor_copy.sql'),
      ('20260908000010_restrict_media_registry_and_restore_support_view.sql'),
      ('20260911000001_add_dataset_ui_visibility.sql'),
      ('20260912000002_add_new_column_multilingual_default.sql'),
      ('20260913000001_inherit_site_card_style.sql'),
      ('20260914000001_record_admin_agent_and_dataset_presentation_release.sql'),
      ('20260914000002_add_dataset_card_detail_columns.sql'),
      ('20260914000003_add_coding_agent_dev_only.sql'),
      ('20260914000004_add_automation_api_only.sql'),
      ('20260914000005_inherit_card_field_labels.sql'),
      ('20260914000006_add_article_section_initial_open.sql'),
      ('20260918000001_record_site_assistant_release.sql'),
      ('20260918000002_seed_site_assistant_language_keys.sql'),
      ('20260919000001_seed_chat_attachment_language_keys.sql'),
      ('20260919000002_repair_chat_attachment_translations.sql'),
      ('20260919000003_seed_dataset_symbol_language_keys.sql'),
      ('20260919000004_serve_authored_seed_translations.sql'),
      ('20260919000005_seed_dataset_form_dimension_language_keys.sql'),
      ('20260919000006_record_lang_key_sources_by_file.sql'),
      ('20260919000007_create_developer_ticket_schema.sql'),
      ('20260919000008_create_developer_workline_schema.sql'),
      ('20260919000009_seed_developer_workflow_metadata.sql'),
      ('20260919000010_record_developer_workflow_schema_release.sql'),
      ('20260920000001_retire_queen_permissions.sql'),
      ('20260920000002_create_dataset_interface_labels.sql'),
      ('20260920000003_name_site_assistant_runtimes.sql'),
      ('20260921000001_withdraw_public_table_creation.sql'),
      ('20260921000002_record_public_table_creation_release.sql'),
      ('20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql'),
      ('20260922000002_create_missing_deletion_log.sql'),
      ('20260922000003_grant_filter_options_to_dataset_readers.sql'),
      ('20260922000004_seed_request_notice_and_interface_language_keys.sql'),
      ('20260922000005_seed_interface_language_keys_of_9_8_1.sql'),
      ('20260922000006_seed_dataset_creation_warning_language_key.sql'),
      ('20260922000007_seed_embedding_refresh_and_dataset_header_language_keys.sql'),
      ('20260926000001_restore_system_foreign_keys.sql'),
      ('20260926000002_record_system_foreign_key_release.sql'),
      ('20260926000003_create_revoked_sign_in_store.sql'),
      ('20260927000001_add_absolute_sign_in_limit.sql'),
      ('20260929000001_seed_connect_two_fields_language_keys.sql'),
      ('20260929000002_clear_missing_display_columns_and_name_column_link.sql'),
      ('20260929000003_record_database_release_9_9_1.sql'),
      ('20260929000004_add_missing_media_check_setting.sql'),
      ('20260929000005_seed_missing_media_check_language_keys.sql'),
      ('20260929000006_record_database_release_9_9_2.sql'),
      ('20261005000001_add_row_actor_support.sql'),
      ('20261005000002_key_row_actor_marks_by_table_uid.sql'),
      ('20261005000004_add_row_actor_columns.sql'),
      ('20261005000005_seed_row_actor_language_keys.sql'),
      ('20261005000006_check_row_actor_trigger_definitions.sql'),
      ('20261005000011_separate_login_names.sql'),
      ('20261005000013_seed_login_name_keys.sql'),
      ('20261005000014_add_password_reset_dummy_work.sql'),
      ('20261005000021_create_system_favorites.sql'),
      ('20261005000022_seed_favorites_language_keys.sql'),
      ('20261005000023_register_system_favorites.sql'),
      ('20261005000030_create_front_page_revision_metadata.sql'),
      ('20261005000031_create_system_front_page_blocks.sql'),
      ('20261005000032_add_front_page_settings.sql'),
      ('20261005000033_seed_front_page_language_keys.sql'),
      ('20261005000034_register_system_front_page_blocks.sql'),
      ('20261005000035_add_row_group_classifications.sql'),
      ('20261005000036_seed_row_group_classification_language_keys.sql'),
      ('20261005000037_register_row_group_classifications.sql'),
      ('20261005000038_seed_row_group_window_language_keys.sql'),
      ('20261005000039_seed_row_group_panel_language_keys.sql'),
      ('20261005000040_add_surviving_sign_in.sql'),
      ('20261005000050_require_registry_reference_key.sql'),
      ('20261005000051_seed_relation_reference_language_key.sql'),
      ('20261005000055_seed_setting_check_language_keys.sql'),
      ('20261005000060_seed_shell_boot_recovery_language_keys.sql'),
      ('20261005000070_drop_column_label_value_layout.sql'),
      ('20261005000075_seed_runtime_grant_refusal_language_keys.sql'),
      ('20261005000080_add_dataset_media_hidden.sql'),
      ('20261005000085_add_front_page_show_blocks.sql'),
      ('20261005000086_seed_front_page_hero_language_keys.sql'),
      ('20261005000099_record_database_release_9_10_0.sql'),
      ('20261007000001_seed_row_group_match_mode_language_keys.sql'),
      ('20261007000002_seed_multiselect_language_keys.sql'),
      ('20261007000099_record_database_release_9_10_1.sql'),
      ('20261009000001_seed_front_page_description_language_key.sql'),
      ('20261009000002_seed_admin_version_info_language_keys.sql'),
      ('20261009000003_create_system_dataset_appearance.sql'),
      ('20261009000099_record_database_release_9_10_2.sql')
    ON CONFLICT (filename) DO NOTHING;
    INSERT INTO public.system_db_version (version, description)
    VALUES ('9.10.2', 'Filterest generated public bootstrap');
END
$filterest_acceptance$;
