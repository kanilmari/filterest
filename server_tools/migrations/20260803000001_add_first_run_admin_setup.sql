-- 20260803000001_add_first_run_admin_setup.sql
-- VERSION_DB: 8.0.57
-- Adds a fail-closed first-run flag and four-language browser setup labels.
-- Existing databases with a login-ready admin start closed; fresh public databases start pending.

INSERT INTO public.system_config (key, json_value, creation_spec, boolean_value, value_type)
SELECT
    'first_run',
    jsonb_build_object(
        'value',
        NOT EXISTS (
            SELECT 1
            FROM public.system_users u
            JOIN public.system_user_group_memberships ug ON ug.user_id = u.id
            JOIN public.system_user_groups g ON g.id = ug.group_id AND g.name = 'admins'
            JOIN restricted.users_restricted ur ON ur.id = u.id
            WHERE u.enabled IS TRUE
              AND u.admin_access_allowed IS TRUE
        )
    ),
    'Controls the one-time browser form for creating the first login-ready administrator. It is closed atomically after successful account creation.',
    NOT EXISTS (
        SELECT 1
        FROM public.system_users u
        JOIN public.system_user_group_memberships ug ON ug.user_id = u.id
        JOIN public.system_user_groups g ON g.id = ug.group_id AND g.name = 'admins'
        JOIN restricted.users_restricted ur ON ur.id = u.id
        WHERE u.enabled IS TRUE
          AND u.admin_access_allowed IS TRUE
    ),
    (
        SELECT id
        FROM public.system_config_value_data_types
        WHERE lower(data_type) IN ('boolean', 'bool')
        ORDER BY id
        LIMIT 1
    )
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'first_run');

INSERT INTO public.system_lang_keys (lang_key, en, fi, ch, yue, creation_spec)
VALUES
    ('first_run_admin_title', 'Create the first administrator', 'Luo ensimmäinen pääkäyttäjä', '创建首位管理员', '建立第一位管理員', 'First-run administrator setup page title.'),
    ('first_run_admin_description', 'Choose the administrator credentials for this installation. The email address will be used for sign-in verification and account messages.', 'Valitse tämän asennuksen pääkäyttäjän tunnukset. Sähköpostiosoitetta käytetään kirjautumisen vahvistamiseen ja käyttäjätilin viesteihin.', '请为此安装设置管理员凭据。该电子邮件地址将用于登录验证和账户通知。', '請為此安裝設定管理員登入資料。電郵地址會用於登入驗證及帳戶通知。', 'Explains the first-run administrator form and future email use.'),
    ('first_run_admin_submit', 'Create administrator', 'Luo pääkäyttäjä', '创建管理员', '建立管理員', 'Submits the one-time first administrator form.'),
    ('email', 'Email', 'Sähköposti', '电子邮件', '電郵', 'Shared email-field label for authentication forms.'),
    ('password', 'Password', 'Salasana', '密码', '密碼', 'Shared password-field label for authentication forms.'),
    ('confirm_password', 'Confirm password', 'Vahvista salasana', '确认密码', '確認密碼', 'Labels a password confirmation field.'),
    ('first_run_username_invalid', 'Use 3–64 characters: letters, numbers, dots, underscores, or hyphens.', 'Käytä 3–64 merkkiä: kirjaimia, numeroita, pisteitä, alaviivoja tai yhdysmerkkejä.', '请输入 3–64 个字符，可使用字母、数字、句点、下划线或连字符。', '請輸入 3–64 個字元，可使用字母、數字、句號、底線或連字號。', 'First administrator username validation error.'),
    ('first_run_email_invalid', 'Enter a valid email address.', 'Anna kelvollinen sähköpostiosoite.', '请输入有效的电子邮件地址。', '請輸入有效的電郵地址。', 'First administrator email validation error.'),
    ('first_run_password_invalid', 'Use a password containing 12–128 characters.', 'Käytä 12–128 merkin pituista salasanaa.', '密码长度须为 12–128 个字符。', '密碼長度須為 12–128 個字元。', 'First administrator password length error.'),
    ('first_run_password_mismatch', 'The passwords do not match.', 'Salasanat eivät täsmää.', '两次输入的密码不一致。', '兩次輸入的密碼不一致。', 'First administrator password confirmation error.'),
    ('first_run_admin_creation_failed', 'The administrator could not be created. No setup changes were saved.', 'Pääkäyttäjää ei voitu luoda. Mitään asetusmuutoksia ei tallennettu.', '无法创建管理员，未保存任何设置更改。', '無法建立管理員，未儲存任何設定變更。', 'Atomic first administrator creation failure message.')
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
       'Labels and validates the one-time first administrator setup form.',
       CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN (
    'first_run_admin_title', 'first_run_admin_description', 'first_run_admin_submit',
    'email', 'password', 'confirm_password', 'first_run_username_invalid', 'first_run_email_invalid',
    'first_run_password_invalid', 'first_run_password_mismatch', 'first_run_admin_creation_failed'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.57', 'Added fail-closed multilingual first-run administrator browser setup.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '8.0.57');
