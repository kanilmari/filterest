<!-- E2E_Testing_Guide.md
What: Documents Filterest's end-to-end browser test workflow and contracts.
Between what: Connects the standalone installation, Playwright, and protected test credentials.
Why: Keeps browser verification portable without coupling public source to Easelect.
-->
# E2E Testing Guide

Playwright E2E tests for Filterest. Tests live in `app/testing/e2e/`.
Run the commands below from the public Filterest product root. The public
command executes Playwright against immutable `app/` while keeping dependencies,
caches, reports, and authentication state in installation-owned `data/`.

The standalone product command defaults browser tests to
`https://localhost:8100`. Set `FILTEREST_E2E_BASE_URL` to another
credential-free local HTTPS origin only when intentionally testing a different
local Filterest runtime; the older `EASELECT_E2E_BASE_URL` name remains a
compatibility fallback only for structurally embedded Easelect development
tooling. A standalone checkout ignores that legacy Easelect-only variable.

## Quick Reference

The [manual K378 custom root proof](../../testing/fixtures/custom_root/README.md)
uses its own config and owned native fixture. Ordinary, setup-enabled, nightly
and relevant-check browser runs exclude it.

```bash
# Run a specific test file
./filterest test testing/e2e/T_admin/T7_card_visibility.spec.ts --project=desktop-card

# Run all tests for one project
./filterest test --project=desktop-card

# Run tests matching a name pattern
./filterest test -g "can navigate" --project=desktop-card

# Run serially (debugging)
./filterest test testing/e2e/T_admin/T7_card_visibility.spec.ts --project=desktop-card --workers=1

# Serve the last HTML report manually without auto-opening a browser
python3 -m http.server 9323 -d data/testing/playwright-report
# then inspect http://127.0.0.1:9323 manually if you actually want the UI
```

For broad non-interactive runs, prefer:

```bash
PLAYWRIGHT_HTML_OPEN=never ./filterest test --project=desktop-card
```

For deterministic full-matrix baselines and long unattended runs, prefer:

```bash
PLAYWRIGHT_HTML_OPEN=never ./filterest test --workers=1 --reporter=list
```

Why this is the safest broad baseline:

- `--workers=1` reduces cross-test mutation overlap when specs create and delete datasets through the real admin APIs.
- `--reporter=list` keeps progress visible in logs without relying on the HTML report UI.
- `PLAYWRIGHT_HTML_OPEN=never` prevents the runner from blocking on report opening in long local runs.
- Playwright's `show-report` command is intentionally not the default agent path here, because upstream always tries to open a browser window.

Local timing varies by machine and app state, but a full 6-project matrix run is on the order of tens of minutes, not hours. Plan overnight loops around multiple reruns rather than a single all-night pass.

### Reserved development accounts and identity

Development startup reconciles reserved accounts by their exact private login names,
`test_admin` and `test_user`, in one administrator transaction. Their public
names may differ: administrators receive `admin_<n>`, and a new ordinary fixture
receives `user_<n>` when the site requires different names. Existing ordinary
fixtures keep their names. Browser helpers compare the numeric account id
returned by the successful credential/factor response and matched by the profile;
a different signed-in session cannot establish that identity. The owner-only
runtime identity file records ids and HMACs of credentials, never private login
names. Global setup clears it each run and generates
`FILTEREST_E2E_IDENTITY_HMAC_KEY` when absent; workers inherit this per-run key.

An old public reserved-name row without credentials stops development startup
with its numeric id. It is never adopted automatically. Use an existing
administrator and the supported account row API to rename that public display
name, or delete the orphan if it is unneeded (resolve its references first),
then restart development. If the service cannot start, use a production-like
runtime temporarily with reserved development-administrator environment values
unset, restore administrator access with the operator recovery tool if needed,
and perform the same API repair. Do not patch the database directly.
Production-like startup purges credentialed reserved accounts atomically and
leaves such ambiguous public orphans untouched.

### Leftover browsers and other sessions

`./filterest test` (`app/server_tools/scripts/safe_test.sh`) finds Playwright in
the installation's own dependency folder (`FILTEREST_NODE_MODULES_ROOT`) before
`PATH`, and names the setup command when it is missing. After Playwright exits,
it ends only the leftover browser processes **this run** started: every process
of the run inherits a per-run marker in its environment, and the cleanup signals
only processes that carry that marker. Playwright launches browsers detached
into their own sessions, so neither the process tree nor the process group
identifies them; the marker survives both. Another session's browsers are never
touched, even when they start during this run. Where process environments
cannot be inspected (no `/proc`), the cleanup is skipped rather than guessed.

A maintenance shell may keep a thin command of its own that sets the dependency
folder, the test target and the credential file, then calls this harness.

## Test Matrix

Every spec runs in 6 combinations automatically (see `app/playwright.config.ts`):

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

- General E2E HTML report: `data/testing/playwright-report`
- General E2E retry traces and Playwright outputs: `data/testing/test-results`
- Visual Guardian screenshots captured for AI analysis: `data/testing/test-results/visual_guardian`
- Visual Guardian failure-page HTML snapshots: `data/testing/test-results-visual/<test-output-dir>/page-source.html`

These mutable files default below the public product root's `data/testing/`
directory, never inside immutable `app/`. Set `FILTEREST_TEST_RUNTIME_ROOT` only
when a separate mutable test-runtime location is needed; the selected path must
remain outside `app/`.

U1 and U2 test the development CSV endpoints, which write and re-read a file on the
native server rather than download it in the browser. The export reply identifies
the actual file: standalone installations use `data/runtime/tables_data/`, while
legacy native layouts use `tables_data/` under the server's installation root.
The test uses the existing project-boundary resolver and accepts only its exact,
previously absent CSV in those locations. The resolver rejects a leaf symlink and
records the reported regular file's device and inode; reads use a non-following
open and verify that identity before reading bytes. Before dataset teardown,
cleanup removes only the reported file with that same identity, including after
assertion failures. Replacements are left untouched and reported as cleanup
failures; files without a valid export reply, including partial exports, and the
unused candidate remain untouched. U1 and U2 must run against the local native instance
whose filesystem the test process can read; a separate test-output directory does
not relocate CSVs.

### Measuring page-load network waste

Use a cold Playwright page with `waitUntil: 'domcontentloaded'` and listen to
`request`/`response`/`requestfailed`. Count unique `/api/translations` and
`/api/datasets` GETs, cancelled catalog PNG URLs, 404s (especially
`codex-query`), and whether catalog/background URLs use `300`/`1000`/`2160`
instead of `original`. Compare LNCD and a production Network capture; script
count is not comparable across unbundled vs bundled builds. See
[DEV_GUIDE.md](DEV_GUIDE.md) § Page-load network waste for the 2026-09-14
baseline and the LNCD #888 before/after notes.

Administrator pages keep an update-notice SSE stream open for up to 60 seconds.
Network idle therefore cannot establish readiness. The shared
`server_tools/lib/browser_view_readiness.mjs` waits for shell boot, loaded fonts,
visible busy indicators, requested images and finite visible animations;
offscreen lazy images and infinite decoration do not block it. C11 additionally
waits for its started storage media requests and requires sized media to have
been requested, so an empty early capture cannot pass.

Geometry comparisons must first await the active filterbar's saved-layout
promise, then rendering readiness. E13 retains exact before/open/closed
geometry assertions, including control, hero and search-row heights to locate
any remaining movement. A settling timeout fails instead of returning a guess.

Dataset navigation retains mounted listings and their viewport (G7). Q2 checks
that a first visit to an explicitly different dataset starts at zero using
that dataset's visible scroll container; the previous dataset keeps its own
position. Never select an ordinal tab or read a global first scroll container.
Likewise, P3 identifies seeded table rows by their row IDs: newest-first sorting
does not preserve insertion order. Selection, text and editor-size assertions
still check the same fixture content.

`app/testing/e2e/helpers/storage-media-requests.ts` counts `/storage/.../(original|300|1000|2160)/`
URLs from a captured request list. `C11_network_media_variants.spec.ts` uses it on
a local home/catalog load and asserts raster originals stay at zero. SVG/GIF
originals are reported separately; article/lightbox/download slots may still
request original after a user opens full-size media.


The Visual Guardian screenshot flow now reuses the authenticated E2E storage state from `app/testing/e2e/global-setup.ts`, so screenshot captures should reflect a logged-in, app-ready UI rather than an unauthenticated shell by default.

## Authentication

Global setup (`app/testing/e2e/global-setup.ts`) logs in once using the private
login name in the credential file, verifies the numeric non-guest account id
against the profile, and saves the session to `data/testing/e2e/.auth/user.json`
with owner-only permissions. The profile's `username` is a public display name
and is not credential evidence. All tests share this session via `storageState`;
normal teardown and failures after this process has acquired the artifact run
remove its auth state. A runner rejected as foreign does not remove another
process's state.

A test that signs out must sign in with its own session
(`test.use({ storageState: { cookies: [], origins: [] } })`, as
`L_auth/L2_logout.spec.ts` does). Signing out revokes that one sign-in on the
server, so signing out of the shared session leaves every later test and the
global teardown with a refused session, and the teardown then cannot release
the run record.

The same global setup/teardown path owns an exclusive artifact-run registry and a complete pre-run baseline:

- setup never deletes a dataset or folder merely because its name looks synthetic
- a creating test registers a `planned` name before the request and confirms it only after reading the exact server id (`table_uid` or folder id)
- teardown deletes only exact current-run `confirmed` identities after re-reading server inventories; missing baselines, mismatched targets/users, corrupt registries, and ambiguous `planned` entries fail closed before cleanup
- added language keys are retained only when their generated name maps to exactly one confirmed dataset owned by this run, including completed per-test datasets kept in registry history. Dataset shapes are `D`, `D_front_page`, `add_row_D`, `search_for_D`, and `search_slogan_D`. Column shapes are `C`, `C_asc`, `C_desc`, and `search_for_C`, using that dataset's recorded actual column names. An `_assets` child must be explicitly registered or confirmed before its parent's drop by authenticated `/api/asset-linking/status?table=D` metadata naming that owned parent and exact child, with a stable child UID and recorded columns; its parent-reference column belongs to the child. Failed reads never infer ownership from the suffix. No name prefix grants ownership. Every counting source must belong to the uniquely matched dataset or be the translations table's exact foreign-key reference; `orphan` and `manual_crud` do not count. After drops, a complete empty or bookkeeping-only source inventory needs confirmed completed ownership history. A missing/unavailable inventory fails closed. Every other addition (including a migration key), ambiguous name and every removal fails; teardown never deletes language keys
- the temp-dataset helper records creation columns immediately after confirming ownership, and reads current columns with a matching dataset UID before dropping a dataset, including managed asset children. Immutable column records survive drops in the run's `dataset-columns` directory. Tests adding columns should confirm the same dataset identity again with the new column names, or capture its current metadata with `recordTestDatasetColumnsFromRequest` before dropping it. Retention reports include `retainedOwnRunLangKeyEvidence` with each key's dataset, recorded column when applicable, ownership history and source-inventory explanation; failures clear accepted evidence and preserve unexplained additions/removals separately
- teardown prints retained key counts and names, including zero, and writes `retainedOwnRunLangKeyCount` and `retainedOwnRunLangKeys` to `data/testing/e2e/lang-key-retention/<runId>.json` for nightly totals (under `FILTEREST_TEST_RUNTIME_ROOT` when overridden). The report and log include `status` (`complete` or `incomplete: <reason>`). Owned-run failures from preflight through finalization report incomplete with zero accepted keys. A finalization failure rewrites and re-logs the report once, moving earlier accepted keys to `unverifiedOwnRunLangKeys`; a failed rewrite is not retried and cannot replace the finalization error. Report-write/rewrite failures are the reporting boundary. An unreadable baseline reports empty key lists; source-read candidates stay unverified
- teardown releases each active artifact entry as soon as cleanup confirms absence by its recorded stable identity, even if a later cleanup/inventory read or drift comparison fails. Deletion responses alone do not release entries; the dataset name and UID inventories or folder-id inventory must prove absence. Those confirmations reach teardown before the helper's language-key inventory read, so that read cannot strand proven cleanup. Entries without confirmation remain for stale-run recovery. A failed sequence still keeps the completed ownership history and baseline for inspection; a secondary reporting failure cannot replace the original sequence failure
- even a history-only run directory blocks startup. After cleanup has started and the report is written/logged, teardown copies an empty failed run's registry history and baseline to `data/testing/e2e/lang-key-retention/<runId>.evidence/` and releases its active run record. A preflight failure starts no cleanup, releases or archives nothing, and leaves the run record and all baseline/ownership evidence in place for inspection. The shared baseline stays until the next setup replaces it and does not block startup; its diagnostic copy survives that replacement. Success releases history and baseline after reporting, as before. A report-write failure keeps the run record and evidence for inspection
- separate Playwright commands must not run concurrently against the shared `.auth` registry; a live owner or recording worker, corrupt state, and unfinished registry files still refuse startup
- teardown mutates the registry, artifacts, and shared auth state only when the recorded PID and per-process nonce match its own process identity; this prevents PID reuse from claiming ownership, and a runner whose setup was rejected as foreign performs no teardown cleanup

Before initializing a new run, setup automatically recovers a dead run's recorded
datasets. An exclusive startup lock covers inspection, fresh test-administrator
login, recovery and initialization, so another Playwright command cannot start
during recovery. The current pointer and descriptor must agree on PID, nonce,
run id, start time and target identity; the owner and every recorded worker PID must be dead.
An abandoned startup lock is reclaimed only after its exact PID/nonce owner is
proved dead. A corrupt or unfinished lock still refuses.

At run start, setup logs in once and captures the normalized base URL and the
persistent `database_id` of the singleton `system_database_identity` row through
`/api/get-results`. The existing administrator-only `/api/admin/version-info`
route verifies administrator access; software versions are not installation
identities. Both run descriptor and current pointer retain this target before
the run is published. Recovery checks it before inspecting datasets, immediately
before each drop and before releasing evidence. A changed URL or database id,
missing/partial identity, or legacy descriptor without target evidence refuses
recovery and keeps the registry, old auth state and baseline for inspection.

Recovery establishes absence from the authenticated administrator's
`/api/datasets` listing and `/api/tree_data` registry inventory together.
Both must succeed and agree on absence; a metadata 403 alone proves nothing.
For a `confirmed` artifact, neither its exact recorded name **nor its recorded
server id** may appear in either inventory. Recovery scans all dataset identities,
including numeric-string ids; incomplete or malformed ids cannot prove absence.
The tree is a mixed navigation structure: the server emits registered datasets
as `t_` nodes, including registered SQL views. Only those nodes supply dataset
identities. Folder nodes (`f_`), the synthetic Views root (`views_root`) and
lightweight view nodes (`v_`, marked `is_view`) are structural, even when a view
node carries a UID. Their names and folder ids are never dataset evidence.
Unknown node kinds refuse reading; a dataset node with a missing or invalid UID
still refuses confirmed-id absence. The shared fake tree retains folders, nested
datasets, Views and raw views from `testing/shared_contracts/e2e_dataset_tree_response.json`.
The Go `TestE2EDatasetTreeResponseFixture` test compares that fixture with the
authenticated `GetTreeDataHandler` response using scripted SQL rows and no sockets;
regenerate intentionally from `app/` with `UPDATE_E2E_TREE_FIXTURE=1 go test
./backend/reusable_components/vanilla_tree -run TestE2EDatasetTreeResponseFixture`,
then run the dataset identity and stale-run recovery regressions.
If the recorded id survives under another name, recovery refuses, reports both
names and the id, drops nothing during preflight, and keeps every old record.
Only a present dataset requires `/api/get-metadata` to cross-check its exact
public name and stable `table_uid`. A `confirmed` dataset is dropped only when
its current id matches the recorded server id; a dataset absent by name and id counts
as recovered, including after a previous successful drop removed its metadata
permissions. Inconsistent inventories or refused metadata for a present dataset
preserve evidence and refuse recovery.

A `planned` dataset is dropped only when its exact registered name exists,
matches `buildTempDatasetName`'s normalized prefix, base36 process timestamp and
six-character random suffix (at most 63 characters), and its embedded timestamp
is **not before** the dead run's start. Registration precedes the create request.
The exact canonical `<generated-name>_assets` child follows the same timestamp
rule only when separately registered before enabling media; a parent record never
authorizes discovery or deletion of an unrecorded child.
Names outside this format, truncated names without a complete suffix, and names
with an earlier embedded time are skipped and reported; their datasets remain.
The database registry's `created` value is never read for ownership: its
timezone-less column cannot establish ordering, even when serialized with `Z`.
No prefix, language key or unrecorded name authorizes a drop.
Planned artifacts have no confirmed server id: their absence rule remains the
exact recorded name in both inventories, without claiming ownership of other ids.
When recovery finds and drops a planned dataset, it also verifies that the stable
id observed during preflight is gone. All recovered names and known ids are checked
again after parent deletion before the dead-run records are released.

Every drop uses `/api/drop-dataset` with the fresh administrator session and its
CSRF token, rechecks identity immediately before deletion, and verifies absence
by both name and recorded id afterward for confirmed artifacts. A rename during
CSRF acquisition or a successful drop that leaves that id under another name
also refuses and keeps the records. Output has one `[E2E recovery]` line per artifact with its name, server
id (or `unknown` for an absent planned name), and dropped/already absent/skipped
outcome. Once all outcomes are safe, setup removes the dead run directory and
pointer, initializes the new run, and captures a fresh baseline. A mismatched id,
unknown or unsupported kind (including folders), corrupt or unfinished record,
failed API read or drop preserves the dead run and refuses startup with the
artifact and reason; an undecodable record is identified by its exact file path.
After a partial recovery failure, successful earlier drops are already absent on
the next attempt, so recovery can resume without losing ownership evidence.

Recovery API failures report only the operation, recorded artifact name/id when
applicable, HTTP status when available, and a fixed reason. This covers profile,
administrator/installation identity, inventory, metadata, CSRF and drop requests,
invalid JSON and transport/body-read failures. Shared request helpers use the
same boundary. Raw error messages, original causes/stacks, headers, cookies, CSRF
tokens and response bodies are never retained or printed. Registry parse failures
keep the affected file path but discard the parser error and its input. Refused
recovery preserves the old registry, auth state and baseline for inspection.

Native full-matrix runs default to two Playwright workers so simultaneous
browsers do not saturate the local app/database and produce unrelated timeout
clusters. `PLAYWRIGHT_WORKERS=<positive integer>` may override the local limit;
CI remains serialized at one worker.

Healthy end state after a normal run:
- zero remaining artifacts confirmed as owned by the run
- zero ambiguous planned artifacts
- the exact dataset and folder baseline restored; only verified own-run dataset language keys may remain above the language-key baseline
- `data/testing/e2e/.auth/user.json`, the baseline, and the completed run registry removed

The `login()` helper from `helpers/auth.ts` handles:
- Navigating to `/` and waiting for the app to load
- Fallback login if the session expired (username and password from the
  installation-owned protected file
  `keys/filterest_runtime/dev_env_test_creds.txt`, or the explicit path in
  `FILTEREST_TEST_CREDENTIAL_FILE`; Easelect keeps its established absolute
  private-root override)
- Reading the explicit OTP from the test process `LOGIN_OTP_CODE`, ignored
  native development env, or finally the native runtime env resolved through
  `EASELECT_KEY_ROOT`; missing configuration fails before a browser auth
  timeout, and there is no hardcoded backend default

Playwright also injects `X-Bypass-Ratelimit: test-mode` in two places:

- `app/playwright.config.ts` for normal test project requests
- `app/testing/e2e/global-setup.ts` for the one-time login/bootstrap context

For the login rate limiter the header is honoured only in explicit development
mode **and** only for a request that arrives from this machine, so it works from
a local Playwright run against `https://localhost:8082` and is ignored for a
development server reached over the network.

This header is not only for rate limits. In development, the backend translation route uses it as a hard guardrail: `/api/generateTranslations` returns an empty JSON array immediately in test mode instead of calling an external LLM provider. This keeps normal Playwright runs out of Anthropic/OpenAI billing paths even if the frontend notices missing lang keys during the test.

Important nuance: when `login_to_browse=false`, landing on `/` does not prove the browser is authenticated. `login()` should confirm a non-guest session via `/api/user-profile` instead of trusting URL state alone.

```typescript
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

let credentials: TestCredentials;
test.beforeAll(() => { credentials = loadCredentials(); });
test.beforeEach(async ({ page }) => { await login(page, credentials); });
```

## Critical Patterns

### Controls inside the filter bar's tools section

Add row, Delete, column management, field presentation and row permissions live
inside the **Add & manage content** (`tools`) disclosure, collapsed by default
on every viewport. Opening the outer panel alone does not expose them. Before
locating these controls, use `revealActiveFilterbarSection(page, 'tools')` from
`helpers/filterbar.ts` and scope the control to its returned section. The helper
waits for shell and saved-layout readiness and reveals the section for this page
without saving the expansion. `openAddRowForm()` already uses it. Assert the
expected control and modal rather than skipping when a collapsed control is
hidden; clicking a disclosure heading with `openActiveFilterbarSection()` is
appropriate only when the test intentionally changes saved layout.

### Account-Name Privacy Proof (WL132 LT10/LT11)

Use distinct random login names for an administrator and an ordinary user.
The ordinary-user equality setting defaults to yes; intentionally choosing the
login name as a display name publishes that value and is not a private-name
canary fixture. Administrators' names always differ. Upgraded administrators
use their unchanged former login with a new `admin_<n>` public name, while
API-only administrators receive `auto_<n>`. See
[Permission Model](Permission_Model.md#account-names-and-account-maintenance)
and [Program Accounts](Program_Accounts.md).

The database-backed handler canary
`TestLoginNameEveryAccountFlowCanaryPostgres` covers registration, sign-in,
profile reads/edits, password-confirmed login-name changes and **Sign out other
devices**, administrator changes/promotion, operator recovery, password reset, sign-out,
and wrong/right fixed-PIN, TOTP and email codes. It inspects bodies, headers
(including redirects), raw decoded response cookies, captured standard and
application logs, and public text/JSON/search columns. Restricted rows and
owner-directed test mail supply positive controls. The first-run and creator
proofs add setup and fixed automation-name checks.
The initial-administrator tool's PostgreSQL proof also uses a random override,
keeps status/conflict output free of it, and verifies it in the private row and
protected credential handoff.
`TestLoginNamePublicSearchCanaryPostgres` exercises the actual results handler
as both roles, with indexed and NULL-vector public-name positive controls and
zero private-name search hits. Mail transport is replaced in memory; these
proofs never contact a mail provider.

```bash
# From the installation root; local disposable PostgreSQL only.
(cd app && FILTEREST_TEST_DISPOSABLE_POSTGRES=1 go test ./backend/core_components/auth -run 'TestLoginName(EveryAccountFlowCanary|PublicSearchCanary|FirstRun|CreatorsAndCanary)Postgres' -count=1 -v)
(cd app && FILTEREST_TEST_DISPOSABLE_POSTGRES=1 go test ./server_tools/initial_admin_bootstrap -run TestInitialAdministratorLoginNamesPostgres -count=1 -v)

# Source guards need no database or running application.
(cd app && go test ./backend/core_components/auth ./backend/core_components/auth/credentials ./backend/core_components/sessions -run 'Test(LoginNameSourceGuard|PrivateNameWholeRowReadGuard|SourceGuard|SystemLoginNameValidationIsNarrowLT11|SessionStoreBypass|SessionNameKey|BackendLoadsAndWrites|NoBackendCode)' -count=1)
```

The LT11 guard reviews runtime Go, JavaScript, TypeScript, Python and SQL
private-name references, binds each Go credential writer to its file and
validator call, and checks that trusted wrappers still call `ValidateLoginName`.
The session guard forbids retired name keys and direct cookie-store loads or
saves outside `sessions`, including simple aliases, in backend and server-tool
Go source. Negative fixtures keep the guards observable. Generated bootstrap
and schema snapshots retain their separate hash/acceptance proofs in
`app/testing/python/test_login_name_bootstrap.py`.

`L_auth/L8_login_name_canary.spec.ts` adds real browser sign-in, profile display,
login-name change, two-device revocation, public search, logout and new-name
sign-in. It captures browser responses, headers/redirects, DOM and browser
cookie/local-storage values. Before each navigation it reads every response
body already seen; a GET body the application's own navigation discards (for
example after following its sign-out redirect) is read again with the same
browser's cookies, and any other unreadable body is a finding. The ordinary
account may answer the account-dataset search with 403 where it has no read
right; the administrator must search it. The Go proofs own decoded-cookie,
server-log, database and owner-mail inspection; a browser cannot decrypt server
cookies.

Profile login-name changes allow three attempts in five minutes per account,
so wait five minutes before running the spec again with the same fixtures.

This mutating spec runs only in `desktop-card` and only when explicitly enabled
against a disposable native installation with mail delivery disabled. Prepare
two enabled password-only accounts through the supported registration and
administrator APIs, with distinct random login names `wl132_<32 lowercase hex
digits>`, distinct public names and ids, one administrator and one ordinary
user. Use a separate existing administrator for global setup. Save a JSON array
of the two records in an absolute, owner-only file under `keys/`; each record
contains `role` (`admin` or `user`), `user_id`, `username` (private login name),
`display_name`, and `password`. Do not use reserved/shared credentials as canaries.

```bash
FILTEREST_E2E_LOGIN_NAME_CANARY=1 \
FILTEREST_E2E_CANARY_ACCOUNTS_FILE="$PWD/keys/filterest_runtime/wl132_canaries.json" \
PLAYWRIGHT_HTML_OPEN=never ./filterest test \
  testing/e2e/L_auth/L8_login_name_canary.spec.ts --project=desktop-card --workers=1
```

The spec verifies the supplied account ids and roles before changing anything
and restores each changed login name through the supervising administrator in
`finally`. The disposable installation owns the fixture accounts and protected
file; remove them with that installation after proof. A normal matrix run skips
this spec. A skipped opt-in proof or sandbox-denied database/browser start is
not a pass: report the missing channels and rerun on an authorized local native
host before release. Slice 4's separate administrator sign-in address requires
its own route matrix and is not covered by this spec.

### 0. Shared Helpers And Stable Anchors First

When a navigation or interaction pattern repeats across E2E files:

- Prefer adding or reusing helpers in `app/testing/e2e/helpers/` instead of copy-pasting raw selector logic.
- Prefer stable `data-testid` anchors over CSS classes, translated text, or deep DOM structure.
- If a recurring UI surface is hard to target reliably, fix the test seam in the app or helper layer first, then write more specs on top of it.

This keeps long-lived Playwright knowledge in helper modules and docs instead of scattering fragile ad hoc patterns across tickets.

For dataset text search, use `openActiveDatasetSearch()` from
`helpers/dataset-search.ts` (E1 and E15). It waits for the active dataset's
layout, selects a visible input rather than the first hidden copy, and opens
the phone search button by click or tap when needed. The phone button applies
through 700 px; tablets retain the hero or shared-bar field. Missing both the
field and button fails the test; the filter-panel button is a separate control.

### 0.1 Required Dataset/View Helpers Should Fail Loudly

`navigateToDataset()` and `switchToView()` are for tests that require a specific dataset or view. They now fail loudly by default if the requested tab or view control is missing, instead of silently falling back to something else.

Use the explicit fallback paths only when fallback is the test's real intent:

- `navigateToDefaultDataset(page)` when any loaded dataset is acceptable
- `navigateToDataset(page, tableName, { allowFallback: true })` only for legacy fallback behavior
- `switchToView(page, viewMode, { allowMissing: true })` only when the test intentionally treats the view as optional and will handle that branch itself

This prevents false-green tests that accidentally exercised the wrong dataset or stayed in the wrong view.

### 0.2 Prefer Temp Datasets For Isolated CRUD And Persistence Flows

When a spec needs destructive CRUD, seeded rows, or a true persistence round-trip, prefer creating a throwaway dataset through the app APIs instead of mutating long-lived shared fixtures.

- Use `app/testing/e2e/helpers/temp-dataset.ts` to create, seed, open, and drop the dataset inside the test.
- The helper confirms the exact name and stable identity from the successful creation response before its follow-up lookup, seeding, or cache refresh. If setup then fails, it compensates only after re-reading the same identity; failed cleanup retains confirmed ownership for teardown and reports both errors.
- Keep the dataset unique per run, register its planned/confirmed identity through `temp-dataset.ts`, and clean it up in `finally`, even when assertions fail.
- For admin-flow tests that create datasets through the visible UI instead of the temp-dataset helper, add a request-scoped `afterEach` cleanup path so the dataset is still dropped if the page flow breaks before the in-test delete step.
- Use this pattern for create/delete persistence checks, dataset-specific view assertions, and any flow where a shared dataset could hide flaky state leakage.
- If the test depends on a non-table view, inject the requested view preference before opening the dataset so the first landing surface matches the assertion target.
- Prefer opening throwaway datasets through the real sidebar `nav-view-*` route when available. Newly created datasets may exist in the database tree before they appear as top tabs, so tab-only helpers are too strict for this path.

This keeps destructive E2E flows isolated from built-in datasets and reduces coupling to hand-maintained fixtures.

Appearance API writes must carry freshly loaded revisions. Reuse
`helpers/appearance-revisions.ts`: the field-editor saver reads current metadata
and both revisions immediately before posting; shared and dataset restore helpers
reload before every attempt, retry once on 409, and throw if restoration fails.
Dataset cleanup restores only the changed sparse leaves, using `unset` for a
previously inherited value and checking the stable dataset identity. A settings
object captured before the test supplies the original values, never the restore
revision. T14 proves the dataset card palette's save through
`/api/admin/dataset-appearance`, fresh page load and card-view readback. Run
shared-fixture appearance proofs with `--workers=1` to avoid overlapping edits.
Home's front-page presentation has its own revision contract; it does not use
the dataset appearance revisions.

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
app/testing/e2e/
├── global-setup.ts    — Login once, save session, clean stale synthetic artifacts, capture lang-key baseline
├── global-teardown.ts — Verify artifacts returned to baseline and report retained own-run dataset keys
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
5. Clean up test data inside the test when the cleanup is bounded to a known step; for admin specs that create datasets and could fail mid-flow, prefer request-scoped `afterEach` cleanup helpers (see `app/testing/e2e/helpers/temp-dataset.ts` and the pattern used in `app/testing/e2e/T_admin/T1_create_table.spec.ts`)

See `T7_card_visibility.spec.ts` as a complete reference for admin view testing.

## Tickets vs Docs

Keep durable E2E strategy here and in the [Developer Guide](DEV_GUIDE.md), not only in umbrella tickets.

- Put project-wide rules here: helper-first patterns, selector strategy, SPA constraints, report usage, and how Playwright fits with Vitest and Visual Guardian.
- Put ticket-specific leftovers in tickets: uncovered workflows, missing verification, flaky cases, or one-off regressions that still need implementation.
