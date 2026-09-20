-- 20260920000003_name_site_assistant_runtimes.sql
-- Adds Finnish and English copy that distinguishes the two site-chat agents.
-- Bridges coding-agent runner kinds with truthful selector and waiting messages.
-- Exists so API-only site work is never described as repository editing.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('coding_agent_repository_label',
         'Repositorioagentti (Codex)',
         'Repository agent (Codex)',
         'Dataset chat: selector option for the local repository-capable coding agent.'),
        ('coding_agent_repository_started',
         'Repositorioagentti aloitti työn.',
         'Repository agent started working.',
         'Dataset chat: first waiting message for the local repository-capable coding agent.'),
        ('coding_agent_repository_context',
         'Codex lukee keskustelua ja repositorion kontekstia.',
         'Codex is reading the chat and repository context.',
         'Dataset chat: repository agent waiting message about reading context.'),
        ('coding_agent_repository_scope',
         'Codex voi tarkistaa ja muokata sille määritettyä koodirepositoriota.',
         'Codex may inspect and edit the configured code repository.',
         'Dataset chat: repository agent waiting message about its code access.'),
        ('coding_agent_repository_working',
         'Repositorioagentti työskentelee edelleen.',
         'Repository agent is still working.',
         'Dataset chat: continuing waiting message for the repository agent.'),
        ('coding_agent_repository_duration',
         'Pitkä repositoriotyö voi kestää enintään 40 minuuttia.',
         'Long repository jobs may take up to 40 minutes.',
         'Dataset chat: duration guidance for the repository agent.'),
        ('site_assistant_api_label',
         'Sivustoavustaja (vain sivuston API)',
         'Site assistant (site API only)',
         'Dataset chat: selector option for the API-only live-site assistant.'),
        ('site_assistant_started',
         'Sivustoavustaja aloitti työn.',
         'Site assistant started working.',
         'Dataset chat: first waiting message for the API-only site assistant.'),
        ('site_assistant_context',
         'Sivustoavustaja lukee keskustelua ja sivuston kontekstia.',
         'Site assistant is reading the chat and site context.',
         'Dataset chat: site assistant waiting message about reading context.'),
        ('site_assistant_scope',
         'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
         'Site assistant may inspect the site and prepare API changes for your approval.',
         'Dataset chat: site assistant waiting message about its approved API boundary.'),
        ('site_assistant_working',
         'Sivustoavustaja työskentelee edelleen.',
         'Site assistant is still working.',
         'Dataset chat: continuing waiting message for the site assistant.'),
        ('site_assistant_duration',
         'Pitkä sivustoavustajan työ voi kestää enintään 40 minuuttia.',
         'Long site-assistant jobs may take up to 40 minutes.',
         'Dataset chat: duration guidance for the site assistant.'),
        ('coding_agent_unavailable_label',
         'Koodausagentti (ei käytettävissä)',
         'Coding agent (unavailable)',
         'Dataset chat: selector label when the server returns an unsupported runner kind.'),
        ('coding_agent_unavailable_waiting',
         'Koodausagentti ei ole käytettävissä.',
         'Coding agent is unavailable.',
         'Dataset chat: safe waiting fallback for an unsupported runner kind.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE lang_key IN (
        'coding_agent_repository_label',
        'coding_agent_repository_started',
        'coding_agent_repository_context',
        'coding_agent_repository_scope',
        'coding_agent_repository_working',
        'coding_agent_repository_duration',
        'site_assistant_api_label',
        'site_assistant_started',
        'site_assistant_context',
        'site_assistant_scope',
        'site_assistant_working',
        'site_assistant_duration',
        'coding_agent_unavailable_label',
        'coding_agent_unavailable_waiting'
    )
), authored_translations AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/ai_features/table_chat',
       'table_chat_coding_agent_copy.js',
       'Names the selected agent and its waiting state from the server runner kind.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'coding_agent_repository_label',
    'coding_agent_repository_started',
    'coding_agent_repository_context',
    'coding_agent_repository_scope',
    'coding_agent_repository_working',
    'coding_agent_repository_duration',
    'site_assistant_api_label',
    'site_assistant_started',
    'site_assistant_context',
    'site_assistant_scope',
    'site_assistant_working',
    'site_assistant_duration',
    'coding_agent_unavailable_label',
    'coding_agent_unavailable_waiting'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
