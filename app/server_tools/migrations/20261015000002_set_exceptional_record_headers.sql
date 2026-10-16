-- 20261015000002_set_exceptional_record_headers.sql
-- Gives two system datasets intentional names where inference is ambiguous.
-- Connects audit handler names and authorized language-key aliases to card roles.
-- Changes only untouched visible metadata and preserves administrator choices.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: record_title_headers_962

DO $record_title_headers$
BEGIN
    UPDATE public.system_column_details details
    SET card_element = 'header', updated = now()
    FROM public.system_db_tables dataset
    WHERE details.table_uid = dataset.table_uid AND dataset.schema_name = 'public'
      AND (dataset.table_name, details.column_name) IN (
          ('system_audit_log', 'handler_name'), ('system_lang_key_translations', 'lang_key_id'))
      AND COALESCE(btrim(details.card_element), '') IN ('', 'details')
      AND COALESCE(details.hide_everywhere, false) = false
      AND COALESCE(details.hide_on_small_card, false) = false
      AND COALESCE(details.show_value_on_card, false) = true
      AND COALESCE(details.client_delivery_mode, 'include') = 'include'
      AND NOT EXISTS (
          SELECT 1 FROM public.system_column_details configured
          WHERE configured.table_uid = dataset.table_uid
            AND configured.card_element ~ '(^|,)\s*header(\s*\+[^,]+)?\s*(,|$)'
      );

    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'record_title_headers_962', 'completed',
           '{"file":"20261015000002_set_exceptional_record_headers.sql"}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
                       WHERE migration = 'record_title_headers_962' AND action = 'completed');
END $record_title_headers$;
