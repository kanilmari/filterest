-- 20260825000001_enable_personal_dataset_sort_defaults.sql
-- Lets each authenticated user persist a personal dataset sorting default.
-- The existing administrator route remains the only route that can write the
-- site-wide row; this route always derives its owner from the login session.
-- VERSION_DB: 9.6.5

COMMENT ON TABLE public.system_dataset_sort_defaults IS
    'Persistent dataset sorting defaults. NULL user_id is the administrator-managed site default; a user_id row overrides it for that authenticated user.';

UPDATE public.system_db_tables
SET description = 'Per-dataset site-wide and authenticated-user-specific default sorting',
    updated = now()
WHERE table_name = 'system_dataset_sort_defaults'
  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public';

INSERT INTO public.system_functions (
    name,
    disabled,
    created,
    updated,
    package,
    specific_table_related,
    creation_spec,
    rate_limit_amount,
    rate_limit_minutes,
    url_route_endpoint,
    ui_only
)
SELECT
    'system_table_tools.SavePersonalDatasetSortDefaultHandler',
    FALSE,
    now(),
    now(),
    'system_table_tools',
    FALSE,
    'Authenticated-user-owned dataset sorting default.',
    200,
    20,
    '/api/dataset-sort-default/personal',
    FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_functions
    WHERE name = 'system_table_tools.SavePersonalDatasetSortDefaultHandler'
);

UPDATE public.system_functions
SET disabled = FALSE,
    updated = now(),
    package = 'system_table_tools',
    specific_table_related = FALSE,
    creation_spec = 'Authenticated-user-owned dataset sorting default.',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = '/api/dataset-sort-default/personal',
    ui_only = FALSE
WHERE name = 'system_table_tools.SavePersonalDatasetSortDefaultHandler';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basic_user') THEN
        GRANT SELECT, INSERT, UPDATE
            ON TABLE public.system_dataset_sort_defaults TO basic_user;
        GRANT USAGE, SELECT
            ON SEQUENCE public.system_dataset_sort_defaults_id_seq TO basic_user;
    END IF;

    -- The personal route itself rejects anonymous/guest sessions. Keep the
    -- database role boundary equally explicit as defense in depth.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guest_user') THEN
        REVOKE INSERT, UPDATE
            ON TABLE public.system_dataset_sort_defaults FROM guest_user;
        REVOKE USAGE, SELECT
            ON SEQUENCE public.system_dataset_sort_defaults_id_seq FROM guest_user;
    END IF;
END $$;

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.5', 'Enabled persistent personal dataset sorting defaults for authenticated users.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.6.5'
);
