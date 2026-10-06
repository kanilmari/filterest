-- front_page_service_catalog_policies.sql
-- Test snapshot of the pilot moderation and exact-row policies, including owner-bound inserts.
-- Reuses the actual 20260902000003 and 20260330 insert-policy definitions.
-- Lives only in disposable test databases; the public bootstrap never imports this fixture.

-- 20260902000003_apply_row_access_to_service_catalog_pilot.sql
-- Layers normalized exact-row rules into the existing app_service_catalog RLS pilot.
-- Keeps reader tooling and administrator behavior while preserving the prior public/owner baselines.
-- Exists so the first DB-native RLS dataset follows the same deny-wins rule engine as generic reads and writes.
-- VERSION_DB: 9.7.0
-- VERSION_DB_OWNER: 20260902000002_add_row_access_rules.sql

ALTER TABLE public.app_service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_service_catalog_read_rls_pilot ON public.app_service_catalog;
CREATE POLICY app_service_catalog_read_rls_pilot
    ON public.app_service_catalog
    FOR SELECT
    USING (
        current_user = 'readeronly'
        OR public.resolve_effective_row_access(
            'app_service_catalog',
            id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::bigint, 1),
            'read',
            (
                (published IS TRUE OR (
                    NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                    AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                    AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
                ))
                AND (enabled IS TRUE OR (
                    NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                    AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                    AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
                ))
                AND (admin_reviewed IS TRUE OR (
                    NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                    AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                    AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
                ))
                AND (admin_approved IS TRUE OR (
                    NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                    AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                    AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
                ))
            ),
            COALESCE(NULLIF(current_setting('app.is_admin', true), '')::boolean, FALSE)
        )
    );

DROP POLICY IF EXISTS app_service_catalog_update_rls_pilot ON public.app_service_catalog;
CREATE POLICY app_service_catalog_update_rls_pilot
    ON public.app_service_catalog
    FOR UPDATE
    USING (
        public.resolve_effective_row_access(
            'app_service_catalog',
            id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::bigint, 1),
            'update',
            (
                NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
            ),
            COALESCE(NULLIF(current_setting('app.is_admin', true), '')::boolean, FALSE)
        )
    )
    WITH CHECK (
        public.resolve_effective_row_access(
            'app_service_catalog',
            id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::bigint, 1),
            'update',
            (
                NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
            ),
            COALESCE(NULLIF(current_setting('app.is_admin', true), '')::boolean, FALSE)
        )
    );

DROP POLICY IF EXISTS app_service_catalog_delete_rls_pilot ON public.app_service_catalog;
CREATE POLICY app_service_catalog_delete_rls_pilot
    ON public.app_service_catalog
    FOR DELETE
    USING (
        public.resolve_effective_row_access(
            'app_service_catalog',
            id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::bigint, 1),
            'delete',
            (
                NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
                AND NULLIF(current_setting('app.user_id', true), '')::bigint > 1
                AND user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
            ),
            COALESCE(NULLIF(current_setting('app.is_admin', true), '')::boolean, FALSE)
        )
    );

-- 20260330_enable_app_service_catalog_insert_rls_pilot.sql
-- Enables the first DB-native insert-policy pilot for app_service_catalog.
-- Non-admin create ownership still stays narrow in the app layer, but the
-- database now also verifies that inserted pilot rows are bound to the current
-- request actor instead of trusting application-side ownership alone.
-- VERSION_DB: 7.0.16

ALTER TABLE app_service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_service_catalog_insert_rls_pilot ON app_service_catalog;

CREATE POLICY app_service_catalog_insert_rls_pilot
    ON app_service_catalog
    FOR INSERT
    WITH CHECK (
        COALESCE(NULLIF(current_setting('app.is_admin', true), ''), 'false')::boolean
        OR (
            NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
            AND NULLIF(current_setting('app.user_id', true), '')::integer > 1
            AND user_id = NULLIF(current_setting('app.user_id', true), '')::integer
        )
    );

