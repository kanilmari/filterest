<!-- PIPELINE_EXCEPTIONS.md -->
<!-- Records intentional frontend transports outside the finite API pipeline. -->
<!-- Connects exception comments in source with their transport and lifecycle contracts. -->
<!-- Exists so direct requests and streams have one reviewable registry. -->
# Pipeline Exceptions Registry

_Last updated: 2026-10-05_

This registry lists frontend files that intentionally bypass the API pipeline (`endpoint_router` -> `runApiPipeline`). The rule is: **all API calls go through the pipeline**. Any direct `fetch()`/`XMLHttpRequest`, or streaming API mechanism such as `EventSource`, must be explicitly documented here.

## Comment Convention

Add this header comment to every intentional exception file so it is grep-able:

```js
// PIPELINE_EXCEPTION: <reason>
```

`git grep 'PIPELINE_EXCEPTION' app/frontend/ -- '*.js' ':!app/frontend/dist/'` should list all active exceptions.

## Active Exceptions

| # | File | Direct calls | Reason | Added |
|---|------|-------------|--------|-------|
| 1 | `app/frontend/core_components/error_and_status_handling/dev_error_forwarder_to_backend.js` | `fetch('/api/csrf-token')`, `fetch('/api/log-client-error')` | Infrastructure error logger. Must not depend on higher-level abstractions to avoid circular dependencies and infinite logging loops. | 2026-02-24 |
| 2 | `app/frontend/core_components/auth/translation_prefetcher.js` | `fetch('/api/translations?lang=en')`, `fetch('/api/translations?lang={browser_lang}')` | IIFE that runs before the module system loads. Pipeline utilities are unavailable; prefetch overlaps with HTML parsing for faster perceived login. | 2026-02-24 |
| 3 | `app/frontend/core_components/auth/pre_auth_request_sender.js` | `fetch(url)` for `/api/login` (credentials and verification code), `/api/request-password-reset-otp` and `/api/reset-password`, sent for both the login page (`login_page_builder.js`) and the login modal (`login_modal_printer.js`) | Sign-in runs before a session exists, so no pipeline stage can attach the token; the token comes from the form's server-rendered hidden field. When the service refuses that token, it reuses the pipeline's `ensureCsrfToken` and `isCsrfFailureResponse`, writes the session's token into the field and retries once, so a page restored from the browser's cache signs in without a reload. Replaced the separate page and modal entries. | 2026-10-03 |
| 5 | `app/frontend/core_components/admin_tools/main/oid_updater.js` | `fetch('/api/update-oids', { method: 'POST' })` | Best-effort admin maintenance refresh. Uses a local `AbortController` timeout so a slow OID/catalog sync cannot keep reloads open for tens of seconds. It is a POST because it rewrites catalog metadata, and it reuses the pipeline's CSRF token cache instead of keeping its own. | 2026-09-20 |
| 6 | `app/frontend/core_components/admin_tools/admin_button_builder.js` | `new EventSource(get_endpoint_url('openaiEmbedStream'))` | Embedding refresh progress is a server-sent event stream. `endpoint_router` handles finite request/response calls, not long-lived SSE transport. | 2026-05-04 |
| 7 | `app/frontend/core_components/endpoints/sse_subscriber.js` | `new EventSource('/api/sse/subscribe?...')` | Realtime row-change notifications are a shared long-lived SSE subscription with explicit reconnect lifecycle. The server rechecks the sign-in every fifteen seconds and before sending a row event; `session_ended` closes the browser stream and stops reconnects for that page, leaving the next request to normal sign-in handling. | 2026-05-04 |
| 9 | `app/frontend/core_components/user_tools/register_tab_printer.js` | `fetch(REGISTER_FRAGMENT_PATH)`, `fetch(form.action)` | Register tab loads and submits server-rendered pre-auth HTML form fragments with hidden CSRF fields, not JSON API calls. | 2026-05-05 |
| 10 | `app/frontend/icons/icon_loader.js` | `fetch(iconPath)` | Static same-origin SVG asset loading. `endpoint_router` is API-only and cannot load arbitrary icon asset paths; the loader validates `image/svg+xml` content before injecting markup. | 2026-05-09 |
| 11 | `app/frontend/core_components/admin_tools/admin_update_notice_subscriber.js` | `new EventSource('/api/admin/update-notice/stream')` | Administrator production-update notices use a bounded SSE stream with persistent database snapshots and an explicit browser reconnect lifecycle. | 2026-08-24 |

## Pipeline Infrastructure (NOT exceptions)

These files use `fetch()` because they implement the pipeline itself:

| File | Direct calls | Role |
|------|-------------|------|
| `app/frontend/core_components/pipeline/api_pipeline.js` | `fetch(endpoint_map.fetchCsrfToken)` for CSRF bootstrap, `fetch(ctx.resolvedUrl)` to execute and retry requests | API pipeline implementation |

## Architectural Edge Cases

| File | Mechanism | Note |
|------|-----------|------|
| `app/frontend/core_components/navigation/nav_engine/navigation_handler.js` | `performNavigation()` export | Legacy public API that bypasses the navigation pipeline (skips permissionCheck, urlUpdate). It still has active callers, so new navigation work should prefer `handle_all_navigation()` -> `runNavigationPipeline()` and any removal must first migrate callers intentionally. |

## How to Add a New Exception

1. Add `// PIPELINE_EXCEPTION: <reason>` near the file header.
2. Add a row to **Active Exceptions** above.
3. Justify why `endpoint_router` / `runApiPipeline` cannot be used and prefer pipeline-first alternatives whenever possible.
