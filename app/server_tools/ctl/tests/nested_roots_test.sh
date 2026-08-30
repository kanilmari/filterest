#!/usr/bin/env bash
# Verifies the public root launchers without starting Filterest or Docker.
# Keeps immutable build paths separate from mutable runtime output paths.

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd "$TEST_DIR/../../.." && pwd -P)"
INSTALLATION_ROOT="$(cd "$SOURCE_ROOT/.." && pwd -P)"
REPOSITORY_ROOT="$(cd "$INSTALLATION_ROOT/.." && pwd -P)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
    printf 'test failure: %s\n' "$*" >&2
    exit 1
}

assert_equal() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    [[ "$actual" == "$expected" ]] ||
        fail "$label: expected '$expected', got '$actual'"
}

make_probe_launcher() {
    local path="$1"
    {
        printf '%s\n' '#!/usr/bin/env bash'
        printf '%s\n' 'printf '\''pwd=%s\nroot=%s\nbuild=%s\nruntime=%s\nlog=%s\nnode=%s\nnodepath=%s\ngomod=%s\ngocache=%s\nargs=%s\n'\'' \'
        printf '%s\n' '    "$PWD" "$FILTEREST_ROOT" "$FILTEREST_BUILD_ROOT_OVERRIDE" \'
        printf '%s\n' '    "$FILTEREST_RUNTIME_ROOT_OVERRIDE" "$FILTEREST_LOG_FILE_OVERRIDE" \'
        printf '%s\n' '    "$FILTEREST_NODE_MODULES_ROOT" "$NODE_PATH" "$GOMODCACHE" "$GOCACHE" "$*"'
    } > "$path"
    chmod +x "$path"
}

assert_root_launcher_contract() {
    local launcher_name="$1"
    local delegated_name="$2"
    local sandbox="$TEST_ROOT/$launcher_name"
    local output=""

    mkdir -p "$sandbox/app"
    cp "$INSTALLATION_ROOT/$launcher_name" "$sandbox/$launcher_name"
    : > "$sandbox/app/go.mod"
    : > "$sandbox/app/VERSION_APP"
    make_probe_launcher "$sandbox/app/$delegated_name"

    output="$(
        FILTEREST_ROOT=/stale/root \
        FILTEREST_BUILD_ROOT_OVERRIDE=/stale/build \
        FILTEREST_RUNTIME_ROOT_OVERRIDE=/stale/runtime \
        FILTEREST_LOG_FILE_OVERRIDE=/stale/log \
            "$sandbox/$launcher_name" start --root /subcommand/root
    )"

    assert_equal "$sandbox/app" "$(sed -n 's/^pwd=//p' <<< "$output")" "$launcher_name working directory"
    assert_equal "$sandbox" "$(sed -n 's/^root=//p' <<< "$output")" "$launcher_name install root"
    assert_equal "$sandbox/app" "$(sed -n 's/^build=//p' <<< "$output")" "$launcher_name build root"
    assert_equal "$sandbox/data/runtime" "$(sed -n 's/^runtime=//p' <<< "$output")" "$launcher_name runtime root"
    assert_equal "$sandbox/data/runtime/logs/server_output.log" "$(sed -n 's/^log=//p' <<< "$output")" "$launcher_name log path"
    assert_equal "$sandbox/data/runtime/node/node_modules" "$(sed -n 's/^node=//p' <<< "$output")" "$launcher_name Node dependency root"
    assert_equal "$sandbox/data/runtime/node/node_modules" "$(sed -n 's/^nodepath=//p' <<< "$output")" "$launcher_name Node module search path"
    assert_equal "$sandbox/data/runtime/go/module-cache" "$(sed -n 's/^gomod=//p' <<< "$output")" "$launcher_name Go module cache"
    assert_equal "$sandbox/data/runtime/go/build-cache" "$(sed -n 's/^gocache=//p' <<< "$output")" "$launcher_name Go build cache"
    assert_equal "start --root /subcommand/root" "$(sed -n 's/^args=//p' <<< "$output")" "$launcher_name argument forwarding"
}

assert_root_launcher_contract filterest filterest
assert_root_launcher_contract ctl ctl

marker_sandbox="$TEST_ROOT/missing-marker"
mkdir -p "$marker_sandbox/app"
cp "$INSTALLATION_ROOT/filterest" "$marker_sandbox/filterest"
make_probe_launcher "$marker_sandbox/app/filterest"
: > "$marker_sandbox/app/VERSION_APP"
if "$marker_sandbox/filterest" --help > /dev/null 2>&1; then
    fail "root filterest launcher accepted an app without go.mod"
fi

(
    PROJECT_ROOT="$INSTALLATION_ROOT"
    FILTEREST_SOURCE_ROOT="$SOURCE_ROOT"
    FILTEREST_RUNTIME_ROOT="$INSTALLATION_ROOT/data/runtime"
    FILTEREST_LOG_FILE_OVERRIDE="$INSTALLATION_ROOT/data/runtime/logs/server_output.log"
    # shellcheck source=../lib/common.sh
    source "$SOURCE_ROOT/server_tools/ctl/lib/common.sh"

    assert_equal "$INSTALLATION_ROOT/data/runtime/bin" "$LOCAL_BINARY_DIR" "nested binary directory"
    assert_equal "$INSTALLATION_ROOT/data/runtime/logs/server_output.log" "$LOG_FILE" "nested log path"
    filterest_is_standalone_public_install || fail "nested public installation was not recognized"
    assert_equal "filterest" "$(project_default_db_name)" "standalone database default"
)

(
    PROJECT_ROOT="$REPOSITORY_ROOT"
    FILTEREST_SOURCE_ROOT="$SOURCE_ROOT"
    FILTEREST_RUNTIME_ROOT="$REPOSITORY_ROOT/runtime"
    FILTEREST_LOG_FILE_OVERRIDE="$REPOSITORY_ROOT/server_output.log"
    # shellcheck source=../lib/common.sh
    source "$SOURCE_ROOT/server_tools/ctl/lib/common.sh"

    assert_equal "$REPOSITORY_ROOT/runtime/bin" "$LOCAL_BINARY_DIR" "Easelect binary directory"
    assert_equal "$REPOSITORY_ROOT/server_output.log" "$LOG_FILE" "Easelect log path"
    if filterest_is_standalone_public_install; then
        fail "Easelect source composition was recognized as standalone Filterest"
    fi
    assert_equal "easelect" "$(project_default_db_name)" "embedded database default"
)

grep -Fq 'npm --prefix "$FILTEREST_BUILD_ROOT" run dev' \
    "$SOURCE_ROOT/server_tools/ctl/lib/local.sh" || fail "Vite does not use the selected build root"
grep -Fq 'cd "$FILTEREST_BUILD_ROOT"' \
    "$SOURCE_ROOT/server_tools/ctl/lib/local.sh" || fail "Go build does not use the selected build root"
grep -Fq 'FILTEREST_FRONTEND_ASSET_MODE" "$db_env_file" "source"' \
    "$SOURCE_ROOT/server_tools/ctl/lib/local.sh" || fail "native frontend does not default to source mode"
grep -Fq '_require_local_dist_frontend_assets' \
    "$SOURCE_ROOT/server_tools/ctl/lib/local.sh" || fail "dist startup does not validate its frontend assets"
grep -Fq 'Frontend dist build active; Vite/HMR was not started.' \
    "$SOURCE_ROOT/server_tools/ctl/lib/local.sh" || fail "dist startup does not skip Vite/HMR"

printf 'nested ctl root contract: ok\n'
