-- 20260804000001_add_first_run_environment_and_login_verification.sql
-- VERSION_DB: 8.0.58
-- Adds the First Run environment purpose and user-owned login verification method.

ALTER TABLE restricted.users_restricted
    ADD COLUMN IF NOT EXISTS login_verification_method text NOT NULL DEFAULT 'email',
    ADD COLUMN IF NOT EXISTS fixed_pin_hash text,
    ADD COLUMN IF NOT EXISTS totp_secret text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_restricted_login_verification_method_check'
          AND conrelid = 'restricted.users_restricted'::regclass
    ) THEN
        ALTER TABLE restricted.users_restricted
            ADD CONSTRAINT users_restricted_login_verification_method_check
            CHECK (login_verification_method IN ('none', 'fixed_pin', 'totp', 'email'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_restricted_login_factor_shape_check'
          AND conrelid = 'restricted.users_restricted'::regclass
    ) THEN
        ALTER TABLE restricted.users_restricted
            ADD CONSTRAINT users_restricted_login_factor_shape_check
            CHECK (
                (login_verification_method = 'fixed_pin' AND fixed_pin_hash IS NOT NULL AND totp_secret IS NULL)
                OR (login_verification_method = 'totp' AND totp_secret IS NOT NULL AND fixed_pin_hash IS NULL)
                OR (login_verification_method IN ('none', 'email') AND fixed_pin_hash IS NULL AND totp_secret IS NULL)
            );
    END IF;
END $$;

INSERT INTO public.system_config (key, json_value, creation_spec, text_value, value_type)
SELECT
    'installation_environment',
    '{"value":""}'::jsonb,
    'User-facing installation purpose selected during First Run. Empty preserves the deployment-defined fallback until First Run saves an explicit choice.',
    '',
    (
        SELECT id
        FROM public.system_config_value_data_types
        WHERE lower(data_type) IN ('text', 'string')
        ORDER BY id
        LIMIT 1
    )
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'installation_environment');

INSERT INTO public.system_lang_keys (lang_key, en, fi, ch, yue, creation_spec)
VALUES
    ('form_sections', 'Form sections', 'Lomakkeen osiot', '表单部分', '表格部分', 'Accessible label for reusable multi-section form navigation.'),
    ('previous', 'Previous', 'Edellinen', '上一步', '上一步', 'Shared previous-navigation label.'),
    ('next', 'Next', 'Seuraava', '下一步', '下一步', 'Shared next-navigation label.'),
    ('back', 'Back', 'Takaisin', '返回', '返回', 'Shared back-navigation button label.'),
    ('proceed', 'Proceed', 'Jatka', '继续', '繼續', 'Shared forward-navigation button label.'),
    ('first_run_welcome', 'Welcome to Filterest!', 'Tervetuloa Filterestiin!', '欢迎使用 Filterest！', '歡迎使用 Filterest！', 'Fixed multilingual Filterest welcome before the installation has a site identity.'),
    ('first_run_section_settings', 'Environment', 'Ympäristö', '环境', '環境', 'First Run settings section label.'),
    ('first_run_section_credentials', 'Credentials', 'Tunnukset', '登录凭据', '登入資料', 'First Run credentials section label.'),
    ('first_run_settings_title', 'Set up your workspace', 'Määritä työympäristö', '设置工作区', '設定工作區', 'First Run environment and verification heading.'),
    ('first_run_settings_description', 'Choose how this installation is used and how the first administrator verifies sign-ins.', 'Valitse asennuksen käyttötarkoitus ja tapa, jolla ensimmäinen pääkäyttäjä varmentaa kirjautumiset.', '选择此安装的用途以及首位管理员验证登录的方式。', '選擇此安裝的用途，以及首位管理員驗證登入的方式。', 'Explains the first First Run section.'),
    ('first_run_environment_legend', 'Environment', 'Ympäristö', '环境', '環境', 'First Run environment choice legend.'),
    ('environment_development', 'Development', 'Devaus', '开发', '開發', 'Development environment choice.'),
    ('environment_development_description', 'For building and changing the application.', 'Sovelluksen kehittämiseen ja muuttamiseen.', '用于构建和修改应用程序。', '用於建構及修改應用程式。', 'Development environment description.'),
    ('environment_testing', 'Testing', 'Testaus', '测试', '測試', 'Testing environment choice.'),
    ('environment_testing_description', 'For testing in a development-like environment.', 'Devausta vastaavaan testaukseen.', '用于类似开发环境的测试。', '用於類似開發環境的測試。', 'Testing environment description.'),
    ('environment_qa', 'QA', 'QA', 'QA', 'QA', 'Quality-assurance environment choice.'),
    ('environment_qa_description', 'For quality assurance and release verification.', 'Laadunvarmistukseen ja julkaisujen tarkistukseen.', '用于质量保证和发布验证。', '用於品質保證及發佈驗證。', 'Quality-assurance environment description.'),
    ('environment_production', 'Production', 'Tuotanto', '生产', '正式環境', 'Production environment choice.'),
    ('environment_production_description', 'For real users and live data.', 'Oikeille käyttäjille ja tuotantodatalle.', '用于真实用户和正式数据。', '用於真實使用者及正式資料。', 'Production environment description.'),
    ('first_run_verification_legend', 'Sign-in verification', 'Kirjautumisen varmennus', '登录验证', '登入驗證', 'First Run login verification choice legend.'),
    ('verification_none', 'No additional verification', 'Ei lisävarmennusta', '无额外验证', '不作額外驗證', 'Password-only login method label.'),
    ('verification_none_description', 'Sign in with username and password only.', 'Kirjaudu vain käyttäjätunnuksella ja salasanalla.', '仅使用用户名和密码登录。', '只使用使用者名稱及密碼登入。', 'Password-only login description.'),
    ('verification_fixed_pin', 'Fixed PIN', 'Kiinteä PIN', '固定 PIN', '固定 PIN', 'Fixed PIN login method label.'),
    ('verification_fixed_pin_description', 'Use the same private 4–8 digit PIN at every sign-in.', 'Käytä samaa yksityistä 4–8 numeron PIN-koodia jokaisella kirjautumisella.', '每次登录都使用同一个私密的 4–8 位数字 PIN。', '每次登入都使用同一個私密的 4–8 位數字 PIN。', 'Fixed PIN login description.'),
    ('verification_authenticator', 'Authenticator app', 'Autentikaattorisovellus', '身份验证器应用', '驗證器應用程式', 'Generic TOTP authenticator method label.'),
    ('verification_authenticator_description', 'Works with standard TOTP apps, including Google Authenticator.', 'Toimii standardia TOTP:tä tukevilla sovelluksilla, myös Google Authenticatorilla.', '适用于标准 TOTP 应用，包括 Google Authenticator。', '適用於標準 TOTP 應用程式，包括 Google Authenticator。', 'Generic TOTP authenticator description.'),
    ('verification_email', 'Email', 'Sähköposti', '电子邮件', '電郵', 'Email login verification method label.'),
    ('verification_email_description', 'Sends a one-time code through Postmark. Requires a free external Postmark account.', 'Lähettää kertakäyttökoodin Postmarkin kautta. Vaatii ilmaisen ulkoisen Postmark-tilin.', '通过 Postmark 发送一次性代码。需要免费的外部 Postmark 账户。', '透過 Postmark 傳送一次性驗證碼。需要免費的外部 Postmark 帳戶。', 'Email verification description and provider requirement.'),
    ('fixed_pin', 'Fixed PIN', 'Kiinteä PIN', '固定 PIN', '固定 PIN', 'Fixed PIN field label.'),
    ('confirm_fixed_pin', 'Confirm fixed PIN', 'Vahvista kiinteä PIN', '确认固定 PIN', '確認固定 PIN', 'Fixed PIN confirmation field label.'),
    ('authenticator_setup_key', 'Add this setup key to your authenticator app:', 'Lisää tämä käyttöönottoavain autentikaattorisovellukseesi:', '将此设置密钥添加到身份验证器应用中：', '將此設定密鑰加入驗證器應用程式：', 'Authenticator manual enrollment instruction.'),
    ('authenticator_confirmation_code', 'Enter the current 6-digit code to confirm setup', 'Vahvista käyttöönotto syöttämällä nykyinen 6-numeroinen koodi', '输入当前的 6 位代码以确认设置', '輸入目前的 6 位驗證碼以確認設定', 'Authenticator enrollment confirmation label.'),
    ('verification_fixed_pin_prompt', 'Enter your fixed PIN.', 'Syötä kiinteä PIN-koodisi.', '输入固定 PIN。', '輸入固定 PIN。', 'Login prompt for fixed PIN.'),
    ('verification_authenticator_prompt', 'Enter the current code from your authenticator app.', 'Syötä autentikaattorisovelluksen nykyinen koodi.', '输入身份验证器应用中的当前代码。', '輸入驗證器應用程式中的目前驗證碼。', 'Login prompt for TOTP authenticator.'),
    ('verification_email_prompt', 'Verification code sent: $site_name', 'Vahvistuskoodi lähetetty: $site_name', '验证代码已发送：$site_name', '驗證碼已傳送：$site_name', 'Login email prompt with masked address.'),
    ('first_run_environment_invalid', 'Choose an environment.', 'Valitse ympäristö.', '请选择环境。', '請選擇環境。', 'First Run environment validation error.'),
    ('first_run_verification_invalid', 'Choose a sign-in verification method.', 'Valitse kirjautumisen varmennustapa.', '请选择登录验证方式。', '請選擇登入驗證方式。', 'First Run verification method validation error.'),
    ('first_run_fixed_pin_invalid', 'Use 4–8 digits for the fixed PIN.', 'Käytä kiinteässä PIN-koodissa 4–8 numeroa.', '固定 PIN 需使用 4–8 位数字。', '固定 PIN 需使用 4–8 位數字。', 'First Run fixed PIN validation error.'),
    ('first_run_fixed_pin_mismatch', 'The fixed PIN values do not match.', 'Kiinteät PIN-koodit eivät täsmää.', '两次输入的固定 PIN 不一致。', '兩次輸入的固定 PIN 不一致。', 'First Run fixed PIN confirmation error.'),
    ('first_run_totp_invalid', 'Confirm the authenticator setup with a valid current code.', 'Vahvista autentikaattorin käyttöönotto kelvollisella nykyisellä koodilla.', '请使用有效的当前代码确认身份验证器设置。', '請使用有效的目前驗證碼確認驗證器設定。', 'First Run TOTP enrollment validation error.'),
    ('first_run_postmark_required', 'Email verification requires POSTMARK_API_KEY and EMAIL_FROM_ADDRESS in the protected environment file.', 'Sähköpostivarmennus vaatii suojattuun ympäristötiedostoon POSTMARK_API_KEY- ja EMAIL_FROM_ADDRESS-arvot.', '电子邮件验证需要在受保护的环境文件中设置 POSTMARK_API_KEY 和 EMAIL_FROM_ADDRESS。', '電郵驗證需要在受保護的環境檔案中設定 POSTMARK_API_KEY 及 EMAIL_FROM_ADDRESS。', 'First Run Postmark readiness error.'),
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
       'Labels and validates the reusable two-section First Run form.',
       CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN (
    'form_sections', 'previous', 'next', 'back', 'proceed', 'first_run_welcome',
    'first_run_section_settings', 'first_run_section_credentials',
    'first_run_settings_title', 'first_run_settings_description',
    'first_run_environment_legend', 'environment_development',
    'environment_development_description', 'environment_testing',
    'environment_testing_description', 'environment_qa',
    'environment_qa_description', 'environment_production',
    'environment_production_description', 'first_run_verification_legend',
    'verification_none', 'verification_none_description', 'verification_fixed_pin',
    'verification_fixed_pin_description', 'verification_authenticator',
    'verification_authenticator_description', 'verification_email',
    'verification_email_description', 'fixed_pin', 'confirm_fixed_pin',
    'authenticator_setup_key', 'authenticator_confirmation_code',
    'verification_fixed_pin_prompt', 'verification_authenticator_prompt',
    'verification_email_prompt', 'first_run_environment_invalid',
    'first_run_verification_invalid', 'first_run_fixed_pin_invalid',
    'first_run_fixed_pin_mismatch', 'first_run_totp_invalid',
    'first_run_postmark_required', 'first_run_admin_description'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.58', 'Added First Run environment purpose and absolute user-owned login verification methods.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '8.0.58');
