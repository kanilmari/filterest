-- 20261005000040_add_surviving_sign_in.sql
-- Remembers the sign-in kept by the latest account-wide authentication bump.
-- Connects profile credential rotation with stale-cookie recovery at the shared boundary.
-- Keeps an acting browser signed in when an older in-flight response writes its cookie back.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl132_surviving_sign_in

DO $surviving_sign_in$
BEGIN
    ALTER TABLE restricted.users_restricted
        ADD COLUMN IF NOT EXISTS surviving_sign_in_id text,
        ADD COLUMN IF NOT EXISTS surviving_sign_in_generation bigint;

    IF (SELECT count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'restricted.users_restricted'::regclass AND NOT attisdropped
          AND NOT attnotnull AND NOT atthasdef
          AND ((attname = 'surviving_sign_in_id' AND atttypid = 'text'::regtype)
            OR (attname = 'surviving_sign_in_generation' AND atttypid = 'bigint'::regtype))) <> 2 THEN
        RAISE EXCEPTION 'surviving sign-in columns must be nullable text/bigint without defaults';
    END IF;

    COMMENT ON COLUMN restricted.users_restricted.surviving_sign_in_id IS
        'Opaque sign-in identity kept by a self-service authentication bump; NULL ends every sign-in.';
    COMMENT ON COLUMN restricted.users_restricted.surviving_sign_in_generation IS
        'Generation that kept this sign-in. A later bump makes the survivor ineffective automatically.';

    -- Existing table grants cover both columns. The runtime restricted-table
    -- policy gives the confidential pool access, with none for basic/guest/readonly.
    -- Do not grant public reads or add these private values to account responses.
    INSERT INTO public.system_data_repair_records(migration, action, detail)
    SELECT 'wl132_surviving_sign_in', 'completed', '{"columns":2}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'wl132_surviving_sign_in' AND action = 'completed');
END $surviving_sign_in$;
