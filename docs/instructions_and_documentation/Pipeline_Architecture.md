# Pipeline Architecture

This document describes the Pipeline Mediator pattern used in Easelect's backend HTTP request processing. It explains how requests flow through middleware stages, how route profiles control which stages apply, and how to add new stages or configure routes.

**Source code:** `backend/pipeline/`  
**Related middleware:** `backend/core_components/middlewares/`  
**Shared response helpers:** `backend/core_components/httpresponse/`

---

## 1. Overview

Every HTTP request in Easelect flows through a **pipeline** — an ordered sequence of middleware stages. Each stage performs one concern (rate limiting, logging, authentication, etc.) and wraps the next stage in the chain.

The pipeline is **declarative**: the stage order is defined in a single file (`pipeline_order.go`), and per-route configuration is defined in another single file (`route_profiles.go`). There are no scattered `switch` statements or map literals.

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
| 7  | `fingerprint`    | No        | Validates browser fingerprint matches session         |
| 8  | `device_id`      | No        | Validates device ID matches session                   |
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

`ApplyDevOverrides()` is called at startup when `ENVIRONMENT_TYPE=dev`. It makes certain schema modification endpoints public for development convenience. These overrides only affect the running instance, not the source code.

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

`WithPanicRecovery` wraps the **entire** HTTP handler in `main.go`, including non-pipeline middleware (CSP, security headers). This is the last line of defense — if Layer 1 somehow fails, Layer 2 catches it.

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
- If it's a **session/auth problem** (corrupt session, missing user_id) → use `httpresponse.RespondWithAuthFailure(w, "message")`
- If it's a **business-logic permission denial** → use `httpresponse.RespondWithError(w, http.StatusForbidden, "message")`
- **No frontend changes needed.** The frontend only redirects when `auth_failure === true`.

**Current auth-failure call sites** (the only places using `RespondWithAuthFailure`):

| File | Reason |
|------|--------|
| `ensure_logged_in.go` | user_id in session is not an int (corrupt session) |
| `admin_user_check.go` (2 sites) | session error / user_id not int |
| `access_control.go` | user_id not int |

See also: `docs/risk_management/login_redirect_after_server_restart.md` for the incident that motivated this design.

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
go test ./backend/pipeline/ -run TestRouteProfilesConformance -v
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

### Outer Chain (main.go)

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

1. **Create the stage** in its own package under `backend/pipeline/` (e.g. `backend/pipeline/my_stage/my_stage.go`):

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

1. **Register the route** in `routing_builder.go` as usual (add to `routeDefinitions`).
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
| `backend/pipeline/pipeline.go` | Core types: Stage, StageFunc, RouteContext, RouteProfile |
| `backend/pipeline/pipeline_order.go` | Ordered list of all stages (single source of truth) |
| `backend/pipeline/build_pipeline.go` | BuildHandler, DescribePipeline, resolveActiveStages |
| `backend/pipeline/route_profiles.go` | Per-route profiles, reusable templates, dev overrides |
| `backend/pipeline/pipeline_conformance_test.go` | Ensures every route has an explicit profile entry |
| `backend/pipeline/introspection_handler.go` | `/api/pipeline-info` debugging endpoint |
| `backend/pipeline/csrf_check/csrf_check.go` | CSRF token validation stage |
| `backend/pipeline/lazy_transaction/with_lazy_transaction.go` | Lazy database transaction stage |
| `backend/pipeline/audit/with_audit.go` | Semantic audit logging stage (async batched inserts) |
| `backend/pipeline/error_handling/error_recovery.go` | Per-route panic recovery (pipeline stage) |
| `backend/core_components/middlewares/panic_recovery.go` | Global panic recovery (main.go wrapper) |
| `backend/core_components/middlewares/with_transaction.go` | Legacy transaction middleware (no longer called from main.go) |
| `backend/core_components/httpresponse/httpresponse.go` | Shared JSON response helpers |
| `backend/core_components/router/routing_builder.go` | Route registration, calls BuildHandler |
| **Frontend** | |
| `frontend/core_components/pipeline/frontend_pipeline.js` | Generic async pipeline runner (shared by nav + API) |
| `frontend/core_components/pipeline/navigation_pipeline.js` | Navigation pipeline: 4 stages, `describeNavigationPipeline()` |
| `frontend/core_components/pipeline/api_pipeline.js` | API pipeline: 9 stages, endpoint_map |
| `frontend/core_components/navigation/nav_engine/navigation_handler.js` | Navigation entry point, builds pipeline context |

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
| 3 | `urlUpdate`      | No  | Pushes new URL to browser history via `updateURL()` |
| 4 | `viewRender`     | Yes | Switches containers, lazy-loads content, shows/hides loading spinner |

**Profiling approach:** Rather than explicit profile objects (like the backend's `RouteProfiles`), the navigation pipeline uses `context.skip` arrays. This was a deliberate design decision: with only 4 stages (3 skippable), named profiles would add abstraction without proportional value.

**Current skip patterns in the codebase:**

| Caller | Skip | Why |
|--------|------|-----|
| Back/forward navigation (`history_navigation.js`) | `['urlUpdate']` | Browser already updated the URL bar |
| Landing on frontpage (`load_tables.js`) | `['urlUpdate']` | Initial load — URL is already correct |
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
| 2 | `buildFetchOptions` | No  | Constructs fetch init (method, headers, body) from context |
| 3 | `csrf`             | No  | Attaches cached CSRF token to state-changing requests |
| 4 | `fingerprint`      | No  | Computes and attaches browser fingerprint hash |
| 5 | `execute`          | No  | Performs the actual `fetch()` call |
| 6 | `authRedirect`     | No  | Redirects to login on 401 responses |
| 7 | `rateLimitHandler` | No  | Shows toast notification on 429 responses |
| 8 | `errorHandler`     | No  | Shows error toast on 4xx/5xx responses |
| 9 | `responseParse`    | No  | Parses JSON response body |

The API pipeline has no `alwaysEnforced` stages — all stages are skippable via `context.skip`. Callers can pass options like `{ returnResponse: true }` to customize behavior (e.g., skip response parsing and get the raw `Response` object).

### 10.4. Frontend vs Backend Pipeline Comparison

| Aspect | Backend | Frontend Navigation | Frontend API |
|--------|---------|--------------------:|-------------:|
| Stages | 12 | 4 | 9 |
| Runner | `BuildHandler()` (Go) | `runPipeline()` (JS) | `runPipeline()` (JS) |
| Profiling | Explicit `RouteProfile` objects | Implicit `context.skip` arrays | Implicit `context.skip` + options |
| AlwaysEnforced | 5 stages | 1 stage (`viewRender`) | 0 stages |
| Introspection | `/api/pipeline-info` endpoint | `describeNavigationPipeline()` | — |
| Conformance | `TestRouteProfilesConformance` | N/A (4 stages, low risk) | N/A |

**Why no explicit profiles on the frontend?** The backend has 103+ routes × 11 stages — without explicit profiles, security decisions would be invisible. The frontend navigation pipeline has 1 entry point × 4 stages with only 1 active skip pattern. An explicit `NavigationProfiles` object would add indirection without improving clarity or safety.

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
