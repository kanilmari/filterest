"""test_md_links.py
Exercise tracked Markdown destinations using disposable Git repositories.
Connect the read-only checker to CLI failures and the real checkout's docs.
Keep broken links out of ordinary QA without touching application services.
"""

import os
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
CHECKER = ROOT / "app/server_tools/scripts/check_md_links.py"


@pytest.fixture
def checkout(tmp_path):
    root = tmp_path / "checkout"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    return root


def track(root, name, content):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    subprocess.run(["git", "-C", str(root), "add", "--", name], check=True)


def check(root=None, **kwargs):
    return subprocess.run(
        [sys.executable, str(CHECKER), *([str(root)] if root is not None else [])],
        text=True, capture_output=True, timeout=10, **kwargs,
    )


@pytest.mark.parametrize("destination,target,reason", [
    ("target.md#heading", "# Heading\n", None),
    ("absent.md", None, "missing target"),
    ("target.md#absent", "# Heading\n", "missing anchor"),
    ("target.md#Heading", "# Heading\n", "anchor case differs"),
    ("target.md#heading-1", "# Heading\n# Heading\n", None),
    ("target.md#chosen", '<a id="chosen"></a>\n', None),
    ("target.md#named", '<a name="named"></a>\n', None),
    ("target.md#fenced", '```html\n<a id="fenced"></a>\n```\n', "missing anchor"),
    ("target.md#inline", '`<a id="inline"></a>`\n', "missing anchor"),
    ("target.md#hidden", '<!--\n<a id="hidden"></a>\n-->\n', "missing anchor"),
    ("target.md#indent", 'Text\n\n    <a id="indent"></a>\n', "missing anchor"),
    ("target.md#long", '````html\n```\n<a id="long"></a>\n````\n', "missing anchor"),
    ("target.md#item", '- item\n\n    <a id="item"></a> text\n', None),
    ("target.md#after", '<!-- note --> <a id="after"></a>\n', None),
    ("target.md#hidden-heading", '<!--\n# Hidden heading\n-->\n', "missing anchor"),
    ("target.md#visible", '<!--\n```\n-->\n\n<a id="visible"></a>\n', None),
    ("target.md#listcode", '- item\n\n      <a id="listcode"></a>\n', "missing anchor"),
    ("target.md#single", "<a id='single'></a>\n", None),
    ("../outside.md", None, "outside the checkout"),
])
def test_destinations(checkout, destination, target, reason):
    track(checkout, "README.md", f"# Docs\n[link]({destination})\n")
    if target is not None:
        track(checkout, "target.md", target)
    # An existing outside file must still be refused.
    (checkout.parent / "outside.md").write_text("# Outside\n")
    result = check(checkout)
    assert result.returncode == (1 if reason else 0), result.stdout + result.stderr
    assert f"{1 if reason else 0} broken" in result.stdout
    assert "checked 1 relative links" in result.stdout
    if reason:
        assert f"README.md:2: {destination} ({reason})" in result.stdout


@pytest.mark.parametrize("content", [
    "```markdown\n[ignored](absent.md)\n```\n",
    "~~~markdown\n[ignored](absent.md)\n~~~\n",
    "`[ignored](absent.md)` and ``[ignored](also-absent.md)``\n",
    "<!--\n[ignored](absent.md)\n-->\n",
    "Text\n\n    [ignored](absent.md)\n",
    "`` [ignored](absent.md) ` literal ``\n",
    '[https](https://example.invalid) [mail](mailto:a@example.invalid) '
    '[custom](custom+scheme:test) [ftp](ftp://example.invalid) '
    '[relative protocol](//example.invalid)\n',
])
def test_ignored_destinations(checkout, content):
    track(checkout, "README.md", content)
    result = check(checkout)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checked 0 relative links in 1 tracked Markdown files; 0 broken" in result.stdout


def test_existing_reference_html_and_path_rules(checkout):
    track(checkout, "docs/README.md", '[reference]: <../target%20file.md#heading>\n'
          '<a href="/target%20file.md?view=1#heading">link</a>\n'
          '[local](#local)\n# Local\n')
    track(checkout, "target file.md", "# Heading\n")
    result = check(checkout)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checked 3 relative links" in result.stdout


@pytest.mark.parametrize("content,line,destination", [
    # Indented code that looks like a fence opener must not swallow the next paragraph.
    ("Text\n\n    ```\n\n[broken](absent.md)\n", 5, "absent.md"),
    ("<a href='absent.md'>broken</a>\n", 1, "absent.md"),
])
def test_rendered_broken_links_are_reported(checkout, content, line, destination):
    track(checkout, "README.md", content)
    result = check(checkout)
    assert result.returncode == 1, result.stdout + result.stderr
    assert f"README.md:{line}: {destination} (missing target)" in result.stdout


def test_untracked_markdown_is_ignored(checkout):
    track(checkout, "README.md", "# Docs\n")
    (checkout / "untracked.md").write_text("[broken](absent.md)\n")
    result = check(checkout)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checked 0 relative links in 1 tracked Markdown files; 0 broken" in result.stdout


def test_not_a_checkout_fails(tmp_path):
    result = check(tmp_path)
    assert result.returncode != 0
    assert "Cannot list tracked Markdown files" in result.stderr
    assert "0 broken" not in result.stdout


def test_missing_git_fails(checkout, tmp_path):
    empty_path = tmp_path / "empty-bin"
    empty_path.mkdir()
    result = check(checkout, env={**os.environ, "PATH": str(empty_path)})
    assert result.returncode != 0
    assert "Cannot list tracked Markdown files" in result.stderr


def test_this_checkout_has_no_broken_links(tmp_path):
    # No checkout argument and an unrelated cwd prove the default follows the script.
    result = check(cwd=tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "tracked Markdown files; 0 broken" in result.stdout
