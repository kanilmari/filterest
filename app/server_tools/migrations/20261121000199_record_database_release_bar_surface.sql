-- 20261121000199_record_database_release_bar_surface.sql
-- Records the frosted-bars experiment switch's label (WL182), a text-only database release.
-- Replay records exactly one release row.
-- VERSION_DB: 9.13.9

INSERT INTO public.system_db_version (version, description)
SELECT '9.13.9', 'Label of the frosted-bars experiment switch in the menu administration tools (WL182)'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.13.9');
