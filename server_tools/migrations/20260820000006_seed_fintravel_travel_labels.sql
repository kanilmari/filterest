-- 20260820000006_seed_fintravel_travel_labels.sql
-- Completes the reviewed Finnish/English labels used by the Fintravel travel
-- datasets and aligns the Travel info hero with its navigation label.
-- VERSION_DB: batched with 9.2.5
-- VERSION_DB_OWNER: 20260820000005_expand_site_presentation_settings.sql

WITH desired_labels(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('link', 'Linkki', 'Link', 'Shared user-facing label for a row link or source URL.'),
        ('keywords', 'Avainsanat', 'Keywords', 'Shared user-facing label for searchable row keywords.'),
        (
            'travel_info_front_page',
            'Matkainfo',
            'Travel information',
            'Visible Fintravel Travel info hero heading; the site name is added separately.'
        )
)
UPDATE public.system_lang_keys AS existing
SET fi = desired.fi,
    en = desired.en,
    creation_spec = desired.creation_spec,
    updated = now()
FROM desired_labels AS desired
WHERE existing.lang_key = desired.lang_key;

WITH desired_labels(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('link', 'Linkki', 'Link', 'Shared user-facing label for a row link or source URL.'),
        ('keywords', 'Avainsanat', 'Keywords', 'Shared user-facing label for searchable row keywords.'),
        (
            'travel_info_front_page',
            'Matkainfo',
            'Travel information',
            'Visible Fintravel Travel info hero heading; the site name is added separately.'
        )
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT desired.lang_key, desired.fi, desired.en, desired.creation_spec
FROM desired_labels AS desired
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = desired.lang_key
);

WITH desired_translations(lang_key, language_code, translation) AS (
    VALUES
        ('link', 'fi', 'Linkki'),
        ('link', 'en', 'Link'),
        ('keywords', 'fi', 'Avainsanat'),
        ('keywords', 'en', 'Keywords'),
        ('travel_info_front_page', 'fi', 'Matkainfo'),
        ('travel_info_front_page', 'en', 'Travel information')
), resolved AS (
    SELECT keys.id AS lang_key_id, desired.language_code, desired.translation
    FROM desired_translations AS desired
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = desired.lang_key
)
UPDATE public.system_lang_key_translations AS existing
SET translation = resolved.translation,
    source_kind = 'manual',
    review_status = 'approved',
    updated = now()
FROM resolved
WHERE existing.lang_key_id = resolved.lang_key_id
  AND existing.language_code = resolved.language_code;

WITH desired_translations(lang_key, language_code, translation) AS (
    VALUES
        ('link', 'fi', 'Linkki'),
        ('link', 'en', 'Link'),
        ('keywords', 'fi', 'Avainsanat'),
        ('keywords', 'en', 'Keywords'),
        ('travel_info_front_page', 'fi', 'Matkainfo'),
        ('travel_info_front_page', 'en', 'Travel information')
), resolved AS (
    SELECT keys.id AS lang_key_id, desired.language_code, desired.translation
    FROM desired_translations AS desired
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = desired.lang_key
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    resolved.lang_key_id,
    resolved.language_code,
    resolved.translation,
    'manual',
    'approved'
FROM resolved
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = resolved.lang_key_id
      AND existing.language_code = resolved.language_code
);

WITH desired_sources(lang_key, source_type, source_high, source_low, usage_explanation) AS (
    VALUES
        (
            'link', 'column', 'travel_info', 'link',
            'Column label for the source link in the Fintravel Travel info dataset.'
        ),
        (
            'link', 'column', 'travel_deals', 'link',
            'Column label for the booking or source link in the Fintravel Travel deals dataset.'
        ),
        (
            'keywords', 'column', 'travel_deals', 'keywords',
            'Column label for multilingual keywords in the Fintravel Travel deals dataset.'
        ),
        (
            'travel_info_front_page',
            'javascript',
            'frontend/core_components/filterbar/filter_bar_builder.js',
            'travel_info_front_page',
            'Visible dataset hero heading for Fintravel Travel info.'
        )
), resolved AS (
    SELECT
        keys.id AS lang_key_id,
        desired.source_type,
        desired.source_high,
        desired.source_low,
        desired.usage_explanation
    FROM desired_sources AS desired
    JOIN public.system_lang_keys AS keys
      ON keys.lang_key = desired.lang_key
)
INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT
    resolved.lang_key_id,
    resolved.source_type,
    resolved.source_high,
    resolved.source_low,
    resolved.usage_explanation,
    CURRENT_DATE
FROM resolved
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_lang_key_sources AS existing
    WHERE existing.lang_key_id = resolved.lang_key_id
      AND existing.source_type = resolved.source_type
      AND existing.source_high = resolved.source_high
);

WITH desired_function (
    name,
    package,
    specific_table_related,
    url_route_endpoint
) AS (
    VALUES (
        'lang.AdminLangKeyHandler',
        'lang',
        FALSE,
        '/api/admin/lang-key'
    )
), missing_function AS (
    SELECT desired.*
    FROM desired_function AS desired
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
    'Filterest administrator language-key maintenance API',
    200,
    20,
    missing.url_route_endpoint,
    FALSE
FROM missing_function AS missing;

UPDATE public.system_functions
SET disabled = FALSE,
    updated = now(),
    package = 'lang',
    specific_table_related = FALSE,
    creation_spec = 'Filterest administrator language-key maintenance API',
    rate_limit_amount = 200,
    rate_limit_minutes = 20,
    url_route_endpoint = '/api/admin/lang-key',
    ui_only = FALSE
WHERE name = 'lang.AdminLangKeyHandler';

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
    'Filterest administrator language-key maintenance API',
    NULL
FROM public.system_user_groups AS groups
JOIN public.system_functions AS functions
  ON functions.name = 'lang.AdminLangKeyHandler'
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
  AND functions.name = 'lang.AdminLangKeyHandler'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_user_groups AS groups
      WHERE groups.id = rights.user_group_id
        AND groups.name = 'admins'
  );
