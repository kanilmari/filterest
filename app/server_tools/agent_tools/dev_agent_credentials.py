#!/usr/bin/env python3
"""Configure one persistent native-development agent login without exposing secrets."""

from __future__ import annotations

import getpass
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parents[2]
if not __package__ and str(CANONICAL_FILTEREST_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_FILTEREST_ROOT))

try:
    from ..lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
    from .easelect_api_client import (
        DEFAULT_BASE_URL,
        EaselectAPIClient,
        EaselectAPIError,
        load_env_file,
        load_project_env,
    )
except ImportError:
    from server_tools.lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
    from server_tools.agent_tools.easelect_api_client import (
        DEFAULT_BASE_URL,
        EaselectAPIClient,
        EaselectAPIError,
        load_env_file,
        load_project_env,
    )


PROJECT_ROOT = resolve_embedded_project_root(CANONICAL_FILTEREST_ROOT)


STRICT_FILE_MODE = 0o600
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$")
ASSIGNMENT_PATTERN = re.compile(
    r"^(?P<prefix>[ \t]*(?:export[ \t]+)?)"
    r"(?P<key>[A-Za-z_][A-Za-z0-9_]*)[ \t]*=.*?(?P<newline>\r?\n)?$"
)
PERSISTED_KEYS = (
    "DEV_USERNAME",
    "DEV_PASSWORD",
    "DEV_LOGIN_VERIFICATION_CODE",
)


class AgentCredentialConfigurationError(ValueError):
    """Reject invalid accounts or unsafe protected-file updates."""


def _validate_username(username: str) -> str:
    value = str(username or "").strip()
    if USERNAME_PATTERN.fullmatch(value) is None:
        raise AgentCredentialConfigurationError(
            "account name must be 3-64 characters and use only letters, digits, dot, dash, or underscore"
        )
    return value


def _validate_password(password: str) -> str:
    value = str(password or "")
    if len(value) < 12 or len(value) > 128:
        raise AgentCredentialConfigurationError("password must be 12-128 characters")
    if any(character in value for character in ("\x00", "\r", "\n", "'")):
        raise AgentCredentialConfigurationError(
            "password may not contain line breaks, NUL, or a single quote in this protected env format"
        )
    return value


def _validate_fixed_pin(pin: str) -> str:
    value = str(pin or "").strip()
    if not value.isdigit() or not 4 <= len(value) <= 8:
        raise AgentCredentialConfigurationError("fixed PIN must contain 4-8 digits")
    return value


def _quoted_env_value(value: str) -> str:
    # Single quotes keep spaces, shell metacharacters, and dollar signs literal
    # for both godotenv and shell readers used around the native environment.
    if "'" in value or any(character in value for character in ("\x00", "\r", "\n")):
        raise AgentCredentialConfigurationError("credential cannot be represented safely")
    return f"'{value}'"


def _updated_env_content(content: str, values: dict[str, str]) -> str:
    lines = content.splitlines(keepends=True)
    found: dict[str, int] = {}
    for index, line in enumerate(lines):
        match = ASSIGNMENT_PATTERN.match(line)
        if match is None or match.group("key") not in values:
            continue
        key = match.group("key")
        if key in found:
            raise AgentCredentialConfigurationError(
                f"protected environment contains multiple active {key} assignments"
            )
        found[key] = index
        newline = match.group("newline") or ""
        lines[index] = f"{match.group('prefix')}{key}={_quoted_env_value(values[key])}{newline}"

    line_ending = "\r\n" if "\r\n" in content else "\n"
    if lines and not lines[-1].endswith(("\n", "\r")):
        lines[-1] += line_ending
    for key in PERSISTED_KEYS:
        if key not in found:
            lines.append(f"{key}={_quoted_env_value(values[key])}{line_ending}")
    return "".join(lines)


def persist_agent_credentials(env_file: Path, *, username: str, password: str, pin: str) -> None:
    """Replace the three agent-only values atomically in one owner-readable file."""

    env_file = Path(env_file)
    if env_file.is_symlink():
        raise AgentCredentialConfigurationError("protected environment must not be a symlink")
    try:
        current_stat = env_file.stat()
        content = env_file.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise AgentCredentialConfigurationError(
            f"protected development environment does not exist: {env_file}"
        ) from error
    if not stat.S_ISREG(current_stat.st_mode):
        raise AgentCredentialConfigurationError("protected environment is not a regular file")

    updated = _updated_env_content(
        content,
        {
            "DEV_USERNAME": username,
            "DEV_PASSWORD": password,
            "DEV_LOGIN_VERIFICATION_CODE": pin,
        },
    )
    descriptor = -1
    temporary_path: Path | None = None
    try:
        descriptor, raw_path = tempfile.mkstemp(prefix=f".{env_file.name}.agent-login-", dir=env_file.parent)
        temporary_path = Path(raw_path)
        os.fchmod(descriptor, STRICT_FILE_MODE)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            descriptor = -1
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        if env_file.read_text(encoding="utf-8") != content:
            raise AgentCredentialConfigurationError(
                "protected development environment changed during the update; retry"
            )
        os.replace(temporary_path, env_file)
        temporary_path = None
        directory_descriptor = os.open(env_file.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _verify_agent_admin(client, username: str) -> None:
    payload = client.request("GET", "/api/admin/user-authentication")
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list):
        raise EaselectAPIError("administrator verification did not return an account list")
    matches = [record for record in users if record.get("username") == username]
    if len(matches) != 1:
        raise AgentCredentialConfigurationError("verified account was not uniquely present")
    record = matches[0]
    if not all(
        record.get(key) is True
        for key in ("enabled", "admin_group_member", "admin_access_allowed")
    ):
        raise AgentCredentialConfigurationError("account is not an enabled Easelect administrator")
    if record.get("verification_method") != "fixed_pin":
        raise AgentCredentialConfigurationError("account does not use the required fixed-PIN login")
    board = client.request("GET", "/api/app/workline-observatory/board")
    if not isinstance(board, dict) or not isinstance(board.get("worklines"), list):
        raise EaselectAPIError("workline observatory verification returned an invalid response")


def _activate_existing_agent_admin(
    *,
    username: str,
    pin: str,
    target: str,
    client_factory,
) -> None:
    """Use the ignored development test administrator to activate one existing account."""

    test_credentials = load_env_file(PROJECT_ROOT / "dev_env_test_creds.txt")
    project_env = load_project_env(PROJECT_ROOT)
    authorizer_username = str(test_credentials.get("TEST_ADMIN_USER") or "").strip()
    authorizer_password = str(test_credentials.get("TEST_ADMIN_PASS") or "").strip()
    authorizer_pin = str(
        test_credentials.get("LOGIN_OTP_CODE")
        or project_env.get("LOGIN_OTP_CODE")
        or ""
    ).strip()
    if not authorizer_username or not authorizer_password:
        raise AgentCredentialConfigurationError(
            "reserved development administrator credentials are unavailable for account activation"
        )
    authorizer = client_factory(
        base_url=target,
        username=authorizer_username,
        password=authorizer_password,
        otp_code=authorizer_pin,
    )
    authorizer.login()
    payload = authorizer.request("GET", "/api/admin/user-authentication")
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list):
        raise EaselectAPIError("administrator activation did not return an account list")
    matches = [record for record in users if record.get("username") == username]
    if len(matches) != 1 or int(matches[0].get("user_id") or 0) <= 1:
        raise AgentCredentialConfigurationError("agent account was not uniquely available for activation")
    authorizer.request(
        "POST",
        "/api/admin/user-authentication",
        data={
            "user_id": int(matches[0]["user_id"]),
            "verification_method": "fixed_pin",
            "fixed_pin": pin,
        },
        csrf=True,
    )


def configure_agent_credentials(
    *,
    base_url: str | None = None,
    client_factory=EaselectAPIClient,
    username_reader=input,
    secret_reader=getpass.getpass,
    env_file: Path | None = None,
) -> dict[str, str]:
    """Prompt once, verify the fixed-PIN admin, and persist only after success."""

    target = (base_url or DEFAULT_BASE_URL).rstrip("/")
    print("Persistent Filterest agent administrator setup")
    print(f"  Service: native Filterest development application at {target}")
    print("  Target: one existing dedicated agent administrator account")
    print("  Storage: protected local development environment; no secret is printed")
    username = _validate_username(username_reader("Agent administrator account name: "))
    print(f"  Exact account being verified and stored: {username}")
    print("  A hidden password prompt and then a hidden fixed-PIN prompt follow.")
    password = _validate_password(secret_reader(f"Password for '{username}': "))
    password_confirmation = secret_reader("Confirm password: ")
    if password != password_confirmation:
        raise AgentCredentialConfigurationError("password confirmation did not match")
    pin = _validate_fixed_pin(secret_reader(f"Fixed PIN for '{username}': "))
    pin_confirmation = secret_reader("Confirm fixed PIN: ").strip()
    if pin != pin_confirmation:
        raise AgentCredentialConfigurationError("fixed PIN confirmation did not match")

    client = client_factory(
        base_url=target,
        username=username,
        password=password,
        otp_code=pin,
    )
    client.login()
    if getattr(client, "last_verification_method", "fixed_pin") != "fixed_pin":
        raise AgentCredentialConfigurationError("account did not request the required fixed PIN")
    try:
        _verify_agent_admin(client, username)
    except EaselectAPIError as error:
        if "HTTP 403" not in str(error):
            raise
        print("  Login succeeded; activating the existing account in the administrators group.")
        _activate_existing_agent_admin(
            username=username,
            pin=pin,
            target=target,
            client_factory=client_factory,
        )
        # Activation increments the account's authentication generation, so a
        # fresh session is required before the final administrator readback.
        client = client_factory(
            base_url=target,
            username=username,
            password=password,
            otp_code=pin,
        )
        client.login()
        _verify_agent_admin(client, username)

    resolved_env_file = env_file
    if resolved_env_file is None:
        resolved_env_file = resolve_easelect_private_paths(PROJECT_ROOT).development_env_file
    persist_agent_credentials(
        resolved_env_file,
        username=username,
        password=password,
        pin=pin,
    )
    return {"username": username, "env_file": str(resolved_env_file)}
