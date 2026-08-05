#!/usr/bin/env bash
# file: refresh_targets.sh
# Refreshes selected Easelect runtime targets from one command.
# Between local native ctl, local Docker instances, and the mixed-topology VPS
# Docker repo copy it turns ad hoc refresh steps into an explicit target list.
# Why: the same code change is often tested across native local, local docker,
# and VPS docker, and the selection should be configuration-like instead of manual.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

declare -a TARGETS=()
declare -a EXPANDED_TARGETS=()
DRY_RUN=false

# ------------------------------------------------------------------------------
# Helper: print a short usage guide for target refresh selections.
# Between the CLI entrypoint and the user it documents the supported target forms.
# Why: the script exists to make multi-target refresh selection easy to remember.
# ------------------------------------------------------------------------------
print_usage() {
    cat <<'EOF'
Usage:
  ./refresh_targets --profile easelect-trio
  ./refresh_targets --target local-native
  ./refresh_targets --target local-docker:easelect.com
  ./refresh_targets --target vps-docker:easelect.com
  ./refresh_targets --dry-run --profile easelect-trio

Target forms:
  local-native
  local-docker:<instance>
  vps-docker:<instance>

Profiles:
  easelect-trio
    -> local-native
    -> local-docker:easelect.com
    -> vps-docker:easelect.com

What each target does:
  local-native                Runs ./ctl
  local-docker:<instance>     Runs ./ctl --instance <instance> --upgrade
  vps-docker:<instance>       Runs ./server_tools/deploy_docker_vps.sh --instance <instance>
EOF
}

# ------------------------------------------------------------------------------
# Helper: fail with one consistent error style.
# Between invalid CLI selections and the caller it surfaces the exact stop reason.
# Why: target orchestration is only useful when mistakes are rejected clearly.
# ------------------------------------------------------------------------------
die() {
    echo "error: $*" >&2
    exit 1
}

# ------------------------------------------------------------------------------
# Helper: render a command array as a shell-safe preview string.
# Between dry-run previews and real execution it shows the exact command shape.
# Why: mixed local/VPS refresh flows are easier to trust when visible beforehand.
# ------------------------------------------------------------------------------
render_cmd() {
    local rendered=""
    printf -v rendered '%q ' "$@"
    printf '%s\n' "${rendered% }"
}

# ------------------------------------------------------------------------------
# Helper: run a command array or print it in dry-run mode.
# Between the target dispatcher and child commands it centralizes preview logic.
# Why: every selected target should respect the same dry-run behavior.
# ------------------------------------------------------------------------------
run_cmd() {
    if $DRY_RUN; then
        echo "DRY-RUN: $(render_cmd "$@")"
        return 0
    fi

    "$@"
}

# ------------------------------------------------------------------------------
# Helper: expand a named profile into concrete refresh targets.
# Between friendly workflow names and executable targets it keeps profile mapping
# in one place instead of scattering hardcoded lists across the script.
# ------------------------------------------------------------------------------
add_profile_targets() {
    local profile="$1"

    case "$profile" in
        easelect-trio)
            TARGETS+=(
                "local-native"
                "local-docker:easelect.com"
                "vps-docker:easelect.com"
            )
            ;;
        *)
            die "unknown profile: ${profile}"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Helper: reject duplicate targets while preserving the first declared order.
# Between repeated CLI flags and actual execution it normalizes the target list.
# Why: repeated profiles/targets should not accidentally rerun the same deploy.
# ------------------------------------------------------------------------------
dedupe_targets() {
    local seen=""
    local target=""

    for target in "${TARGETS[@]}"; do
        case " ${seen} " in
            *" ${target} "*) ;;
            *)
                EXPANDED_TARGETS+=("${target}")
                seen="${seen} ${target}"
                ;;
        esac
    done
}

# ------------------------------------------------------------------------------
# Helper: run one selected refresh target.
# Between the normalized target list and existing project commands it dispatches
# to the correct native/local-docker/VPS-docker refresh path.
# Why: one target abstraction should cover the full easelect.com test triangle.
# ------------------------------------------------------------------------------
run_target() {
    local target="$1"
    local instance=""

    case "$target" in
        local-native)
            echo "→ Refreshing local native runtime"
            run_cmd "${PROJECT_ROOT}/ctl"
            ;;
        local-docker:*)
            instance="${target#local-docker:}"
            [[ -n "${instance}" ]] || die "missing instance in target: ${target}"
            echo "→ Refreshing local Docker instance ${instance}"
            run_cmd "${PROJECT_ROOT}/ctl" --instance "${instance}" --upgrade
            ;;
        vps-docker:*)
            instance="${target#vps-docker:}"
            [[ -n "${instance}" ]] || die "missing instance in target: ${target}"
            echo "→ Refreshing VPS Docker instance ${instance}"
            if $DRY_RUN; then
                run_cmd "${PROJECT_ROOT}/server_tools/deploy_docker_vps.sh" --dry-run --instance "${instance}"
            else
                run_cmd "${PROJECT_ROOT}/server_tools/deploy_docker_vps.sh" --instance "${instance}"
            fi
            ;;
        *)
            die "unknown target: ${target}"
            ;;
    esac
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            [[ $# -ge 2 ]] || die "--target requires a value"
            TARGETS+=("$2")
            shift 2
            ;;
        --profile)
            [[ $# -ge 2 ]] || die "--profile requires a value"
            add_profile_targets "$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
    print_usage
    exit 1
fi

dedupe_targets

echo "Selected refresh targets:"
printf '  - %s\n' "${EXPANDED_TARGETS[@]}"
echo ""

for target in "${EXPANDED_TARGETS[@]}"; do
    run_target "${target}"
    echo ""
done

echo "Target refresh flow complete."
