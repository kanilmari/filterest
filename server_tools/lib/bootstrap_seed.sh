#!/usr/bin/env bash
# bootstrap_seed.sh
# Resolves committed bootstrap-seed zip artifacts and the local password file they require.
# Bridges VERSION_DB, versioned bootstrap zip paths, and shell scripts that unpack/import the seed.
# Exists so setup, Docker restore, and migration flows share one bootstrap-zip contract.

BOOTSTRAP_SEED_PASSWORD_FILE_DEFAULT="${PROJECT_ROOT}/server_tools/versioning/bootstrap_seeds/bootstrap_zip_password.txt"
BOOTSTRAP_SEED_PROFILE_DEFAULT="application"

# ------------------------------------------------------------------------------
# Helper: Return the gitignored local password file used to decrypt bootstrap zips.
# Between local operator secrets and repo-tracked zip artifacts it keeps one path canonical.
# Why: setup/import flows should not each invent their own bootstrap password location.
# ------------------------------------------------------------------------------
bootstrap_seed_password_file_path() {
    printf '%s\n' "${BOOTSTRAP_SEED_PASSWORD_FILE:-${BOOTSTRAP_SEED_PASSWORD_FILE_DEFAULT}}"
}

# ------------------------------------------------------------------------------
# Helper: Normalize an application/management bootstrap seed profile name.
# Between caller-provided env/CLI values and artifact paths it keeps one profile vocabulary.
# Why: role-specific bootstrap seeds need a strict naming contract before data can diverge safely.
# ------------------------------------------------------------------------------
normalize_bootstrap_seed_profile() {
    local seed_profile="${1:-${BOOTSTRAP_SEED_PROFILE:-${BOOTSTRAP_SEED_PROFILE_DEFAULT}}}"

    case "${seed_profile}" in
        application|management)
            printf '%s\n' "${seed_profile}"
            ;;
        *)
            echo "Unsupported bootstrap seed profile: ${seed_profile}" >&2
            return 1
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Helper: Return the committed bootstrap zip path for one DB version and seed profile.
# Between VERSION_DB-driven release pairing and the versioned artifact folder it preserves a stable naming rule.
# Why: callers should derive role-specific paths once instead of scattering filename conventions.
# ------------------------------------------------------------------------------
bootstrap_seed_zip_path_for_version() {
    local db_version="$1"
    local seed_profile=""

    seed_profile="$(normalize_bootstrap_seed_profile "${2:-}")" || return 1
    case "${seed_profile}" in
        application)
            printf '%s\n' "${PROJECT_ROOT}/server_tools/versioning/bootstrap_seeds/db-${db_version}/easelect_bootstrap_db-${db_version}.zip"
            ;;
        management)
            printf '%s\n' "${PROJECT_ROOT}/server_tools/versioning/bootstrap_seeds/db-${db_version}/easelect_management_bootstrap_db-${db_version}.zip"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Helper: Resolve the tracked bootstrap zip for one DB version/profile if it exists.
# Between version files and callers it returns an empty string when no artifact is committed yet.
# Why: scripts need a simple existence check before attempting bootstrap unzip/import work.
# ------------------------------------------------------------------------------
find_bootstrap_seed_zip_for_version() {
    local db_version="$1"
    local seed_profile="${2:-}"
    local zip_path=""

    zip_path="$(bootstrap_seed_zip_path_for_version "${db_version}" "${seed_profile}")" || return 1
    if [[ -f "${zip_path}" ]]; then
        printf '%s\n' "${zip_path}"
        return 0
    fi

    return 1
}

# ------------------------------------------------------------------------------
# Helper: Resolve the bootstrap zip that matches the tracked VERSION_DB file and profile.
# Between the current repo state and bootstrap consumers it anchors them to one DB version/profile.
# Why: most flows need the current release-paired bootstrap artifact for one instance role.
# ------------------------------------------------------------------------------
current_bootstrap_seed_zip_path() {
    local db_version=""
    local seed_profile="${1:-}"

    if [[ ! -f "${PROJECT_ROOT}/VERSION_DB" ]]; then
        return 1
    fi

    db_version="$(tr -d '[:space:]' < "${PROJECT_ROOT}/VERSION_DB")"
    [[ -n "${db_version}" ]] || return 1

    find_bootstrap_seed_zip_for_version "${db_version}" "${seed_profile}"
}

# ------------------------------------------------------------------------------
# Helper: Read the bootstrap zip password from the gitignored local file.
# Between local secrets and unzip consumers it exposes one trimmed password string.
# Why: committed bootstrap zips are password-protected, but the password itself stays local-only.
# ------------------------------------------------------------------------------
read_bootstrap_seed_password() {
    local password_file=""
    local password_value=""

    password_file="$(bootstrap_seed_password_file_path)"
    [[ -f "${password_file}" ]] || return 1

    password_value="$(
        awk '
            {
                sub(/\r$/, "")
                sub(/^[[:space:]]+/, "")
                sub(/[[:space:]]+$/, "")
                if ($0 != "") {
                    print
                    exit
                }
            }
        ' "${password_file}"
    )"
    [[ -n "${password_value}" ]] || return 1

    printf '%s\n' "${password_value}"
}

# ------------------------------------------------------------------------------
# Helper: Encrypt one zip archive in-place without exposing the password in argv.
# Between a plain temporary zip and its password-protected final form it uses zipcloak interactively.
# Why: archive-creation flows should avoid `zip -P` so passwords do not leak via process listings.
# ------------------------------------------------------------------------------
encrypt_zip_archive_in_place() {
    local zip_path="$1"
    local zip_password="$2"

    command -v zipcloak >/dev/null 2>&1 || {
        echo "zipcloak not found in PATH" >&2
        return 127
    }

    python3 -c '
try:
    import pexpect
except Exception as exc:
    raise SystemExit(f"python3 module pexpect is required for zipcloak automation: {exc}")
import sys

zip_path = sys.argv[1]
password = sys.stdin.buffer.read().rstrip(b"\r\n")
if not password:
    raise SystemExit("zip password is empty")

child = pexpect.spawn("zipcloak", [zip_path], encoding="utf-8", timeout=10)
try:
    child.expect("Enter password:")
    child.sendline(password.decode("utf-8"))
    child.expect("Verify password:")
    child.sendline(password.decode("utf-8"))
    child.expect(pexpect.EOF)
finally:
    child.close()

if child.exitstatus != 0:
    raise SystemExit(f"zipcloak failed with exit code {child.exitstatus}")
' "${zip_path}" <<<"${zip_password}"
}

# ------------------------------------------------------------------------------
# Helper: Extract one committed bootstrap zip into a destination directory.
# Between the encrypted archive and import callers it performs the local unzip step consistently.
# Why: every bootstrap consumer needs the same password + unzip contract and error handling.
# ------------------------------------------------------------------------------
extract_bootstrap_seed_zip() {
    local zip_path="$1"
    local dest_dir="$2"
    local zip_password="$3"

    python3 -c '
import pathlib
import sys
import zipfile

zip_path = pathlib.Path(sys.argv[1])
dest_dir = pathlib.Path(sys.argv[2])
password = sys.stdin.buffer.read().rstrip(b"\r\n")

if not password:
    raise SystemExit("bootstrap zip password is empty")

dest_dir.mkdir(parents=True, exist_ok=True)

try:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            member_path = pathlib.PurePosixPath(member.filename)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise SystemExit(f"unsafe archive entry: {member.filename}")
        archive.extractall(dest_dir, pwd=password)
except RuntimeError as exc:
    raise SystemExit(f"bootstrap zip decryption failed: {exc}")
' "${zip_path}" "${dest_dir}" <<<"${zip_password}"
}

# ------------------------------------------------------------------------------
# Helper: Stream a bootstrap schema in the form supported by the local cluster.
# Between versioned schema dumps and psql import it removes pg_dump session guards
# and, when PostGIS is unavailable, omits the extension statements while mapping
# the one optional geometry column to text. Why: leaving CREATE EXTENSION postgis
# in the fallback stream makes ON_ERROR_STOP abort before the geometry rewrite can
# make a native development bootstrap usable.
# ------------------------------------------------------------------------------
stream_bootstrap_schema_sql() {
    local schema_file="$1"
    local postgis_available="${2:-1}"

    if [[ "$postgis_available" == "1" ]]; then
        sed \
            -e 's/^CREATE SCHEMA postgis;$/CREATE SCHEMA IF NOT EXISTS postgis;/' \
            -e '/^\\restrict/d' \
            -e '/^\\unrestrict/d' \
            "$schema_file"
        return
    fi

    sed \
        -e 's/postgis\.geometry(Point,4326)/text/g' \
        -e '/^CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;$/d' \
        -e '/^CREATE EXTENSION IF NOT EXISTS postgis;$/d' \
        -e '/^COMMENT ON EXTENSION postgis IS /d' \
        -e '/^\\restrict/d' \
        -e '/^\\unrestrict/d' \
        "$schema_file"
}
