-- 20260902000004_finalize_row_access_fail_closed_defaults.sql
-- Finalizes the fail-closed row-access resolver and its newest translated error copy.
-- Bridges early DB 9.7.0 development installs with the final immutable public migration state.
-- Exists so an already-recorded draft migration cannot retain the retired application-layer bypass.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

DELETE FROM public.system_config
WHERE key = 'row_access_rules_enabled';

INSERT INTO public.system_config (
    key, boolean_value, text_value, value_type, creation_spec
)
VALUES (
    'postgresql_rls_backend_enabled',
    FALSE,
    'false',
    2,
    'Global readiness gate for future PostgreSQL RLS rollout. False never disables application-layer row authorization.'
)
ON CONFLICT (key) DO UPDATE
SET creation_spec = EXCLUDED.creation_spec,
    updated = now();

CREATE OR REPLACE FUNCTION public.resolve_effective_row_access(
    target_table_name TEXT,
    target_row_id BIGINT,
    actor_user_id BIGINT,
    requested_action TEXT,
    broader_policy_allows BOOLEAN,
    actor_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN actor_is_admin THEN TRUE
        ELSE COALESCE((
            SELECT CASE
                WHEN bool_or(rules.effect = 'deny') THEN FALSE
                WHEN bool_or(rules.effect = 'allow') THEN TRUE
                ELSE NULL
            END
            FROM public.system_row_access_rules AS rules
            JOIN public.system_permission_actions AS actions
              ON actions.id = rules.action_id
             AND actions.enabled IS TRUE
             AND actions.scope_type = 'row'
            JOIN public.system_db_tables AS tables
              ON tables.table_uid = rules.table_uid
            WHERE tables.table_name = target_table_name
              AND COALESCE(NULLIF(tables.schema_name, ''), 'public') = 'public'
              AND rules.row_id = target_row_id
              AND actions.action_key = requested_action
              AND rules.valid_from <= now()
              AND (rules.valid_until IS NULL OR rules.valid_until > now())
              AND (
                  rules.user_id = actor_user_id
                  OR rules.group_id IN (
                      SELECT memberships.group_id
                      FROM public.system_user_group_memberships AS memberships
                      WHERE memberships.user_id = actor_user_id
                  )
              )
        ), COALESCE(broader_policy_allows, FALSE))
    END;
$$;

COMMENT ON FUNCTION public.resolve_effective_row_access(TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN) IS
    'Resolves one row action: admin bypass, explicit deny, explicit allow, then the broader application policy. The RLS backend feature flag never bypasses this layer.';

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES (
    'row_access_invalid_response',
    'Rivioikeusvastaus oli puutteellinen. Mitään ei muutettu.',
    'The row access response was incomplete. Nothing was changed.',
    '行权限响应不完整。未进行任何更改。',
    '列權限回應不完整。未進行任何變更。',
    'Fail-closed notice for incomplete or mismatched row-access readback.'
)
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();
