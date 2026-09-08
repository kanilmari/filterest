-- 20260908000002_add_public_site_login_policy.sql
-- Adds independent public login visibility and administrator-only sign-in settings.
-- Connects existing installations to the same compatible defaults as public bootstrap.
-- Preserves every previously configured value and does not open a site's data to guests.
-- VERSION_DB: 9.7.5

-- Separate public sign-in visibility from server-enforced administrator-only access.
INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT defaults.key, defaults.enabled, jsonb_build_object('value', defaults.enabled),
       defaults.enabled::text, 2, defaults.description
FROM (VALUES
    ('show_login_button', TRUE, 'Show visitor sign-in entry points. Direct /login remains available when hidden.'),
    ('only_admin_can_login', FALSE, 'Allow sign-in only for enabled administrators with administrator access; also disables effective self-registration.')
) AS defaults(key, enabled, description)
WHERE NOT EXISTS (SELECT 1 FROM public.system_config AS existing WHERE existing.key = defaults.key);

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.5', 'Separate visitor login visibility from administrator-only sign-in policy'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.5');
