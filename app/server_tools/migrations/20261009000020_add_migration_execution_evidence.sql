-- 20261009000020_add_migration_execution_evidence.sql
-- Adds nullable byte hashes, truthful outcomes and provenance to the migration ledger.
-- Connects startup execution and bootstrap baselines to future signed-release checks.
-- Leaves every historical row unverified; present files cannot prove past execution.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_migration_execution_evidence

DO $migration_evidence$
BEGIN
    ALTER TABLE public.system_schema_migrations
        ADD COLUMN IF NOT EXISTS content_sha256 text,
        ADD COLUMN IF NOT EXISTS outcome text,
        ADD COLUMN IF NOT EXISTS provenance text;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                   WHERE conrelid = 'public.system_schema_migrations'::regclass
                     AND conname = 'system_schema_migrations_evidence_check') THEN
        ALTER TABLE public.system_schema_migrations
            ADD CONSTRAINT system_schema_migrations_evidence_check CHECK (
                (content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL)
                OR (
                    content_sha256 IS NOT NULL AND content_sha256 ~ '^[0-9a-f]{64}$'
                    AND outcome IS NOT NULL AND provenance IS NOT NULL
                    AND (
                        (provenance = 'runner' AND outcome IN
                            ('applied', 'optional_failure_skipped', 'interrupted_self_managed', 'failed_self_managed'))
                        OR (provenance = 'bootstrap' AND outcome = 'bootstrap_baseline')
                    )
                )
            );
    END IF;

    COMMENT ON COLUMN public.system_schema_migrations.content_sha256 IS
        'Runner: exact bytes submitted for execution (outcome determines completion). Bootstrap: folded-in migration source hash, not execution proof. NULL: unverified history.';
    COMMENT ON COLUMN public.system_schema_migrations.outcome IS
        'applied: completed; optional_failure_skipped: optional error; failed_self_managed: observed failure with transaction rolled back, earlier commits may remain; interrupted_self_managed: completion unknown; bootstrap_baseline: packaged source; NULL: unverified history.';
    COMMENT ON COLUMN public.system_schema_migrations.provenance IS
        'runner or bootstrap; NULL is unverified historical origin.';

    INSERT INTO public.system_data_repair_records (migration, action)
    SELECT 'wl157_migration_execution_evidence', 'completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                      WHERE migration = 'wl157_migration_execution_evidence' AND action = 'completed');
END $migration_evidence$;
