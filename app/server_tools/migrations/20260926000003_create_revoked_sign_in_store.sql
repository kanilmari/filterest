-- 20260926000003_create_revoked_sign_in_store.sql
-- Creates the short list of sign-ins that have been signed out and must be refused.
-- Bridges the sign-out handler, which writes one row, and the authentication
-- boundary, which reads one row per request of a signed-in person.
-- Exists because a sign-in lives entirely in cookies: signing out expired them in
-- the browser and the server kept no record, so a request that was already in
-- flight wrote all three back and the person was signed in again without knowing.
-- One row refuses one browser's sign-in. Signing out on a phone must not sign the
-- same person out of their desktop, so nothing here names a user or an account.
-- A site that already has the table keeps it and its rows; running the file again
-- changes nothing. The public bootstrap runs this same file, so a new installation
-- is born with it.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

DO $$
BEGIN
    IF to_regclass('public.system_revoked_sign_ins') IS NULL THEN
        CREATE TABLE public.system_revoked_sign_ins (
            -- The sign-in's own identity, minted at sign-in and carried inside the
            -- signed session cookie. It is the only thing stored about the sign-in:
            -- the record has to answer one question and must not become a log of
            -- who signed out from where.
            sign_in_id TEXT PRIMARY KEY,
            revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- When this record stops refusing. It is written as the sign-in
            -- lifetime the application states in
            -- backend/core_components/sessions/auth_cookie_identity.go, counted
            -- from the database's own clock, so the record always outlives the
            -- cookies it refuses.
            expires_at TIMESTAMPTZ NOT NULL
        );
        COMMENT ON TABLE public.system_revoked_sign_ins IS
            'Sign-ins that have been signed out and must be refused until they would have run out anyway. One row per signed-out browser session; carries no user, address or browser data.';
        COMMENT ON COLUMN public.system_revoked_sign_ins.sign_in_id IS
            'Opaque per-sign-in identity from the signed session cookie';
        COMMENT ON COLUMN public.system_revoked_sign_ins.revoked_at IS
            'When the person signed out';
        COMMENT ON COLUMN public.system_revoked_sign_ins.expires_at IS
            'When this record stops refusing; the row is removed by the next sign-out';
    END IF;
END $$;

-- Both things done to this table are bounded by time: the check reads only
-- records that are still current, and each sign-out removes the ones that are not.
CREATE INDEX IF NOT EXISTS idx_system_revoked_sign_ins_expires_at
    ON public.system_revoked_sign_ins (expires_at);

-- The application writes and reads this table on the role that runs migrations,
-- which owns it and needs no grant. A read-only role is given the same look at it
-- as at every other system table, so an operator can see why a sign-in is being
-- refused. A role an installation does not have is skipped.
DO $$
DECLARE
    read_role TEXT;
BEGIN
    FOR read_role IN
        SELECT rolname
          FROM pg_catalog.pg_roles
         WHERE rolname IN ('readeronly', 'filterest_readonly', 'readonly_user')
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE public.system_revoked_sign_ins TO %I', read_role);
    END LOOP;
END $$;
