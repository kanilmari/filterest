#!/usr/bin/env bash
# build_assets.sh
# Builds Filterest administrator binaries and checksums on the maintainer machine.
# Bridges a reviewed standalone checkout with release assets built locally.
# Exists so release assembly belongs to the product and needs no parent repository.

set -euo pipefail

target=""
output_dir=""
check_only=0

usage() {
    cat <<'EOF'
Usage: ./filterest release build --output-dir PATH [--check-only] [--target PATH]

Builds Linux amd64 and arm64 production binaries plus SHA-256 checksum files
and a complete license/notice bundle entirely on the local maintainer machine.
The target defaults to this Filterest installation. The output directory must
be outside its Git checkout and empty before a real build. --check-only checks
required source files and command availability without creating output. It does
not certify a clean release source, compiled binary metadata or host ABI.
EOF
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    local command_name="$1"
    local install_hint="${2:-}"

    if command -v "$command_name" >/dev/null 2>&1; then
        return
    fi
    if [[ -n "$install_hint" ]]; then
        die "required local command missing: $command_name ($install_hint)"
    fi
    die "required local command missing: $command_name"
}

resolve_existing_directory() {
    local path="$1"
    (cd "$path" && pwd -P)
}

validate_local_toolchain() {
    require_command git "install Git for release source identity checks"
    require_command go "install the Go version declared by Filterest"
    require_command gcc "install the native C compiler"
    require_command aarch64-linux-gnu-gcc \
        "install once with: sudo apt install gcc-aarch64-linux-gnu"
    require_command sha256sum "install GNU coreutils"
    require_command file "install the file utility"
    require_command readelf "install GNU binutils"
    require_command tar "install a tar implementation with gzip support"
    require_command gzip "install gzip for deterministic notice archives"
    require_command python3 "install Python 3 for release metadata verification"
}

verify_binary_third_party_manifest() {
    local architecture="$1"
    local binary_path="$2"

    python3 "$script_dir/verify_binary_manifest.py" \
        --manifest "$target_root_abs/THIRD_PARTY_LICENSES/manifest.json" \
        --binary "$binary_path" \
        --architecture "$architecture" \
        --binary-target filterest
}

write_checksum() {
    local asset="$1"

    (
        cd "$output_abs"
        sha256sum "$asset" > "$asset.sha256"
        sha256sum -c "$asset.sha256"
    )
}

package_release_notices() {
    local app_version
    local archive_base
    local asset
    local source

    app_version="$(tr -d '[:space:]' < "$target_root_abs/app/VERSION_APP")"
    for source in LICENSE NOTICE THIRD_PARTY_NOTICES.md; do
        asset="filterest-${app_version}-${source}"
        cp -p "$target_root_abs/$source" "$output_abs/$asset"
        write_checksum "$asset"
    done
    source="app/server_tools/licenses/GPL-3.0.txt"
    asset="filterest-${app_version}-LICENSE-GPL-3.0"
    cp -p "$target_root_abs/$source" "$output_abs/$asset"
    write_checksum "$asset"
    archive_base="filterest-${app_version}-THIRD_PARTY_LICENSES.tar"
    tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
        -cf "$output_abs/$archive_base" -C "$target_root_abs" THIRD_PARTY_LICENSES
    gzip -n "$output_abs/$archive_base"
    asset="$archive_base.gz"
    write_checksum "$asset"
}

build_architecture() {
    local architecture="$1"
    local compiler="$2"
    local expected_file_pattern="$3"
    local asset="filterest-linux-${architecture}"
    local newest_glibc=""

    printf 'Building %s locally with %s...\n' "$asset" "$compiler"
    (
        cd "$target_abs"
        CGO_ENABLED=1 \
        GOOS=linux \
        GOARCH="$architecture" \
        CC="$compiler" \
        GOFLAGS=-mod=readonly \
        go build \
            -tags 'netgo osusergo' \
            -trimpath \
            -buildvcs=true \
            -ldflags='-w -s -X main.buildEnv=prod -linkmode external' \
            -o "$output_abs/$asset" \
            .
    )
    file "$output_abs/$asset" | grep -Eq "$expected_file_pattern.*dynamically linked" || \
        die "$asset does not match the expected Linux architecture"
    readelf -d "$output_abs/$asset" | grep -q 'Shared library: \[libc\.so\.6\]' || \
        die "$asset does not declare the expected host glibc dependency"
    if readelf -d "$output_abs/$asset" | grep 'Shared library:' | \
        grep -Ev 'Shared library: \[(libc|libm)\.so\.6\]|Shared library: \[ld-linux-aarch64\.so\.1\]' >/dev/null; then
        die "$asset gained an unreviewed dynamic library dependency"
    fi
    newest_glibc="$(
        readelf --version-info "$output_abs/$asset" |
            grep -Eo 'GLIBC_[0-9]+\.[0-9]+' |
            sort -Vu |
            tail -n 1
    )"
    [[ -n "$newest_glibc" ]] || die "$asset does not expose a reviewable glibc compatibility floor"
    [[ "$(printf '%s\n' "$newest_glibc" 'GLIBC_2.34' | sort -V | tail -n 1)" == 'GLIBC_2.34' ]] || \
        die "$asset requires $newest_glibc; supported native hosts require a GLIBC_2.34-compatible build"
    verify_binary_third_party_manifest "$architecture" "$output_abs/$asset"
    write_checksum "$asset"
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --target)
            [[ "$#" -ge 2 ]] || die "--target requires a value"
            target="$2"
            shift 2
            ;;
        --output-dir)
            [[ "$#" -ge 2 ]] || die "--output-dir requires a value"
            output_dir="$2"
            shift 2
            ;;
        --check-only)
            check_only=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
target="${target:-$(cd "$script_dir/../../.." && pwd -P)}"
[[ -n "$output_dir" ]] || die "--output-dir is required"
[[ -d "$target" ]] || die "Filterest target directory missing: $target"
[[ -f "$target/app/VERSION_APP" ]] || die "app/VERSION_APP missing from Filterest target"
[[ -f "$target/app/go.mod" ]] || die "app/go.mod missing from Filterest target"
[[ -f "$target/app/main.go" ]] || die "app/main.go missing from Filterest target"
[[ -f "$target/LICENSE" ]] || die "LICENSE missing from Filterest target"
[[ -f "$target/NOTICE" ]] || die "NOTICE missing from Filterest target"
[[ -f "$target/THIRD_PARTY_NOTICES.md" ]] || die "THIRD_PARTY_NOTICES.md missing from Filterest target"
[[ -f "$target/app/server_tools/licenses/GPL-3.0.txt" ]] || \
    die "complete GPL version 3 text missing from Filterest target"
[[ -f "$target/THIRD_PARTY_LICENSES/manifest.json" ]] || \
    die "THIRD_PARTY_LICENSES/manifest.json missing from Filterest target"

target_root_abs="$(resolve_existing_directory "$target")"
target_abs="$(resolve_existing_directory "$target/app")"
validate_local_toolchain
export GOWORK=off
export GOMODCACHE="${GOMODCACHE:-$target_root_abs/data/runtime/go/module-cache}"
export GOCACHE="${GOCACHE:-$target_root_abs/data/runtime/go/build-cache}"

if [[ "$check_only" -eq 1 ]]; then
    printf 'Filterest source files and local commands are available for Linux amd64 and arm64.\nA real build still requires clean Git source and verifies binary metadata and GLIBC_2.34 compatibility.\n'
    exit 0
fi

if [[ -e "$output_dir" ]]; then
    [[ -d "$output_dir" ]] || die "output path exists and is not a directory: $output_dir"
    output_contents="$(find "$output_dir" -mindepth 1 -print -quit)" || \
        die "could not inspect output directory: $output_dir"
    [[ -z "$output_contents" ]] || \
        die "output directory must be empty: $output_dir"
else
    mkdir -p "$output_dir"
fi
output_abs="$(resolve_existing_directory "$output_dir")"
case "$output_abs" in
    "$target_root_abs"|"$target_root_abs"/*)
        die "release assets must be built outside the standalone Filterest checkout"
        ;;
esac

source_status="$(git -C "$target_abs" status --porcelain)" || \
    die "could not inspect standalone Filterest Git source"
[[ -z "$source_status" ]] || \
    die "standalone Filterest checkout must be clean before building release assets"

build_architecture amd64 gcc 'ELF 64-bit.*x86-64'
build_architecture arm64 aarch64-linux-gnu-gcc 'ELF 64-bit.*ARM aarch64'
package_release_notices

printf 'Local Filterest release assets are ready: %s\n' "$output_abs"
