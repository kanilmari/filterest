-- reconcile_self_managed_migration.sql
-- Resolves one inspected failed or interrupted self-managed migration marker.
-- Connects an operator's explicit decision to the startup filename ledger.
-- Guards the observed state and never manufactures successful execution evidence.
-- Stop all application processes and inspect effects first; see README.md.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('filterest.reconcile_filename', :'filename', true),
       set_config('filterest.reconcile_hash', :'expected_hash', true),
       set_config('filterest.reconcile_outcome', :'expected_outcome', true),
       set_config('filterest.reconcile_decision', :'decision', true);

DO $reconcile$
DECLARE
    target_filename text := current_setting('filterest.reconcile_filename');
    expected_hash text := current_setting('filterest.reconcile_hash');
    expected_outcome text := current_setting('filterest.reconcile_outcome');
    decision text := current_setting('filterest.reconcile_decision');
    marker public.system_schema_migrations%ROWTYPE;
    affected integer;
BEGIN
    IF expected_hash !~ '^[0-9a-f]{64}$'
       OR expected_outcome NOT IN ('failed_self_managed', 'interrupted_self_managed')
       OR decision NOT IN ('applied', 'retry') THEN
        RAISE EXCEPTION 'invalid reconciliation inputs; no marker changed';
    END IF;
    SELECT * INTO marker FROM public.system_schema_migrations
        WHERE filename = target_filename FOR UPDATE;
    IF NOT FOUND OR marker.content_sha256 IS DISTINCT FROM expected_hash
       OR marker.outcome IS DISTINCT FROM expected_outcome
       OR marker.provenance IS DISTINCT FROM 'runner' THEN
        RAISE EXCEPTION 'marker missing or changed for %; inspect again', target_filename;
    END IF;
    IF decision = 'applied' THEN
        -- Operator acceptance is unverified history, not a successful SQL attempt.
        -- Retain the filename/timestamp; archive the original evidence before this.
        UPDATE public.system_schema_migrations
            SET content_sha256 = NULL, outcome = NULL, provenance = NULL
            WHERE filename = target_filename;
    ELSE
        -- Only a corrected, inspected file may be retried at the next startup.
        DELETE FROM public.system_schema_migrations WHERE filename = target_filename;
    END IF;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'reconciliation did not change exactly one marker';
    END IF;
END $reconcile$;
COMMIT;
\echo Reconciliation committed for :filename (:decision). Verify the ledger and then start Filterest.
