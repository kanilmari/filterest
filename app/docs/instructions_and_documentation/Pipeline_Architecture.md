# Pipeline Architecture

This document describes the Pipeline Mediator pattern used in Filterest's backend HTTP request processing. It explains how requests flow through middleware stages, how route profiles control which stages apply, and how to add new stages or configure routes.

**Source code:** `app/backend/pipeline/`
**Related middleware:** `app/backend/core_components/middlewares/`
**Shared response helpers:** `app/backend/core_components/httpresponse/`

---

## 1. Overview

Every HTTP request in Filterest flows through a **pipeline** — an ordered sequence of middleware stages. Each stage performs one concern (rate limiting, logging, authentication, etc.) and wraps the next stage in the chain.

The pipeline is **declarative**: the stage order is defined in a single file (`pipeline_order.go`), and a route's access profile is defined in another single file (`route_profiles.go`), where a conformance test requires every route to have an explicit entry.

The profile is the part that is governed this way. A route's other properties are not yet: its permitted methods, whether it acts on one dataset, and its permission identity are decided in further lists across several files. Treat the access profile as the model the rest should follow, not as a description of the whole route story.

### The Ice Cream Kiosk Metaphor

Think of the pipeline as an ice cream kiosk:

1. **Rate limit** — If too many customers are waiting, they're told "come back later" immediately.
2. **Logging** — Every customer is greeted and their visit is recorded.
3. **Error handling** — A safety net catches any problems during service.
4. **Auth** — The customer shows their loyalty card (or not, for public orders).
5. **CSRF** — Verify the customer's order slip hasn't been forged by someone else.
6. **Fingerprint + Device ID** — The customer's identity is verified.
7. **Access control** — Can this customer order this specific flavor?
8. **Admin check** — Is this customer a manager with special access?
9. **Transaction** — The cash register opens (only if a purchase is made).
10. **Audit** — The receipt is saved: who bought what, when, how long it took.
11. **Handler** — The customer receives their ice cream.

Different customers go through different stages, but the **order is always the same**.

---

## 2. Core Types

All types are defined in `pipeline.go`.

### Stage

```go
type Stage struct {
    Name           string     // Unique identifier (e.g. "auth", "rate_limit")
    Fn             StageFunc  // The middleware function
    AlwaysEnforced bool       // true = cannot be skipped by any route
}
```

### StageFunc

```go
type StageFunc func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc
```

Every stage receives the next handler in the chain plus route metadata, and returns a wrapped handler. This standard signature allows stages to access per-route context (handler name, URL pattern, database connection) without non-standard function parameters.

### RouteContext

```go
type RouteContext struct {
    URLPattern  string   // e.g. "GET /api/rows/{table}"
    HandlerName string   // e.g. "dtt_1_row_delete.DeleteRowsHandlerWrapper"
    DB          *sql.DB  // Database connection for stages that need it
}
```

Carries per-route metadata through the pipeline. Created once per route at startup.

### RouteProfile

```go
type RouteProfile struct {
    SkipStages map[string]bool  // Stages this route skips
    AdminOnly  bool             // Activates the admin_check stage
}
```

Controls which optional stages a route runs. `AlwaysEnforced` stages **cannot** be skipped regardless of profile.

---

## 3. Pipeline Order

Defined in `pipeline_order.go`. This is the **single source of truth** for the request processing order.

| #  | Stage Name       | AlwaysEnforced | Purpose                                              |
|----|------------------|:---------:|------------------------------------------------------|
| 1  | `rate_limit`     | Yes       | Per-function rate limiting (prevents abuse)           |
| 2  | `request_size_limit` | Yes   | Rejects oversized request bodies early                |
| 3  | `logging`        | Yes       | Logs every request for analytics and debugging        |
| 4  | `error_handling` | Yes       | Catches panics from downstream, writes JSON 500       |
| 5  | `auth`           | No        | Verifies session / login status                       |
| 6  | `csrf`           | No        | Validates CSRF token for state-changing methods       |
| 7  | `fingerprint`    | No        | Validates the browser fingerprint against the session, and renews it |
| 8  | `device_id`      | No        | Validates the device ID against the session, and renews it |
| 9  | `access_control` | No        | Checks function-level permissions (user group rights) |
| 10 | `admin_check`    | No        | Requires `admin_access_allowed = true` on user        |
| 11 | `transaction`    | No        | Lazy database transaction (commit/rollback)           |
| 12 | `audit`          | Yes       | Semantic audit logging (who did what to which table)  |

After all stages, the **handler** runs — the actual business logic.

### Stage Ordering Rationale

- **Rate limit first:** Reject abusive requests before doing any work.
- **Request size limit second:** Reject oversized request bodies before request logging or auth work.
- **Logging third:** Record every request that passes rate limiting and size limits for debugging.
- **Error handling fourth:** Catch panics from auth/handler chain, log with context.
- **Auth before CSRF:** Must have a session before validating CSRF tokens.
- **CSRF before fingerprint:** Reject forged requests before doing device verification.
- **Fingerprint/device_id before access control:** Verify device identity before granting access.
- **Admin check after access control:** Most specific check, only for admin routes.
- **Transaction before audit:** Wraps the business logic in a lazy transaction for normal request/response routes. The lazy transaction opens only when a handler calls `dbutils.GetTx()` or `dbutils.RequireTx()`, commits after the inner handler chain returns, and rolls back on panic. Because it is lazy, routes that never touch the DB pay no connection cost, and long-lived stream profiles can explicitly skip it.
- **Audit last (before handler):** Captures the semantic operation and HTTP status after the handler completes, then enqueues the audit event asynchronously. It runs inside the transaction wrapper, so transaction commit/rollback outcome is recorded separately by the transaction log stage rather than by the audit event itself.

### Request Actor and DB Pool Selection

The `transaction` stage does not open a generic database transaction. It picks a role-specific pool through `backend.GetRequestDBForRequest(actor.UserRole, r)` and only then opens the lazy `*sql.Tx`.

That makes request identity part of the write-path contract:

- The actor normally comes from the session (`user_id` + `user_role`).
- Login/bootstrap flows must keep `session.Values["user_role"]` in sync with the authenticated user, not just `user_id`.
- If `user_role` is missing or stale, an admin-approved request can accidentally open its transaction from the wrong pool (`basic`/`guest`) and fail with misleading privilege errors.

To reduce that risk, the `admin_check` stage now seeds a request-scoped admin actor into the context before the `transaction` stage runs. This makes admin routes resilient even if an older session is missing `user_role`, but the preferred steady-state contract is still: authenticated sessions persist the correct application role.

### Future Stages (Planned)

```
validation    — Request body schema validation
notification  — Event-triggered notifications
```

These are commented out in `pipeline_order.go` and can be activated by uncommenting and providing a `StageFunc`.

---

## 4. Route Profiles

Defined in `route_profiles.go`. Six reusable profile templates exist:

### PublicProfile

Skips: `auth`, `csrf`, `fingerprint`, `device_id`, `access_control`, `admin_check`

Used for: static files, auth endpoints (login, register), public data APIs, webhooks with their own auth.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `transaction` → `audit` → **handler**

### StorageProfile

Uses the same pipeline-stage skips as `PublicProfile`, but is selected
explicitly for `router.ServeStorage`. Generic route/table inference is skipped;
the storage handler performs path-aware public-asset allowlisting and
row-scoped authorization through the storage authorization layer.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `transaction` → `audit` → **handler**

### LoginOnlyProfile

Skips: `access_control`, `admin_check`

Used for: routes that require a logged-in user but no specific permissions.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `auth` → `csrf` → `fingerprint` → `device_id` → `transaction` → `audit` → **handler**

### AdminProfile

Skips: nothing. Sets `AdminOnly: true` which activates `admin_check`.

Used for: schema modification, role management, permission management.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `auth` → `csrf` → `fingerprint` → `device_id` → `access_control` → `admin_check` → `transaction` → `audit` → **handler**

### DefaultProfile

`GetProfile()` falls back to `DefaultProfile` — all stages active, `AdminOnly: false` — for unknown handler names. Registered routes must still be listed explicitly in `RouteProfiles`; the conformance test fails when a route relies on the fallback.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `auth` → `csrf` → `fingerprint` → `device_id` → `access_control` → `transaction` → `audit` → **handler**

This keeps the runtime fallback secure while making every registered route's security posture auditable.

### AccessControlNoTxProfile

Skips: `admin_check`, `transaction`

Used for: long-lived authenticated streams that still require route/table access control but must not keep transaction middleware around the open response.

Active stages: `rate_limit` → `request_size_limit` → `logging` → `error_handling` → `auth` → `csrf` → `fingerprint` → `device_id` → `access_control` → `audit` → **handler**

### Dev Overrides

`ApplyDevOverrides()` is called at startup when `ENVIRONMENT_TYPE=dev`. It only registers the profiles of the development tool endpoints, which exist only in development. It never weakens an existing route: creating datasets, setting comments, creating indexes and generating translations keep their normal login, CSRF, access-control and administrator checks in development too, because a development server can be reached from other machines and from any page open in the developer's browser. (Until September 2026 development made these four routes public and skipped their access control; scripts now log in through the API client instead.)

---

## 5. How the Pipeline Builds

Defined in `build_pipeline.go`.

### BuildHandler

```go
func BuildHandler(handler http.HandlerFunc, ctx RouteContext, profile RouteProfile) http.HandlerFunc
```

1. Collects **active stages** by filtering `PipelineOrder` through the route's profile.
2. Wraps the handler in reverse order (last stage wraps first, so first stage executes first).
3. Returns the fully wrapped `http.HandlerFunc`.

**Wrapping example:**

```
PipelineOrder: [rate_limit, request_size_limit, logging, error_handling, auth, handler]
Wrapping order: auth(handler) → error_handling(auth(handler)) → logging(...) → request_size_limit(...) → rate_limit(...)
Execution order: rate_limit → request_size_limit → logging → error_handling → auth → handler
```

### Integration with Router

In `routing_builder.go`, route registration calls:

```go
pipeline.ApplyDevOverrides()  // Once at startup

// Per route:
profile := pipeline.GetProfile(handlerName)
finalHandler := pipeline.BuildHandler(handler, routeCtx, profile)
```

This replaces the old `switch` statement with a single function call.

---

## 6. Error Handling in the Pipeline

Two layers of panic protection exist:

### Layer 1: Pipeline Error Recovery (`error_recovery.go`)

The `error_handling` stage wraps everything from `auth` through the handler. If any downstream code panics:

- Logs: HTTP method, URL path, handler name, panic value, remote address, user agent, full stack trace
- Writes: JSON `{"error": "Internal Server Error", "code": 500}` via `httpresponse.RespondWithError`

This stage has `AlwaysEnforced: true` — it runs for every route, including public ones.

### Layer 2: Global Panic Recovery (`panic_recovery.go`)

`WithPanicRecovery` wraps the **entire** HTTP handler in `app/main.go`, including non-pipeline middleware (CSP, security headers). This is the last line of defense — if Layer 1 somehow fails, Layer 2 catches it.

Both layers produce JSON responses and log stack traces.

### Shared Response Helpers (`httpresponse.go`)

```go
httpresponse.RespondWithError(w, http.StatusNotFound, "Row not found")
httpresponse.RespondWithJSON(w, http.StatusOK, data)
```

These ensure every HTTP response uses the same JSON format:
- Error: `{"error": "message", "code": 404}`
- Success: `{...data...}`

Both set `Content-Type: application/json; charset=utf-8`.

### 403 Response Convention (Structural — auth_failure field)

The backend uses a **structured JSON field** to distinguish session/auth failures from business-logic permission denials. The frontend (`api_pipeline.js`) checks the `auth_failure` field — no string parsing required.

**How it works:**

| Backend function | JSON output | Frontend behavior |
|-----------------|-------------|-------------------|
| `RespondWithAuthFailure(w, msg)` | `{"error": "...", "code": 403, "auth_failure": true}` | Redirect to `/login` |
| `RespondWithError(w, 403, msg)` | `{"error": "...", "code": 403}` | Show toast, no redirect |

The `auth_failure` field uses `omitempty` — it only appears in the JSON when `true`.

**When adding new 403 responses in Go code:**
- If it's a **session/auth problem** (an ended or revoked sign-in, a lost device or fingerprint binding, a corrupt session, a missing user_id) → call `session_expiry.RespondSignInNoLongerValid(w, r, session, reason)`
- If it's a **business-logic permission denial** → use `httpresponse.RespondWithError(w, http.StatusForbidden, "message")`
- **No frontend changes needed.** The frontend only redirects when `auth_failure === true`.

This distinction prevents a permission denial from being misread as a broken
session and triggering an unnecessary login redirect.

### An ended sign-in is never answered with the login page

`app/backend/core_components/session_expiry/session_expiry_responder.go` owns the
one answer the application gives when a request arrives with a sign-in the server
can no longer accept. Every authentication stage calls it rather than deciding for
itself:

| Stage | Calls it when |
|-------|---------------|
| `auth_check/ensure_logged_in.go` | no sign-in on a site that requires one, a blocked guest session, an unreadable session or user identity |
| `fingerprint_check/fingerprint_check.go` | the browser's fingerprint binding is missing or does not match |
| `device_id_check/device_id_check.go` | the browser's device binding is missing or does not match |
| `admin_check/admin_user_check.go` | the session cannot be read, or carries no readable user identity |
| `access_control/access_control.go` | the same session problems, plus a guest opening a page that needs a sign-in |

The responder does three things: it drops the ended sign-in from the session, so
`GET /login` no longer sends an apparently signed-in visitor back to the page that
just refused them; it sends a **page navigation** to
`/login?auth_notice=session-ended&redirect=…`, which the login page turns into a
sentence in the person's own language; and it answers **every other request** with
`RespondWithAuthFailure`, so the application's own fetches get something they can
act on.

The rule they all follow is that a request for data is never answered with a
redirect to a page. A browser follows such a redirect silently, and the caller
receives the login page's HTML with status 200 — indistinguishable from real data.
That is what once left a person with a top bar, no navigation and no explanation,
because the reader of their access rights had quietly parsed a web page instead.

The frontend states the same rule as a detector, in
`isDataRequestAnsweredWithPage` in
`app/frontend/core_components/pipeline/api_pipeline_helpers.js`: a response that
followed a redirect off `/api/` and came back as markup is treated as an ended
sign-in. It is a guard against this class of mistake returning, not a second
implementation of the decision.

An administrator route refusing a signed-in person without administrator access,
and any other authorization denial, stay ordinary `RespondWithError` 403s. Those
two cases must never get the same words or the same recovery.

### The browser binding keeps pace with the session

A sign-in is carried by three cookies that each last seven days: the session
itself, and the two cookies that tie it to one browser (`device_id_*` and
`fingerprint_*`). The session's seven days restart every time a request writes
it, but the binding cookies were once written only at sign-in. A person who kept
using the site therefore reached a day where the session was still readable and
the binding had already run out underneath it, and was signed out although they
had never been away.

The two binding stages now renew the binding on the session's own terms. When a
request's binding has been compared with the session's and found equal, the
stage writes that same value back with a full fresh lifetime, so an active
person's binding cannot expire under a session that is still being extended.

Renewing is not accepting:

- the write happens only **after** the equality check, so the value handed back
  is the one the request already carried, never a new one;
- a request with a different or absent binding is refused before it reaches the
  renewal, and still gets the one ended-sign-in answer above;
- nothing renews without use — a browser that stops visiting keeps nothing, and
  comes back to that same answer.

There is deliberately no absolute maximum on how long an active sign-in may be
extended. The session has never had one either: only an explicit sign-out, or a
changed `authentication_generation` for that user, ends it before its time.

`app/backend/pipeline/session_binding_renewal_test.go` walks one browser through
the journey with a cookie jar that drops what has run out.

---

## 7. Introspection

The pipeline provides a debugging endpoint:

```
GET /api/pipeline-info?handler=<handlerName>
```

Response:

```json
{
    "handler": "dtt_1_row_delete.DeleteRowsHandlerWrapper",
    "stages": ["rate_limit", "request_size_limit", "logging", "error_handling", "auth", "csrf", "fingerprint", "device_id", "access_control", "admin_check", "transaction", "audit", "handler"]
}
```

This makes it possible to verify at runtime which stages a specific handler runs through. The endpoint is registered only in explicit development mode and uses `AdminProfile`.

---

## 7.1. Conformance Test

A compile-time conformance test ensures **every registered route** has an explicit entry in `RouteProfiles`:

```bash
go -C app test ./backend/pipeline/ -run TestRouteProfilesConformance -v
```

The test:
1. Calls `router.RegisterRoutes()` to populate the route definitions
2. Iterates all registered `HandlerName` values via `router.GetRouteDefinitions()`
3. Checks each one exists as a key in `pipeline.RouteProfiles`
4. Fails with a list of missing handlers if any are absent

**Why explicit `DefaultProfile`?** While `DefaultProfile` is the safe fallback (all stages active), implicit reliance on it means the security decision is undocumented. The conformance test enforces that even `DefaultProfile` routes are listed explicitly — making every route's security posture auditable.

**When running locally:** The test sets `ENABLE_API_LANGUAGE=true` to include conditional routes. If you add new conditional route registration patterns, ensure they are also covered.

---

## 7.2. Outer Chain vs Pipeline Stages

The HTTP request processing has two layers:

### Outer Chain (app/main.go)

These middlewares wrap the **entire mux** — they run for every request regardless of route:

```
MaintenanceMode → PanicRecovery → CSP → SecurityHeaders → Firewall → [mux/pipeline]
```

| Middleware         | Why outer? |
|--------------------|------------|
| `MaintenanceMode`  | Blocks ALL requests with 503 — must be outermost |
| `PanicRecovery`    | Global safety net — catches panics from any layer |
| `WithCSP`          | Generates nonce for Content-Security-Policy headers |
| `SecurityHeaders`  | Sets security response headers (X-Frame-Options, etc.) |
| `FirewallHandler`  | IP-level blocking — fastest rejection path |

These are stateless, apply uniformly, and don't benefit from per-route profiling.

### Pipeline Stages (per-route)

These stages run inside the pipeline and can be selectively skipped based on each route's profile:

```
rate_limit → request_size_limit → logging → error_handling → auth → csrf → fingerprint → device_id → access_control → admin_check → transaction → audit → [handler]
```

Moved from outer chain to pipeline (2026-02-27):
- **CSRF** (`csrf_check/csrf_check.go`): Previously had hardcoded URL exceptions in the old outer middleware. Now controlled by `SkipStages["csrf"]` in route profiles — PublicProfile skips it, all other profiles enforce it for state-changing methods (POST/PUT/PATCH/DELETE).
- **Transaction** (`lazy_transaction/with_lazy_transaction.go`): Lazy transaction provider. Included by the standard profiles, but skippable by explicit custom profiles such as `AccessControlNoTxProfile`.

---

## 8. How To: Common Tasks

### Add a New Pipeline Stage

1. **Create the stage** in its own package under `app/backend/pipeline/` (e.g. `app/backend/pipeline/my_stage/my_stage.go`):

```go
package my_stage

func WithMyStage(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // Pre-processing
        next(w, r)
        // Post-processing (if needed)
    }
}
```

If the stage needs route context (handler name, URL pattern, DB), accept those parameters:

```go
func WithMyStage(handlerName string, next http.HandlerFunc) http.HandlerFunc { ... }
```

2. **Add one entry** to `PipelineOrder` in `pipeline_order.go`:

```go
{
    Name:           "my_stage",
    AlwaysEnforced: false, // or true if it must run for every route
    Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
        return my_stage.WithMyStage(ctx.HandlerName, next)
    },
},
```

Place it in the correct position relative to existing stages. Consider:
- Does it need to know the user? → After `auth`
- Is it security-critical? → Before the handler, after auth
- Is it observability? → Near `logging`

3. **Restart the server.** Check with `/api/pipeline-info?handler=<name>` that the stage appears.

### Add a New Route

1. **Register the route and its allowed methods** in `router.go` (or `router_for_apps.go` for an application route), with `functionRegisterHandler`:

```go
functionRegisterHandler("/api/my-route", mypackage.MyHandler, "mypackage.MyHandler", http.MethodPost)
```

The router boundary rejects every undeclared method before handler code runs. Declaring `GET` also declares `HEAD`; handlers receive those permitted `HEAD` requests with GET semantics. The generated route manifest and assistant API catalog read this same declaration. Do not repeat method switches inside the handler. `routing_builder.go` holds no registrations: it turns the registered definitions into database rows and middleware chains.
2. **Add a profile entry** in `route_profiles.go` — **every route must have an explicit entry** (enforced by the conformance test):

```go
"mypackage.MyHandler": PublicProfile,    // No auth needed
"mypackage.MyHandler": AdminProfile,     // Admin only
"mypackage.MyHandler": LoginOnlyProfile, // Login but no permission check
"mypackage.MyHandler": DefaultProfile,   // Full auth + access control (explicit)
```

> **Note:** The conformance test (`TestRouteProfilesConformance`) will fail if any registered route is missing from `RouteProfiles`. Even routes using `DefaultProfile` must be listed explicitly so the security decision is documented.

3. **Restart and verify** with `/api/pipeline-info?handler=mypackage.MyHandler`.

### Change a Route's Security Profile

Edit a single line in `route_profiles.go`:

```go
// Before: full access control
// After: public
"mypackage.MyHandler": PublicProfile,
```

Restart.

### Create a Custom Profile

For routes that need a non-standard combination:

```go
var MyCustomProfile = RouteProfile{
    SkipStages: map[string]bool{
        "fingerprint": true,  // Skip fingerprint but keep auth
    },
}

// In RouteProfiles:
"mypackage.MyHandler": MyCustomProfile,
```

---

## 9. File Reference

| File | Purpose |
|------|---------|
| `app/backend/pipeline/pipeline.go` | Core types: Stage, StageFunc, RouteContext, RouteProfile |
| `app/backend/pipeline/pipeline_order.go` | Ordered list of all stages (single source of truth) |
| `app/backend/pipeline/build_pipeline.go` | BuildHandler, DescribePipeline, resolveActiveStages |
| `app/backend/pipeline/route_profiles.go` | Per-route profiles, reusable templates, dev overrides |
| `app/backend/pipeline/pipeline_conformance_test.go` | Ensures every route has an explicit profile entry |
| `app/backend/pipeline/introspection_handler.go` | `/api/pipeline-info` debugging endpoint |
| `app/backend/pipeline/csrf_check/csrf_check.go` | CSRF token validation stage |
| `app/backend/pipeline/lazy_transaction/with_lazy_transaction.go` | Lazy database transaction stage |
| `app/backend/pipeline/audit/with_audit.go` | Semantic audit logging stage (async batched inserts) |
| `app/backend/pipeline/error_handling/error_recovery.go` | Per-route panic recovery (pipeline stage) |
| `app/backend/core_components/middlewares/panic_recovery.go` | Global panic recovery (app/main.go wrapper) |
| `app/backend/core_components/middlewares/with_transaction.go` | Legacy transaction middleware (no longer called from app/main.go) |
| `app/backend/core_components/httpresponse/httpresponse.go` | Shared JSON response helpers |
| `app/backend/core_components/router/routing_builder.go` | Route registration, calls BuildHandler |
| **Frontend** | |
| `app/frontend/core_components/pipeline/frontend_pipeline.js` | Generic async pipeline runner (shared by nav + API) |
| `app/frontend/core_components/pipeline/navigation_pipeline.js` | Navigation pipeline: 4 stages, `describeNavigationPipeline()` |
| `app/frontend/core_components/pipeline/api_pipeline.js` | API pipeline: 9 stages, endpoint_map |
| `app/frontend/core_components/navigation/nav_engine/navigation_handler.js` | Navigation entry point, builds pipeline context |

---

## 10. Frontend Pipelines

The frontend mirrors the backend Pipeline Mediator pattern with two client-side pipelines that share a common runner (`frontend_pipeline.js`). Both use the same `createStage()` / `createPipeline()` / `runPipeline()` primitives.

### 10.1. Pipeline Runner (`frontend_pipeline.js`)

The generic runner powers all frontend pipelines:

```javascript
runPipeline(stages, context)   // Run stages sequentially against shared context
createPipeline(stages)         // Factory: returns (context) => runPipeline(stages, context)
createStage(name, fn, alwaysEnforced)  // Declare a stage with consistent shape
```

**Skip mechanism:** `context.skip` is an array of stage names. If a stage name appears in the skip array and the stage is not `alwaysEnforced`, it is bypassed. This provides implicit profiling — callers can selectively skip stages without needing formal profile objects.

**Abort protocol:** Any stage can return `{ abort: true, reason: '...' }` to halt the pipeline. The abort result propagates to the caller; no downstream stages execute.

### 10.2. Navigation Pipeline (`navigation_pipeline.js`)

Handles client-side view transitions — every tab/route change flows through this pipeline.

| # | Stage Name       | AlwaysEnforced | Purpose |
|---|------------------|:-:|---|
| 1 | `dirtyCheck`     | No  | Aborts if user has unsaved changes (calls `window.check_manage_permissions_dirty()`) |
| 2 | `permissionCheck`| No  | Aborts if user lacks access to target route (API routes, custom views, dataset tables) |
| 3 | `urlUpdate`      | No  | Writes the URL the caller asked for, via `updateURL()` |
| 4 | `viewRender`     | Yes | Switches containers, lazy-loads content, shows/hides loading spinner |
| 5 | `datasetAddress` | No  | Corrects the address to the state that actually rendered, via `updateDatasetAddress()` |
| 6 | `browserTabTitle`| Yes | Retitles the browser tab for the settled state, via `updateBrowserTabTitle()` |

Stages 3 and 5 are not the same decision twice. `urlUpdate` writes the address a
caller requested, before anything renders. `datasetAddress` runs after rendering
and replaces that entry with the address the settled state produced: the dataset
through its alias, the view that survived permission and capability checks, and
the open row when one is open. It writes the cached query parameters with the
address, so the two cannot drift apart. Its owner is
`navigation/nav_engine/dataset_address_writer.js`, which also owns the
serialisation behind `updateURL()`.

**Profiling approach:** Rather than explicit profile objects (like the backend's `RouteProfiles`), the navigation pipeline uses `context.skip` arrays. This was a deliberate design decision: with few skippable stages, named profiles would add abstraction without proportional value.

**Current skip patterns in the codebase:**

| Caller | Skip | Why |
|--------|------|-----|
| Back/forward navigation (`history_navigation_handler.js`) | `['urlUpdate']` | Browser already moved the address; the settled state still corrects it |
| Landing on frontpage (`table_loader_handler.js`) | `['urlUpdate']` | Initial load — URL is already correct |
| Image-first article (`image_first_view_history.js`) | `['urlUpdate', 'datasetAddress']` | That view owns its own address, row and image |
| Normal navigation | `[]` (no skip) | Full pipeline |

**Introspection:** Call `describeNavigationPipeline()` (exported from `navigation_pipeline.js`) to get the pipeline structure at runtime:

```javascript
import { describeNavigationPipeline } from './navigation_pipeline.js';
console.table(describeNavigationPipeline());
// → [{ name: 'dirtyCheck', alwaysEnforced: false }, ...]
```

### 10.3. API Pipeline (`api_pipeline.js`)

Handles all HTTP API requests from the frontend. Every `O()` call (the endpoint router) flows through this pipeline.

| # | Stage Name         | AlwaysEnforced | Purpose |
|---|--------------------|:-:|---|
| 1 | `resolveUrl`       | No  | Resolves endpoint name to URL pattern via `endpoint_map` |
| 2 | `buildFetchOptions` | No  | Constructs fetch init (method, headers, body) from context; marks it as a request whose notice the pipeline owns |
| 3 | `csrf`             | No  | Attaches cached CSRF token to state-changing requests |
| 4 | `fingerprint`      | No  | Computes and attaches browser fingerprint hash |
| 5 | `execute`          | No  | Performs the actual `fetch()` call; shows the network notice when the request never reaches the service |
| 6 | `csrfRecovery`     | No  | Refreshes the CSRF token and retries once after a CSRF-specific 403 |
| 7 | `authRedirect`     | No  | Redirects to login on 401 responses and session-failure 403s |
| 8 | `rateLimitHandler` | No  | Shows the rate-limit notice on 429 responses |
| 9 | `serviceUnavailable` | No | Shows the maintenance notice on 503 responses |
| 10 | `errorHandler`    | No  | Shows the one notice for any other 4xx/5xx response |
| 11 | `responseParse`   | No  | Parses JSON response body |

The API pipeline has no `alwaysEnforced` stages — all stages are skippable via `context.skip`. Callers can pass options like `{ returnResponse: true }` to customize behavior (e.g., skip response parsing and get the raw `Response` object).

The pipeline owns the failure notice of every request it sends, and each failure gets exactly one, in the reader's language (`request_failure_notice.js`): the sentence is a `data-lang-key` element that the translation handler fills from the site's translations, starting from bootstrap copy in the page's language. A 5xx shows `server_error_notice`, a 503 `service_unavailable_notice` instead, a 429 `rate_limit_notice`, a 403 the permission notice, a request that never reaches the service `network_error_notice`, and any other 4xx `request_failed_notice`, or the reason the server names by language key (`error_lang_key` in a JSON body). The status code follows the 5xx and 4xx sentences. The route, the address and the server's own text are technical detail: they go to the console and the thrown error, never the notice. A request its caller cancelled, or one sent while the page is being left, gets no notice.

A caller that shows its own error passes `{ suppressErrorToast: true }`; the pipeline's notices then stay silent. `buildFetchOptions` marks every request's fetch options (`markCallerOwnsFailureNotice`, a non-enumerable mark that never reaches the network), so the global fetch monitor (`error_monitor_handler.js`) adds no second notice. The monitor's own notices, with the same copy, are for fetches outside the pipeline.

### 10.4. Frontend vs Backend Pipeline Comparison

| Aspect | Backend | Frontend Navigation | Frontend API |
|--------|---------|--------------------:|-------------:|
| Stages | 12 | 6 | 9 |
| Runner | `BuildHandler()` (Go) | `runPipeline()` (JS) | `runPipeline()` (JS) |
| Profiling | Explicit `RouteProfile` objects | Implicit `context.skip` arrays | Implicit `context.skip` + options |
| AlwaysEnforced | 5 stages | 2 stages (`viewRender`, `browserTabTitle`) | 0 stages |
| Introspection | `/api/pipeline-info` endpoint | `describeNavigationPipeline()` | — |
| Conformance | `TestRouteProfilesConformance` | N/A (6 stages, low risk) | N/A |

**Why no explicit profiles on the frontend?** The backend has 103+ routes × 11 stages — without explicit profiles, security decisions would be invisible. The frontend navigation pipeline has 1 entry point and a handful of stages with only a few active skip patterns. An explicit `NavigationProfiles` object would add indirection without improving clarity or safety.

---

## 11. Design Principles

1. **Declarative over imperative.** Stage order is a data structure, not control flow.
2. **Secure by default.** Unknown routes get maximum protection (DefaultProfile).
3. **Single responsibility.** Each stage does exactly one thing.
4. **Single source of truth.** Stage order in one file, route profiles in another.
5. **Visible.** `/api/pipeline-info` makes the pipeline inspectable at runtime.
6. **AlwaysEnforced for safety.** Critical stages (rate limiting, request size limits, logging, error handling, audit) cannot be accidentally skipped.
7. **Extensible.** Adding a stage = one entry in `pipeline_order.go`. Adding a route = one entry in `route_profiles.go`.
8. **Frontend mirrors backend.** Both sides use the same pattern (ordered stages, skip lists, abort protocol) with appropriate granularity for their scope.
