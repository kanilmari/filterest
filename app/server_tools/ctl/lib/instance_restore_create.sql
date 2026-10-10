-- instance_restore_create.sql
-- Shared replacement creation; original encoding/locale/tablespace are retained.
-- Refuse missing originals or a locale provider this PostgreSQL cannot replay.
-- Ordinary connections stay closed until the verified database is swapped in.
SELECT 1 / CASE WHEN count(*)=1 AND bool_and(datlocprovider IN ('c','i')) THEN 1 ELSE 0 END
 FROM pg_database WHERE datname=:'target';
SELECT format('CREATE DATABASE %I TEMPLATE template0 CONNECTION LIMIT 0 ENCODING %L LC_COLLATE %L LC_CTYPE %L LOCALE_PROVIDER %s%s%s%s TABLESPACE %I IS_TEMPLATE %s',
    :'replacement',pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,
    CASE d.datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' END,
    CASE WHEN d.datlocprovider='i' THEN format(' ICU_LOCALE %L',to_jsonb(d)->>'daticulocale') ELSE '' END,
    CASE WHEN to_jsonb(d)->>'daticurules' IS NOT NULL THEN format(' ICU_RULES %L',to_jsonb(d)->>'daticurules') ELSE '' END,
    CASE WHEN d.datcollversion IS NOT NULL THEN format(' COLLATION_VERSION %L',d.datcollversion) ELSE '' END,
    t.spcname,CASE WHEN d.datistemplate THEN 'true' ELSE 'false' END)
 FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=:'target';
\gexec
