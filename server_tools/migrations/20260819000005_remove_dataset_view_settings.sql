-- 20260819000005_remove_dataset_view_settings.sql
-- Removes the short-lived per-dataset article activation table introduced by
-- 20260819000004. Image-first is an always-available standalone image view,
-- so retaining dataset activation metadata would misrepresent the product.
-- VERSION_DB: 9.2.0
-- VERSION_DB_OWNER: 20260819000003_record_dataset_media_db_release.sql

DROP TABLE IF EXISTS public.system_dataset_view_settings;

DELETE FROM public.system_column_details
WHERE table_uid IN (
    SELECT table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_dataset_view_settings'
      AND schema_name = 'public'
);

DELETE FROM public.system_db_tables
WHERE table_name = 'system_dataset_view_settings'
  AND schema_name = 'public';

DROP FUNCTION IF EXISTS public.set_system_dataset_view_settings_updated_timestamp();
