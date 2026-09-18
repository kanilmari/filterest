-- 20260918000002_seed_site_assistant_language_keys.sql
-- Adds the interface copy for the chat's site assistant and its waiting changes.
-- Bridges the assistant chat controls with the installation's own language keys.
-- Exists so the approval view reads from language keys instead of hardcoded copy.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('site_assistant_pending_heading', 'Odottaa hyväksyntääsi', 'Waiting for your approval',
         'Site assistant chat: heading above the changes waiting for approval.'),
        ('site_assistant_pending_intro', 'Avustaja valmisteli nämä muutokset, mutta ei ole tehnyt niitä.',
         'The assistant prepared these changes but has not made them.',
         'Site assistant chat: explains that nothing has been changed yet.'),
        ('site_assistant_pending_approve_all', 'Hyväksy ja suorita', 'Approve and run',
         'Site assistant chat: button that approves and runs several waiting changes.'),
        ('site_assistant_pending_approve_one', 'Hyväksy tämä muutos', 'Approve this change',
         'Site assistant chat: button that approves and runs one waiting change.'),
        ('site_assistant_pending_running', 'Suoritetaan…', 'Running…',
         'Site assistant chat: status while approved changes are running.'),
        ('site_assistant_pending_done', 'Tehty', 'Done',
         'Site assistant chat: status of a change that has been made.'),
        ('site_assistant_pending_failed', 'Tämä muutos epäonnistui. Sen jälkeisiä ei suoritettu.',
         'This change failed. Nothing after it was run.',
         'Site assistant chat: status when an approved change failed.'),
        ('site_assistant_pending_error', 'Hyväksyntä epäonnistui. Mitään ei muutettu.',
         'Approval failed. Nothing was changed.',
         'Site assistant chat: status when the approval request itself failed.'),
        ('site_assistant_pending_dataset', 'Aineisto', 'Dataset',
         'Site assistant chat: label for the dataset a waiting change targets.'),
        ('site_assistant_pending_details', 'Näytä tarkka kutsu', 'Show the exact call',
         'Site assistant chat: toggle that reveals the exact request of a waiting change.'),
        ('coding_agent_service_label', 'Tekoälypalvelu', 'AI service',
         'Dataset chat: label of the AI service selector.'),
        ('coding_agent_service_api', 'API-tekoäly', 'API AI',
         'Dataset chat: AI service option that answers from dataset reads.'),
        ('coding_agent_service_agent', 'Koodausagentti (Codex)', 'Coding agent (Codex)',
         'Dataset chat: AI service option that runs the site assistant.'),
        ('coding_agent_checking', 'Tarkistetaan saatavuutta…', 'Checking availability…',
         'Dataset chat: status while assistant availability is being read.'),
        ('coding_agent_not_ready', 'Koodausagentti ei ole valmis. Ylläpitäjän on viimeisteltävä sen käyttöönotto.',
         'Coding agent is not ready. An administrator must finish its setup.',
         'Dataset chat: assistant is permitted but its runner setup is unfinished.'),
        ('coding_agent_dev_only', 'Koodausagentti on rajattu kehitysympäristöön.',
         'Coding agent is restricted to development.',
         'Dataset chat: assistant is allowed only in the development environment.'),
        ('coding_agent_job_pending', 'Työ on yhä käynnissä. Keskustelun avaaminen jatkaa sen tilan seurantaa.',
         'A job is still running. Reopening this chat resumes its status.',
         'Dataset chat: an assistant job continues after the chat is closed.'),
        ('coding_agent_job_failed', 'Työ keskeytyi tai epäonnistui. Sen loki säilyy ylläpitäjälle.',
         'The job stopped or failed. Its log remains available to the administrator.',
         'Dataset chat: an assistant job ended without an answer.')
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
    WHERE creation_spec LIKE 'Site assistant chat:%' OR creation_spec LIKE 'Dataset chat:%'
), authored_translations AS (
    SELECT selected.id AS lang_key_id, translations.language_code, translations.translation
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
       '',
       'Dataset chat assistant controls and the approval view for prepared changes.',
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.creation_spec LIKE 'Site assistant chat:%' OR keys.creation_spec LIKE 'Dataset chat:%'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
