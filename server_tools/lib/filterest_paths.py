"""Resolve dynamic Filterest project and key homes without reading secrets.

Bridges operator path configuration with Python tooling, shell wrappers,
public-repository sync, Docker context protection, and deployment filters.
Exists so safety follows the resolved path instead of a hard-coded directory name.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
from typing import Mapping


CONFIG_FILE_NAME = "filterest.paths"
LOCAL_CONFIG_FILE_NAME = "filterest.paths.local"
SUPPORTED_KEYS = frozenset({"schema_version", "projects_home", "keys_home"})
GIT_EXCLUDE_BEGIN = "# filterest-paths:begin"
GIT_EXCLUDE_END = "# filterest-paths:end"


@dataclass(frozen=True)
class FilterestHomes:
    project_root: Path
    projects_home: Path
    keys_home: Path
    projects_home_entry: Path
    keys_home_entry: Path
    projects_home_configured: bool
    keys_home_configured: bool


def is_private_easelect_source_checkout(project_root: Path) -> bool:
    return (project_root / ".git").exists() and (project_root / "VERSION_EASELECT").is_file()


def _read_paths_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    if (
        path.name == LOCAL_CONFIG_FILE_NAME
        and stat.S_IMODE(path.stat().st_mode) & 0o022
    ):
        raise ValueError(
            f"{path}: local path locator must not be writable by group or others"
        )

    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected key=value")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key not in SUPPORTED_KEYS:
            raise ValueError(f"{path}:{line_number}: unsupported key {key!r}")
        if key in values:
            raise ValueError(f"{path}:{line_number}: duplicate key {key!r}")
        if any(character in value for character in ("\x00", "\n", "\r")):
            raise ValueError(f"{path}:{line_number}: path value contains a control character")
        values[key] = value

    schema_version = values.get("schema_version", "1")
    if schema_version != "1":
        raise ValueError(f"{path}: unsupported schema_version {schema_version!r}")
    return values


def _resolved_home(project_root: Path, raw_value: str, label: str) -> Path:
    value = raw_value.strip()
    if not value:
        raise ValueError(f"{label} must not be empty")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} must not contain control characters")
    if any(character in value for character in ("*", "?", "[", "]", "\\")):
        raise ValueError(
            f"{label} must not contain pattern characters (*, ?, [, ], or backslash)"
        )
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = project_root / candidate
    resolved = candidate.resolve(strict=False)
    if resolved == Path(resolved.anchor):
        raise ValueError(f"{label} must not resolve to the filesystem root")
    if resolved == project_root:
        raise ValueError(f"{label} must not resolve to the checkout root")

    git_root = (project_root / ".git").resolve(strict=False)
    try:
        resolved.relative_to(git_root)
    except ValueError:
        pass
    else:
        raise ValueError(f"{label} must not resolve inside .git")
    return resolved


def _declared_home(project_root: Path, raw_value: str) -> Path:
    candidate = Path(raw_value.strip())
    if not candidate.is_absolute():
        candidate = project_root / candidate
    return Path(os.path.abspath(candidate))


def _paths_overlap(first: Path, second: Path) -> bool:
    try:
        first.relative_to(second)
        return True
    except ValueError:
        pass
    try:
        second.relative_to(first)
        return True
    except ValueError:
        return False


def resolve_filterest_homes(
    project_root: Path | str,
    environment: Mapping[str, str] | None = None,
) -> FilterestHomes:
    root = Path(project_root).resolve()
    resolved_environment = os.environ if environment is None else environment
    private_source = is_private_easelect_source_checkout(root)

    defaults = {
        "projects_home": str(root.parent / "filterest-projects") if private_source else "filterest_projects",
        "keys_home": str(root.parent / "filterest_keys") if private_source else "filterest_keys",
    }
    values = dict(defaults)
    configured_keys: set[str] = set()
    for config_path in (root / CONFIG_FILE_NAME, root / LOCAL_CONFIG_FILE_NAME):
        file_values = _read_paths_file(config_path)
        for key in ("projects_home", "keys_home"):
            if key in file_values:
                values[key] = file_values[key]
                configured_keys.add(key)

    environment_overrides = {
        "projects_home": str(resolved_environment.get("FILTEREST_PROJECTS_HOME", "")).strip(),
        "keys_home": str(resolved_environment.get("FILTEREST_KEYS_HOME", "")).strip(),
    }
    for key, value in environment_overrides.items():
        if value:
            values[key] = value
            configured_keys.add(key)

    legacy_key_root = str(resolved_environment.get("EASELECT_KEY_ROOT", "")).strip()
    if legacy_key_root and private_source:
        if not Path(legacy_key_root).is_absolute():
            raise ValueError("invalid EASELECT_KEY_ROOT: path must be absolute")
        legacy_resolved = _resolved_home(root, legacy_key_root, "EASELECT_KEY_ROOT")
        try:
            legacy_resolved.relative_to(root)
        except ValueError:
            pass
        else:
            raise ValueError(
                "invalid EASELECT_KEY_ROOT: path must stay outside the Easelect repository"
            )
        if "keys_home" in configured_keys:
            configured_resolved = _resolved_home(root, values["keys_home"], "keys_home")
            if configured_resolved != legacy_resolved:
                raise ValueError(
                    "EASELECT_KEY_ROOT conflicts with the configured keys_home"
                )
        values["keys_home"] = str(legacy_resolved)
        configured_keys.add("keys_home")

    projects_home_entry = _declared_home(root, values["projects_home"])
    keys_home_entry = _declared_home(root, values["keys_home"])
    projects_home = _resolved_home(root, values["projects_home"], "projects_home")
    keys_home = _resolved_home(root, values["keys_home"], "keys_home")
    if _paths_overlap(projects_home, keys_home):
        raise ValueError("projects_home and keys_home must not be equal or nested")

    return FilterestHomes(
        project_root=root,
        projects_home=projects_home,
        keys_home=keys_home,
        projects_home_entry=projects_home_entry,
        keys_home_entry=keys_home_entry,
        projects_home_configured="projects_home" in configured_keys,
        keys_home_configured="keys_home" in configured_keys,
    )


def relative_protected_homes(homes: FilterestHomes) -> list[str]:
    protected: list[str] = []
    for home in (homes.projects_home_entry, homes.keys_home_entry):
        try:
            relative = home.relative_to(homes.project_root)
        except ValueError:
            continue
        guarded_relative = relative
        cursor = homes.project_root
        for component in relative.parts:
            cursor /= component
            if cursor.is_symlink():
                guarded_relative = cursor.relative_to(homes.project_root)
                break
        rendered = guarded_relative.as_posix()
        if rendered not in protected:
            protected.append(rendered)
    return protected


def _tracked_home_paths(homes: FilterestHomes) -> list[str]:
    protected = relative_protected_homes(homes)
    if not protected or not (homes.project_root / ".git").exists():
        return []
    completed = subprocess.run(
        ["git", "-C", str(homes.project_root), "ls-files", "-z", "--", *protected],
        check=True,
        capture_output=True,
    )
    return [
        path.decode("utf-8", errors="replace")
        for path in completed.stdout.split(b"\x00")
        if path
    ]


def audit_path_boundaries(homes: FilterestHomes) -> None:
    tracked = _tracked_home_paths(homes)
    if tracked:
        rendered = ", ".join(tracked[:5])
        suffix = "" if len(tracked) <= 5 else f" (+{len(tracked) - 5} more)"
        raise ValueError(
            f"configured project/key home contains tracked files: {rendered}{suffix}"
        )


def render_dockerignore_files(homes: FilterestHomes) -> list[Path]:
    base_path = homes.project_root / ".dockerignore"
    base_text = base_path.read_text(encoding="utf-8") if base_path.is_file() else ""
    dynamic_lines = [
        "",
        "# Dynamic Filterest homes; generated by server_tools/lib/filterest_paths.py.",
        f"/{LOCAL_CONFIG_FILE_NAME}",
    ]
    for relative in relative_protected_homes(homes):
        dynamic_lines.extend((f"/{relative}", f"/{relative}/**"))
    rendered = base_text.rstrip() + "\n" + "\n".join(dynamic_lines) + "\n"

    outputs: list[Path] = []
    docker_root = homes.project_root / "docker"
    for dockerfile in sorted(docker_root.glob("Dockerfile*")):
        if not dockerfile.is_file() or dockerfile.name.endswith(".dockerignore"):
            continue
        output = dockerfile.with_name(f"{dockerfile.name}.dockerignore")
        output.write_text(rendered, encoding="utf-8")
        outputs.append(output)
    return outputs


def render_git_exclude(homes: FilterestHomes) -> Path | None:
    if not (homes.project_root / ".git").exists():
        return None
    completed = subprocess.run(
        ["git", "-C", str(homes.project_root), "rev-parse", "--git-path", "info/exclude"],
        check=True,
        capture_output=True,
        text=True,
    )
    exclude_path = Path(completed.stdout.strip())
    if not exclude_path.is_absolute():
        exclude_path = homes.project_root / exclude_path
    existing = exclude_path.read_text(encoding="utf-8") if exclude_path.is_file() else ""
    pattern = re.compile(
        rf"\n?{re.escape(GIT_EXCLUDE_BEGIN)}.*?{re.escape(GIT_EXCLUDE_END)}\n?",
        re.DOTALL,
    )
    retained = pattern.sub("\n", existing).rstrip()
    dynamic_lines = [
        GIT_EXCLUDE_BEGIN,
        f"/{LOCAL_CONFIG_FILE_NAME}",
        "/docker/Dockerfile*.dockerignore",
    ]
    for relative in relative_protected_homes(homes):
        dynamic_lines.extend((f"/{relative}", f"/{relative}/**"))
    dynamic_lines.append(GIT_EXCLUDE_END)
    rendered = "\n".join(filter(None, (retained, "\n".join(dynamic_lines)))) + "\n"
    try:
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        exclude_path.write_text(rendered, encoding="utf-8")
    except OSError as error:
        print(
            f"warning: could not update local Git exclude file {exclude_path}: {error}",
            file=sys.stderr,
        )
        return None
    return exclude_path


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument(
        "--format",
        choices=("lines", "shell", "relative-lines"),
        default="lines",
    )
    parser.add_argument("--audit", action="store_true")
    parser.add_argument("--render-dockerignore", action="store_true")
    parser.add_argument("--render-git-exclude", action="store_true")
    return parser


def main(argv: list[str]) -> int:
    args = _build_parser().parse_args(argv)
    try:
        homes = resolve_filterest_homes(args.project_root)
        if args.audit:
            audit_path_boundaries(homes)
        if args.render_dockerignore:
            render_dockerignore_files(homes)
        if args.render_git_exclude:
            render_git_exclude(homes)
        if args.format == "relative-lines":
            for relative in relative_protected_homes(homes):
                print(relative)
        elif args.format == "shell":
            print(f"FILTEREST_PROJECTS_HOME={shlex.quote(str(homes.projects_home))}")
            print(f"FILTEREST_KEYS_HOME={shlex.quote(str(homes.keys_home))}")
            print(
                "FILTEREST_PROJECTS_HOME_CONFIGURED="
                f"{int(homes.projects_home_configured)}"
            )
            print(
                f"FILTEREST_KEYS_HOME_CONFIGURED={int(homes.keys_home_configured)}"
            )
        else:
            print(homes.projects_home)
            print(homes.keys_home)
            print(int(homes.projects_home_configured))
            print(int(homes.keys_home_configured))
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
