#!/bin/bash
# ==============================================================================
# env_permissions.sh: Shared secret-env permission helpers for operator tooling.
#
# Detects sensitive local env/config files that should use chmod 600.
# Provides warning-only and fix helpers for ctl, setup, and migration scripts.
# ==============================================================================

_env_perm_warn_line() {
    local message="$1"
    if [[ -n "${YELLOW:-}" && -n "${NC:-}" ]]; then
        echo -e "${YELLOW}${message}${NC}"
    else
        echo "$message"
    fi
}

_secret_env_requires_strict_permissions() {
    local file_path="$1"
    local file_name
    file_name="$(basename "$file_path")"

    case "$file_name" in
        .env|dev_env.txt|runtime_environment.env|development_environment.env|revolut.env|environment_type.env)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

_secret_env_file_mode() {
    local file_path="$1"

    if stat -c '%a' "$file_path" > /dev/null 2>&1; then
        stat -c '%a' "$file_path"
        return 0
    fi

    if stat -f '%Lp' "$file_path" > /dev/null 2>&1; then
        stat -f '%Lp' "$file_path"
        return 0
    fi

    return 1
}

warn_secret_env_file_permissions() {
    local file_path="$1"
    local context="${2:-runtime check}"

    if [[ ! -e "$file_path" || -L "$file_path" ]]; then
        return 0
    fi
    if ! _secret_env_requires_strict_permissions "$file_path"; then
        return 0
    fi

    local mode
    mode="$(_secret_env_file_mode "$file_path" 2>/dev/null || true)"
    if [[ -z "$mode" || "$mode" == "600" ]]; then
        return 0
    fi

    _env_perm_warn_line "⚠️  ${file_path} permissions are ${mode}; expected 600 for secret-bearing env files (${context})."
}

set_secret_env_file_permissions() {
    local file_path="$1"

    if [[ ! -e "$file_path" || -L "$file_path" ]]; then
        return 0
    fi
    if ! _secret_env_requires_strict_permissions "$file_path"; then
        return 0
    fi

    chmod 600 "$file_path"
}

# Initialize copied runtime settings together so native runtime/dev share an
# identity. Keep every existing real key verbatim; key material never leaves Python.
ensure_session_encryption_env_files() {
    python3 - "$@" <<'PY'
from pathlib import Path
import re
import secrets
import sys

entries = []
existing = []
for name in sys.argv[1:]:
    path = Path(name)
    if path.is_symlink() or (path.exists() and not path.is_file()):
        sys.exit("Session encryption settings require regular files.")
    if not path.is_file():
        continue
    content = path.read_text(encoding="utf-8")
    matches = list(re.finditer(
        r"^[ \t]*(?:export[ \t]+)?SESSION_SECRET_KEY[ \t]*=(.*)$", content, re.M))
    if len(matches) > 1:
        sys.exit("Duplicate SESSION_SECRET_KEY declarations refused.")
    value = matches[0].group(1).strip() if matches else ""
    if value[:1] in ("'", '"') and value[:1] in value[1:]:
        value = value[1:].split(value[0], 1)[0].strip()
    else:
        value = value.split(" #", 1)[0].strip()
    missing = not value or value.startswith("replace-me")
    if not missing:
        existing.append(matches[0].group(1))  # Preserve quoting when sharing this identity.
    entries.append((path, content, matches, missing))

key = existing[0] if existing else secrets.token_hex(32)
for path, content, matches, missing in entries:
    path.chmod(0o600)
    if not missing:
        continue
    assignment = "SESSION_SECRET_KEY=" + key
    if matches:
        match = matches[0]
        content = content[:match.start()] + assignment + content[match.end():]
    else:
        content += ("\n" if content and not content.endswith("\n") else "") + assignment + "\n"
    path.write_text(content, encoding="utf-8")
PY
}
