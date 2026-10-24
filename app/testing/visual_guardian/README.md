<!-- README.md: Visual Guardian's visual QA and deterministic observation guide. -->
<!-- Connects capture specs, optional AI analysis and report-only measurements. -->
<!-- Keeps output contracts, reviewed intent and verification in one place. -->
<!-- Records the current collection boundary before broader integration. -->
# Visual Guardian - Technical Documentation

## Overview
Visual Guardian is the automated Quality Assurance system for Easelect. It combines:
1.  **The Constitution**: Design rules defined in `app/docs/constitution/design/technical_definitions.md`.
2.  **The Engine**: Playwright tests in `app/testing/visual_guardian/*.spec.ts` that capture screenshots.
3.  **The Guardian**: An AI-powered analysis script (`analyze_ui.py`) that verifies screenshots against the Constitution.

## Scope Boundary
Visual Guardian is intentionally scoped to **visual** QA:
- It analyzes screenshots for layout, styling, responsive presentation, and other constitution-level UI issues.
- It does **not** triage ordinary Playwright assertion failures from `app/testing/e2e/`.

Ordinary Playwright failures are currently expected to be debugged using the standard runner artifacts:
- console output from `./filterest test`
- the HTML report in `data/testing/playwright-report`
- retry traces in `data/testing/test-results`
- Visual Guardian screenshots in `data/testing/test-results/visual_guardian`
- Visual Guardian failure-page artifacts in `data/testing/test-results-visual/<test-output-dir>/` including `page-source.html`

These mutable outputs use `data/testing/` at the public product root by
default. `FILTEREST_TEST_RUNTIME_ROOT` may select another mutable location, but
it must remain outside immutable `app/`.

This means AI-assisted triage is currently a specialized capability for visual regressions, not a general requirement for every Playwright failure.

## AI Configuration
The analysis is performed using OpenAI's Vision API.

-   **Script**: `app/testing/visual_guardian/analyze_ui.py`
-   **Model**: `gpt-5.2` (default)
    -   **Config**: Override via `VISUAL_GUARDIAN_MODEL` (or `OPENAI_VISION_MODEL` / `OPENAI_API_MODEL`).
-   **Input**:
    -   Screenshots captured by Playwright (base64 encoded).
    -   Context from `technical_definitions.md` (Rules) and `README.md` (Principles).
-   **Output**: JSON report indicating PASS/FAIL status, detected device, and list of issues.

Notes:
- The analysis script currently uses OpenAI's Chat Completions vision path when `OPENAI_API_KEY` is set, and falls back to Anthropic when only a valid Anthropic key is available.

## Running the Guardian
To execute the full suite (Tests + Analysis):
```bash
./filterest audit visual
```

The Visual Guardian Playwright config reuses the authenticated E2E storage state from `app/testing/e2e/global-setup.ts`, so captures default to a logged-in, app-ready browser context instead of relying on anonymous `/` loads.

`capture_search_bar.spec.ts` checks the same search surface in the content hero
and the flat shared toolbar at desktop and tablet widths. The shared input row
owns the continuous outer border; the text input and overlaid clear button are
borderless, and Submit has one inset separator. The proof checks the enclosing
frame, control geometry, text padding, stable pressed clear control and cleared
input. Both surfaces clear a submitted search, since drafts have no clear
action. The query is submitted through the hero before exposing the flat bar,
and the flat-bar screenshot captures the checked frame with its clear control
visible, before clearing can restore the ordinary listing's scroll position.
Both cases capture translated copy and explicit application themes opposite
the operating-system preference. Run this entire spec with
`app/playwright.visual.config.ts`, first with `--project=chromium --workers=1`.
The `firefox` project needs its installed Playwright browser; an unavailable
browser is missing coverage, not a passing or skipped visual proof.

## Directory Structure
-   `analyze_ui.py`: Main analysis script.
-   `*.spec.ts`: Playwright test files for capturing screenshots.
-   `requirements.txt`: Python dependencies (openai, python-dotenv).

## Deterministic visual observations (WO92)

The optional deterministic observer writes measured problems beside screenshots.
It needs no API service and is **report-only**: findings, invalid configuration,
timeouts and observer exceptions never fail a test. Screenshot errors propagate
unchanged. The existing AI analyser is a separate optional pass (K482 is open).

```ts
import { startVisualObservations } from './visual_observer';
const visual = startVisualObservations(page, testInfo, {
  enabled: true, reportDir: testInfo.outputPath('observations'),
  // expectations: reviewedObjectOrFile, allowlist: entriesOrFile,
  // meta: { runId: 'shared-run-id', theme: 'dark', language: 'fi' },
}); // Start before navigation.
try {
  await page.goto('/front_page');
  await visual.shot({ path: testInfo.outputPath('observations/home.png'),
    name: 'home', animations: 'disabled' });
  // Optional target: Locator, fullPage, clip; expect: required CSS selectors.
} finally {
  await visual.finish();
}
```

`enabled` overrides the opt-in environment switch
`FILTEREST_VISUAL_OBSERVATIONS=1`. With neither enabled, there are no listeners,
page evaluations, configuration reads or observation files; `shot()` only calls
the original screenshot operation. Participating specs must use this API;
setting the switch alone does not instrument other screenshots.

For each enabled shot: scroll a locator normally, wait at most 500 ms for fonts,
images and finite animations, measure once, take the caller's screenshot, and
recheck a small geometry fingerprint. Pending media, unsettled geometry, observer
errors or a reached cap mean partial coverage. Caps are 2,500 elements and 2,000
text fragments. Infinite decorative animations do not block readiness.

First-wave checks use CSS pixels within the captured viewport, page, clip or
locator, respecting ancestor clipping and including painted decorative images:

| Check | Reporting threshold |
| --- | --- |
| `image-load` (high) | Complete image with zero natural width/height, rejected `decode()`, failed image response, or matching invalid image structure. Pending images mean partial coverage. |
| `image-box` | Frame **and actual image** differ from a reviewed width/height by `> max(2px, 5% expected)` on either axis, or ratio error `> 10%`. A declared CSS aspect ratio supplies ratio intent; absent intent says “not checked”. |
| `image-box`, rule `ancestor-clip` | Hidden/clip ancestor exposes less than 90% of the image box. |
| `image-distortion` | Only `object-fit: fill`, natural-to-content scale ratio `> 1.10`. Cover/contain/none/scale-down are exempt. |
| `text-clip` | Non-scrolling horizontal overflow `> max(2px, 5% clientWidth)`; vertical overflow `> 2px` with clipping CSS and at least half a line cut. Overflowing ellipsis/clamps need a reviewed truncation contract. Ancestor duplicates are avoided. |
| `page-x-scroll` | At widths ≤700, root scroll width exceeds document client width by `> 4px`. Record root/body overflow and up to five protruders. A nested scroller alone is quiet. |
| `touch-size` | Either effective dimension `< 43.5px` at widths ≤700; `< 24px` above. Enabled, exposed buttons, standalone links, non-hidden inputs, selects, textareas, summaries, and roles button/link/checkbox/radio/switch/tab/menuitem. Prose links are excluded. Labels and registered expanded targets require centre + four inset hit tests. |
| `console`, `request` | Console errors, uncaught errors, failed requests and HTTP ≥400, attached before navigation. Uncaught errors, required assets and first-party 5xx are high; cancellations low unless required assets fail; other events medium. Fingerprints group occurrences while retaining counts and event links. |

Touch hit tests use viewport coordinates. A captured control with no hit-test
result (including one below the viewport in a full-page capture) is counted in
`excluded`, never `examined`, and makes touch coverage partial. Its reason reports
the number not examined; that reason survives into JSON and Markdown. The observer
does not scroll the page to measure those controls.

Image responses up to 2 MB are checked in memory: PNG signature, bounded chunks,
every CRC, first IHDR, IDAT, last IEND, complete zlib stream, and exact inflated
size for non-interlaced images; JPEG SOI/SOS/EOI; GIF header/trailer; WebP RIFF
size and a VP8/VP8L/VP8X chunk. PNG inflation is bounded at 64 MB. Other formats
retain browser loading/decode checks. No bodies, headers, storage or DOM dumps
are written. Event paths and URL tokens in messages share the same sanitiser:
absolute, protocol-relative and relative URLs retain only paths, without authority,
user information, query or fragment; data/blob URLs become `[inline]`. Sanitised
messages are limited to 200 characters after URL removal. Detection recognises
HTTP(S), WS(S), FTP and file `://` URLs, `//` authorities and data/blob content
anywhere, including after error labels and inside brackets or quotes. Closing
delimiters and trailing sentence punctuation remain in the message. Arbitrary
`word:` labels stay readable; they are never treated as URL schemes. The earlier
executable-inline redaction is retained separately. The shared unit-test matrix
checks every message through the sanitiser, console/page errors and failed
requests, including worker shards and merged JSON/Markdown.

Outputs are `visual-observations.json`, `visual-observations.md` and
`shards/<runId>-<test>-<project>-<retry>.json`. Use a fresh shared `reportDir` for
each run; an explicit `meta.runId` switches the manifest when reusing a folder.
Without an explicit id, `run.json` establishes the shared id under the lock.
Without a directory, outputs use `visual-observations/` under the project's
existing mutable Playwright output root, which Playwright clears between runs.
Parallel workers and retries write unique shards; a bounded mkdir lock protects
merging. Writes use temporary files and rename. Only the manifest's run is merged.
JSON schema version 1 and its required fields are defined by
[the report types](visual_observer_types.ts). Timestamps are ISO UTC; artifact
paths are relative to the report with `/` separators. Application theme, OS
theme, language and internal scrolls accompany each shot. Callers can supply
explicit application theme/language metadata without reading browser storage.

Markdown opens with coverage and unsuppressed counts, lists high → medium → low
sorted by shot/check/selector, then suppressions and unknowns. Zero findings with
partial coverage says **incomplete**. The merger is also usable directly:

```bash
node app/testing/visual_guardian/visual_report.mjs merge <reportDir>
# VISUAL_OBSERVATIONS run=<id> high=<n> medium=<n> low=<n> coverage=<complete|partial> report=<path>
```

The CLI prints exactly one line and exits 0 for reporting failures; usage errors
exit 2. `finish()` emits the same summary line after a successful write.

Reviewed expectations live in [visual_expectations.json](visual_expectations.json):
`{schemaVersion: 1, entries: [...]}`. Every entry requires `id`, `kind`, CSS
`selector`, `shot` (`"any"` or a name glob with `*`), `viewport` with inclusive
`minWidth`/`maxWidth`, `reason`, and a `source` file:line. Kind data is:

- `image-box`: positive `width`, `height`, and `box: "border" | "content"`.
- `truncation`: positive integer `lines` matching an active clamp or one-line ellipsis.
- `expanded-target`: `via: "::after"`; the measured pseudo box needs all five hit tests.

The four seed entries describe Home's image slot, one-line title, two-line excerpt
and stretched title link, with sources in the CSS, compact builder and G15 proof.
An expectation is design intent; an allowance suppresses a reviewed defect.

[visual_allowlist.json](visual_allowlist.json) starts as `[]`. Every entry requires:
`{id, check, selector, shot, viewport, theme, language, reason, owner, expires,
maxMatches, eventFingerprint}`. `selector` is an exact CSS selector; `shot` is an
exact shot id or screenshot basename (without extension), or `"any"`. `viewport`
is exact `{width,height}` or `"any"`; theme and language may also explicitly be
`"any"`. No other field permits `"any"`. Expiry is a UTC `YYYY-MM-DD`, valid
through that day; `maxMatches` is a positive integer. Event allowances require
`:root` plus the exact fingerprint; other checks require `eventFingerprint: null`.
An empty reason, malformed/expired entry, or count above `maxMatches` suppresses
nothing (including the first excess-count matches). Suppressed findings stay in
JSON. States are `matched`, `expired`, `missing-selector` (only with observed
context and selector evidence), and `untested`. **`possibly-resolved` needs run
history and is deferred to V-2.**

Verify with `npm test -- testing/visual_guardian/visual_image_structure.test.mjs
testing/visual_guardian/visual_report.test.mjs
testing/visual_guardian/visual_observer_page.test.mjs` from `app/`. The page unit
tests use in-memory geometry, including two 30×30 buttons at y=100 and y=1000;
they launch no browser. The fixture-only
[browser self-test](visual_observations_selftest.spec.ts) uses absolute routed
URLs and no application pages. Run `npx playwright test -c
playwright.visual.config.ts visual_observations_selftest` in Chromium and Firefox.
The visual config still owns its existing global setup; listing tests requires
neither a browser launch nor that setup. Case (l) uses concurrent isolated page
collectors with independent worker identities; unit tests also prove lock/retry
merging. Browser execution is required before accepting geometry claims.

V-2 owns G11/G13/G15 capture adoption, runner artifact copying and log/gate
integration, plus retained-run staleness. V-3 owns overlap, focused/contract
off-screen checks, notices covering content and explicit opt-in contrast.
The approved V-4 nightly sweep must be timed before rollout. V-1 installs none
of these integrations and never turns observations into gate failures.

The visual Playwright configuration matches only `*.spec.ts`, keeping the
Node/Vitest `.test.mjs` files out of browser-test discovery.
