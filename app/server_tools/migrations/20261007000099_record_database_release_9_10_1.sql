-- 20261007000099_record_database_release_9_10_1.sql
-- Records the database release 9.10.1: the texts of the category match choice ("At least one" or "All selected")
-- and of the guidance for category values without current hits (WL103 slice 3a), and the steps of the same release
-- that are added before it ships.
-- Bridges the files of this release with the startup database compatibility check.
-- Exists so an installation can prove the release was applied. It is the last file
-- of the release, so a file that failed never leaves the version claimed; a file
-- added to 9.10.1 before it is published is named to run before this one. A new
-- installation receives the same version row from the bootstrap seed instead.
-- VERSION_DB: 9.10.1

INSERT INTO public.system_db_version (version, description)
SELECT '9.10.1',
       'Added the texts of the category match choice (at least one or all selected values) and of the guidance for category values without current hits (WL103)'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.10.1'
);
