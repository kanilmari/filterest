# E2E Testing Guide

Playwright E2E tests for Easelect. Tests live in `testing/e2e/`.

## Quick Reference

```bash
# Run a specific test file
npx playwright test testing/e2e/T_admin/T7_card_visibility.spec.ts --project=desktop-card

# Run all tests for one project
npx playwright test --project=desktop-card

# Run tests matching a name pattern
npx playwright test -g "can navigate" --project=desktop-card

# Run serially (debugging)
npx playwright test testing/e2e/T_admin/T7_card_visibility.spec.ts --project=desktop-card --workers=1

# Serve the last HTML report manually without auto-opening a browser
python3 -m http.server 9323 -d testing/playwright-report
# then inspect http://127.0.0.1:9323 manually if you actually want the UI
```

For broad non-interactive runs, prefer:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test --project=desktop-card
```

For deterministic full-matrix baselines and long unattended runs, prefer:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test --workers=1 --reporter=list
```

Why this is the safest broad baseline:

- `--workers=1` reduces cross-test mutation overlap when specs create and delete datasets through the real admin APIs.
- `--reporter=list` keeps progress visible in logs without relying on the HTML report UI.
- `PLAYWRIGHT_HTML_OPEN=never` prevents the runner from blocking on report opening in long local runs.
- `npx playwright show-report` is intentionally not the default agent path here, because upstream always tries to open a browser window.

Local timing varies by machine and app state, but a full 6-project matrix run is on the order of tens of minutes, not hours. Plan overnight loops around multiple reruns rather than a single all-night pass.

## Test Matrix

Every spec runs in 6 combinations automatically (see `playwright.config.ts`):

| Project | Viewport | Card View |
|---------|----------|-----------|
| `mobile-card` | 375×667 | normal |
| `mobile-bigcard` | 375×667 | big |
| `tablet-card` | 768×1024 | normal |
| `tablet-bigcard` | 768×1024 | big |
| `desktop-card` | 1440×900 | normal |
| `desktop-bigcard` | 1440×900 | big |

Use `--project=desktop-card` during development. No active GitHub Actions workflow currently runs the Playwright matrix or Visual Guardian; run the relevant commands locally when a change touches browser behavior or layout.

## Runner Artifacts

- General E2E HTML report: `testing/playwright-report`
- General E2E retry traces and Playwright outputs: `testing/test-results`
- Visual Guardian screenshots captured for AI analysis: `testing/test-results/visual_guardian`
- Visual Guardian failure-page HTML snapshots: `testing/test-results-visual/<test-output-dir>/page-source.html`

The Visual Guardian screenshot flow now reuses the authenticated E2E storage state from `testing/e2e/global-setup.ts`, so screenshot captures should reflect a logged-in, app-ready UI rather than an unauthenticated shell by default.

## Authentication

Global setup (`testing/e2e/global-setup.ts`) logs in once, verifies the exact non-guest username/user id, and saves the session to `.auth/user.json` with owner-only permissions. All tests share this session via `storageState`; normal teardown and failures after this process has acquired the artifact run remove its auth state. A runner rejected as foreign does not remove another process's state.

The same global setup/teardown path owns an exclusive artifact-run registry and a complete pre-run baseline:

- setup never deletes a dataset or folder merely because its name looks synthetic
- a creating test registers a `planned` name before the request and confirms it only after reading the exact server id (`table_uid` or folder id)
- teardown deletes only exact current-run `confirmed` identities after re-reading server inventories; missing baselines, mismatched targets/users, corrupt registries, and ambiguous `planned` entries fail closed before cleanup
- the full language-key set must return exactly to the setup baseline, and drift reports the exact added or removed keys
- separate Playwright commands must not run concurrently against the shared `.auth` registry; an active, stale, or corrupt foreign run is rejected for inspection rather than guessed away
- teardown mutates the registry, artifacts, and shared auth state only when the recorded PID and per-process nonce match its own process identity; this prevents PID reuse from claiming ownership, and a runner whose setup was rejected as foreign performs no teardown cleanup

Native full-matrix runs default to two Playwright workers so simultaneous
browsers do not saturate the local app/database and produce unrelated timeout
clusters. `PLAYWRIGHT_WORKERS=<positive integer>` may override the local limit;
CI remains serialized at one worker.

Healthy end state after a normal run:
- zero remaining artifacts confirmed as owned by the run
- zero ambiguous planned artifacts
- the exact dataset, folder, and language-key baseline restored
- `.auth/user.json`, the baseline, and the completed run registry removed

The `login()` helper from `helpers/auth.ts` handles:
- Navigating to `/` and waiting for the app to load
- Fallback login if the session expired (username and password from `dev_env_test_creds.txt`)
- Reading the explicit OTP from the test process `LOGIN_OTP_CODE`, ignored
  native development env, or finally the native runtime env resolved through
  `EASELECT_KEY_ROOT`; missing configuration fails before a browser auth
  timeout, and there is no hardcoded backend default

Playwright also injects `X-Bypass-Ratelimit: test-mode` in two places:

- `playwright.config.ts` for normal test project requests
- `testing/e2e/global-setup.ts` for the one-time login/bootstrap context

This header is not only for rate limits. In development, the backend translation route uses it as a hard guardrail: `/api/generateTranslations` returns an empty JSON array immediately in test mode instead of calling an external LLM provider. This keeps normal Playwright runs out of Anthropic/OpenAI billing paths even if the frontend notices missing lang keys during the test.

Important nuance: when `login_to_browse=false`, landing on `/` does not prove the browser is authenticated. `login()` should confirm a non-guest session via `/api/user-profile` instead of trusting URL state alone.

```typescript
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

let credentials: TestCredentials;
test.beforeAll(() => { credentials = loadCredentials(); });
test.beforeEach(async ({ page }) => { await login(page, credentials); });
```

## Critical Patterns

### 0. Shared Helpers And Stable Anchors First

When a navigation or interaction pattern repeats across E2E files:

- Prefer adding or reusing helpers in `testing/e2e/helpers/` instead of copy-pasting raw selector logic.
- Prefer stable `data-testid` anchors over CSS classes, translated text, or deep DOM structure.
- If a recurring UI surface is hard to target reliably, fix the test seam in the app or helper layer first, then write more specs on top of it.

This keeps long-lived Playwright knowledge in helper modules and docs instead of scattering fragile ad hoc patterns across tickets.

### 0.1 Required Dataset/View Helpers Should Fail Loudly

`navigateToDataset()` and `switchToView()` are for tests that require a specific dataset or view. They now fail loudly by default if the requested tab or view control is missing, instead of silently falling back to something else.

Use the explicit fallback paths only when fallback is the test's real intent:

- `navigateToDefaultDataset(page)` when any loaded dataset is acceptable
- `navigateToDataset(page, tableName, { allowFallback: true })` only for legacy fallback behavior
- `switchToView(page, viewMode, { allowMissing: true })` only when the test intentionally treats the view as optional and will handle that branch itself

This prevents false-green tests that accidentally exercised the wrong dataset or stayed in the wrong view.

### 0.2 Prefer Temp Datasets For Isolated CRUD And Persistence Flows

When a spec needs destructive CRUD, seeded rows, or a true persistence round-trip, prefer creating a throwaway dataset through the app APIs instead of mutating long-lived shared fixtures.

- Use `testing/e2e/helpers/temp-dataset.ts` to create, seed, open, and drop the dataset inside the test.
- Keep the dataset unique per run, register its planned/confirmed identity through `temp-dataset.ts`, and clean it up in `finally`, even when assertions fail.
- For admin-flow tests that create datasets through the visible UI instead of the temp-dataset helper, add a request-scoped `afterEach` cleanup path so the dataset is still dropped if the page flow breaks before the in-test delete step.
- Use this pattern for create/delete persistence checks, dataset-specific view assertions, and any flow where a shared dataset could hide flaky state leakage.
- If the test depends on a non-table view, inject the requested view preference before opening the dataset so the first landing surface matches the assertion target.
- Prefer opening throwaway datasets through the real sidebar `nav-view-*` route when available. Newly created datasets may exist in the database tree before they appear as top tabs, so tab-only helpers are too strict for this path.

This keeps destructive E2E flows isolated from built-in datasets and reduces coupling to hand-maintained fixtures.

### 0.3 Keep Synthetic Test Lang Keys Out Of AI Translation Work

The frontend translation layer can notice missing `data-lang-key` values during E2E runs. That is normal. The important rule is to keep synthetic test-only keys clearly synthetic.

- If a test invents transient lang keys, dataset names, or folder labels only for automation, prefer the `e2e_...` or `e2e-...` prefix.
- The frontend translation handler treats those prefixes as synthetic and skips them before enqueueing AI translation fetches.
- Keys named `test_*` are not currently treated as synthetic by that frontend filter. They are still safe in Playwright because test mode makes the backend return `[]`, but they can create noisy `/api/generateTranslations` requests and logs during long runs.
- E2E assertions must never depend on live AI-generated translations appearing during the test. Assert seeded translations, fallback text, or explicit empty-response behavior instead.

### 1. Fixed Sidebar (`#navbar` — `position: fixed`)

**Problem:** The sidebar is `position: fixed` with `overflow-y: auto`. Playwright's `scrollIntoViewIfNeeded()` and `click()` fail with "element is outside of the viewport" because Playwright tries to scroll the page, not the sidebar container.

**Solution:** Use `page.evaluate()` for ALL sidebar interactions:

```typescript
// ✅ CORRECT — use evaluate() for fixed sidebar elements
await page.evaluate(() => {
  const btn = document.querySelector('button.collapsible[data-group="admin_tools"]') as HTMLElement;
  if (btn) {
    btn.scrollIntoView({ block: 'center' }); // scrolls within #navbar
    if (btn.getAttribute('aria-expanded') !== 'true') {
      btn.click();
    }
  }
});

// ❌ WRONG — will fail with "outside of the viewport"
const btn = page.locator('button.collapsible[data-group="admin_tools"]');
await btn.click(); // Error!
await btn.scrollIntoViewIfNeeded(); // Doesn't help — scrolls page, not sidebar
await btn.click({ force: true }); // Also fails
```

### 2. Vanilla Tree Expansion

The vanilla tree component (`reusable_components/vanilla_tree/`) stores children in `<div class="children" style="display:none">`. Folder nodes have `data-is-folder="true"`, leaf nodes have `data-is-folder="false"`.

**Expanding folders:** The `initial_open_level` config only auto-opens the first N levels. Deeper folders must be expanded manually:

```typescript
await page.evaluate(() => {
  const tree = document.getElementById('my_tree_id');
  if (!tree) return;
  const folders = tree.querySelectorAll('.node[data-is-folder="true"]');
  for (const folder of folders) {
    const childrenDiv = folder.querySelector(':scope > .children') as HTMLElement;
    if (childrenDiv && childrenDiv.style.display === 'none') {
      childrenDiv.style.cssText = 'display:block;overflow:hidden;';
    }
  }
});
```

**Node IDs:** Format is `tree_node_{id}_{suffix}` where suffix comes from the tree's `id_suffix` config (e.g. `_admin`, `_cv_tree`).

### 3. Checkbox Event Chain

Simply setting `cb.checked = true` is NOT enough. The tree's event handling requires a proper `change` event dispatch to trigger `handle_checkbox_change` → `collectSelectedLeafNodesWithFolders` → `checkboxSelectionChanged` custom event.

```typescript
// ✅ CORRECT — dispatch change event after setting state
cb.checked = true;
cb.dispatchEvent(new Event('change', { bubbles: true }));

// ❌ WRONG — just toggles the DOM, no event chain fires
cb.checked = true; // Nothing happens in the app
```

### 4. Admin Tools Tree Navigation

The admin sidebar tree uses `render_mode: 'button'` with `id_suffix: '_admin'`. Leaf button selectors:

```typescript
// Button class follows pattern: 'general_button' + id_suffix
// So admin tree buttons have class 'general_button_admin'
const selector = '#admin_tools_tree button.general_button_admin[data-lang-key="view_name"]';
```

Folder nodes use label spans with `data-lang-key`:
```typescript
// Expanding a folder node
const label = node.querySelector('.node-row span[data-lang-key="maintenance"]');
label.click(); // toggles children visibility
```

### 5. Avoiding Page Reload

**Problem:** `page.reload()` causes "Failed to fetch" network errors in the SPA because in-flight API calls (translations, CSRF, fingerprint check) are aborted.

**Solution:** Verify persistence by deselecting and reselecting data (triggers a fresh API call) instead of a full page reload:

```typescript
// ✅ CORRECT — deselect + reselect triggers fresh GET from server
await page.evaluate(() => {
  const tree = document.getElementById('the_tree');
  const checked = tree.querySelectorAll('input[type="checkbox"]:checked');
  checked.forEach(cb => {
    (cb as HTMLInputElement).checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
});
await page.waitForTimeout(500);
await selectFirstTable(page); // re-selects → fresh API call

// ❌ RISKY — causes network errors in SPA
await page.reload();
```

### 6. `waitForSelector` — Visibility vs Attachment

**Problem:** `page.waitForSelector(sel)` defaults to `state: 'visible'`. If the first matching element in DOM order is hidden (e.g. `[data-lang-key]` inside a collapsed dropdown), the wait can time out even though hundreds of matching elements are visible elsewhere on the page.

**Solution:** Use `state: 'attached'` when you only need the element to exist in the DOM, or use a more specific selector that targets a visible element:

```typescript
// ✅ CORRECT — waits for DOM presence, not visibility
await page.waitForSelector('[data-lang-key]', { state: 'attached', timeout: 15000 });

// ✅ ALSO CORRECT — more specific selector targets a visible element
await page.waitForSelector('.scrollable_content [data-lang-key]', { timeout: 15000 });

// ❌ RISKY — first match may be hidden (e.g. <label> in collapsed language dropdown)
await page.waitForSelector('[data-lang-key]', { timeout: 15000 });
```

## File Organization

```
testing/e2e/
├── global-setup.ts    — Login once, save session, clean stale synthetic artifacts, capture lang-key baseline
├── global-teardown.ts — Verify synthetic artifacts and lang keys returned to the setup baseline
├── helpers/
│   ├── auth.ts        — login(), loadCredentials()
│   ├── navigation.ts  — waitForAppReady(), navigateToDataset()
│   ├── temp-dataset.ts — isolated throwaway dataset helpers
│   └── view-switch.ts — switchToView(), openBigCard()
├── A_row_crud/        — Row CRUD and selection tests
├── D_view_switch/     — View, theme, and mobile menu tests
├── G_navigation/      — Sidebar, tabs, history, and custom view tests
├── T_admin/           — Admin tool tests
│   ├── T1_create_table.spec.ts
│   ├── T2_delete_table.spec.ts
│   ├── ...
│   └── T12_storage_deleted_prune.spec.ts
└── ...
```

## Writing a New Admin View Test

1. Use `page.evaluate()` for all sidebar navigation (fixed positioning)
2. Wait for the view container with `await expect(page.locator('#container_id')).toBeVisible()`
3. For tree-based views, expand folders via JS before interacting with leaf nodes
4. Always dispatch `change` events when programmatically toggling checkboxes
5. Clean up test data inside the test when the cleanup is bounded to a known step; for admin specs that create datasets and could fail mid-flow, prefer request-scoped `afterEach` cleanup helpers (see `testing/e2e/helpers/temp-dataset.ts` and the pattern used in `testing/e2e/T_admin/T1_create_table.spec.ts`)

See `T7_card_visibility.spec.ts` as a complete reference for admin view testing.

## Tickets vs Docs

Keep durable E2E strategy here and in `DEV_GUIDE.md`, not only in umbrella tickets.

- Put project-wide rules here: helper-first patterns, selector strategy, SPA constraints, report usage, and how Playwright fits with Vitest and Visual Guardian.
- Put ticket-specific leftovers in tickets: uncovered workflows, missing verification, flaky cases, or one-off regressions that still need implementation.
