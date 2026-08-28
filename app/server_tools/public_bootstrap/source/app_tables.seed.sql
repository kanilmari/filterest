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
