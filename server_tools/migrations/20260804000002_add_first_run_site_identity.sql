-- 20260804000002_add_first_run_site_identity.sql
-- VERSION_DB: 8.0.58
-- VERSION_DB_OWNER: 20260804000001_add_first_run_environment_and_login_verification.sql
-- Makes the First Run site name an explicit, multilingual, persisted identity.

INSERT INTO public.system_config (key, json_value, creation_spec, text_value, value_type)
SELECT
    'site_name',
    '{"value":""}'::jsonb,
    'Administrator-owned browser-facing identity selected during First Run.',
    '',
    (
        SELECT id
        FROM public.system_config_value_data_types
        WHERE lower(data_type) IN ('text', 'string')
        ORDER BY id
        LIMIT 1
    )
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'site_name');

INSERT INTO public.system_lang_keys (lang_key, en, fi, ch, yue, creation_spec)
VALUES
    ('first_run_welcome', 'Welcome to Filterest!', 'Tervetuloa Filterestiin!', '欢迎使用 Filterest！', '歡迎使用 Filterest！', 'Fixed multilingual Filterest welcome before the installation has a site identity.'),
    ('first_run_site_name', 'Site name', 'Sivuston nimi', '站点名称', '網站名稱', 'First Run site identity field label.'),
    ('first_run_site_name_invalid', 'Enter a site name containing 1–100 characters.', 'Anna sivustolle 1–100 merkkiä pitkä nimi.', '请输入 1–100 个字符的站点名称。', '請輸入 1–100 個字元的網站名稱。', 'First Run site identity validation error.'),
    ('first_run_admin_description', 'Choose the site name and administrator credentials for this installation. Email is also used for account recovery and messages.', 'Valitse tämän asennuksen sivuston nimi ja pääkäyttäjän tunnukset. Sähköpostia käytetään myös tilin palautukseen ja viesteihin.', '为此安装设置站点名称和管理员凭据。电子邮件也用于账户恢复和消息。', '為此安裝設定網站名稱及管理員登入資料。電郵亦用於帳戶復原及訊息。', 'First Run site identity and administrator description.')
ON CONFLICT (lang_key) DO UPDATE
SET en = EXCLUDED.en,
    fi = EXCLUDED.fi,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = NOW();

INSERT INTO public.system_lang_key_sources (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id,
       'template',
       'frontend/templates/first_run_admin.html',
       '',
       'Labels and validates the First Run site identity field and fixed Filterest welcome.',
       CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('first_run_welcome', 'first_run_site_name', 'first_run_site_name_invalid', 'first_run_admin_description')
ON CONFLICT DO NOTHING;
