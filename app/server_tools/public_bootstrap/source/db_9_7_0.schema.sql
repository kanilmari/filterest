-- db_9_7_0.schema.sql
-- Defines the DB 9.7.0 group field-assignment and exact-row access-control schema.
-- Bridges the base runtime schema with accepted administrator workflows #874 and #879.
-- Exists so a fresh public installation receives the real contract instead of only its version label.

ALTER TABLE public.system_column_details
    ADD COLUMN IF NOT EXISTS client_delivery_mode VARCHAR(32) NOT NULL DEFAULT 'include';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_column_details_client_delivery_mode'
          AND conrelid = 'public.system_column_details'::regclass
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT ck_system_column_details_client_delivery_mode
            CHECK (client_delivery_mode IN ('include', 'server_only'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_column_details_id_client_delivery'
          AND conrelid = 'public.system_column_details'::regclass
    ) THEN
        ALTER TABLE public.system_column_details
            ADD CONSTRAINT ck_system_column_details_id_client_delivery
            CHECK (column_name <> 'id' OR client_delivery_mode <> 'server_only');
    END IF;
END $$;

COMMENT ON COLUMN public.system_column_details.client_delivery_mode IS
    'Client projection contract: include may reach authorized clients; server_only remains available only to backend operations.';

ALTER TABLE public.system_view_field_set_assignments
    ADD COLUMN IF NOT EXISTS group_id BIGINT
        REFERENCES public.system_user_groups(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS group_priority INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.system_view_field_set_assignments
    DROP CONSTRAINT IF EXISTS uq_system_view_field_set_assignment;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_view_field_set_assignment_principal'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT ck_system_view_field_set_assignment_principal
            CHECK (NOT (user_id IS NOT NULL AND group_id IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_system_view_field_set_assignment_group_priority'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT ck_system_view_field_set_assignment_group_priority
            CHECK (group_priority BETWEEN -1000000 AND 1000000);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_system_view_field_set_assignment_principal'
          AND conrelid = 'public.system_view_field_set_assignments'::regclass
    ) THEN
        ALTER TABLE public.system_view_field_set_assignments
            ADD CONSTRAINT uq_system_view_field_set_assignment_principal
            UNIQUE NULLS NOT DISTINCT (user_id, group_id, table_uid, view_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_system_view_field_set_assignments_group_lookup
    ON public.system_view_field_set_assignments
        (table_uid, view_id, group_id, group_priority DESC);

COMMENT ON COLUMN public.system_view_field_set_assignments.group_id IS
    'Optional user-group target. NULL user_id and NULL group_id mark the site-wide default.';
COMMENT ON COLUMN public.system_view_field_set_assignments.group_priority IS
    'Deterministic precedence among matching group assignments; higher values win, then the smaller group id.';
COMMENT ON TABLE public.system_view_field_set_assignments IS
    'Active per-view field collection. Resolution order is personal, group, site default, then metadata.';

CREATE TABLE IF NOT EXISTS public.system_permission_categories (
    id              BIGSERIAL PRIMARY KEY,
    category_key    VARCHAR(64)  NOT NULL UNIQUE,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_categories_key
        CHECK (category_key ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE IF NOT EXISTS public.system_permission_actions (
    id              BIGSERIAL PRIMARY KEY,
    category_id     BIGINT       NOT NULL REFERENCES public.system_permission_categories(id),
    action_key      VARCHAR(64)  NOT NULL UNIQUE,
    scope_type      VARCHAR(32)  NOT NULL,
    label_lang_key  VARCHAR(128) NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_permission_actions_key
        CHECK (action_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_system_permission_actions_scope
        CHECK (scope_type IN ('dataset', 'row', 'system'))
);

CREATE TABLE IF NOT EXISTS public.system_row_access_rules (
    id              BIGSERIAL PRIMARY KEY,
    table_uid       INTEGER      NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    row_id          BIGINT       NOT NULL,
    user_id         BIGINT       REFERENCES public.system_users(id) ON DELETE CASCADE,
    group_id        BIGINT       REFERENCES public.system_user_groups(id) ON DELETE CASCADE,
    action_id       BIGINT       NOT NULL REFERENCES public.system_permission_actions(id),
    effect          VARCHAR(16)  NOT NULL,
    reason          TEXT,
    valid_from      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    created_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    updated_by      BIGINT       REFERENCES public.system_users(id) ON DELETE SET NULL,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rules_row_id CHECK (row_id > 0),
    CONSTRAINT ck_system_row_access_rules_principal
        CHECK ((user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1),
    CONSTRAINT ck_system_row_access_rules_effect CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT ck_system_row_access_rules_validity
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT uq_system_row_access_rules_target
        UNIQUE NULLS NOT DISTINCT (table_uid, row_id, user_id, group_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_evaluation
    ON public.system_row_access_rules (table_uid, row_id, action_id, effect);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_user
    ON public.system_row_access_rules (user_id, table_uid, row_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_row_access_rules_group
    ON public.system_row_access_rules (group_id, table_uid, row_id)
    WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.system_row_access_rule_events (
    id                  BIGSERIAL PRIMARY KEY,
    change_set_id       VARCHAR(36) NOT NULL,
    actor_user_id       BIGINT      REFERENCES public.system_users(id) ON DELETE SET NULL,
    table_uid           INTEGER     NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
    principal_type      VARCHAR(16) NOT NULL,
    principal_id        BIGINT      NOT NULL,
    row_ids             BIGINT[]    NOT NULL,
    changes             JSONB       NOT NULL,
    reason              TEXT,
    affected_rule_count INTEGER     NOT NULL DEFAULT 0,
    created             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_row_access_rule_events_change_set
        CHECK (change_set_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT ck_system_row_access_rule_events_principal
        CHECK (principal_type IN ('user', 'group') AND principal_id > 0),
    CONSTRAINT ck_system_row_access_rule_events_rows
        CHECK (cardinality(row_ids) BETWEEN 1 AND 200),
    CONSTRAINT ck_system_row_access_rule_events_changes
        CHECK (jsonb_typeof(changes) = 'object'),
    CONSTRAINT ck_system_row_access_rule_events_count
        CHECK (affected_rule_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_target
    ON public.system_row_access_rule_events (table_uid, created DESC);
CREATE INDEX IF NOT EXISTS idx_system_row_access_rule_events_actor
    ON public.system_row_access_rule_events (actor_user_id, created DESC);

CREATE OR REPLACE FUNCTION public.set_row_access_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_system_permission_categories_timestamp
    ON public.system_permission_categories;
CREATE TRIGGER update_system_permission_categories_timestamp
BEFORE UPDATE ON public.system_permission_categories
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

DROP TRIGGER IF EXISTS update_system_permission_actions_timestamp
    ON public.system_permission_actions;
CREATE TRIGGER update_system_permission_actions_timestamp
BEFORE UPDATE ON public.system_permission_actions
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

DROP TRIGGER IF EXISTS update_system_row_access_rules_timestamp
    ON public.system_row_access_rules;
CREATE TRIGGER update_system_row_access_rules_timestamp
BEFORE UPDATE ON public.system_row_access_rules
FOR EACH ROW EXECUTE FUNCTION public.set_row_access_updated_timestamp();

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

COMMENT ON TABLE public.system_permission_categories IS
    'Translatable UI grouping for normalized permission actions; categories never change enforcement semantics.';
COMMENT ON TABLE public.system_permission_actions IS
    'Stable permission-action registry. Existing-row editing uses only enabled actions whose scope_type is row.';
COMMENT ON TABLE public.system_row_access_rules IS
    'Exact-row user/group allow or deny exceptions layered over broader dataset and legacy row policies; deny wins.';
COMMENT ON TABLE public.system_row_access_rule_events IS
    'Append-only principal audit rows; every multi-principal transaction shares one change_set_id.';
COMMENT ON FUNCTION public.resolve_effective_row_access(TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN) IS
    'Resolves one row action: admin bypass, explicit deny, explicit allow, then the broader application policy. The RLS backend feature flag never bypasses this layer.';
