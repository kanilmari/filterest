-- 20260824000001_add_user_auth_generation.sql
-- Adds a per-user credential generation for invalidating signed sessions after security changes.
-- Keeps password, login-factor, and "sign out all devices" events on one revocation contract.
-- Exists so rotating one user's credentials does not require rotating every site's session keys.
-- VERSION_DB: 9.6.2

DO $$
BEGIN
    IF to_regclass('restricted.users_restricted') IS NULL THEN
        RAISE EXCEPTION 'restricted.users_restricted is missing';
    END IF;
END $$;

ALTER TABLE restricted.users_restricted
    ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM restricted.users_restricted
        WHERE authentication_generation < 1
    ) THEN
        RAISE EXCEPTION 'restricted.users_restricted contains an invalid authentication_generation';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_restricted_authentication_generation_positive'
          AND conrelid = 'restricted.users_restricted'::regclass
    ) THEN
        ALTER TABLE restricted.users_restricted
            ADD CONSTRAINT users_restricted_authentication_generation_positive
            CHECK (authentication_generation >= 1);
    END IF;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.2', 'Added per-user authentication generation for credential and session recovery.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.6.2'
);
