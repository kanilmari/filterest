-- instance_restore_swap.sql
-- Shared atomic name swap, retaining the original with connections disabled.
-- Connects verified packet/instance replacements with their installation's name.
-- Restore the saved connection limit only in the transaction that installs it.
BEGIN;
\if :{?connection_limit}
SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s', :'replacement', :'connection_limit'::integer);
\gexec
\else
SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s', :'replacement', datconnlimit)
 FROM pg_database WHERE datname=:'target';
\gexec
\endif
SELECT format('ALTER DATABASE %I ALLOW_CONNECTIONS false', :'target');
\gexec
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'target' AND pid <> pg_backend_pid();
SELECT format('ALTER DATABASE %I RENAME TO %I', :'target', :'recovery');
\gexec
SELECT format('ALTER DATABASE %I RENAME TO %I', :'replacement', :'target');
\gexec
COMMIT;
