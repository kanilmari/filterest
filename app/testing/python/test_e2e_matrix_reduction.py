"""test_e2e_matrix_reduction.py
Guard K549's reviewed reductions and prevent accidental browser multiplication.
Connect matrix discovery, relative import chains and the versioned manifest.
Use static source only; never run Playwright, a browser or application hooks.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re

import pytest

from e2e_matrix_reduction import MANIFEST_PATH, load_reduction, resolve_spec_projects


ROOT = Path(__file__).resolve().parents[3]
T23 = "T_admin/T23_permissions_rights_fingerprint.spec.ts"
# J25 assumption, matching the steward's matrix_sets.py: protected names are
# opaque, including imported auth utilities. Never open them; L3 stays on six
# projects. Unclassified project reads also stay outside C until reviewed.
SECRET = re.compile(r"credential|secret|token|password|passwd|creds|\.env|\.pem$|\.key$|^(?:keys|\.ssh|\.codex)$", re.I)
IMPORT = re.compile(r"""(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.[^'"]+)['"]""")
READ_CARD = re.compile(r"\bcardView\b|setupCardView")
READ_NAME = re.compile(r"\.project\.name\b|projectName|\bproject\.name\b|project\s*\[\s*['\"]name|\.project\.metadata\b(?!\??\.screenWidth)|metadata\??\.cardView|\.metadata\s*\)|\{\s*name\s*\}\s*=\s*\w*\.?project")
READ_ANY_PROJECT = re.compile(r"\.project\b|\{\s*project\b|\bproject\s*\}")
READ_WIDTH = re.compile(r"metadata\??\.screenWidth|\.project\.use\b")
WIDTH_NAME = re.compile(r"/\^\(mobile\|tablet\)-/\.test\(\s*[\w.()]+\.project\.name\s*\)")
OWN_SIZE = re.compile(r"setViewportSize\s*\(|test\.use\s*\(\s*\{[^}]*viewport", re.S)
MATRIX_SPEC = re.compile(r"\.(?:spec|test)\.[cm]?[jt]sx?$")
T23_SKIP = re.compile(r"^\s*test\.skip\(testInfo\.project\.name === 'mobile-card',.*\);\s*$")


def protected(path: Path) -> bool:
    return any(SECRET.search(part) for part in path.parts)


def source(path: Path, cache: dict) -> str | None:
    if path not in cache:
        cache[path] = None if protected(path) else path.read_text(errors="replace")
    return cache[path]


def resolve_import(path: Path, relative: str) -> Path | None:
    base = path.parent / relative
    for candidate in (base, *(Path(str(base) + suffix) for suffix in (".ts", ".js", ".mjs", ".cjs", ".json")),
                      base / "index.ts", base / "index.js"):
        if candidate.is_file():
            return candidate.resolve()
    return None


def chain(path: Path, cache: dict) -> set[Path]:
    seen, stack = set(), [path.resolve()]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        text = source(current, cache)
        if text is not None and current.suffix != ".json":
            stack.extend(target for relative in IMPORT.findall(text)
                         if (target := resolve_import(current, relative)) is not None)
    return seen


def code(path: Path, cache: dict) -> str:
    text = source(path, cache) or ""
    if path.as_posix().endswith("/helpers/view-switch.ts"):
        # The audited helper is dormant. Exempt only its definition; any caller
        # or new read elsewhere in this helper must invalidate the reduction.
        text = re.sub(r"export async function setupCardView\([^\n]*\n.*?\n}", "", text, flags=re.S)
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith(("//", "*", "/*")))


def dependency_reads(spec: Path, cache: dict, t23: bool) -> list[str]:
    reads = []
    for path in sorted(chain(spec, cache)):
        for line in code(path, cache).splitlines():
            if t23 and path == spec.resolve() and T23_SKIP.fullmatch(line):
                continue  # K549 B: T23's own phone skip is the sole named exception.
            line = WIDTH_NAME.sub("widthOnly", line)
            if READ_CARD.search(line) or READ_NAME.search(line):
                reads.append(str(path))
            elif READ_ANY_PROJECT.search(line) and not READ_WIDTH.search(line):
                reads.append(str(path))
    return reads


def matrix_specs(root: Path, manual: set[str]) -> list[Path]:
    directory = root / "app/testing/e2e"
    specs = []
    for base, directories, files in os.walk(directory):
        directories[:] = [name for name in directories if name not in ("node_modules", "setup", "manual_specs")
                          and not protected(Path(name))]
        for name in files:
            path = Path(base) / name
            if (MATRIX_SPEC.search(name) and not name.endswith(".test.ts") and not protected(path)
                    and path.relative_to(directory).as_posix() not in manual):
                specs.append(path)
    return sorted(specs)


def validate_one_project_sizing(spec: str, text: str) -> None:
    # Cheap line-based net, not a proof of unconditional sizing or page ownership.
    # Keep physical line distances while ignoring standalone comments.
    lines = ["" if line.lstrip().startswith(("//", "*", "/*")) else line for line in text.splitlines()]
    for index, line in enumerate(lines):
        assert not re.search(r"\bif\s*\(.*\).*\.setViewportSize\s*\(", line), f"conditional own-size in one-project spec: {spec}"
        if match := re.search(r"\.newPage\s*\(", line):
            following = "\n".join([line[match.end():], *lines[index + 1:index + 3]])
            assert re.search(r"\.setViewportSize\s*\(", following), f"new page needs size within two lines: {spec}"


def validate_reduction(root: Path) -> None:
    """Fail on stale scope, new blind specs, new dependency reads or own sizing."""
    manifest = load_reduction(root)
    assert set(manifest) == {"version", "one_project", "one_card_mode", "own_size_allowed"}, "manifest shape"
    one, card, allowed = manifest["one_project"], manifest["one_card_mode"], manifest["own_size_allowed"]
    assert isinstance(one, dict) and isinstance(card, list) and isinstance(allowed, dict), "manifest types"
    assert len(card) == len(set(card)), "duplicate card spec"
    assert not one.keys() & set(card), "spec in both reduction lists"
    assert not one.keys() & allowed.keys(), "one-project spec needs no size waiver"
    directory = root / "app/testing/e2e"
    manual = set(json.loads((directory / "manual-specs.json").read_text()))
    projects = set(re.findall(r"\bname:\s*['\"]([^'\"]+)['\"]", (root / "app/playwright.config.ts").read_text()))
    assert set(one.values()) <= projects, "unknown project"
    entries = set(one) | set(card) | set(allowed)
    for spec in sorted(entries):
        assert not protected(Path(spec)), f"protected spec cannot enter manifest: {spec}"
        assert not Path(spec).is_absolute() and ".." not in Path(spec).parts and Path(spec).as_posix() == spec, "relative spec path"
        assert MATRIX_SPEC.search(spec) and not spec.endswith(".test.ts") and (directory / spec).is_file(), f"missing spec: {spec}"
        assert spec not in manual and not spec.startswith("setup/"), f"manual/setup spec: {spec}"
    assert all(isinstance(reason, str) and reason.strip() for reason in allowed.values()), "size waiver needs a reason"
    cache = {}
    for path in matrix_specs(root, manual):
        spec = path.relative_to(directory).as_posix()
        reduced = spec in one or spec in card
        reads = dependency_reads(path, cache, spec == T23 and spec in one)
        assert not reduced or not reads, f"reduced spec reads card/project: {spec}: {reads}"
        assert reads or reduced, f"blind spec missing from manifest: {spec}"
        own_size = OWN_SIZE.search(code(path.resolve(), cache))
        assert not own_size or spec in one or spec in allowed, f"own-size spec needs a project or reason: {spec}"
        assert spec not in allowed or own_size, f"stale own-size waiver: {spec}"
        if spec in one:
            validate_one_project_sizing(spec, source(path.resolve(), cache) or "")


def test_current_matrix_matches_k549():
    validate_reduction(ROOT)


@pytest.fixture
def matrix_fixture(tmp_path):
    directory = tmp_path / "app/testing/e2e"
    directory.mkdir(parents=True)
    (directory / "manual-specs.json").write_text("[]")
    (directory / "blind.spec.ts").write_text("export const userPath = true;\n")
    (tmp_path / "app/playwright.config.ts").write_text("name: 'desktop-card', name: 'desktop-bigcard'")
    manifest = {"version": 1, "one_project": {}, "one_card_mode": ["blind.spec.ts"], "own_size_allowed": {}}
    def save():
        (tmp_path / MANIFEST_PATH).write_text(json.dumps(manifest))
    save()
    return tmp_path, directory, manifest, save


@pytest.mark.parametrize("change, message", [
    ("missing", "missing spec"), ("manual", "manual/setup"), ("both", "both reduction"),
    ("project", "unknown project"), ("new", "blind spec missing"), ("new-js", "blind spec missing"), ("own-call", "own-size spec"),
    ("own-use", "own-size spec"), ("blank-reason", "needs a reason"), ("stale-reason", "stale own-size"),
    ("protected", "protected spec"), ("setup", "manual/setup"),
])
def test_invalid_manifest_or_unreviewed_spec_fails(matrix_fixture, change, message):
    root, directory, manifest, save = matrix_fixture
    if change == "missing": manifest["one_card_mode"].append("missing.spec.ts")
    if change == "manual": (directory / "manual-specs.json").write_text('["blind.spec.ts"]')
    if change == "both": manifest["one_project"]["blind.spec.ts"] = "desktop-card"
    if change == "project": manifest["one_project"][manifest["one_card_mode"].pop()] = "desktop-typo"
    if change == "new": (directory / "new.spec.ts").write_text("export const anotherPath = true;")
    if change == "new-js": (directory / "new.spec.js").write_text("export const anotherPath = true;")
    if change in ("own-call", "own-use"):
        (directory / "blind.spec.ts").write_text("page.setViewportSize({width: 375});" if change == "own-call"
                                                 else "test.use({\n viewport: {width: 375}\n});")
    if change in ("blank-reason", "stale-reason"):
        manifest["own_size_allowed"]["blind.spec.ts"] = " " if change == "blank-reason" else "old reason"
    if change == "protected": manifest["one_card_mode"].append("L_auth/L3_password_toggle.spec.ts")
    if change == "setup":
        (directory / "setup").mkdir()
        (directory / "setup/fixture.spec.ts").write_text("")
        manifest["one_card_mode"].append("setup/fixture.spec.ts")
    save()
    with pytest.raises(AssertionError, match=message):
        validate_reduction(root)


@pytest.mark.parametrize("text, message", [
    ("await page.setViewportSize(size);\nconst editor = await context.newPage();", "new page needs size"),
    ("const editor = await context.newPage();\nawait first();\nawait second();\n"
     "await editor.setViewportSize(size);", "new page needs size"),
    ("const editor = await context.newPage();\n// await editor.setViewportSize(size);", "new page needs size"),
    ("if (fixture) await page.setViewportSize(size);", "conditional own-size"),
    ("if (fixture) { await page.setViewportSize(size); }", "conditional own-size"),
])
def test_one_project_inherited_or_conditional_size_fails(matrix_fixture, text, message):
    root, directory, manifest, save = matrix_fixture
    manifest["one_project"][manifest["one_card_mode"].pop()] = "desktop-card"
    (directory / "blind.spec.ts").write_text(text)
    save()
    with pytest.raises(AssertionError, match=message):
        validate_reduction(root)


@pytest.mark.parametrize("between", [" ", "\n", "\nawait prepare();\n"])
def test_one_project_new_page_sized_within_two_lines_passes(matrix_fixture, between):
    root, directory, manifest, save = matrix_fixture
    manifest["one_project"][manifest["one_card_mode"].pop()] = "desktop-card"
    (directory / "blind.spec.ts").write_text(
        "const editor = await context.newPage();" + between + "await editor.setViewportSize(size);")
    save()
    validate_reduction(root)


def test_conditional_size_waiver_keeps_project_widths(matrix_fixture):
    root, directory, manifest, save = matrix_fixture
    (directory / "blind.spec.ts").write_text("if (fixture) await page.setViewportSize(size);")
    manifest["own_size_allowed"]["blind.spec.ts"] = "Native cases retain the project width."
    save()
    validate_reduction(root)


@pytest.mark.parametrize("read", ["info.project.metadata.cardView", "info.project.name", "projectName",
                                  "const { name } = project;", "const { project } = info;",
                                  "setupCardView(page, 'big')"])
@pytest.mark.parametrize("import_form", ["import { value } from './first';", "export * from './first';",
                                       "require('./first');", "import('./first');"])
def test_transitive_card_or_project_reads_reject_reduction(matrix_fixture, read, import_form):
    root, directory, _, _ = matrix_fixture
    (directory / "blind.spec.ts").write_text(import_form)
    (directory / "first.ts").write_text("export * from './second';")
    (directory / "second.ts").write_text(read)
    with pytest.raises(AssertionError, match="reads card/project"):
        validate_reduction(root)


def test_width_reads_cycles_and_dormant_definition_remain_safe(matrix_fixture):
    root, directory, _, _ = matrix_fixture
    (directory / "helpers").mkdir()
    (directory / "helpers/view-switch.ts").write_text(
        "export async function setupCardView(page, cardView) {\n if (cardView === 'big') {}\n}\n")
    (directory / "blind.spec.ts").write_text("""import './helpers/view-switch';
import './cycle';
const a = info.project.metadata.screenWidth;
const b = info.project.use.viewport;
const c = /^(mobile|tablet)-/.test(info.project.name);
""")
    (directory / "cycle.ts").write_text("import './blind.spec';")
    validate_reduction(root)
    with (directory / "helpers/view-switch.ts").open("a") as stream:
        stream.write("const unexpected = info.project.metadata.cardView;\n")
    with pytest.raises(AssertionError, match="reads card/project"):
        validate_reduction(root)


@pytest.mark.parametrize("name", ["secret.ts", "token.ts", "password.ts", "credential.ts", "creds.ts",
                                  "sample.key", "sample.pem", "sample.env", ".env.local"])
def test_protected_imports_are_never_opened(matrix_fixture, monkeypatch, name):
    root, directory, _, _ = matrix_fixture
    blocked = directory / name
    blocked.write_text("info.project.metadata.cardView")
    (directory / "blind.spec.ts").write_text(f"import './{name}';")
    original = Path.read_text
    def guarded(path, *args, **kwargs):
        assert path != blocked, "protected file opened"
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", guarded)
    validate_reduction(root)


def test_t23_exception_is_only_its_own_skip(matrix_fixture):
    root, directory, manifest, save = matrix_fixture
    path = directory / T23
    path.parent.mkdir()
    path.write_text("test.skip(testInfo.project.name === 'mobile-card', 'Phone layout');")
    manifest["one_project"][T23] = "desktop-card"
    save()
    validate_reduction(root)
    path.write_text(path.read_text() + "\nconst newRead = testInfo.project.name;")
    with pytest.raises(AssertionError, match="reads card/project"):
        validate_reduction(root)


def test_project_resolution_and_own_size_waivers(matrix_fixture):
    root, directory, manifest, save = matrix_fixture
    (directory / "blind.spec.ts").write_text("page.setViewportSize({ width: 375 });")
    manifest["own_size_allowed"]["blind.spec.ts"] = "Legacy mixed-width user path."
    save()
    validate_reduction(root)
    assert resolve_spec_projects("blind.spec.ts", ["desktop-bigcard", "desktop-card", "tablet-bigcard"], manifest) == (
        "desktop-card",)
    assert resolve_spec_projects("blind.spec.ts", ["desktop-bigcard", "tablet-bigcard"], manifest) == (
        "desktop-card", "tablet-card")
    manifest["one_project"][manifest["one_card_mode"].pop()] = "desktop-card"
    manifest["own_size_allowed"].clear()
    save()
    validate_reduction(root)
    assert resolve_spec_projects("blind.spec.ts", ["mobile-bigcard"], manifest) == ("desktop-card",)
    assert resolve_spec_projects("setup/proof.spec.ts", ["desktop-bigcard", "mobile-card"], manifest) == (
        "desktop-bigcard", "mobile-card")
