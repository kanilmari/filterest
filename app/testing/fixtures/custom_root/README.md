<!-- README.md
Documents the manual K378 native proof and fixture lifecycle.
Connects the administrator storage path, helper and dedicated Playwright config.
Keeps operator-file and shared-setting restoration instructions beside the fixture. -->
# Manual K378 custom root proof

The custom root spec (`T_admin/T18_custom_root_page.spec.ts`) changes two shared
switches and temporarily hides an operator file. Run it **alone**, natively,
against this worktree's rebuilt development target. It is excluded from both
ordinary and setup-enabled matrices, nightly runs and relevant-check browser
selection through `testing/e2e/manual-specs.json`. The dedicated config rejects
CI runs, requires the fixture, uses one Chromium worker, disables retries and
trace, and retains the standard timeout. Do not override these settings.

As an administrator, open **Site settings → Home settings** and read the
displayed index.html path. The same private path is returned as `site_root.path`
by `GET /api/admin/front-page`. Use its containing `site_root` directory below;
do not infer a storage location from a different installation. The helper runs
on the native server's machine and makes no network/database calls.

```bash
(
set -e
# Repository root; replace this example with the administrator-reported directory.
export FILTEREST_E2E_CUSTOM_ROOT_FIXTURE=/absolute/storage/site_root
helper=app/testing/e2e/T_admin/T18_custom_root_fixture.sh
bash "$helper" place "$FILTEREST_E2E_CUSTOM_ROOT_FIXTURE"
# The outer trap also covers config/startup failures; cleanup is idempotent.
trap 'proof_status=$?; bash "$helper" remove "$FILTEREST_E2E_CUSTOM_ROOT_FIXTURE" || proof_status=1; exit "$proof_status"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
FILTEREST_E2E_BASE_URL=https://localhost:8082 PLAYWRIGHT_HTML_OPEN=never \
  ./filterest test --config=playwright.custom-root.config.ts --workers=1
)
```

The explicit worker argument also prevents the public launcher's automatic
worker count from overriding this manual config. Placement refuses existing files, including an existing
operator index.html, symlinks and hidden-file collisions. The five placed files
(HTML, CSS, JS, SVG and an intentionally refused JSON probe) and their identities
are recorded in an ownership manifest. `verify` fails for missing/changed files;
`hide`/`show` move only the owned index without overwriting a destination;
`remove` preserves unrelated files, original directories and operator
replacements. A changed owned file causes a loud refusal; inspect it before
retrying rather than deleting it by filename.

The fixture links to the existing administrator dataset `/system_config`; it
creates no dataset. Dedicated setup signs in with the established protected
administrator credentials and returns to that dataset even when custom Home
was already enabled. It uses separate owner-only login state and removes that
state and the fixture on exit, including setup failures. Each browser run reads
the original custom-page switch, browse-login requirement and account theme
before mutation. Final cleanup attempts each restoration independently, also
restoring an absent switch/theme row as absent, and verifies the results.

Assertions cover disabled fallback; signed-in and public delivery; CSS/script/
image execution; GET/HEAD CSP/cache policy; anonymous and retained-guest denials
with queries; raw traversal/encoded separators/unknown types; Home's single
document load without SPA Home flash; Back/Forward and Home after Back; missing
index fallback without reload loops; and administrator save/status in explicit
light and dark themes over the opposite OS preference. Neither absent fixtures
nor signed-out refusals can silently skip a proof. A killed process cannot run
browser cleanup: retain `original-k378-settings.json` in the test's result
directory (also attached to its report), and restore its original values through the administrator UI/API before
another run; the shell helper still owns file cleanup.

Offline ownership/selection regressions require no instance or browser:

```bash
data/runtime/python/venv/bin/python -m pytest \
  app/testing/python/test_custom_root_proof_tooling.py
```
