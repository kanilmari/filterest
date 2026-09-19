-- 20260919000006_record_lang_key_sources_by_file.sql
-- Records the chat attachment keys against the file that uses them.
-- Bridges a seed migration's hand-written usage record with the start-up scan's.
-- Exists because the seed recorded a folder while the scan records a file, which
-- left two records for one use and let the authored explanation expire in a week.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

UPDATE public.system_lang_key_sources AS sources
SET source_high = 'frontend/core_components/ai_features/table_chat/table_chat_attachments.js',
    source_low = '',
    last_seen = CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.id = sources.lang_key_id
  AND keys.lang_key LIKE 'chat_attach_%'
  AND sources.source_type = 'code'
  AND sources.source_high = 'frontend/core_components/ai_features/table_chat'
  AND NOT EXISTS (
      SELECT 1
      FROM public.system_lang_key_sources AS existing
      WHERE existing.lang_key_id = sources.lang_key_id
        AND existing.source_type = 'code'
        AND existing.source_high = 'frontend/core_components/ai_features/table_chat/table_chat_attachments.js'
  );

DELETE FROM public.system_lang_key_sources AS sources
USING public.system_lang_keys AS keys
WHERE keys.id = sources.lang_key_id
  AND keys.lang_key LIKE 'chat_attach_%'
  AND sources.source_type = 'code'
  AND sources.source_high = 'frontend/core_components/ai_features/table_chat';
