-- 20261005000099_record_database_release_9_10_0.sql
-- Records the database release 9.10.0: the creator and owner columns of every content
-- dataset with the support they rest on (WL58 stage 2), and the steps of the same
-- release that are added before it ships, including retirement of the unused
-- per-column wrapping choice (WL52, K234).
-- Bridges the files of this release with the startup database compatibility check.
-- Exists so an installation can prove the release was applied. It is the last file
-- of the release, so a file that failed never leaves the version claimed; a file
-- added to 9.10.0 before it is published is named to run before this one. A new
-- installation receives the same version row from the bootstrap seed instead.
-- VERSION_DB: 9.10.0

INSERT INTO public.system_db_version (version, description)
SELECT '9.10.0',
       'Added creator and owner columns to every content dataset, with the actor marks, repair record and guards they rest on; added account-owned favorites and administrator quick-list copy; added optional common and account-specific front pages with protected backgrounds; removed unused per-column field wrapping; required, protected dataset registry reference key; added multilingual row-group classification headings (WL103)'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.10.0'
);
