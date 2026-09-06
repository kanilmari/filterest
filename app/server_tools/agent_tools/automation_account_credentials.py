#!/usr/bin/env python3
# automation_account_credentials.py
# Creates or verifies one protected client credential for Filterest API automation.
# Bridges a trusted system-manager endpoint with the existing authenticated API client.
# Exists so repeatable maintenance does not depend on human passwords or self-registration.

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import sys
import tempfile
from typing import Callable, Iterator
import urllib.error
import urllib.parse
import urllib.request


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from easelect_api_client import (  # noqa: E402
    EaselectAPIClient,
    EaselectAPIError,
    _SameOriginRedirectHandler,
    _validate_api_base_url,
)


AUTOMATION_ACCOUNT_USERNAME = "filterest_agent"
AUTOMATION_ACCOUNT_ENDPOINT = "/system/automation-account"
MANAGER_TOKEN_KEY = "EASELECT_SYSTEM_MANAGER_TOKEN"
STRICT_SECRET_MODE = 0o600
DOTENV_ASSIGNMENT = re.compile(
    r"^[ \t]*(?:export[ \t]+)?(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)"
    r"[ \t]*(?:=|:)[ \t]*(?P<value>.*)$"
)


class AutomationCredentialError(RuntimeError):
    """Reports a fail-closed credential operation without returning secret values."""


@dataclass(frozen=True)
class AutomationCredentialResult:
    """Contains non-secret evidence for one credential ensure or rotation."""

    action: str
    base_url: str
    username: str
    user_id: int
    authentication_generation: int


def _require_absolute_path(path: Path, label: str) -> Path:
    resolved = Path(path)
    if not resolved.is_absolute():
        raise AutomationCredentialError(f"{label} must be an absolute path")
    return resolved


def _read_owner_only_regular_file(path: Path, label: str) -> str:
    """Read a protected file without following its final path component."""

    path = _require_absolute_path(path, label)
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError as error:
        raise AutomationCredentialError(f"{label} does not exist") from error
    except OSError as error:
        raise AutomationCredentialError(f"cannot safely open {label}") from error

    try:
        file_status = os.fstat(descriptor)
        if not stat.S_ISREG(file_status.st_mode):
            raise AutomationCredentialError(f"{label} is not a regular file")
        if stat.S_IMODE(file_status.st_mode) & 0o077:
            raise AutomationCredentialError(f"{label} must use owner-only permissions (0600)")
        with os.fdopen(descriptor, "r", encoding="utf-8", newline="") as stream:
            descriptor = -1
            return stream.read()
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _dotenv_value(raw_value: str) -> str:
    value = raw_value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return value


def _parse_unique_dotenv(content: str, allowed_keys: set[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = DOTENV_ASSIGNMENT.match(raw_line)
        if match is None:
            continue
        key = match.group("key")
        if key not in allowed_keys:
            continue
        if key in values:
            raise AutomationCredentialError(f"protected file contains duplicate {key} assignments")
        values[key] = _dotenv_value(match.group("value"))
    return values


def load_manager_token(environment_file: Path) -> str:
    """Load exactly one manager token from an owner-only runtime environment file."""

    content = _read_owner_only_regular_file(
        environment_file,
        "system-manager environment file",
    )
    values = _parse_unique_dotenv(content, {MANAGER_TOKEN_KEY})
    token = values.get(MANAGER_TOKEN_KEY, "")
    if len(token) < 32 or token != token.strip():
        raise AutomationCredentialError("system-manager environment file lacks one valid manager token")
    return token


def load_automation_credentials(credentials_file: Path) -> dict[str, str]:
    """Load the standard Filterest API variables from one owner-only file."""

    content = _read_owner_only_regular_file(credentials_file, "automation credential file")
    required_keys = {
        "FILTEREST_API_BASE_URL",
        "FILTEREST_API_USERNAME",
        "FILTEREST_API_PASSWORD",
    }
    values = _parse_unique_dotenv(content, required_keys)
    if set(values) != required_keys or not all(values.values()):
        raise AutomationCredentialError("automation credential file is incomplete")
    return values


@contextmanager
def _locked_parent_directory(path: Path) -> Iterator[int]:
    """Serialize the atomic credential-file replacement in its protected directory."""

    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path.parent, flags)
    except OSError as error:
        raise AutomationCredentialError("cannot safely open automation credential directory") from error
    try:
        directory_status = os.fstat(descriptor)
        if stat.S_IMODE(directory_status.st_mode) & 0o022:
            raise AutomationCredentialError("automation credential directory must not be group/world writable")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield descriptor
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _write_automation_credentials(path: Path, base_url: str, password: str) -> None:
    """Atomically write standard API client variables without exposing their values."""

    path = _require_absolute_path(path, "automation credential file")
    if "\n" in password or "\r" in password or "=" in password:
        raise AutomationCredentialError("generated automation password is not dotenv-safe")
    if path.exists():
        _read_owner_only_regular_file(path, "automation credential file")

    content = (
        "# Filterest API automation credential. Keep this file outside Git.\n"
        f"FILTEREST_API_BASE_URL={base_url}\n"
        f"FILTEREST_API_USERNAME={AUTOMATION_ACCOUNT_USERNAME}\n"
        f"FILTEREST_API_PASSWORD={password}\n"
    )
    temporary_path: Path | None = None
    temporary_descriptor = -1
    with _locked_parent_directory(path) as directory_descriptor:
        try:
            temporary_descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{path.name}.pending-",
                dir=path.parent,
            )
            temporary_path = Path(temporary_name)
            os.fchmod(temporary_descriptor, STRICT_SECRET_MODE)
            with os.fdopen(temporary_descriptor, "w", encoding="utf-8", newline="") as stream:
                temporary_descriptor = -1
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, path)
            temporary_path = None
            os.fsync(directory_descriptor)
        finally:
            if temporary_descriptor >= 0:
                os.close(temporary_descriptor)
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)


def _is_loopback_origin(base_url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(base_url)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _validate_origin(raw_url: str, label: str) -> str:
    """Accept one API origin, never credentials, query state, or a path prefix."""

    try:
        validated = _validate_api_base_url(raw_url)
    except EaselectAPIError as error:
        raise AutomationCredentialError(f"{label} is invalid") from error
    parsed = urllib.parse.urlsplit(validated)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AutomationCredentialError(f"{label} must be a clean HTTP(S) origin")
    if parsed.path not in {"", "/"}:
        raise AutomationCredentialError(f"{label} must not contain a path")
    return validated.rstrip("/")


def _manager_request(
    manager_base_url: str,
    manager_token: str,
    method: str,
    *,
    payload: dict[str, str] | None = None,
) -> dict[str, object]:
    """Call the manager endpoint without ambient proxies, redirects, or secret echoing."""

    manager_base_url = _validate_origin(manager_base_url, "manager base URL")
    handlers: list[urllib.request.BaseHandler] = []
    if _is_loopback_origin(manager_base_url):
        handlers.append(urllib.request.ProxyHandler({}))
    context = ssl.create_default_context()
    if _is_loopback_origin(manager_base_url) and manager_base_url.startswith("https://"):
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    handlers.extend(
        (
            _SameOriginRedirectHandler(manager_base_url),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=context),
        )
    )
    opener = urllib.request.build_opener(*handlers)
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {manager_token}",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        manager_base_url.rstrip("/") + AUTOMATION_ACCOUNT_ENDPOINT,
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with opener.open(request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        error.read()
        raise AutomationCredentialError(
            f"system-manager automation API returned HTTP {error.code}"
        ) from error
    except urllib.error.URLError as error:
        raise AutomationCredentialError("system-manager automation API is unavailable") from error
    try:
        decoded = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise AutomationCredentialError("system-manager automation API returned invalid JSON") from error
    if not isinstance(decoded, dict):
        raise AutomationCredentialError("system-manager automation API returned an invalid record")
    return decoded


def _validate_ready_record(record: dict[str, object]) -> AutomationCredentialResult:
    expected = (
        record.get("exists") is True
        and record.get("ready") is True
        and record.get("username") == AUTOMATION_ACCOUNT_USERNAME
        and record.get("enabled") is True
        and record.get("admin_group_member") is True
        and record.get("admin_access_allowed") is True
        and record.get("privileged") is False
        and record.get("verification_method") == "none"
    )
    try:
        user_id = int(record.get("user_id") or 0)
        generation = int(record.get("authentication_generation") or 0)
    except (TypeError, ValueError) as error:
        raise AutomationCredentialError("automation account readback is invalid") from error
    if not expected or user_id <= 1 or generation < 1:
        raise AutomationCredentialError("automation account readback did not prove readiness")
    return AutomationCredentialResult(
        action="created" if record.get("created") is True else "rotated",
        base_url="",
        username=AUTOMATION_ACCOUNT_USERNAME,
        user_id=user_id,
        authentication_generation=generation,
    )


def _verify_api_login(base_url: str, password: str) -> None:
    try:
        client = EaselectAPIClient(
            base_url=base_url,
            username=AUTOMATION_ACCOUNT_USERNAME,
            password=password,
            otp_code=None,
            environment={},
        )
        login = client.login()
    except (EaselectAPIError, RuntimeError) as error:
        raise AutomationCredentialError("automation account login verification failed") from error
    if login.get("authenticated") is not True or client.last_verification_method != "none":
        raise AutomationCredentialError("automation account login readback is incomplete")


def ensure_automation_credentials(
    *,
    api_base_url: str,
    manager_base_url: str,
    manager_environment_file: Path,
    credentials_file: Path,
    rotate: bool = False,
    password_factory: Callable[[int], str] = secrets.token_urlsafe,
) -> AutomationCredentialResult:
    """Ensure one verified local secret matches the fixed remote automation account."""

    api_base_url = _validate_origin(api_base_url, "API base URL")
    manager_base_url = _validate_origin(manager_base_url, "manager base URL")
    manager_token = load_manager_token(manager_environment_file)
    credentials_file = _require_absolute_path(credentials_file, "automation credential file")

    if credentials_file.exists() and not rotate:
        existing = load_automation_credentials(credentials_file)
        if existing["FILTEREST_API_BASE_URL"].rstrip("/") != api_base_url:
            raise AutomationCredentialError("automation credential file belongs to another API target")
        if existing["FILTEREST_API_USERNAME"] != AUTOMATION_ACCOUNT_USERNAME:
            raise AutomationCredentialError("automation credential file belongs to another username")
        _verify_api_login(api_base_url, existing["FILTEREST_API_PASSWORD"])
        readback = _validate_ready_record(
            _manager_request(manager_base_url, manager_token, "GET")
        )
        return AutomationCredentialResult(
            action="unchanged",
            base_url=api_base_url,
            username=readback.username,
            user_id=readback.user_id,
            authentication_generation=readback.authentication_generation,
        )

    password = password_factory(36)
    if not isinstance(password, str) or len(password) < 32:
        raise AutomationCredentialError("password generator returned an invalid credential")
    provisioned = _validate_ready_record(
        _manager_request(
            manager_base_url,
            manager_token,
            "POST",
            payload={"password": password},
        )
    )
    readback = _validate_ready_record(
        _manager_request(manager_base_url, manager_token, "GET")
    )
    if provisioned.user_id != readback.user_id or provisioned.authentication_generation != readback.authentication_generation:
        raise AutomationCredentialError("automation account changed before credential readback completed")
    _verify_api_login(api_base_url, password)
    _write_automation_credentials(credentials_file, api_base_url, password)
    return AutomationCredentialResult(
        action=provisioned.action,
        base_url=api_base_url,
        username=provisioned.username,
        user_id=provisioned.user_id,
        authentication_generation=provisioned.authentication_generation,
    )


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision or verify the fixed Filterest API automation administrator.",
    )
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument(
        "--manager-base-url",
        help="trusted loopback/tunnel origin; defaults to --api-base-url",
    )
    parser.add_argument("--manager-environment-file", required=True, type=Path)
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument(
        "--rotate",
        action="store_true",
        help="replace an existing automation password after verified provisioning",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_argument_parser().parse_args(argv)
    try:
        result = ensure_automation_credentials(
            api_base_url=args.api_base_url,
            manager_base_url=args.manager_base_url or args.api_base_url,
            manager_environment_file=args.manager_environment_file,
            credentials_file=args.credentials_file,
            rotate=args.rotate,
        )
    except AutomationCredentialError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(
        "automation credentials ready: "
        f"target={result.base_url} username={result.username} "
        f"action={result.action} generation={result.authentication_generation}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
