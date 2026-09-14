-- 20260914000004_add_automation_api_only.sql
-- Protects automation-channel identity beside credentials rather than editable profile data.
-- Connects existing trusted automation accounts to ID-based login and request restrictions.
-- Ambiguous legacy identity stops the migration; a genuine conversion revokes old sessions.
-- VERSION_DB: 9.7.15
-- VERSION_DB_OWNER: 20260914000001_record_admin_agent_and_dataset_presentation_release.sql

ALTER TABLE restricted.users_restricted
    ADD COLUMN IF NOT EXISTS api_only BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
    candidate_count INTEGER;
    candidate_id INTEGER;
    candidate_name TEXT;
    candidate_spec TEXT;
BEGIN
    SELECT count(*) INTO candidate_count FROM public.system_users
    WHERE lower(username) = 'filterest_agent'
       OR creation_spec = 'System manager API automation account';
    IF candidate_count = 0 THEN RETURN; END IF;
    IF candidate_count <> 1 THEN
        RAISE EXCEPTION 'Ambiguous legacy automation identity; review the reserved account before migration';
    END IF;
    SELECT id, username, creation_spec INTO candidate_id, candidate_name, candidate_spec
    FROM public.system_users
    WHERE lower(username) = 'filterest_agent'
       OR creation_spec = 'System manager API automation account';
    IF candidate_name IS DISTINCT FROM 'filterest_agent'
       OR candidate_spec IS DISTINCT FROM 'System manager API automation account'
       OR NOT EXISTS (SELECT 1 FROM restricted.users_restricted WHERE id = candidate_id) THEN
        RAISE EXCEPTION 'Legacy automation identity does not match its protected account';
    END IF;
    UPDATE restricted.users_restricted
    SET api_only = TRUE, authentication_generation = authentication_generation + 1
    WHERE id = candidate_id AND api_only = FALSE;
END;
$$;

COMMENT ON COLUMN restricted.users_restricted.api_only IS
    'Protected API-only authentication boundary, resolved by user ID; profile rename or public metadata edits do not remove it.';
