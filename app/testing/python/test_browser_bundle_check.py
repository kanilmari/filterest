"""The release refuses a browser bundle that its own source no longer builds.

Production serves the tracked minified files under app/frontend/dist, and a
development machine that serves raw source never touches them, so a stale
bundle is invisible until it ships. These tests prove both directions of the
check — a bundle that matches passes, a bundle made stale fails — and that a
build which cannot run is reported as unchecked rather than as fine.

The stand-in build keeps the fixtures small. One test runs the real command
path through npm, so the comparison is not the only thing proved.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import stat
from urllib.parse import urljoin, urlsplit

import pytest

from server_tools.release import audit_browser_bundle, browser_bundle


BUILT = {"main.aaaa.min.js": b"built bundle\n", "imports.bbbb.min.css": b"built styles\n"}
SERVED_DIST = "/frontend/dist/"


def assert_served_dependency_paths(bundle: dict[str, bytes]) -> tuple[int, int]:
    """Resolve emitted imports and Vite preload maps as the browser does.

    Vite 6 emits literal module specifiers, a JSON array in each mapDeps
    declaration, and one shared URL-prefix function. Read that emitted prefix,
    not the source configuration: existing files alone cannot detect a wrong
    preload base. Refuse an unrecognized helper/map rather than silently skip it.
    """
    chunks = {name: data.decode() for name, data in bundle.items() if name.endswith(".js")}
    assert chunks, "the production bundle contains no JavaScript"
    preload_bases = {
        match[2]
        for source in chunks.values()
        for match in re.findall(
            r'function\((\w+)\)\{return(["\'])(/frontend/[^"\']*)\2\+\1\}', source
        )
    }
    imports = preloads = 0

    def assert_target(owner: str, reference: str, base: str) -> None:
        address = urlsplit(urljoin(base, reference))
        assert not address.scheme and not address.netloc, (owner, reference, address)
        assert address.path.startswith(SERVED_DIST), f"{owner}: dependency served outside dist: {address.path}"
        target = address.path.removeprefix(SERVED_DIST)
        assert target in bundle, f"{owner}: missing dependency: {address.path}"

    for name, source in chunks.items():
        assert not re.search(r'/frontend/[^/"\'\s]+\.min\.js', source), name
        # Covers static imports, re-exports and literal dynamic imports.
        references = re.findall(r'\b(?:from\s*|import\s*\(?\s*)["\']([^"\']+)["\']', source)
        for reference in references:
            assert_target(name, reference, SERVED_DIST + name)
            imports += 1
        if "__vite__mapDeps=" not in source:
            continue
        maps = re.findall(r'__vite__mapDeps=\([^;]*?\.f=(\[[^\]]*\])', source)
        assert maps, f"{name}: unrecognized Vite preload dependency map"
        assert len(preload_bases) == 1, f"unrecognized Vite preload URL helper: {preload_bases}"
        for dependency_map in maps:
            for reference in json.loads(dependency_map):
                assert_target(name, reference, next(iter(preload_bases)))
                preloads += 1
    return imports, preloads


def test_tracked_browser_dependencies_resolve_under_served_dist():
    root = Path(__file__).resolve().parents[3]
    imports, preloads = assert_served_dependency_paths(browser_bundle.tracked_bundle(root))
    assert imports > 0 and preloads > 0, "the shipped dependency graph was not checked"


@pytest.mark.parametrize("failure", ["preload_base", "missing_import", "missing_preload", "absolute_import"])
def test_dependency_guard_refuses_wrong_addresses_and_missing_files(failure):
    bundle = {
        "main.min.js": (
            'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["lazy.min.js"])))=>i.map(i=>d[i]);'
            'const url=function(e){return"/frontend/dist/"+e};'
            'import "./shared.min.js";import("./lazy.min.js");'
        ).encode(),
        "shared.min.js": b"export const shared = true;",
        "lazy.min.js": b"export const lazy = true;",
    }
    assert assert_served_dependency_paths(bundle) == (2, 1)
    if failure == "preload_base":
        bundle["main.min.js"] = bundle["main.min.js"].replace(b'/frontend/dist/', b'/frontend/')
    elif failure == "missing_import":
        del bundle["shared.min.js"]
    elif failure == "missing_preload":
        bundle["main.min.js"] = bundle["main.min.js"].replace(b'"lazy.min.js"', b'"missing.min.js"')
    else:
        bundle["main.min.js"] = bundle["main.min.js"].replace(b'./shared.min.js', b'/frontend/shared.min.js')
    with pytest.raises(AssertionError):
        assert_served_dependency_paths(bundle)


def checkout(tmp_path: Path, tracked: dict[str, bytes]) -> Path:
    """Create a miniature checkout whose tracked bundle is the given files."""

    root = tmp_path / "checkout"
    (root / "app/server_tools").mkdir(parents=True)
    bundle = root / browser_bundle.BUNDLE_DIRECTORY
    bundle.mkdir(parents=True)
    for name, content in tracked.items():
        (bundle / name).write_bytes(content)
    return root


def stand_in_build(monkeypatch, built: dict[str, bytes] | None = None) -> None:
    def build(root, output_dir):
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, content in (BUILT if built is None else built).items():
            (output_dir / name).write_bytes(content)
        return dict(BUILT if built is None else built)
    monkeypatch.setattr(browser_bundle, "build_browser_bundle", build)


def snapshot(root: Path) -> dict[str, bytes]:
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*") if path.is_file()}


def test_a_current_bundle_passes(tmp_path, monkeypatch, capsys):
    root = checkout(tmp_path, BUILT)
    stand_in_build(monkeypatch)

    assert audit_browser_bundle.main(["--target", str(root)]) == 0
    assert "Browser bundle OK: 2 tracked files" in capsys.readouterr().out


@pytest.mark.parametrize("change,named", [
    ("stale_bytes", "main.aaaa.min.js"),
    ("renamed", "main.old.min.js"),
    ("left_behind", "main.previous.min.js"),
    ("empty", "main.aaaa.min.js"),
])
def test_a_stale_bundle_is_refused(tmp_path, monkeypatch, capsys, change, named):
    tracked = dict(BUILT)
    if change == "stale_bytes":
        tracked["main.aaaa.min.js"] = b"bundle built before the last frontend change\n"
    elif change == "renamed":
        tracked = {"main.old.min.js": BUILT["main.aaaa.min.js"], **{k: v for k, v in BUILT.items() if k != "main.aaaa.min.js"}}
    elif change == "left_behind":
        tracked["main.previous.min.js"] = b"a build nobody removed\n"
    elif change == "empty":
        tracked = {}
    root = checkout(tmp_path, tracked)
    stand_in_build(monkeypatch)
    before = snapshot(root)

    assert audit_browser_bundle.main(["--target", str(root)]) == 1
    printed = capsys.readouterr()
    assert named in printed.err
    assert "./filterest release prepare --apply" in printed.err
    assert "OK" not in printed.out
    assert snapshot(root) == before  # A check that repairs is not a check.


def test_an_unrunnable_build_is_reported_as_unchecked(tmp_path, monkeypatch, capsys):
    root = checkout(tmp_path, BUILT)
    def unavailable(target, output_dir):
        raise browser_bundle.BundleBuildError("npm could not start\n" + browser_bundle.TOOLCHAIN_ADVICE)
    monkeypatch.setattr(browser_bundle, "build_browser_bundle", unavailable)

    assert audit_browser_bundle.main(["--target", str(root)]) == 1
    printed = capsys.readouterr()
    assert "could not run" in printed.err
    assert "neither produced nor checked" in printed.err
    assert printed.out == ""


def test_a_directory_that_is_not_a_checkout_is_rejected(tmp_path):
    with pytest.raises(SystemExit):
        audit_browser_bundle.main(["--target", str(tmp_path)])


def test_a_bundle_symlink_is_never_read_as_content(tmp_path, monkeypatch):
    root = checkout(tmp_path, BUILT)
    secret = tmp_path / "operator-state"
    secret.write_bytes(b"outside the checkout\n")
    (root / browser_bundle.BUNDLE_DIRECTORY / "linked.min.js").symlink_to(secret)
    stand_in_build(monkeypatch)

    with pytest.raises(browser_bundle.BundleBuildError, match="symlink"):
        audit_browser_bundle.audit_browser_bundle(root)


def npm_project(root: Path) -> None:
    """Give the miniature checkout a real npm build script of its own."""

    (root / "app/package.json").write_text(
        '{"name": "fixture", "private": true, "scripts": {"build": "sh build_fixture.sh"}}\n'
    )
    script = root / "app/build_fixture.sh"
    script.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "# Accepts the same --outDir the application build accepts.\n"
        "[ \"$1\" = '--outDir' ] || exit 2\n"
        "mkdir -p \"$2\"\n"
        "printf 'built bundle\\n' > \"$2/main.aaaa.min.js\"\n"
        "printf 'built styles\\n' > \"$2/imports.bbbb.min.css\"\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)


def test_the_real_command_path_separates_a_current_bundle_from_a_stale_one(tmp_path, capsys):
    if shutil.which("npm") is None:
        pytest.skip("npm is required to run the application build command")
    root = checkout(tmp_path, BUILT)
    npm_project(root)

    assert audit_browser_bundle.main(["--target", str(root)]) == 0

    (root / browser_bundle.BUNDLE_DIRECTORY / "main.aaaa.min.js").write_bytes(b"stale\n")
    assert audit_browser_bundle.main(["--target", str(root)]) == 1
    assert "main.aaaa.min.js" in capsys.readouterr().err


def test_a_failing_build_carries_its_own_output_to_the_reader(tmp_path):
    if shutil.which("npm") is None:
        pytest.skip("npm is required to run the application build command")
    root = checkout(tmp_path, BUILT)
    npm_project(root)
    (root / "app/build_fixture.sh").write_text("#!/bin/sh\necho 'imports/missing_module.js not found' >&2\nexit 1\n")

    with pytest.raises(browser_bundle.BundleBuildError, match="missing_module"):
        browser_bundle.build_browser_bundle(root, tmp_path / "out")


def test_a_checkout_without_a_frontend_project_never_claims_a_build(tmp_path):
    root = checkout(tmp_path, BUILT)

    with pytest.raises(browser_bundle.BundleBuildError, match="not a Filterest checkout"):
        browser_bundle.build_browser_bundle(root, tmp_path / "out")
