-- 20261009000083_add_automatic_log_retention.sql
-- Adds owner decision K353's 90-day log defaults to fresh and existing settings.
-- Connects the public bootstrap and upgrades to the existing daily retention loop.
-- Preserves private migration rows and operator policies without duplicate keys.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql
-- COMPLETION_MARKER: t750_automatic_log_retention

-- One identity rule for policy tables and generated names. PostgreSQL's default
-- btrim/locale whitespace differs from Go strings.TrimSpace. The explicit set
-- is Go's Unicode White_Space set; the translate also covers every Unicode
-- uppercase rune Go maps to ASCII (including dotted I and the Kelvin sign).
-- Retention table identities and generated names are ASCII. The Go regression
-- checks the entire rune space and the PostgreSQL proof checks actual upgrades.
CREATE OR REPLACE FUNCTION pg_temp.normalize_data_retention_identity(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $identity$
    SELECT translate(btrim(value, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
                             chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
                             chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) ||
                             chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) ||
                             chr(12288)),
                     'ABCDEFGHIJKLMNOPQRSTUVWXYZ' || chr(304) || chr(8490),
                     'abcdefghijklmnopqrstuvwxyzik');
$identity$;

-- Do not reproduce encoding/json's case folding or duplicate-member rules.
-- Only exact reader JSON tags are safe to inspect; all other stored settings
-- remain byte-for-byte untouched. The Go contract test checks this member list
-- against the reader's tags, and the PostgreSQL proof exercises this predicate.
CREATE OR REPLACE FUNCTION pg_temp.data_retention_policies_are_canonical(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $canonical$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(value) AS policy
               WHERE jsonb_typeof(policy) IS DISTINCT FROM 'object') THEN
        RETURN FALSE;
    END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(value) AS policy
        CROSS JOIN LATERAL jsonb_object_keys(policy) AS member(name)
        WHERE member.name COLLATE "C" NOT IN (
            'name', 'enabled', 'table_name', 'timestamp_column', 'filter_column',
            'filter_value', 'mode', 'keep_years', 'keep_days', 'description')
    );
END $canonical$;

DO $log_retention$
DECLARE
    target RECORD;
    policies JSONB;
    policies_are_canonical BOOLEAN;
    policy_name TEXT;
    name_suffix INTEGER;
BEGIN
    INSERT INTO public.system_config (key, boolean_value, value_type, creation_spec)
    SELECT 'automatic_data_retention_enabled', TRUE, 2,
           'Run configured retention daily, starting 90 seconds after server startup. Existing operator choices are preserved.'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'automatic_data_retention_enabled');

    INSERT INTO public.system_config (key, json_value, value_type, creation_spec)
    SELECT 'data_retention_policies', '[]'::jsonb, 5,
           'Retention policies: rolling_days uses keep_days (default log history: 90); rolling_years and calendar_years_plus_current use keep_years. Each policy can be disabled with enabled=false. See the public maintenance guide.'
    WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'data_retention_policies');

    SELECT json_value
      INTO policies FROM public.system_config WHERE key = 'data_retention_policies' FOR UPDATE;
    policies_are_canonical := pg_temp.data_retention_policies_are_canonical(policies);
    IF NOT policies_are_canonical THEN
        RAISE NOTICE 'data_retention_policies is not in canonical form; default log policies were not added and the stored configuration was left untouched. Add missing log policies through the Settings dataset as described in the runtime contract.';
    END IF;

    -- deletion_log contains anti-resurrection tombstones, not disposable history.
    -- Agent runs are pruned only after completion; the worker also retains pending reviews.
    FOR target IN SELECT * FROM (VALUES
        ('system_audit_log', 'created_at'),
        ('system_transaction_log', 'created_at'),
        ('system_log', 'created'),
        ('dev_agent_task_runs', 'started_at'),
        ('ai_usage_logs', 'created_at'),
        ('mcp_query_log', 'created_at')
    ) AS logs(table_name, timestamp_column) LOOP
        -- Table identity, rather than a private migration's policy name, decides
        -- whether a policy exists. Disabled and custom-duration policies survive.
        IF policies_are_canonical THEN
            IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(policies) AS policy
                           WHERE pg_temp.normalize_data_retention_identity(policy->>'table_name') = target.table_name) THEN
                policy_name := 'log-retention-' || target.table_name;
                name_suffix := 1;
                WHILE EXISTS (SELECT 1 FROM jsonb_array_elements(policies) AS policy
                              WHERE pg_temp.normalize_data_retention_identity(policy->>'name') = policy_name) LOOP
                    name_suffix := name_suffix + 1;
                    policy_name := 'log-retention-' || target.table_name || '-' || name_suffix;
                END LOOP;
                policies := policies || jsonb_build_array(jsonb_build_object(
                    'name', policy_name,
                    'enabled', TRUE, 'table_name', target.table_name,
                    'timestamp_column', target.timestamp_column,
                    'mode', 'rolling_days', 'keep_days', 90));
            END IF;
        END IF;

        -- Optional log tables need no placeholder schema. Index only real clocks;
        -- the migration runs under startup admission before requests are served.
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = target.table_name
                     AND column_name = target.timestamp_column) THEN
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
                           'idx_retention_' || target.table_name, target.table_name, target.timestamp_column);
        END IF;
    END LOOP;

    IF policies_are_canonical THEN
        UPDATE public.system_config SET json_value = policies
         WHERE key = 'data_retention_policies' AND json_value IS DISTINCT FROM policies;
    END IF;

    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 't750_automatic_log_retention', 'completed',
           '{"file":"20261009000083_add_automatic_log_retention.sql"}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                       WHERE migration = 't750_automatic_log_retention' AND action = 'completed');
END $log_retention$;
