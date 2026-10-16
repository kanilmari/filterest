"""test_import_boundaries.py
Enforce frontend layering and browser-native module imports in the public suite.
Connect strict source guards to ordinary platform-tooling test selection.
Protect native startup as well as root resolution outside this checkout.
"""

from pathlib import Path
import subprocess

import pytest

from python_category_support import category_for_path
from python_test_tiers import tier_for_path
from relevant_check_discovery import FRONTEND_ROOTS, frontend_import_inventory, frontend_imports, source_files


ROOT = Path(__file__).resolve().parents[3]


def css_module_imports(source):
    """Find literal stylesheet module references, preserving source line numbers."""
    return sorted((line, name) for line, name in frontend_imports(source)
                  if name is not None and name.split("?")[0].split("#")[0].lower().endswith(".css"))


def test_shipped_frontend_modules_do_not_import_css():
    violations = []
    files = [file for directory in FRONTEND_ROOTS
             for file in source_files(ROOT, directory, {".js", ".mjs"})
             if not file.name.endswith((".test.js", ".test.mjs"))]
    for owner, imports in frontend_import_inventory(ROOT, files).items():
        for line, name in imports:
            if name is not None and name.split("?")[0].split("#")[0].lower().endswith(".css"):
                violations.append(f"{owner}:{line}: {name}")
    assert not violations, (
        "Native browsers cannot load CSS as JavaScript modules. Register component "
        "styles with @import in app/frontend/styles/imports.css, linked by "
        "frontend/index.html and bundled by frontend/vite.config.mjs; see "
        "Frontend_Coding_Conventions.md section 7.\n" + "\n".join(violations)
    )


@pytest.mark.parametrize("statement", [
    "import './article_view_access.css';",  # The K379 native-startup regression.
    'import styles from "./component.css";',
    "import { sheet } from './component.css';",
    "import * as styles from './component.css';",
    "import\n/* component styles */ './component.css';",
    "export { default } from './component.css';",
    "export * from './component.css';",
    "await import('./component.css');",
    "await import('./component.css', { with: { type: 'css' } });",
    "await import(`./component.css`);",
    "require('./component.css?inline#sheet');",
])
def test_css_module_guard_catches_stylesheet_imports(statement):
    assert css_module_imports("// header\n" + statement)


def test_css_module_guard_allows_javascript_and_ignores_comments():
    assert css_module_imports("""
        // import './comment.css';
        /* export * from './comment.css'; */
        import { bindArticleViewActivation } from './article_view_access.js';
        const stylesheet = './article_view_access.css';
        await import('./component.js');
    """) == []


def test_article_access_styles_use_the_shared_native_and_bundle_entry():
    imports = (ROOT / "app/frontend/styles/imports.css").read_text()
    entry = '@import url("../core_components/table_views/card_view/article_view_access.css");'
    assert imports.count(entry) == 1
    # Permission overrides follow the views whose hover/cursor rules they replace.
    for view in ("card_view/cards.css", "product_card_view/product_card_view.css",
                 "calendar_view/calendar_view.css"):
        assert imports.index(entry) > imports.index(view)


def test_import_boundary_guard_belongs_to_ordinary_platform_tooling():
    path = Path(__file__)
    assert tier_for_path(path) == "ordinary"
    assert category_for_path(path) == "platform-tooling"


def test_strict_import_boundaries_from_unrelated_working_directory(tmp_path):
    root = Path(__file__).resolve().parents[3]
    script = root / "app/server_tools/scripts/check_import_boundaries.sh"
    working_directory = tmp_path / "unrelated" / "working_directory"
    working_directory.mkdir(parents=True)

    result = subprocess.run(
        ["bash", str(script), "--strict"],
        cwd=working_directory,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
