-- 20260824000003_add_production_update_notice.sql
-- Seeds the fixed production-update notice state and its manager/admin stream routes.
-- Bridges lifecycle commands, protected administrator access, and persistent system configuration.
-- Exists so administrators receive a durable save-work warning before a deployment drain.
-- VERSION_DB: 9.6.4

INSERT INTO public.system_config (
    key,
    json_value,
    creation_spec
)
SELECT
    'production_update_notice',
    '{
      "schema_version": 1,
      "notice_id": "",
      "state": "cleared",
      "announced_at": "",
      "starts_at": "",
      "expires_at": "",
      "updated_at": ""
    }'::jsonb,
    'Manager-controlled fixed-schema administrator production-update notice; no operator-authored display text.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_config
    WHERE key = 'production_update_notice'
);

WITH desired_functions (
    name,
    package,
    specific_table_related,
    url_route_endpoint,
    creation_spec
) AS (
    VALUES
        (
            'router.systemUpdateNoticeHandler',
            'router',
            FALSE,
            '/system/update-notice',
            'Manager-authenticated production-update notice state transition.'
        ),
        (
            'router.adminUpdateNoticeStreamHandler',
            'router',
            FALSE,
            '/api/admin/update-notice/stream',
            'Administrator-only bounded production-update notice stream.'
        )
), missing_functions AS (
    SELECT desired.*
    FROM desired_functions AS desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_functions AS existing
        WHERE existing.name = desired.name
    )
)
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
    missing.name,
    FALSE,
    now(),
    now(),
    missing.package,
    missing.specific_table_related,
    missing.creation_spec,
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_functions AS missing;

UPDATE public.system_functions AS functions
SET disabled = FALSE,
    updated = now(),
    package = desired.package,
    specific_table_related = FALSE,
    creation_spec = desired.creation_spec,
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = desired.url_route_endpoint,
    ui_only = FALSE
FROM (
    VALUES
        (
            'router.systemUpdateNoticeHandler',
            'router',
            '/system/update-notice',
            'Manager-authenticated production-update notice state transition.'
        ),
        (
            'router.adminUpdateNoticeStreamHandler',
            'router',
            '/api/admin/update-notice/stream',
            'Administrator-only bounded production-update notice stream.'
        )
) AS desired(name, package, url_route_endpoint, creation_spec)
WHERE functions.name = desired.name;

INSERT INTO public.system_group_table_func_rights (
    user_group_id,
    function_id,
    target_schema_name,
    creation_spec,
    target_table_uid
)
SELECT
    groups.id,
    functions.id,
    'public',
    'Filterest DB 9.6.4 administrator production-update notice stream',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'router.adminUpdateNoticeStreamHandler'
WHERE groups.name = 'admins'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_group_table_func_rights AS existing
      WHERE existing.user_group_id = groups.id
        AND existing.function_id = functions.id
        AND existing.target_table_uid IS NULL
        AND COALESCE(NULLIF(existing.target_schema_name, ''), 'public') = 'public'
  );

DELETE FROM public.system_group_table_func_rights AS rights
USING public.system_functions AS functions
WHERE functions.id = rights.function_id
  AND functions.name = 'router.adminUpdateNoticeStreamHandler'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );

INSERT INTO public.system_db_version (version, description)
SELECT '9.6.4', 'Added fixed-schema administrator production-update advance notices.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '9.6.4'
);
