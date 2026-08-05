# Pipeline Exceptions Registry

_Last updated: 2026-05-09_

This registry lists frontend files that intentionally bypass the API pipeline (`endpoint_router` -> `runApiPipeline`). The rule is: **all API calls go through the pipeline**. Any direct `fetch()`/`XMLHttpRequest`, or streaming API mechanism such as `EventSource`, must be explicitly documented here.

## Comment Convention

Add this header comment to every intentional exception file so it is grep-able:

```js
// PIPELINE_EXCEPTION: <reason>
```

`git grep 'PIPELINE_EXCEPTION' frontend/ -- '*.js' ':!frontend/dist/'` should list all active exceptions.

## Active Exceptions

| # | File | Direct calls | Reason | Added |
|---|------|-------------|--------|-------|
| 1 | `frontend/core_components/error_and_status_handling/dev_error_forwarder_to_backend.js` | `fetch('/api/csrf-token')`, `fetch('/api/log-client-error')` | Infrastructure error logger. Must not depend on higher-level abstractions to avoid circular dependencies and infinite logging loops. | 2026-02-24 |
| 2 | `frontend/core_components/auth/translation_prefetcher.js` | `fetch('/api/translations?lang=en')`, `fetch('/api/translations?lang={browser_lang}')` | IIFE that runs before the module system loads. Pipeline utilities are unavailable; prefetch overlaps with HTML parsing for faster perceived login. | 2026-02-24 |
| 3 | `frontend/core_components/auth/login_page_builder.js` | `fetch('/api/login')` x2, `fetch('/api/request-password-reset-otp')`, `fetch('/api/reset-password')` | Login page runs before session exists — no CSRF/fingerprint pipeline stages available. CSRF token is sourced from server-rendered hidden field instead. | 2026-03-01 |
| 4 | `frontend/core_components/auth/login_modal_printer.js` | `fetch('/api/login')` x2, `fetch('/api/request-password-reset-otp')`, `fetch('/api/reset-password')` | Login modal runs before session exists — same pre-auth constraint as login page. | 2026-03-04 |
| 5 | `frontend/core_components/admin_tools/main/oid_updater.js` | `fetch('/api/update-oids')` | Best-effort admin maintenance refresh. Uses a local `AbortController` timeout so a slow OID/catalog sync cannot keep reloads open for tens of seconds. | 2026-04-26 |
| 6 | `frontend/core_components/admin_tools/admin_button_builder.js` | `new EventSource(get_endpoint_url('openaiEmbedStream'))` | Embedding refresh progress is a server-sent event stream. `endpoint_router` handles finite request/response calls, not long-lived SSE transport. | 2026-05-04 |
| 7 | `frontend/core_components/endpoints/sse_subscriber.js` | `new EventSource('/api/sse/subscribe?...')` | Realtime row-change notifications are a shared long-lived SSE subscription with explicit reconnect lifecycle. | 2026-05-04 |
| 8 | `frontend/core_components/admin_tools/queen_chat_view.js` | `new EventSource(get_endpoint_url('queenTranscriptStream'))`, `new EventSource(get_endpoint_url('queenSessionStream'))` | Queen transcript/session following streams incremental events; the finite management calls in the same file still use `endpoint_router`. | 2026-05-04 |
| 9 | `frontend/core_components/user_tools/register_tab_printer.js` | `fetch(REGISTER_FRAGMENT_PATH)`, `fetch(form.action)` | Register tab loads and submits server-rendered pre-auth HTML form fragments with hidden CSRF fields, not JSON API calls. | 2026-05-05 |
| 10 | `frontend/icons/icon_loader.js` | `fetch(iconPath)` | Static same-origin SVG asset loading. `endpoint_router` is API-only and cannot load arbitrary icon asset paths; the loader validates `image/svg+xml` content before injecting markup. | 2026-05-09 |

## Pipeline Infrastructure (NOT exceptions)

These files use `fetch()` because they implement the pipeline itself:

| File | Direct calls | Role |
|------|-------------|------|
| `frontend/core_components/pipeline/api_pipeline.js` | `fetch(endpoint_map.fetchCsrfToken)` for CSRF bootstrap, `fetch(ctx.resolvedUrl)` to execute and retry requests | API pipeline implementation |

## Architectural Edge Cases

| File | Mechanism | Note |
|------|-----------|------|
| `frontend/core_components/navigation/nav_engine/navigation_handler.js` | `performNavigation()` export | Legacy public API that bypasses the navigation pipeline (skips permissionCheck, urlUpdate). It still has active callers, so new navigation work should prefer `handle_all_navigation()` -> `runNavigationPipeline()` and any removal must first migrate callers intentionally. |

## Review Needed

| File | Issue |
|------|-------|
| `frontend/core_components/dev_tools/session_details_printer.js` | Contains a commented-out `fetch()`; if re-enabled it should use `endpoint_router`. |

## How to Add a New Exception

1. Add `// PIPELINE_EXCEPTION: <reason>` near the file header.
2. Add a row to **Active Exceptions** above.
3. Justify why `endpoint_router` / `runApiPipeline` cannot be used and prefer pipeline-first alternatives whenever possible.
