-- 20260929000003_record_database_release_9_9_1.sql
-- Records the database release 9.9.1: the language keys of the links section of
-- the dataset form, and the repair of stale display-column settings and of the
-- column-metadata link name.
-- Bridges the files of this release with the startup database compatibility check.
-- Exists so an installation can prove the release was applied. It is the last file
-- of the release, so a file that failed never leaves the version claimed; a file
-- added to 9.9.1 before it is published is named to run before this one. A new
-- installation receives the same version row from the bootstrap seed instead.
-- VERSION_DB: 9.9.1

INSERT INTO public.system_db_version (version, description)
SELECT '9.9.1',
       'Seeded the Connect two fields copy of the dataset form and the foreign-keys page labels in four languages, and repaired stale display-column settings and the column-metadata link name'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.9.1'
);
