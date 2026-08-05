-- 20260719000001_remove_generic_row_links.sql
-- VERSION_DB: 8.0.51
-- Removes the unused generic row-link subsystem without affecting schema-defined
-- foreign-key relations or the article view's existing related-row sections.

DO $$
DECLARE
    stored_row_links_exist BOOLEAN := false;
BEGIN
    IF to_regclass('public.system_row_links') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.system_row_links LIMIT 1)'
           INTO stored_row_links_exist;

        IF stored_row_links_exist THEN
            RAISE EXCEPTION
                'Refusing to remove system_row_links because stored row links exist; export or migrate them first.';
        END IF;
    END IF;
END $$;

DELETE FROM public.system_functions
WHERE name IN (
        'system_table_tools.GetRowLinksHandler',
        'system_table_tools.CreateRowLinkHandler',
        'system_table_tools.ArchiveRowLinkHandler'
    )
   OR url_route_endpoint IN (
        '/api/row-links',
        '/api/row-links/create',
        '/api/row-links/archive'
    );

DELETE FROM public.system_lang_keys
WHERE lang_key IN (
    'row_article_section_linked_objects',
    'row_article_linked_objects_empty',
    'row_article_link_target_dataset',
    'row_article_link_target_row_id',
    'row_article_link_description',
    'row_article_link_create',
    'row_article_link_type_related_to'
);

DROP TABLE IF EXISTS public.system_row_links;
DROP TABLE IF EXISTS public.system_row_link_types;

DELETE FROM public.system_db_tables
WHERE table_name IN ('system_row_links', 'system_row_link_types')
  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public';

DROP FUNCTION IF EXISTS public.set_system_row_link_updated_timestamp();

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.51',
       'Removed the unused generic row-link subsystem.'
WHERE NOT EXISTS (
    SELECT 1
      FROM public.system_db_version
     WHERE version = '8.0.51'
);
