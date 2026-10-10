-- 20261009000050_create_application_update_admission.sql
-- Creates private durable update intent, authentication proofs and audit records.
-- Connects administrator admission to a future manager-controlled execution worker.
-- Ships disabled: no installation identity, release offer or executor is bootstrapped.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql
-- COMPLETION_MARKER: wl157_application_update_admission
-- FINAL_CHECK: public.app_check_application_update_admission()

CREATE TABLE IF NOT EXISTS restricted.system_application_update_control (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton IS TRUE),
    installation_id text NOT NULL CHECK (installation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    executor_enabled boolean NOT NULL DEFAULT FALSE,
    executor_available boolean NOT NULL DEFAULT FALSE,
	 executor_checked_at timestamptz NOT NULL DEFAULT '-infinity',
    offer jsonb CHECK (offer IS NULL OR jsonb_typeof(offer) = 'object')
);
COMMENT ON TABLE restricted.system_application_update_control IS
    'Operator/manager-published, installation-bound signed offer. No browser write API; absent row fails closed. Reachability is refreshed by the future manager boundary.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_jobs (
    id text PRIMARY KEY,
    installation_id text NOT NULL,
    requester_id integer NOT NULL,
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT TRUE,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'protocol_version' = '1')
);
CREATE UNIQUE INDEX IF NOT EXISTS system_application_update_one_active
    ON restricted.system_application_update_jobs ((active)) WHERE active IS TRUE;

CREATE TABLE IF NOT EXISTS restricted.system_application_update_proofs (
    id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
	 verification_method text NOT NULL CHECK (verification_method IN ('none','fixed_pin','totp','email')),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
COMMENT ON TABLE restricted.system_application_update_proofs IS
    'Single-use SHA-256 token references bound to actor, generation, sign-in, action, installation, release/cutover and evidence; no passwords, factors or raw tokens.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_decisions (
    id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES restricted.system_application_update_jobs(id),
    evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'protocol_version' = '1')
);
CREATE INDEX IF NOT EXISTS system_application_update_pending_decisions
    ON restricted.system_application_update_decisions(job_id,evidence_sha256,expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS restricted.system_application_update_admissions (
    actor_id integer NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    PRIMARY KEY (actor_id,operation,idempotency_key)
);

CREATE TABLE IF NOT EXISTS restricted.system_application_update_events (
    job_id text NOT NULL REFERENCES restricted.system_application_update_jobs(id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
    authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
    proof_id text NOT NULL,
    target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
    origin text NOT NULL CHECK (origin IN ('administrator_view','manager')),
    PRIMARY KEY (job_id,sequence)
);
COMMENT ON TABLE restricted.system_application_update_events IS
    'Atomic admission audit mirror. Execution/consumption authority must also be journaled outside database restoration scope by the manager; never infer progress from logs.';

CREATE TABLE IF NOT EXISTS restricted.system_application_update_auth_attempts (
    key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0)
);
REVOKE ALL ON restricted.system_application_update_control, restricted.system_application_update_jobs,
    restricted.system_application_update_proofs, restricted.system_application_update_decisions,
    restricted.system_application_update_admissions, restricted.system_application_update_events,
    restricted.system_application_update_auth_attempts FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_check_application_update_admission()
RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $check$
    SELECT 'application-update storage missing a private table or primary key: ' || expected.name
    FROM unnest(ARRAY['system_application_update_control','system_application_update_jobs',
        'system_application_update_proofs','system_application_update_decisions',
        'system_application_update_admissions','system_application_update_events',
        'system_application_update_auth_attempts']) AS expected(name)
    WHERE to_regclass('restricted.' || expected.name) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('restricted.' || expected.name) AND contype='p')
    UNION ALL
    SELECT 'application-update storage has an unexpected column shape: ' || expected.name
    FROM (VALUES ('system_application_update_control',6),('system_application_update_jobs',8),
        ('system_application_update_proofs',6),('system_application_update_decisions',7),
        ('system_application_update_admissions',5),('system_application_update_events',7),
        ('system_application_update_auth_attempts',3)) AS expected(name,column_count)
    WHERE (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('restricted.' || expected.name)
        AND attnum>0 AND NOT attisdropped) <> expected.column_count
    UNION ALL
    SELECT 'application-update authorization context column is invalid: ' || expected.name
    FROM unnest(ARRAY['system_application_update_jobs','system_application_update_decisions',
        'system_application_update_events']) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('restricted.' || expected.name)
        AND attname='authorization_context' AND atttypid='jsonb'::regtype AND attnotnull
        AND attnum>0 AND NOT attisdropped)
    UNION ALL
    SELECT 'application-update storage must stay outside generic datasets'
    WHERE EXISTS (SELECT 1 FROM public.system_db_tables WHERE table_name LIKE 'system_application_update_%')
    UNION ALL
    SELECT 'application-update admission requires the single-active-job index'
    WHERE NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('restricted.system_application_update_one_active') AND indisunique AND indisvalid
        AND pg_get_indexdef(indexrelid) LIKE '%(active)%WHERE%active IS TRUE%')
    UNION ALL
    SELECT 'application-update proof freshness constraint missing'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='restricted.system_application_update_proofs'::regclass
        AND contype='c' AND convalidated AND pg_get_constraintdef(oid) LIKE '%expires_at%created_at%00:05:00%')
    UNION ALL
    SELECT 'application-update idempotency scope is invalid'
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='restricted.system_application_update_admissions'::regclass
        AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (actor_id, operation, idempotency_key)')
    UNION ALL
    SELECT 'application-update storage must not grant privileges to PUBLIC'
    WHERE EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
        LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
        WHERE n.nspname='restricted' AND c.relname LIKE 'system_application_update_%'
        AND c.relkind='r' AND acl.grantee=0);
$check$;
DO $acceptance$
DECLARE findings text;
BEGIN
    SELECT string_agg(finding,'; ') INTO findings FROM public.app_check_application_update_admission() AS finding;
    IF findings IS NOT NULL THEN RAISE EXCEPTION 'application-update admission final check refused: %', findings; END IF;
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl157_application_update_admission','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='wl157_application_update_admission' AND action='completed');
END $acceptance$;
