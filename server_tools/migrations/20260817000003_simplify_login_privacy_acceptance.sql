-- 20260817000003_simplify_login_privacy_acceptance.sql
-- Replaces two independently translated login fragments with one fluent,
-- fully linked privacy-acceptance sentence.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES (
    'privacy_notice_login_acceptance',
    'Kirjautuaksesi sinun on hyväksyttävä tietosuojaseloste.',
    'To sign in, you must accept the privacy notice.',
    '登录前，您必须接受隐私声明。',
    '登入前，你必須接受私隱聲明。',
    'Single linked sentence beside the sign-in privacy acceptance checkbox.'
)
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH authored_translations AS (
    SELECT keys.id AS lang_key_id,
           values.language_code,
           values.translation,
           values.review_status
    FROM public.system_lang_keys AS keys
    CROSS JOIN LATERAL (
        VALUES
            ('en'::TEXT, keys.en, 'approved'::TEXT),
            ('fi'::TEXT, keys.fi, 'approved'::TEXT),
            ('zh-CN'::TEXT, keys.ch, 'needs_review'::TEXT)
    ) AS values(language_code, translation, review_status)
    WHERE keys.lang_key = 'privacy_notice_login_acceptance'
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    authored.lang_key_id,
    authored.language_code,
    authored.translation,
    'manual',
    authored.review_status
FROM authored_translations AS authored
WHERE NULLIF(btrim(authored.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now();
