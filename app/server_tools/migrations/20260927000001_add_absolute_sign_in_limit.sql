-- 20260927000001_add_absolute_sign_in_limit.sql
-- Adds the setting that decides how long one sign-in may last at the very most.
-- Bridges the administrator's settings view and the deadline stamped into every
-- new sign-in, which the shared authentication boundary then enforces.
-- Exists because a sign-in had no ceiling at all: it was renewed on every visit,
-- so one used daily never ended, and a cookie copied elsewhere could be signed
-- afresh through any of the routes that write a session -- several of them
-- reachable without signing in -- and so outlive the record of its own sign-out.
-- A deadline stamped once at sign-in cannot be pushed forward by any of them.
--
-- The three fields are one row rather than three because none of them means
-- anything alone: an amount without a unit is not a length of time, and neither
-- matters while the limit is switched off. One row also changes as one act.
-- A site that already has the setting keeps its own value; only its description
-- is refreshed. The public bootstrap seeds the same row, so a new site is born
-- with it.
-- VERSION_DB: 9.9.0
-- VERSION_DB_OWNER: 20260926000002_record_system_foreign_key_release.sql

INSERT INTO public.system_config (key, json_value, text_value, value_type, creation_spec)
SELECT
    'absolute_sign_in_limit',
    -- Thirty days, chosen by the owner: long enough that an ordinary person
    -- meets it about once a month, short enough that a stolen cookie cannot be
    -- kept alive indefinitely. Changing it here governs sign-ins made after the
    -- change; a deadline already given to a sign-in is never revised, because a
    -- setting that could revise it would be a way to extend a sign-in.
    jsonb_build_object(
        'limit_enabled', TRUE,
        'limit_unit', 'days',
        'limit_amount', 30
    ),
    NULL,
    -- 5 is the JSON editor in the settings view. The text editor would let a
    -- malformed policy be saved as a string.
    5,
    'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_config WHERE key = 'absolute_sign_in_limit'
);

-- A site that already had the row keeps its policy and gets the current wording.
UPDATE public.system_config
   SET creation_spec = 'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.',
       value_type = 5,
       updated = now()
 WHERE key = 'absolute_sign_in_limit'
   AND (creation_spec IS DISTINCT FROM 'How long one sign-in may last at the most, counted from the moment it began and never extended. limit_unit is hours or days; limit_amount is a whole number above zero. Setting limit_enabled to false removes the ceiling, and sign-outs then have to be remembered indefinitely.'
        OR value_type IS DISTINCT FROM 5);

-- A sign-in with no ceiling still has to be refusable after it is signed out, and
-- there is no honest date on which that refusal may be dropped. The column takes
-- PostgreSQL's infinity for exactly that case; every finite record is unaffected.
COMMENT ON COLUMN public.system_revoked_sign_ins.expires_at IS
    'When this record stops refusing; the row is removed by the next sign-out. It is the deadline the sign-in was given, so the record lasts exactly as long as that sign-in could still be admitted -- not as long as its cookie stays readable, which nothing here promises -- and infinity when that sign-in was given no deadline at all.';
