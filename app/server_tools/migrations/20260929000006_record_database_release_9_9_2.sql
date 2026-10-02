-- 20260929000006_record_database_release_9_9_2.sql
-- Records the database release 9.9.2: the settings row of the missing media files
-- check and the language keys of its administration screen.
-- Bridges the files of this release with the startup database compatibility check.
-- Exists so an installation can prove the release was applied. It is the last file
-- of the release, so a file that failed never leaves the version claimed; a file
-- added to 9.9.2 before it is published is named to run before this one. A new
-- installation receives the same version row from the bootstrap seed instead.
-- VERSION_DB: 9.9.2

INSERT INTO public.system_db_version (version, description)
SELECT '9.9.2',
       'Added the missing media files check setting with its update trigger, sampling and counting limits, and seeded the copy of its administration screen in four languages'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.9.2'
);
