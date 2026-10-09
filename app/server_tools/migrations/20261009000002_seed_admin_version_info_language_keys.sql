-- 20261009000002_seed_admin_version_info_language_keys.sql
-- Seeds truthful release-check actions, timing and running-database requirement copy.
-- Connects upgrades and fresh installations to the administrator's shared language keys.
-- Inserts missing Finnish/English copy only, preserving reviewed site translations.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('admin_version_info_check_releases', 'Tarkista julkaisut', 'Check releases'),
        ('admin_version_info_required_by_running_app', 'Käynnissä olevan sovelluksen vaatima', 'Required by the running application'),
        ('admin_version_info_last_attempt', 'Viimeisin tarkistusyritys', 'Last check attempt'),
        ('admin_version_info_checked_successfully', 'Tarkistettu onnistuneesti', 'Checked successfully'),
        ('admin_version_info_check_allowed_at', 'Julkaisujen tarkistus sallittu', 'Release check available at'),
        ('admin_version_info_site_operator_updates', 'Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella.', 'Updates are currently performed by the site operator.')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL157 administrator release-check copy.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
