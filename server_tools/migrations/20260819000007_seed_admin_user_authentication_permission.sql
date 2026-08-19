-- 20260819000007_seed_admin_user_authentication_permission.sql
-- Registers the administrator-only user provisioning and sign-in-method API
-- before route startup so the admins group can reach the new tableless route.
-- VERSION_DB: 9.2.1
-- VERSION_DB_OWNER: 20260819000006_enable_admin_owned_registration.sql

WITH desired_function (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES (
        'auth.AdminUserAuthenticationHandler',
        'auth',
        FALSE,
        '/api/admin/user-authentication'
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
    'Filterest DB 9.2.1 administrator user authentication',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_function AS missing;

WITH desired_function (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES (
        'auth.AdminUserAuthenticationHandler',
        'auth',
        FALSE,
        '/api/admin/user-authentication'
    )
)
UPDATE public.system_functions AS target
SET disabled = FALSE,
    updated = now(),
    package = desired.package,
    specific_table_related = desired.specific_table_related,
    creation_spec = 'Filterest DB 9.2.1 administrator user authentication',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.url_route_endpoint,
    ui_only = FALSE
FROM desired_function AS desired
WHERE target.name = desired.name;

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    ('user_authentication', 'Käyttäjien kirjautuminen', 'User authentication', '用户身份验证', '用戶登入驗證', 'Administrator user authentication tool.'),
    ('user_authentication_description', 'Valitse käyttäjä, tarkista nykytila ja valitse kirjautuminen ilman lisävahvistusta, kiinteällä PINillä tai sähköpostikoodilla.', 'Select a user, review the current status, and choose sign-in without additional verification, with a fixed PIN, or with an email code.', '选择用户、检查当前状态，并选择无需额外验证、固定 PIN 或电子邮件代码登录。', '揀選用戶、檢查目前狀態，並選擇毋須額外驗證、固定 PIN 或電郵代碼登入。', 'Description for the administrator user authentication tool.'),
    ('select_user', 'Valitse käyttäjä', 'Select a user', '选择用户', '揀選用戶', 'Placeholder in the administrator user selector.'),
    ('current_status', 'Nykytila', 'Current status', '当前状态', '目前狀態', 'Heading for the selected user state.'),
    ('login_verification_method', 'Kirjautumisen vahvistustapa', 'Sign-in verification method', '登录验证方式', '登入驗證方式', 'Legend for login verification choices.'),
    ('verification_method_none', 'Ei lisävahvistusta', 'No additional verification', '无需额外验证', '毋須額外驗證', 'Password-only login choice.'),
    ('verification_method_fixed_pin', 'Kiinteä PIN', 'Fixed PIN', '固定 PIN', '固定 PIN', 'Fixed PIN login choice.'),
    ('verification_method_email', 'Sähköpostikoodi', 'Email code', '电子邮件代码', '電郵代碼', 'Email-code login choice.'),
    ('verification_method_totp_unmanaged', 'Todennussovellus (ei hallittavissa tällä työkalulla)', 'Authenticator app (not managed by this tool)', '身份验证器应用（此工具不管理）', '驗證器應用程式（呢個工具唔管理）', 'Read-only label for an existing TOTP method.'),
    ('verification_method_unavailable', 'Menetelmä ei ole käytettävissä', 'Unavailable method', '不可用的方式', '不可用嘅方式', 'Fallback label for an unsupported stored method.'),
    ('verification_method_none_description', 'Vain salasana; ei toista vahvistusvaihetta.', 'Password only; no second verification step.', '仅使用密码；没有第二个验证步骤。', '只用密碼；冇第二個驗證步驟。', 'Password-only login explanation.'),
    ('verification_method_fixed_pin_description', 'Salasanan jälkeen kysytään yksityinen 4–8 numeron PIN.', 'Ask for a private 4–8 digit PIN after the password.', '输入密码后，再输入私密的 4–8 位 PIN。', '輸入密碼後，再輸入私人嘅 4–8 位 PIN。', 'Fixed PIN login explanation.'),
    ('verification_method_email_description', 'Kertakäyttöinen koodi lähetetään käyttäjän sähköpostiin.', 'Send a one-time code to the user''s email address.', '向用户的电子邮件地址发送一次性代码。', '傳送一次性代碼去用戶嘅電郵地址。', 'Email-code login explanation.'),
    ('user_status_enabled', 'Tunnus käytössä', 'Account enabled', '账户已启用', '帳戶已啟用', 'Selected user enabled state.'),
    ('user_status_admin_group', 'Admins-ryhmän jäsen', 'Admins group member', '管理员组成员', '管理員群組成員', 'Selected user admin-group state.'),
    ('user_status_admin_access', 'Admin-käyttö sallittu', 'Administrator access allowed', '允许管理员访问', '允許管理員存取', 'Selected user admin-access flag state.'),
    ('user_status_verification_method', 'Lisävahvistus', 'Additional verification', '额外验证', '額外驗證', 'Selected user login verification state.'),
    ('user_authentication_activation_notice', 'Tallennus ottaa tunnuksen käyttöön, lisää sen admins-ryhmään ja sallii admin-käytön.', 'Saving also enables this account, adds it to the admins group, and allows administrator access.', '保存还会启用此账户、将其添加到管理员组并允许管理员访问。', '儲存亦會啟用呢個帳戶、加入管理員群組，同埋允許管理員存取。', 'Security notice before administrator provisioning.'),
    ('save_and_activate_admin', 'Tallenna ja aktivoi admin', 'Save and activate administrator', '保存并激活管理员', '儲存並啟用管理員', 'Administrator provisioning action.'),
    ('fixed_pin_format_error', 'PIN-koodissa pitää olla 4–8 numeroa.', 'PIN must contain 4–8 digits.', 'PIN 必须包含 4–8 位数字。', 'PIN 必須包含 4–8 個數字。', 'Fixed PIN client validation error.'),
    ('fixed_pin_mismatch', 'PIN-koodit eivät täsmää.', 'The PIN entries do not match.', '两次输入的 PIN 不一致。', '兩次輸入嘅 PIN 唔一致。', 'Fixed PIN confirmation error.'),
    ('select_supported_verification_method', 'Valitse jokin käytettävissä olevista vahvistustavoista ennen tallennusta.', 'Select one of the available verification methods before saving.', '保存前请选择一种可用的验证方式。', '儲存之前請揀一種可用嘅驗證方式。', 'Validation when an existing unsupported method has not been explicitly replaced.'),
    ('user_authentication_saved', 'Kirjautumisasetukset tallennettiin ja admin-käyttö aktivoitiin.', 'Authentication settings saved and administrator access activated.', '身份验证设置已保存，管理员访问权限已激活。', '登入驗證設定已儲存，管理員存取權已啟用。', 'Administrator provisioning success message.'),
    ('user_authentication_unavailable_readback', 'Tunnus päivitettiin, mutta palvelin palautti vahvistustavan, jota tämä työkalu ei voi hallita.', 'The account was updated, but the server returned a verification method this tool cannot manage.', '账户已更新，但服务器返回了此工具无法管理的验证方式。', '帳戶已更新，但伺服器傳回咗呢個工具無法管理嘅驗證方式。', 'Safe readback warning for an unsupported method.'),
    ('no_users_found', 'Käyttäjiä ei löytynyt.', 'No users found.', '未找到用户。', '搵唔到用戶。', 'Empty administrator user list message.')
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

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
    'Filterest DB 9.2.1 administrator user authentication',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'auth.AdminUserAuthenticationHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );
