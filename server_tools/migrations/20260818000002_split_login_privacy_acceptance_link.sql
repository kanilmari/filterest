-- 20260818000002_split_login_privacy_acceptance_link.sql
-- Splits the login privacy sentence into a translated prefix, linked notice name, and suffix.
-- Bridges legacy language columns with normalized locale rows so only the notice name is clickable.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'privacy_notice_login_acceptance_prefix',
            'Kirjautuaksesi sinun on hyväksyttävä ',
            'To sign in, you must accept the ',
            '登录前，您必须接受',
            '登入前，你必須接受',
            'Plain-text prefix before the linked privacy notice name; spacing is intentional for languages that use it.'
        ),
        (
            'privacy_notice_login_acceptance_link',
            'tietosuojaseloste',
            'privacy notice',
            '隐私声明',
            '私隱聲明',
            'Only the privacy notice name linked to the notice modal in the login acceptance sentence.'
        ),
        (
            'privacy_notice_login_acceptance_suffix',
            '.',
            '.',
            '。',
            '。',
            'Plain-text locale-specific sentence terminator after the linked privacy notice name.'
        )
)
UPDATE public.system_lang_keys AS existing
SET fi = authored.fi,
    en = authored.en,
    ch = authored.ch,
    yue = authored.yue,
    creation_spec = authored.creation_spec,
    updated = now()
FROM authored_keys AS authored
WHERE existing.lang_key = authored.lang_key;

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        (
            'privacy_notice_login_acceptance_prefix',
            'Kirjautuaksesi sinun on hyväksyttävä ',
            'To sign in, you must accept the ',
            '登录前，您必须接受',
            '登入前，你必須接受',
            'Plain-text prefix before the linked privacy notice name; spacing is intentional for languages that use it.'
        ),
        (
            'privacy_notice_login_acceptance_link',
            'tietosuojaseloste',
            'privacy notice',
            '隐私声明',
            '私隱聲明',
            'Only the privacy notice name linked to the notice modal in the login acceptance sentence.'
        ),
        (
            'privacy_notice_login_acceptance_suffix',
            '.',
            '.',
            '。',
            '。',
            'Plain-text locale-specific sentence terminator after the linked privacy notice name.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT
    authored.lang_key,
    authored.fi,
    authored.en,
    authored.ch,
    authored.yue,
    authored.creation_spec
FROM authored_keys AS authored
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = authored.lang_key
);

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('privacy_notice_login_acceptance_prefix', 'en', 'To sign in, you must accept the ', 'approved'),
        ('privacy_notice_login_acceptance_prefix', 'fi', 'Kirjautuaksesi sinun on hyväksyttävä ', 'approved'),
        ('privacy_notice_login_acceptance_prefix', 'zh-CN', '登录前，您必须接受', 'needs_review'),
        ('privacy_notice_login_acceptance_prefix', 'zh-TW', '登入前，您必須接受', 'needs_review'),
        ('privacy_notice_login_acceptance_prefix', 'zh-HK', '登入前，你必須接受', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'en', 'privacy notice', 'approved'),
        ('privacy_notice_login_acceptance_link', 'fi', 'tietosuojaseloste', 'approved'),
        ('privacy_notice_login_acceptance_link', 'zh-CN', '隐私声明', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'zh-TW', '隱私權聲明', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'zh-HK', '私隱聲明', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'en', '.', 'approved'),
        ('privacy_notice_login_acceptance_suffix', 'fi', '.', 'approved'),
        ('privacy_notice_login_acceptance_suffix', 'zh-CN', '。', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'zh-TW', '。', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'zh-HK', '。', 'needs_review')
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
UPDATE public.system_lang_key_translations AS existing
SET translation = resolved.translation,
    source_kind = 'manual',
    review_status = resolved.review_status,
    updated = now()
FROM resolved
WHERE existing.lang_key_id = resolved.lang_key_id
  AND existing.language_code = resolved.language_code;

WITH authored_translations(lang_key, language_code, translation, review_status) AS (
    VALUES
        ('privacy_notice_login_acceptance_prefix', 'en', 'To sign in, you must accept the ', 'approved'),
        ('privacy_notice_login_acceptance_prefix', 'fi', 'Kirjautuaksesi sinun on hyväksyttävä ', 'approved'),
        ('privacy_notice_login_acceptance_prefix', 'zh-CN', '登录前，您必须接受', 'needs_review'),
        ('privacy_notice_login_acceptance_prefix', 'zh-TW', '登入前，您必須接受', 'needs_review'),
        ('privacy_notice_login_acceptance_prefix', 'zh-HK', '登入前，你必須接受', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'en', 'privacy notice', 'approved'),
        ('privacy_notice_login_acceptance_link', 'fi', 'tietosuojaseloste', 'approved'),
        ('privacy_notice_login_acceptance_link', 'zh-CN', '隐私声明', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'zh-TW', '隱私權聲明', 'needs_review'),
        ('privacy_notice_login_acceptance_link', 'zh-HK', '私隱聲明', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'en', '.', 'approved'),
        ('privacy_notice_login_acceptance_suffix', 'fi', '.', 'approved'),
        ('privacy_notice_login_acceptance_suffix', 'zh-CN', '。', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'zh-TW', '。', 'needs_review'),
        ('privacy_notice_login_acceptance_suffix', 'zh-HK', '。', 'needs_review')
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
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = resolved.lang_key_id
      AND existing.language_code = resolved.language_code
);
