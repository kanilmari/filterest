#!/bin/bash
# instance_restore_security.sh
# Preserves live target security/configuration around portable replacement imports.
# Reads the original in the same cluster and verifies before the caller swaps names.
# The runtime's embedded policy file is also the restore's definer authority.

restore_copy_function_security() {
    filterest_recovery_scan "${PROJECT_ROOT:-.}" stderr _restore_copy_function_security "$@"
}

_restore_copy_function_security() {
    local instance="$1" administrator="$2" target="$3" replacement="$4" evidence_dir="$5"
    local library policy security_file status=0
    library="${BASH_SOURCE[0]%/*}"
    policy="${library}/../../../backend/core_components/runtime_grants/reviewed_definers.json"
    [[ -r "${library}/instance_restore_acl.sql" && -r "${library}/instance_restore_functions.sql" ]] || return 1
    [[ -s "$policy" ]] || { echo 'Restore definer policy is missing.' >&2; return 1; }
    security_file="$(filterest_recovery_mktemp "${PROJECT_ROOT:-.}" -- "${evidence_dir}/function_security.XXXXXX.sql")" || return 1
    filterest_recovery_output "${PROJECT_ROOT:-.}" chmod 600 -- "$security_file" || { filterest_recovery_output "${PROJECT_ROOT:-.}" rm -f -- "$security_file"; return 1; }
    # The SQL stream contains identifiers and ACLs only, never function bodies.
    filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$security_file" printf 'BEGIN;\nSET search_path=pg_catalog;\nCREATE TEMP TABLE restore_original_functions(identity text PRIMARY KEY,info jsonb);\n' || { filterest_recovery_output "${PROJECT_ROOT:-.}" rm -f -- "$security_file"; return 1; }
    if ! filterest_recovery_content_to_file "${PROJECT_ROOT:-.}" "$security_file" --append docker exec -i "easelect-${instance}-db" psql -X -qAt -v ON_ERROR_STOP=1 -U "$administrator" -d "$target" <<'SQL'
SET search_path=pg_catalog;
SELECT format('INSERT INTO restore_original_functions VALUES (%L,%L::jsonb);',p.oid::regprocedure::text,jsonb_build_object(
    'identity',p.oid::regprocedure::text,'owner',r.rolname,
    'acl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',COALESCE(gr.rolname,'PUBLIC'),
              'privilege',a.privilege_type,'grantable',a.is_grantable)
              ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
           FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
           JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles gr ON gr.oid=a.grantee)))
 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.prokind IN ('f','w','p','a');
SQL
    then
        filterest_recovery_output "${PROJECT_ROOT:-.}" rm -f -- "$security_file"
        return 1
    fi
    # Bind policy through psql quoting, then replay and check in one transaction.
    (
      set -o pipefail
      {
        filterest_recovery_utility "${PROJECT_ROOT:-.}" cat -- "$security_file" || exit 1
        printf "CREATE TEMP TABLE restore_reviewed_definers AS SELECT :'reviewed'::jsonb AS policy;\n"
        filterest_recovery_utility "${PROJECT_ROOT:-.}" cat -- "${library}/instance_restore_acl.sql" "${library}/instance_restore_functions.sql" || exit 1
        printf 'COMMIT;\n'
    } | filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$administrator" -d "$replacement" \
            -v reviewed="$(filterest_recovery_utility "${PROJECT_ROOT:-.}" cat -- "$policy")"
    ) || status=$?
    filterest_recovery_output "${PROJECT_ROOT:-.}" rm -f -- "$security_file"
    return "$status"
}

restore_copy_database_settings() {
    filterest_recovery_scan "${PROJECT_ROOT:-.}" stderr _restore_copy_database_settings "$@"
}

_restore_copy_database_settings() {
    local instance="$1" administrator="$2" maintenance="$3" target="$4" replacement="$5" library
    library="${BASH_SOURCE[0]%/*}"
    [[ -r "${library}/instance_restore_acl.sql" && -r "${library}/instance_restore_settings.sql" ]] || return 1
    (
      set -o pipefail
      {
        printf 'BEGIN;\n'
        filterest_recovery_utility "${PROJECT_ROOT:-.}" cat -- "${library}/instance_restore_properties.sql" "${library}/instance_restore_acl.sql" "${library}/instance_restore_settings.sql" || exit 1
        printf 'COMMIT;\n'
    } | filterest_recovery_output "${PROJECT_ROOT:-.}" docker exec -i "easelect-${instance}-db" psql -X -v ON_ERROR_STOP=1 -U "$administrator" -d "$maintenance" \
            -v target="$target" -v replacement="$replacement"
    )
}
