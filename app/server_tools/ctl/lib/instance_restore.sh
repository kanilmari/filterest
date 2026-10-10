#!/bin/bash
# instance_restore.sh
# Imports writer-produced SQL into an empty replacement, retaining the old DB.
# Bridges a stopped instance, PostgreSQL maintenance connection and readiness.
# Every failed phase leaves recovery evidence and never reports a ready site.

source "${BASH_SOURCE[0]%/*}/../../lib/installation_records.sh"
source "${BASH_SOURCE[0]%/*}/instance_restore_security.sh"

preflight_instance_restore() {
    local instance="$1" restore_file="$2" library="${BASH_SOURCE[0]%/*}" name=""
    filterest_recovery_require_safe_names "${PROJECT_ROOT:-.}" "$instance" "$restore_file" \
        "${DB_ADMIN_USER:-}" "${DB_NAME:-$(project_default_db_name)}" || return 1
    [[ -n "${DB_ADMIN_USER:-}" ]] || { echo 'Restore administrator is missing.' >&2; return 1; }
    for name in create verify properties acl settings swap functions preflight; do
        [[ -r "$library/instance_restore_${name}.sql" && -s "$library/instance_restore_${name}.sql" ]] || {
            echo 'Restore SQL prerequisites are missing or unreadable.' >&2; return 1;
        }
    done
    [[ -s "$library/../../../backend/core_components/runtime_grants/reviewed_definers.json" ]] || {
        echo 'Restore definer policy is missing.' >&2; return 1;
    }
    filterest_recovery_content_stream "${PROJECT_ROOT:-.}" source-preflight "$restore_file" \
        "$library"/instance_restore_*.sql < /dev/null || return 1
    filterest_recovery_content_stream "${PROJECT_ROOT:-.}" json-preflight \
        "$library/../../../backend/core_components/runtime_grants/reviewed_definers.json" < /dev/null || return 1
    # Allocate names before shutdown and retain them for creation/reconciliation.
    FILTEREST_INSTANCE_RESTORE_STAMP="$(date -u +%Y%m%d_%H%M%S)_$$"
    local db_name="${DB_NAME:-$(project_default_db_name)}" maintenance=postgres
    local replacement="${db_name:0:26}_restore_${FILTEREST_INSTANCE_RESTORE_STAMP}"
    local kept="${db_name:0:26}_before_restore_${FILTEREST_INSTANCE_RESTORE_STAMP}"
    local evidence="instances/${instance}/backups/restore_${FILTEREST_INSTANCE_RESTORE_STAMP}.txt"
    filterest_recovery_content_names "${PROJECT_ROOT:-.}" "$replacement" "$kept" "$evidence" || return 1
    [[ ! -e "$evidence" && ! -L "$evidence" ]] || { echo 'Restore evidence destination already exists.' >&2; return 1; }
    [[ "$db_name" != postgres ]] || maintenance=template1
    filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" \
        psql -X -v ON_ERROR_STOP=1 -U "$DB_ADMIN_USER" -d "$maintenance" \
        -v target="$db_name" -v replacement="${db_name:0:26}_restore_${FILTEREST_INSTANCE_RESTORE_STAMP}" \
        -v recovery="${db_name:0:26}_before_restore_${FILTEREST_INSTANCE_RESTORE_STAMP}" \
        < "$library/instance_restore_preflight.sql" || return 1
    filterest_recovery_content_stream "${PROJECT_ROOT:-.}" destination-preflight \
        "instances/${instance}/backups/restore-preflight" < /dev/null
}

restore_instance_database_replacement() {
    filterest_recovery_scan "${PROJECT_ROOT:-.}" stderr _restore_instance_database_replacement "$@"
}

_restore_instance_database_replacement() {
    local instance="$1" restore_file="$2"
    filterest_recovery_require_safe_names "${PROJECT_ROOT:-.}" "$instance" "$restore_file" || return 1
    filterest_recovery_content_stream "${PROJECT_ROOT:-.}" source-preflight "$restore_file" < /dev/null || return 1
    local db_admin="${DB_ADMIN_USER}" db_name="${DB_NAME:-$(project_default_db_name)}"
    filterest_recovery_require_safe_names "${PROJECT_ROOT:-.}" "$db_admin" "$db_name" || return 1
    local maintenance=postgres
    [[ "$db_name" == postgres ]] && maintenance=template1
    local stamp="${3:-$(date -u +%Y%m%d_%H%M%S)_$$}"
    local replacement="${db_name:0:26}_restore_${stamp}" recovery="${db_name:0:26}_before_restore_${stamp}"
    local library="${BASH_SOURCE[0]%/*}"
    local evidence_dir="instances/${instance}/backups" evidence=""
    filterest_recovery_content_names "${PROJECT_ROOT:-.}" "$evidence_dir" || return 1
    (umask 077; filterest_recovery_output "${PROJECT_ROOT:-.}" mkdir -p -- "$evidence_dir") || return 1
    filterest_recovery_output "${PROJECT_ROOT:-.}" chmod 700 -- "$evidence_dir" || return 1
    evidence="${evidence_dir}/restore_${stamp}.txt"
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" printf 'source=%s\ntarget=%s\nreplacement=%s\nrecovery=%s\nphase=prepared\n' \
        "$restore_file" "$db_name" "$replacement" "$recovery" || return 1
    echo "Recovery evidence: $evidence"

    echo "[1/6] Creating an empty restore database..."
    if ! filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$maintenance" \
        -v target="$db_name" -v replacement="$replacement" < "$library/instance_restore_create.sql"
    then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=database_settings_failed' || return 1
        echo "Restore refused: could not create replacement; original database retained ($evidence)." >&2
        return 1
    fi
    echo "[2/6] Importing backup into the empty replacement..."
    if ! (
        set -o pipefail
        case "$restore_file" in
            *.gz) filterest_recovery_utility "${PROJECT_ROOT:-.}" gzip -dc -- "$restore_file" ;;
            *) filterest_recovery_utility "${PROJECT_ROOT:-.}" cat -- "$restore_file" ;;
        esac | filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$replacement"
    ); then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=import_failed' || return 1
        echo "Restore failed: original and partial replacement retained ($evidence)." >&2
        return 1
    fi
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=imported' || return 1
    # A successful SQL stream can still be the wrong file. Require the core
    # identity/rights catalogue before changing the installation's DB name.
    if ! filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$replacement" < "$library/instance_restore_verify.sql"
    then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=verification_failed' || return 1
        return 1
    fi
    # Portable dumps intentionally omit cluster-specific ownership and ACLs.
    # Recover these from the live original while it is still addressable.
    echo "[3/6] Preserving and checking function security..."
    if ! restore_copy_function_security "$instance" "$db_admin" "$db_name" "$replacement" "$evidence_dir"; then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=function_security_failed' || return 1
        echo "Restore refused: function security could not be preserved; original retained ($evidence)." >&2
        return 1
    fi
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=function_security_verified' || return 1
    echo "[4/6] Preserving and checking database configuration..."
    if ! restore_copy_database_settings "$instance" "$db_admin" "$maintenance" "$db_name" "$replacement"; then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=database_settings_failed' || return 1
        echo "Restore refused: database configuration could not be preserved; original retained ($evidence)." >&2
        return 1
    fi
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=database_settings_verified' || return 1
    echo "[5/6] Retaining the original and installing the verified replacement..."
    # Stop reconnects and terminate remaining consumers of the original before
    # renaming it. This includes other nodes' workers, not only this container.
    # No DROP is used: both databases survive every failure, including a partial
    # rename. psql variables quote installation-specific identifiers safely.
    if ! filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$db_admin" -d "$maintenance" \
        -v target="$db_name" -v replacement="$replacement" -v recovery="$recovery" < "$library/instance_restore_swap.sql"
    then
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=swap_failed' || return 1
        echo "Restore swap failed; inspect the retained database names in $evidence before recovery." >&2
        return 1
    fi
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=installed' || return 1
    echo "[6/6] Starting and checking permission reconciliation..."
    if ! filterest_recovery_output "${PROJECT_ROOT:-.}" docker start "easelect-${instance}-app" >/dev/null ||
       ! wait_for_instance_app "$instance" "${APP_PORT:-8082}" 60; then
        filterest_recovery_output "${PROJECT_ROOT:-.}" docker stop --time 30 "easelect-${instance}-app" >/dev/null 2>&1 || true
        filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=readiness_failed' || return 1
        echo "Restore imported, but reconciliation/readiness failed; app stopped; original retained as $recovery ($evidence)." >&2
        return 1
    fi
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$evidence" --append printf '%s\n' 'phase=ready' || return 1
    echo "Database restored and reconciled from: $restore_file; original retained as $recovery"
}
