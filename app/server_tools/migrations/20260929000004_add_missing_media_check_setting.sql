-- 20260929000004_add_missing_media_check_setting.sql
-- Adds the settings row of the missing media files check, or brings an existing row
-- to its second shape.
-- Bridges the settings view with the check, which reads the row through
-- missing_media_check.LoadSettings and runs by itself after an update.
-- Exists because the check created the row only the first time it ran, without an
-- editor type, so a site could not see or edit the setting before that, and the
-- choices of this release had no stored value at all: how a large dataset is
-- sampled, whether the check runs after an update, and how many rows of one dataset
-- are counted exactly before the count is estimated.
-- A new installation receives the defaults, in which the check runs after an update
-- and not at every start. A site that already has the row keeps every other value it
-- stores and gains the keys it lacks, but its two run choices become those of the
-- defaults: every site runs the check after an update and not at every start, the
-- owner's decision K122 of 30.9.2026. A site that switched the whole check off keeps
-- it off. A stored value that is not a JSON object is left for the administrator to
-- replace; the check does not run on it. Running the file again changes nothing,
-- because the stamp merged last is the same in the value and in the condition. The
-- defaults and the description are those of missing_media_check.DefaultSettings and
-- settingsCreationSpec, and a Go test keeps them and the stamp equal. The public
-- bootstrap runs this same file, so a new installation is born with the row. No
-- result row is written here: the first run writes it.
-- VERSION_DB: 9.9.2
-- VERSION_DB_OWNER: 20260929000006_record_database_release_9_9_2.sql

WITH defaults(value, description) AS (
    VALUES (
        '{"schema_version": 2, "enabled": true, "max_total_rows_checked": 10000, "min_rows_per_dataset": 50, "sampling": "even", "max_run_seconds": 120, "run_on_startup": false, "run_after_update": true, "startup_delay_seconds": 30, "exact_count_max_rows": 100000, "report_unused_files": false, "max_reported_missing": 200, "max_reported_unused_files": 200}'::jsonb,
        'Settings of the missing media files check, which reports pictures and attachments that rows use but storage no longer has. It only reports: it never repairs, moves or deletes anything. enabled switches the whole check off. It runs by itself once after an application or database update when run_after_update is true, and at every server start when run_on_startup is true, startup_delay_seconds after the start. max_total_rows_checked and max_run_seconds bound one run; min_rows_per_dataset is the smallest sample of each dataset; sampling is even or random. A dataset with more than exact_count_max_rows rows is estimated instead of counted and is never reported as fully checked. report_unused_files also lists stored files that no row uses; max_reported_missing and max_reported_unused_files bound the stored lists.'
    )
), created AS (
    -- 5 is the JSON editor of the settings view: the whole object is edited at once
    -- and cannot be saved as a string.
    INSERT INTO public.system_config (key, json_value, text_value, value_type, creation_spec)
    SELECT 'missing_media_check', defaults.value, NULL, 5, defaults.description
    FROM defaults
    WHERE NOT EXISTS (
        SELECT 1 FROM public.system_config WHERE key = 'missing_media_check'
    )
    RETURNING key
)
-- One statement does not read its own writes, so a row inserted above is not
-- updated here: it already has its final value.
UPDATE public.system_config AS setting
   SET json_value = CASE
           WHEN jsonb_typeof(setting.json_value) = 'object'
           THEN defaults.value || setting.json_value || '{"schema_version": 2, "run_on_startup": false, "run_after_update": true}'::jsonb
           ELSE setting.json_value
       END,
       value_type = 5,
       creation_spec = defaults.description,
       updated = now()
  FROM defaults
 WHERE setting.key = 'missing_media_check'
   AND (setting.value_type IS DISTINCT FROM 5
        OR setting.creation_spec IS DISTINCT FROM defaults.description
        OR (jsonb_typeof(setting.json_value) = 'object'
            AND setting.json_value IS DISTINCT FROM
                defaults.value || setting.json_value || '{"schema_version": 2, "run_on_startup": false, "run_after_update": true}'::jsonb));
