#!/usr/bin/env python3
"""Build the tracked browser bundle and judge the one in a Filterest checkout.

The files under app/frontend/dist are the minified browser bundle that every
non-development runtime serves, and they are tracked in Git. This module owns
the single way to produce them — the reviewed Vite build, into a directory the
caller chooses — and the single way to judge them: rebuild from the same source
and compare filenames and bytes. Candidate preparation stages the rebuilt bytes
so a release carries its own bundle; the release source checks refuse a bundle
that the source beside it no longer produces.

The build is reproducible on one toolchain: repeated builds of the same source,
including from different absolute paths, produce the same content-hashed
filenames and the same bytes. A difference therefore means either that the
tracked files are stale, or that the Node/Vite toolchain differs from the one
that built them, and the reported failure says both.

Nothing here writes into app/frontend/dist. A caller that wants the tracked
bundle replaced hands the returned bytes to its own reviewed file replacement.
"""

from __future__ import annotations

from pathlib import Path
import subprocess


BUNDLE_DIRECTORY = "app/frontend/dist"

TOOLCHAIN_ADVICE = (
    "The frontend build did not run, so the browser bundle was neither produced nor checked.\n"
    "Install the declared Node dependencies:\n"
    "  ./filterest setup --profile development --dependencies-only --yes\n"
    "and run release commands through ./filterest from the installation root, so "
    "Node finds this installation's dependency folder."
)

REFRESH_ADVICE = (
    "Candidate preparation rebuilds the bundle by itself, so a prepared release "
    "always carries a current one:\n"
    "  ./filterest release prepare --apply ...\n"
    "To refresh the tracked bundle outside a release, run this from the "
    "installation root and commit the result:\n"
    "  ./filterest build --outDir dist"
)


class BundleBuildError(RuntimeError):
    """The reviewed browser build could not run, so the bundle was not judged."""


def bundle_files(directory: Path) -> dict[str, bytes]:
    """Return every regular file below directory, keyed by its relative path."""

    files: dict[str, bytes] = {}
    if directory.is_symlink():
        raise BundleBuildError(f"browser bundle directory must not be a symlink: {directory}")
    if not directory.is_dir():
        return files
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise BundleBuildError(f"browser bundle entry must not be a symlink: {path}")
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = path.read_bytes()
    return files


def tracked_bundle(root: Path) -> dict[str, bytes]:
    """Return the bundle files this checkout ships, keyed by their name."""

    return bundle_files(root / BUNDLE_DIRECTORY)


def build_browser_bundle(root: Path, output_dir: Path) -> dict[str, bytes]:
    """Build root's frontend into output_dir and return the produced files.

    The command is the reviewed application build with an explicit output
    directory, which is what the quality run already uses to compile the
    frontend outside source. A missing toolchain or a failing build raises
    BundleBuildError; it never reports an unbuilt bundle as a built one.
    """

    application = root / "app"
    if not (application / "package.json").is_file():
        raise BundleBuildError(f"not a Filterest checkout: {application / 'package.json'} is missing")
    output_dir.mkdir(parents=True, exist_ok=True)
    command = ["npm", "run", "build", "--", "--outDir", str(output_dir)]
    try:
        result = subprocess.run(command, cwd=application, capture_output=True, text=True, check=False)
    except OSError as error:
        raise BundleBuildError(f"{' '.join(command)} could not start: {error}\n{TOOLCHAIN_ADVICE}") from error
    if result.returncode != 0:
        raise BundleBuildError(
            f"the browser build failed ({' '.join(command)} exited {result.returncode}).\n"
            f"{TOOLCHAIN_ADVICE}\n--- build output ---\n{build_output(result)}"
        )
    built = bundle_files(output_dir)
    if not built:
        raise BundleBuildError(
            f"the browser build wrote no files into {output_dir}.\n{TOOLCHAIN_ADVICE}"
        )
    return built


def build_output(result: subprocess.CompletedProcess, lines: int = 20) -> str:
    """Return the tail of a failed build's own output for the reader."""

    text = ((result.stdout or "") + (result.stderr or "")).strip().splitlines()
    return "\n".join(text[-lines:]) if text else "(the build printed nothing)"


def compare_bundle(tracked: dict[str, bytes], built: dict[str, bytes]) -> dict[str, list[str]]:
    """Return how the tracked bundle differs from one built from the same source."""

    return {
        "missing": sorted(set(built) - set(tracked)),
        "unexpected": sorted(set(tracked) - set(built)),
        "differing": sorted(name for name in set(tracked) & set(built) if tracked[name] != built[name]),
    }


def describe_difference(difference: dict[str, list[str]]) -> str:
    """Describe a bundle difference in the order a reader can act on it."""

    labels = (
        ("missing", "This source produces files the tracked bundle does not contain"),
        ("unexpected", "The tracked bundle contains files this source no longer produces"),
        ("differing", "The tracked bundle keeps different bytes under the same name"),
    )
    sections = []
    for key, label in labels:
        if difference[key]:
            sections.append(label + ":\n" + "\n".join(f"- {name}" for name in difference[key]))
    return "\n".join(sections)
