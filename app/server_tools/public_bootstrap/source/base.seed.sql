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
