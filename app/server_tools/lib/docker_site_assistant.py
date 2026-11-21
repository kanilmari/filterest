"""Validate the optional Docker connection to a separately managed site runner.

Share one selection policy between setup and offline installation conformance.
Keep external IPC paths outside installation backups and reject broad/overlapping mounts.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import urlsplit

ASSISTANT_KEYS = (
    "FILTEREST_CODING_AGENT_SOCKET_DIR", "FILTEREST_CODING_AGENT_IPC_GID",
    "FILTEREST_CODING_AGENT_SITE_ID", "FILTEREST_SITE_ASSISTANT_BASE_URL",
    "FILTEREST_CODING_AGENT_UPLOAD_DIR",
)
ASSISTANT_SELECTOR = "FILTEREST_ASSISTANT_FILE"
SOCKET_TARGET = "/run/filterest-coding-agent"
DISABLED_FRAGMENT = "docker-compose.assistant-disabled.yml"
ENABLED_FRAGMENT = "docker-compose.assistant.yml"


def canonical_directory(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    broad = {"/", "/run", "/tmp", "/var", "/var/lib", "/srv", "/home", "/opt"}
    if (not path.is_absolute() or value.startswith("//") or str(path) != value or ".." in path.parts
            or any(character.isspace() or ord(character) < 32 or character == "$" for character in value)
            or value in broad):
        raise ValueError("Assistant directories must be dedicated canonical absolute paths without whitespace or interpolation")
    return path


def overlaps(first: PurePosixPath, second: PurePosixPath) -> bool:
    return first == second or first in second.parents or second in first.parents


def real_directory(value: PurePosixPath) -> None:
    """Inspect existing components without creating, following or changing any path."""
    try:
        for path in reversed((Path(value), *Path(value).parents)):
            if not stat.S_ISDIR(path.lstat().st_mode):
                raise ValueError("Assistant directories must exist with no symbolic-link components")
    except OSError:
        raise ValueError("Assistant directories must exist and be accessible before Docker setup") from None


def assistant_options(settings: dict[str, str] | None = None, installation_root: str = "",
                      *, check_paths: bool = False) -> dict[str, str]:
    """Select a maintained fragment only for one complete operator-owned connection."""
    settings = settings or {}
    values = [settings.get(key, "") for key in ASSISTANT_KEYS]
    if not any(values):
        return {ASSISTANT_SELECTOR: DISABLED_FRAGMENT} if settings.get(ASSISTANT_SELECTOR) else {}
    if not all(values):
        raise ValueError("Assistant Docker settings must include socket directory, IPC group, site identity, callback URL and upload directory together")
    socket_directory, gid, site, base_url, upload_directory = values
    if not re.fullmatch(r"[1-9][0-9]*", gid) or int(gid) > 2147483647:
        raise ValueError("Assistant IPC group must be a non-root numeric group ID")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", site):
        raise ValueError("Assistant site identity must use letters, digits, dots, underscores or hyphens")
    try:
        url = urlsplit(base_url)
        valid_url = (url.scheme in ("http", "https") and url.hostname and url.username is None
                     and url.password is None and not url.query and not url.fragment
                     and url.path in ("", "/") and (url.port is None or 1 <= url.port <= 65535)
                     and (url.scheme == "https" or url.hostname in ("127.0.0.1", "localhost"))
                     and not any(character.isspace() or character in "$\x00" for character in base_url))
    except ValueError:
        valid_url = False
    if not valid_url:
        raise ValueError("Assistant callback must be a loopback HTTP or HTTPS origin without credentials, query or fragment")
    socket_path = canonical_directory(socket_directory)
    upload_path = canonical_directory(upload_directory)
    if not installation_root:
        raise ValueError("Assistant path validation requires the installation root")
    root = PurePosixPath(installation_root)
    if overlaps(socket_path, root) or overlaps(upload_path, root):
        raise ValueError("Assistant socket and upload directories must stay outside the installation and its backups")
    if overlaps(socket_path, upload_path):
        raise ValueError("Assistant socket and upload directories must be separate non-overlapping directories")
    for protected in ("/filterest", "/proc", "/sys", "/dev", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", SOCKET_TARGET):
        if overlaps(upload_path, PurePosixPath(protected)):
            raise ValueError("Assistant upload mount must not cover application, system or socket paths")
    if check_paths:
        real_directory(socket_path)
        real_directory(upload_path)
    return {ASSISTANT_SELECTOR: ENABLED_FRAGMENT}
