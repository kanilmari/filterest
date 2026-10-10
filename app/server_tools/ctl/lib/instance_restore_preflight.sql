-- instance_restore_preflight.sql
-- Check existing cluster prerequisites without changing any role or database.
-- Shared by packet and legacy restore before application shutdown.
-- Replacement import, permission reconciliation and swap still recheck live state.
SELECT 1 / CASE WHEN count(*)=1 AND bool_and(datlocprovider IN ('c','i')) THEN 1 ELSE 0 END
 FROM pg_database WHERE datname=:'target';
SELECT 1 / CASE WHEN NOT EXISTS
 (SELECT 1 FROM pg_database WHERE datname IN (:'replacement', :'recovery')) THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN rolsuper OR rolcreatedb THEN 1 ELSE 0 END
 FROM pg_roles WHERE rolname=current_user;
