-- 20261005000085_add_front_page_show_blocks.sql
-- Adds the site-wide Home box switch with the existing visible-box default.
-- Connects the dedicated Home editor and registered generic boolean validation.
-- Preserves an administrator's value on upgrades and repeated imports.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

INSERT INTO public.system_config(key,boolean_value,json_value,text_value,value_type,creation_spec)
SELECT 'front_page_show_blocks',true,'{"value":true}'::jsonb,'true',2,
       'Show Home dataset boxes; missing configuration also means enabled.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key='front_page_show_blocks');
