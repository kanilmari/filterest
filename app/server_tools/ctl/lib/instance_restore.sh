#!/bin/bash
# instance_restore.sh
# Imports writer-produced SQL into an empty replacement, retaining the old DB.
# Bridges a stopped instance, PostgreSQL maintenance connection and readiness.
# Every failed phase leaves recovery evidence and never reports a ready site.

source "$(dirname "${BASH_SOURCE[0]}")/instance_restore_security.sh"

restore_instance_database_replacement() {
    local instance="$1" restore_file="$2"
    local db_admin="${DB_ADMIN_USER}" db_name="${DB_NAME:-$(project_default_db_name)}"
    local maintenance=postgres
    [[ "$db_name" == postgres ]] && maintenance=template1
    local stamp="$(date +%Y%m%d_%H%M%S)_$$"
    local replacement="filterest_restore_${stamp}" recovery="filterest_recovery_${stamp}"
    local evidence_dir="instances/${instance}/backups" evidence=""
    mkdir -p "$evidence_dir" || return 1
    chmod 700 "$evidence_dir" || return 1
    evidence="${evidence_dir}/restore_${stamp}.txt"
    (umask 077; printf 'source=%s\ntarget=%s\nreplacement=%s\nrecovery=%s\nphase=prepared\n' \
        "$restore_file" "$db_name" "$replacement" "$recovery" > "$evidence") || return 1
    echo "Recovery evidence: $evidence"

    echo "[1/6] Creating an empty restore database..."
    if ! docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$maintenance" \
        -v target="$db_name" -v replacement="$replacement" <<'SQL'
-- Refuse missing originals or a locale provider this PostgreSQL cannot replay.
SELECT 1 / CASE WHEN count(*)=1 AND bool_and(datlocprovider IN ('c','i')) THEN 1 ELSE 0 END
 FROM pg_database WHERE datname=:'target';
SELECT format('CREATE DATABASE %I TEMPLATE template0 ENCODING %L LC_COLLATE %L LC_CTYPE %L LOCALE_PROVIDER %s%s%s%s TABLESPACE %I IS_TEMPLATE %s',
    :'replacement',pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,
    CASE d.datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' END,
    CASE WHEN d.datlocprovider='i' THEN format(' ICU_LOCALE %L',to_jsonb(d)->>'daticulocale') ELSE '' END,
    CASE WHEN to_jsonb(d)->>'daticurules' IS NOT NULL THEN format(' ICU_RULES %L',to_jsonb(d)->>'daticurules') ELSE '' END,
    CASE WHEN d.datcollversion IS NOT NULL THEN format(' COLLATION_VERSION %L',d.datcollversion) ELSE '' END,
    t.spcname,CASE WHEN d.datistemplate THEN 'true' ELSE 'false' END)
 FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=:'target';
\gexec
SQL
    then
        echo 'phase=database_settings_failed' >> "$evidence"
        echo "Restore refused: could not create replacement; original database retained ($evidence)." >&2
        return 1
    fi
    echo "[2/6] Importing backup into the empty replacement..."
    if ! (
        set -o pipefail
        case "$restore_file" in
            *.gz) gzip -dc "$restore_file" ;;
            *) cat "$restore_file" ;;
        esac | docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$replacement"
    ); then
        echo 'phase=import_failed' >> "$evidence"
        echo "Restore failed: original and partial replacement retained ($evidence)." >&2
        return 1
    fi
    echo 'phase=imported' >> "$evidence"
    # A successful SQL stream can still be the wrong file. Require the core
    # identity/rights catalogue before changing the installation's DB name.
    if ! docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$replacement" <<'SQL'
DO $$ BEGIN
    IF to_regclass('public.system_db_tables') IS NULL
       OR to_regclass('public.system_db_version') IS NULL
       OR to_regclass('public.system_functions') IS NULL
       OR to_regclass('public.system_group_table_func_rights') IS NULL THEN
        RAISE EXCEPTION 'backup has no complete Filterest catalogue';
    END IF;
END $$;
SQL
    then
        echo 'phase=verification_failed' >> "$evidence"
        return 1
    fi
    # Portable dumps intentionally omit cluster-specific ownership and ACLs.
    # Recover these from the live original while it is still addressable.
    echo "[3/6] Preserving and checking function security..."
    if ! restore_copy_function_security "$instance" "$db_admin" "$db_name" "$replacement" "$evidence_dir"; then
        echo 'phase=function_security_failed' >> "$evidence"
        echo "Restore refused: function security could not be preserved; original retained ($evidence)." >&2
        return 1
    fi
    echo 'phase=function_security_verified' >> "$evidence"
    echo "[4/6] Preserving and checking database configuration..."
    if ! restore_copy_database_settings "$instance" "$db_admin" "$maintenance" "$db_name" "$replacement"; then
        echo 'phase=database_settings_failed' >> "$evidence"
        echo "Restore refused: database configuration could not be preserved; original retained ($evidence)." >&2
        return 1
    fi
    echo 'phase=database_settings_verified' >> "$evidence"
    echo "[5/6] Retaining the original and installing the verified replacement..."
    # Stop reconnects and terminate remaining consumers of the original before
    # renaming it. This includes other nodes' workers, not only this container.
    # No DROP is used: both databases survive every failure, including a partial
    # rename. psql variables quote installation-specific identifiers safely.
    if ! docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$maintenance" \
        -v target="$db_name" -v replacement="$replacement" -v recovery="$recovery" <<'SQL'
SELECT format('ALTER DATABASE %I ALLOW_CONNECTIONS false', :'target');
\gexec
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'target' AND pid <> pg_backend_pid();
SELECT format('ALTER DATABASE %I RENAME TO %I', :'target', :'recovery');
\gexec
SELECT format('ALTER DATABASE %I RENAME TO %I', :'replacement', :'target');
\gexec
SQL
    then
        echo 'phase=swap_failed' >> "$evidence"
        echo "Restore swap failed; inspect the retained database names in $evidence before recovery." >&2
        return 1
    fi
    echo 'phase=installed' >> "$evidence"
    echo "[6/6] Starting and checking permission reconciliation..."
    if ! docker start "easelect-${instance}-app" >/dev/null ||
       ! wait_for_instance_app "$instance" "${APP_PORT:-8082}" 60; then
        docker stop --time 30 "easelect-${instance}-app" >/dev/null 2>&1 || true
        echo 'phase=readiness_failed' >> "$evidence"
        echo "Restore imported, but reconciliation/readiness failed; app stopped; original retained as $recovery ($evidence)." >&2
        return 1
    fi
    echo 'phase=ready' >> "$evidence"
    echo "Database restored and reconciled from: $restore_file; original retained as $recovery"
}
