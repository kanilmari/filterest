-- 20260817000004_default_card_field_labels_off.sql
-- New column metadata starts with card labels hidden. Existing explicit choices
-- are preserved; administrators can opt individual labels back in.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

ALTER TABLE public.system_column_details
    ALTER COLUMN show_key_on_card SET DEFAULT FALSE;

COMMENT ON COLUMN public.system_column_details.show_key_on_card IS
    'Whether a field label is shown on cards. New metadata defaults to false; existing rows retain their saved value.';
