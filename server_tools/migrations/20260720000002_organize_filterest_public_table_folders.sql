-- 20260720000002_organize_filterest_public_table_folders.sql
-- Builds the public Filterest database tree and assigns its seeded datasets.
-- Keeps Easelect-source and non-replaceable domain folder choices untouched.
-- VERSION_DB: 8.0.53

DO $$
DECLARE
    v_instance_kind TEXT;
    v_overwrite_possible BOOLEAN;
    v_database_folder_id BIGINT;
    v_system_folder_id BIGINT;
    v_apps_folder_id BIGINT;
    v_filterest_folder_id BIGINT;
    v_users_folder_id BIGINT;
    v_logs_folder_id BIGINT;
    v_mgmt_folder_id BIGINT;
    v_functions_folder_id BIGINT;
    v_about_folder_id BIGINT;
    v_lang_folder_id BIGINT;
    v_tables_folder_id BIGINT;
    v_columns_folder_id BIGINT;
    v_other_tables_folder_id BIGINT;
    v_admin_user_id BIGINT;
BEGIN
    SELECT text_value
    INTO v_instance_kind
    FROM public.system_config
    WHERE key = 'instance_kind'
    ORDER BY id
    LIMIT 1;

    SELECT boolean_value
    INTO v_overwrite_possible
    FROM public.system_config
    WHERE key = 'overwrite_possible'
    ORDER BY id
    LIMIT 1;

    IF v_instance_kind IS DISTINCT FROM 'filterest_sibling'
       OR v_overwrite_possible IS DISTINCT FROM TRUE THEN
        RETURN;
    END IF;

    SELECT id
    INTO v_database_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'database'
      AND parent_id IS NULL
    ORDER BY id
    LIMIT 1;

    IF v_database_folder_id IS NULL THEN
        RAISE EXCEPTION 'Filterest public folder migration requires the database root folder';
    END IF;

    SELECT id
    INTO v_admin_user_id
    FROM public.system_users
    WHERE privileged = TRUE
    ORDER BY id
    LIMIT 1;

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT 'system', 'Platform configuration and administration metadata',
           CURRENT_DATE, CURRENT_DATE, v_database_folder_id,
           'Filterest public folder hierarchy', FALSE, NULL, '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_table_folders
        WHERE folder_name = 'system' AND parent_id = v_database_folder_id
    );

    SELECT id INTO v_system_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'system' AND parent_id = v_database_folder_id
    ORDER BY id LIMIT 1;

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT 'development', 'Development-time datasets and tools',
           CURRENT_DATE, CURRENT_DATE, v_database_folder_id,
           'Filterest public folder hierarchy', FALSE, NULL, '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_table_folders
        WHERE folder_name = 'development' AND parent_id = v_database_folder_id
    );

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT 'apps', 'Application and project workspaces',
           CURRENT_DATE, CURRENT_DATE, v_database_folder_id,
           'Filterest public folder hierarchy', FALSE, NULL, '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_table_folders
        WHERE folder_name = 'apps' AND parent_id = v_database_folder_id
    );

    SELECT id INTO v_apps_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'apps' AND parent_id = v_database_folder_id
    ORDER BY id LIMIT 1;

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT 'filterest', 'Filterest public example workspace',
           CURRENT_DATE, CURRENT_DATE, v_apps_folder_id,
           'Filterest public folder hierarchy', FALSE, v_admin_user_id, '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_table_folders
        WHERE folder_name = 'filterest' AND parent_id = v_apps_folder_id
    );

    SELECT id INTO v_filterest_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'filterest' AND parent_id = v_apps_folder_id
    ORDER BY id LIMIT 1;

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT child.folder_name, child.folder_description,
           CURRENT_DATE, CURRENT_DATE, v_system_folder_id,
           'Filterest public folder hierarchy', FALSE, NULL, '[]'::jsonb
    FROM (VALUES
        ('users_and_groups', 'Users, groups, and memberships'),
        ('logs', 'Runtime and transaction logs'),
        ('mgmt_helpers', 'Database-management helper metadata'),
        ('functions_and_rights', 'Functions and group permissions'),
        ('about', 'Product and privacy information'),
        ('lang', 'Language keys and their sources'),
        ('tables', 'Dataset and folder metadata'),
        ('columns', 'Column metadata and user column settings')
    ) AS child(folder_name, folder_description)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_table_folders existing
        WHERE existing.folder_name = child.folder_name
          AND existing.parent_id = v_system_folder_id
    );

    SELECT id INTO v_users_folder_id FROM public.system_table_folders
    WHERE folder_name = 'users_and_groups' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_logs_folder_id FROM public.system_table_folders
    WHERE folder_name = 'logs' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_mgmt_folder_id FROM public.system_table_folders
    WHERE folder_name = 'mgmt_helpers' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_functions_folder_id FROM public.system_table_folders
    WHERE folder_name = 'functions_and_rights' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_about_folder_id FROM public.system_table_folders
    WHERE folder_name = 'about' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_lang_folder_id FROM public.system_table_folders
    WHERE folder_name = 'lang' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_tables_folder_id FROM public.system_table_folders
    WHERE folder_name = 'tables' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;
    SELECT id INTO v_columns_folder_id FROM public.system_table_folders
    WHERE folder_name = 'columns' AND parent_id = v_system_folder_id
    ORDER BY id LIMIT 1;

    INSERT INTO public.system_table_folders (
        folder_name, folder_description, created, updated, parent_id,
        creation_spec, is_current_project, admin_user_id, tab_order_json
    )
    SELECT 'other_tables', 'Other platform and relation tables',
           CURRENT_DATE, CURRENT_DATE, v_database_folder_id,
           'Filterest public folder hierarchy', FALSE, NULL, '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_table_folders
        WHERE folder_name = 'other_tables' AND parent_id = v_database_folder_id
    );

    SELECT id INTO v_other_tables_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'other_tables' AND parent_id = v_database_folder_id
    ORDER BY id LIMIT 1;

    UPDATE public.system_table_folders
    SET is_current_project = FALSE,
        updated = CURRENT_DATE
    WHERE is_current_project = TRUE
      AND id IS DISTINCT FROM v_filterest_folder_id;

    UPDATE public.system_table_folders
    SET is_current_project = TRUE,
        admin_user_id = COALESCE(admin_user_id, v_admin_user_id),
        tab_order_json = '[{"tab_id":"palvelukatalogi","sort_order":1},{"tab_id":"riskienhallinta","sort_order":2},{"tab_id":"dokumentaatio","sort_order":3},{"tab_id":"tiketit","sort_order":4},{"tab_id":"system_users","sort_order":5},{"tab_id":"static:user","sort_order":6},{"tab_id":"static:logout","sort_order":7}]'::jsonb,
        updated = CURRENT_DATE
    WHERE id = v_filterest_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_filterest_folder_id, updated = NOW()
    WHERE table_name IN ('palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit')
      AND folder_id IS DISTINCT FROM v_filterest_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_system_folder_id, updated = NOW()
    WHERE table_name = 'system_config'
      AND folder_id IS DISTINCT FROM v_system_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_users_folder_id, updated = NOW()
    WHERE table_name IN ('system_users', 'system_user_groups', 'system_user_group_memberships')
      AND folder_id IS DISTINCT FROM v_users_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_logs_folder_id, updated = NOW()
    WHERE table_name = 'system_transaction_log'
      AND folder_id IS DISTINCT FROM v_logs_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_mgmt_folder_id, updated = NOW()
    WHERE table_name IN (
        'system_db_version', 'system_foreign_key_relations_1_m',
        'system_foreign_key_relations_m_m', 'system_schema_migrations',
        'system_table_row_view_counts', 'system_table_views'
    )
      AND folder_id IS DISTINCT FROM v_mgmt_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_functions_folder_id, updated = NOW()
    WHERE table_name IN ('system_functions', 'system_group_table_func_rights')
      AND folder_id IS DISTINCT FROM v_functions_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_about_folder_id, updated = NOW()
    WHERE table_name = 'system_about'
      AND folder_id IS DISTINCT FROM v_about_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_lang_folder_id, updated = NOW()
    WHERE table_name IN ('system_lang_keys', 'system_lang_keys_archive', 'system_lang_key_sources')
      AND folder_id IS DISTINCT FROM v_lang_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_tables_folder_id, updated = NOW()
    WHERE table_name IN ('system_db_tables', 'system_table_folders')
      AND folder_id IS DISTINCT FROM v_tables_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_columns_folder_id, updated = NOW()
    WHERE table_name IN ('system_column_control', 'system_column_details', 'system_user_column_settings')
      AND folder_id IS DISTINCT FROM v_columns_folder_id;

    UPDATE public.system_db_tables SET folder_id = v_other_tables_folder_id, updated = NOW()
    WHERE table_name IN (
        'ai_chat_conversations', 'payments', 'spatial_ref_sys',
        'system_audit_log', 'system_child_tab_config',
        'dokumentaatio_tiketit_relation',
        'palvelukatalogi_dokumentaatio_relation',
        'palvelukatalogi_riskienhallinta_relation',
        'palvelukatalogi_tiketit_relation',
        'riskienhallinta_dokumentaatio_relation',
        'riskienhallinta_tiketit_relation'
    )
      AND folder_id IS DISTINCT FROM v_other_tables_folder_id;
END $$;

DO $$
DECLARE
    v_translation RECORD;
BEGIN
    FOR v_translation IN
        SELECT *
        FROM (VALUES
            ('system', 'Järjestelmä', 'System', '系统', '系統'),
            ('development', 'Kehitys', 'Development', '开发', '開發'),
            ('apps', 'Sovellukset', 'Apps', '应用', '應用程式'),
            ('filterest', 'Filterest', 'Filterest', 'Filterest', 'Filterest'),
            ('users_and_groups', 'Käyttäjät ja ryhmät', 'Users and groups', '用户与用户组', '用戶同群組'),
            ('logs', 'Lokit', 'Logs', '日志', '日誌'),
            ('mgmt_helpers', 'Hallinnan apurakenteet', 'Management helpers', '管理辅助项', '管理輔助項目'),
            ('functions_and_rights', 'Toiminnot ja oikeudet', 'Functions and rights', '功能与权限', '功能同權限'),
            ('about', 'Tietoja', 'About', '关于', '關於'),
            ('lang', 'Kielet', 'Language', '语言', '語言'),
            ('tables', 'Taulut', 'Tables', '表格', '資料表'),
            ('columns', 'Sarakkeet', 'Columns', '列', '欄位')
        ) AS translations(lang_key, fi, en, ch, yue)
    LOOP
        UPDATE public.system_lang_keys
        SET fi = v_translation.fi,
            en = v_translation.en,
            ch = v_translation.ch,
            yue = v_translation.yue,
            updated = NOW()
        WHERE lang_key = v_translation.lang_key;

        IF NOT FOUND THEN
            INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
            VALUES (
                v_translation.lang_key,
                v_translation.fi,
                v_translation.en,
                v_translation.ch,
                v_translation.yue,
                'Filterest public folder hierarchy'
            );
        END IF;
    END LOOP;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.53',
       'Organized the replaceable Filterest public workspace into the database, system, apps, and other-tables hierarchy.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '8.0.53'
);
