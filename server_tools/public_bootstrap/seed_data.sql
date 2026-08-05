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
  (3001, 'login_to_browse', '{"value": false}'::jsonb, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', FALSE, 'false', NULL, 1),
  (3002, 'site_name', '{"value": "Filterest"}'::jsonb, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', NULL, 'Filterest', NULL, 2);









INSERT INTO public.system_config (id, key, json_value, created, updated, creation_spec, boolean_value, text_value, int_value, value_type) VALUES
  (3003, 'results_load_amount', '{"value": 50}'::jsonb, '2026-03-29 00:00:00', '2026-03-29 00:00:00', 'public fixture seed', NULL, '50', 50, 3),
  (3004, 'instance_kind', '{"value": "filterest_sibling"}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', NULL, 'filterest_sibling', NULL, 2),
  (3005, 'overwrite_possible', '{"value": true}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', TRUE, 'true', NULL, 1),
  (3006, 'dev_rate_limiting_off', '{"value": true}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', TRUE, 'true', NULL, 1),
  (3007, 'use_minified_js_css_in_dev_env', '{"value": false}'::jsonb, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'public fixture seed', FALSE, 'false', NULL, 1),
  (3008, 'first_run', '{"value": true}'::jsonb, '2026-08-03 00:00:00', '2026-08-03 00:00:00', 'Controls the one-time browser form for creating the first login-ready administrator. It is closed atomically after successful account creation.', TRUE, 'true', NULL, 1),
  (3009, 'installation_environment', '{"value": ""}'::jsonb, '2026-08-04 00:00:00', '2026-08-04 00:00:00', 'User-facing installation purpose selected during First Run. Empty preserves the deployment-defined fallback until First Run saves an explicit choice.', NULL, '', NULL, 2);

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
  (4017, 'dtt_1_row_read.GetDynamicChildItemsHandler', FALSE, '2026-05-21 00:00:00', '2026-05-21 00:00:00', 'dtt_1_row_read', TRUE, 'public fixture seed', 200, 20, '/api/fetch-dynamic-children', FALSE);

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

INSERT INTO public.system_db_version (version, description)
VALUES ('8.0.59', 'Filterest generated public bootstrap');
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
  (201, 'system_about', 'Product information', 201, NULL, 10, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'System information', FALSE, FALSE, TRUE, FALSE, FALSE, TRUE, NULL, 'info'),
  (202, 'system_lang_keys', 'Language keys', 202, NULL, 11, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Language keys', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'lang_key', 'language'),
  (203, 'system_column_control', 'Column control', 203, NULL, 13, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Column control', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'columns'),
  (204, 'system_db_tables', 'Dataset metadata', 204, NULL, 12, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Database tables', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'table_name', 'table'),
  (205, 'system_table_folders', 'Dataset folders', 205, NULL, 12, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Table folders', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'folder_name', 'folder'),
  (206, 'system_db_version', 'Database version history', 206, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Database version', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'version', 'history'),
  (207, 'system_foreign_key_relations_m_m', 'Many-to-many relation metadata', 207, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Foreign-key relations M:M', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'link'),
  (208, 'system_child_tab_config', 'Child-tab configuration', 208, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Child tab configuration', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'settings'),
  (209, 'spatial_ref_sys', 'Spatial reference systems', 209, NULL, 14, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Spatial reference systems', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'srid', 'map'),
  (210, 'system_user_column_settings', 'User column settings', 210, NULL, 13, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'User column settings', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, NULL, 'columns'),
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
  (224, 'system_table_views', 'Dataset view configuration', 224, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Table views', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'view_name', 'view'),
  (225, 'system_schema_migrations', 'Applied schema migrations', 225, NULL, 8, '2026-07-20 00:00:00', '2026-07-20 00:00:00', 'public fixture seed', NULL, 'public', 'Schema migrations', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, 'filename', 'history');

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
  (7, 'user_id', 'User ID', 'integer', 'hidden', 8, -10, NULL, NULL, 'public fixture seed', FALSE, FALSE, TRUE, TRUE, FALSE, NULL),
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
  (8, 'user_id', 'User ID', 'integer', 'hidden', 11, -10, NULL, NULL, 'public fixture seed', FALSE, FALSE, TRUE, TRUE, FALSE, NULL),
  (8, 'cached_username', 'Username', 'character varying', 'username', 12, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL),

  (9, 'otsikko', 'Document', 'text', 'header', 1, 1, 1, 'otsikko', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (9, 'ohje', 'Guidance', 'text', 'description', 2, 2, 2, 'ohje', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, TRUE, NULL),
  (9, 'cached_image', 'Image', 'image', 'image', 3, NULL, NULL, 'cached_image', 'public fixture seed', FALSE, TRUE, FALSE, TRUE, FALSE, NULL),
  (9, 'kohdetiimi', 'Target team', 'text', 'details10', 4, 3, 3, 'kohdetiimi', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'user'),
  (9, 'voimassaolo', 'Validity', 'text', 'details20', 5, 4, 4, 'voimassaolo', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, TRUE, 'check-circle'),
  (9, 'paivitetty', 'Reviewed', 'date', 'details30', 6, 5, 5, 'paivitetty', 'public fixture seed', TRUE, TRUE, FALSE, FALSE, FALSE, 'calendar'),
  (9, 'palvelu_id', 'Service ID', 'integer', 'hidden', 7, NULL, NULL, 'palvelu_id', 'public fixture seed', FALSE, FALSE, TRUE, FALSE, FALSE, NULL),
  (9, 'user_id', 'User ID', 'integer', 'hidden', 8, -10, NULL, NULL, 'public fixture seed', FALSE, FALSE, TRUE, TRUE, FALSE, NULL),
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
  (10, 'user_id', 'User ID', 'integer', 'hidden', 12, -10, NULL, NULL, 'public fixture seed', FALSE, FALSE, TRUE, TRUE, FALSE, NULL),
  (10, 'cached_username', 'Username', 'character varying', 'username', 13, -60, NULL, 'username', 'public fixture seed', FALSE, TRUE, FALSE, FALSE, FALSE, NULL);

UPDATE public.system_column_details
SET insertable = FALSE
WHERE table_uid IN (7, 8, 9, 10)
  AND column_name IN ('user_id', 'cached_username');

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
    (id, user_id, cached_username, palvelu, kuvaus, omistava_tiimi,
     palvelutaso, tila, vastuuhenkilo)
VALUES (
    1,
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
    (id, user_id, cached_username, palvelu_id, riski, kuvaus, vaikutus, riskitaso, tila,
     omistava_tiimi, todennakoisyys, alentamistoimet)
VALUES (
    1,
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
    (id, user_id, cached_username, palvelu_id, otsikko, kohdetiimi,
     ohje, paivitetty, voimassaolo)
VALUES
  (
    1,
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
    'teppo_tekija',
    1,
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
    'teppo_tekija',
    1,
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
    (id, user_id, cached_username, palvelu_id, riski_id, dokumentaatio_id,
     otsikko, vastuutiimi, maarapaiva, tila, prioriteetti, pyyntotyyppi, kuvaus)
VALUES (
    1,
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
-- match the accepted Filterest preview; storage files are copied separately by
-- the public repository generator.
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

-- Restore the reviewed public images that ship with the minimal workspace.
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

  -- Shared navigation and tool labels rendered by the public application shell.
  ('account', 'Tili', 'Account', '账户', '帳戶', 'public fixture seed'),
  ('logout', 'Kirjaudu ulos', 'Logout', '退出登录', '登出', 'public fixture seed'),
  ('system_config', 'Järjestelmäasetukset', 'System configuration', '系统配置', '系統設定', 'public fixture seed'),
  ('users', 'Käyttäjät', 'Users', '用户', '用戶', 'public fixture seed'),
  ('system_users_front_page', 'Käyttäjät', 'Users', '用户', '用戶', 'public fixture seed'),
  ('search_slogan_system_users', 'Löydä käyttäjiä nimen, käyttäjätunnuksen tai käyttöoikeusryhmän perusteella.', 'Find users by name, username, or permission group.', '按姓名、用户名或权限组查找用户。', '按姓名、用戶名稱或者權限群組搵用戶。', 'public fixture seed'),
  ('search_for_system_users', 'Hae käyttäjiä nimellä, käyttäjätunnuksella tai käyttöoikeusryhmällä', 'Search users by name, username, or permission group', '按姓名、用户名或权限组搜索用户', '按姓名、用戶名稱或者權限群組搜尋用戶', 'public fixture seed'),
  ('admin_and_development_tools', 'Ylläpidon ja kehityksen työkalut', 'Admin and development tools', '管理和开发工具', '管理及開發工具', 'public fixture seed'),
  ('admin_tools', 'Ylläpidon työkalut', 'Admin tools', '管理工具', '管理工具', 'public fixture seed'),
  ('permissions', 'Käyttöoikeudet', 'Permissions', '权限', '權限', 'public fixture seed'),
  ('queen_chat', 'Queen-keskustelu', 'Queen chat', 'Queen 聊天', 'Queen 傾偈', 'public fixture seed'),
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
  ('system_about', 'Järjestelmätiedot', 'System information', '系统信息', '系統資訊', 'public fixture seed'),
  ('system_audit_log', 'Auditointiloki', 'Audit log', '审计日志', '稽核記錄', 'public fixture seed'),
  ('system_child_tab_config', 'Alivälilehtien asetukset', 'Child tab configuration', '子标签页配置', '子分頁設定', 'public fixture seed'),
  ('system_column_control', 'Sarakkeiden hallinta', 'Column control', '列控制', '欄位控制', 'public fixture seed'),
  ('system_column_details', 'Sarakkeiden tiedot', 'Column details', '列详情', '欄位詳細資料', 'public fixture seed'),
  ('system_db_tables', 'Tietokannan taulut', 'Database tables', '数据库表', '資料庫資料表', 'public fixture seed'),
  ('system_db_version', 'Tietokantaversio', 'Database version', '数据库版本', '資料庫版本', 'public fixture seed'),
  ('system_foreign_key_relations_1_m', 'Vierasavainrelaatiot 1:M', 'Foreign-key relations 1:M', '外键关系 1:M', '外鍵關係 1:M', 'public fixture seed'),
  ('system_foreign_key_relations_m_m', 'Vierasavainrelaatiot M:M', 'Foreign-key relations M:M', '外键关系 M:M', '外鍵關係 M:M', 'public fixture seed'),
  ('system_functions', 'Järjestelmätoiminnot', 'System functions', '系统功能', '系統功能', 'public fixture seed'),
  ('system_group_table_func_rights', 'Ryhmien taulutoimintojen oikeudet', 'Group table-function rights', '组表功能权限', '群組資料表功能權限', 'public fixture seed'),
  ('system_lang_keys', 'Kieliavaimet', 'Language keys', '语言键', '語言鍵', 'public fixture seed'),
  ('system_lang_keys_archive', 'Kieliavainarkisto', 'Language-key archive', '语言键归档', '語言鍵封存', 'public fixture seed'),
  ('system_lang_key_sources', 'Kieliavainlähteet', 'Language-key sources', '语言键来源', '語言鍵來源', 'public fixture seed'),
  ('system_schema_migrations', 'Skeemamigraatiot', 'Schema migrations', '架构迁移', '結構描述遷移', 'public fixture seed'),
  ('system_table_folders', 'Taulukansiot', 'Table folders', '表格文件夹', '資料表資料夾', 'public fixture seed'),
  ('system_table_row_view_counts', 'Rivien näyttökerrat', 'Table row view counts', '表行查看次数', '資料列檢視次數', 'public fixture seed'),
  ('system_table_views', 'Taulunäkymät', 'Table views', '表格视图', '資料表檢視', 'public fixture seed'),
  ('system_transaction_log', 'Tapahtumaloki', 'Transaction log', '事务日志', '交易記錄', 'public fixture seed'),
  ('system_user_column_settings', 'Käyttäjien sarakeasetukset', 'User column settings', '用户列设置', '用戶欄位設定', 'public fixture seed'),
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
           base.fi || ' – etusivu' AS fi,
           base.en || ' front page' AS en,
           COALESCE(NULLIF(base.ch, ''), base.en) || '首页' AS ch,
           COALESCE(NULLIF(base.yue, ''), NULLIF(base.ch, ''), base.en) || '首頁' AS yue
    FROM public.system_db_tables tables
    JOIN public.system_lang_keys base ON base.lang_key = tables.table_name
) derived
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys existing
    WHERE existing.lang_key = derived.lang_key
);
