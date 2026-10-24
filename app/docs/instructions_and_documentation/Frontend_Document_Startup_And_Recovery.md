<!-- Frontend_Document_Startup_And_Recovery.md: explains how page shells start and recover. -->
<!-- Connects SPA navigation, authentication entry, the boot guard and recovery documents. -->
<!-- Exists to keep startup and recovery guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Document Startup and Recovery

Part of the [Frontend Guide](Frontend_Guide.md).

## Production bundle addresses

The production base in [vite.config.mjs](../../frontend/vite.config.mjs) is
`/frontend/dist/`, matching the directory served by Go. Vite uses it for
preload hints and emitted asset URLs; module imports resolve beside their
bundled entry. The server selects the current hashed main, login and CSS files
through [asset_paths.go](../../backend/core_components/frontend_assets/asset_paths.go).
Explicit source icon URLs under `/frontend/icons/` and service addresses keep
their own paths. Development serving retains base `/` and the existing source
asset rewrite.

Refresh the tracked bundle with `./filterest build --outDir dist`, following
the [Developer Guide](DEV_GUIDE.md#build-and-run). The ordinary Python
[bundle check](../../testing/python/test_browser_bundle_check.py) resolves
emitted imports and Vite preload maps against the served dist directory and
refuses missing files or a preload prefix outside it. The release
[bundle audit](../../server_tools/release/audit_browser_bundle.py) separately
rebuilds and compares every filename and byte; both checks are needed because
an incorrect base can be reproducible.

## SPA Navigation Contract

Filterest is a single-page application (SPA). **No user or administrator workflow
should require a manual browser refresh (F5).** Ordinary navigation and successful
changes must update the current shell through application state, refreshed data
and the History API. This is the development contract; the
[immediate UI update inventory](SPA_Immediate_UI_Update_Inventory.md) records
remaining implementation gaps rather than exceptions to the rule.

### Root login-to-browse contract

For an installed site with First Run complete, an ordinary visit to `/` follows
the browsing policy (`login_to_browse`) and the current sign-in:

| `login_to_browse` | Signed in? | Entry page | Address bar route |
|---|---|---|---|
| `true` | no | Standalone login form and tour | `/login` |
| `true` | yes | Normal application landing page | `/` or the selected default dataset address |
| `false` | no | Normal application landing page | `/` or the selected default dataset address |
| `false` | yes | Normal application landing page | `/` or the selected default dataset address |

The server's `rootHandler` in
[root_handler.go](../../backend/core_components/router/root_handler.go) owns the
guest redirect to `/login` (HTTP 303). The application landing page is the
[optional Home page](Frontend_Home_Page.md#optional-home-page) when enabled;
otherwise `load_tables` in
[table_loader_handler.js](../../frontend/core_components/admin_tools/main/table_loader_handler.js)
and `initTabs` select the initial dataset/view and update the address inside the
SPA. A dataset address here does not imply a full document redirect.

When Vite serves the development root before the Go handler, it mirrors the
guest-login rule by reading backend auth modes. `devForcedLoginRootRedirect`,
`shouldRedirectDevRootToStandaloneLogin` and `isRootDocumentRequest` in
[vite.config.mjs](../../frontend/vite.config.mjs) check ordinary root document
requests; explicit login/register entry queries bypass that redirect. Use the
configured development address, not a fixed Vite port. An unavailable auth-mode
response falls through to normal Vite handling.

### Pre-authentication entry routes

| Entry | Current behavior and owner |
|---|---|
| `GET /login` | For a guest, `LoginHandler` in [login_form_printer.go](../../backend/core_components/auth/login_form_printer.go) renders the standalone login form and tour. An already signed-in visitor is redirected to `/`; pending First Run goes to `/first-run`. |
| `/?login-entry=1` | Explicit guest-shell entry. `handleLoginShellEntry` in [login_shell_entry.js](../../frontend/core_components/auth/login_shell_entry.js) opens the login modal after shell startup. Ordinary in-shell login on a public-browsing site also opens this modal. |
| `GET /register_*` | The registered compatibility address is `/register_ndYOyXV0INOK3F`. With registration enabled and without `fragment=1`, `RegisterHandler` in [register.go](../../backend/core_components/auth/register.go) sends HTTP 303 to `/?register-entry=1`, preserving an optional `redirect` query. |
| `/?register-entry=1` | `handleRegisterShellEntry` in [register_shell_entry.js](../../frontend/core_components/auth/register_shell_entry.js) removes the entry marker with `replaceState` and opens the Register tab. The server permits explicit entry queries even when browsing requires login. |
| `/login?fragment=1` and `/register_ndYOyXV0INOK3F?fragment=1` | HTML fetch surfaces for embedding the authentication forms; they are not ordinary standalone entry pages. The login modal owns the embedded form's interactions. |

**Bare `/register` differs from the compatibility route in this checkout.** The
session prompt below navigates there, and `isExplicitAuthEntryRoute` recognizes
it, but `rootHandler` has no special `/register` redirect and the router does
not register it with `RegisterHandler`. On a login-required site the generic
guest route goes to `/login`; on a public-browsing site it can serve the generic
SPA document. Do not claim that bare `/register` hands off to
`/?register-entry=1`. The bootstrap's route check is not a hard navigation.

### Shared sign-in verification view

The standalone page and modal retain their existing request controllers and
reuse [login.html](../../frontend/templates/login.html). Their PIN, authenticator,
email-code and recovery-code phases mount one presentation adapter from
[second_step_view.js](../../frontend/core_components/auth/second_step_view.js).
[second_step_factors.js](../../frontend/core_components/auth/second_step_factors.js)
owns each factor's copy keys, input attributes, semantic length and secondary actions.
The renderer accepts an `auth-verify` root with the template's `data-verify` slots
and a descriptor, plus optional caller-owned primary/back/resend controls. New
slot identities are unique per mount; existing input identities remain stable.
Profile verification and PIN/authenticator enrollment are separate callers for a
later batch; extend these descriptors and slots instead of adding another renderer.

The code view normalizes whitespace without truncating codes, preserves password
values, and keeps polite inline errors beside their field. It focuses the phase
heading at phone widths up to 520px and the field on desktop; validation failures
focus the field. Delivered email/recovery codes can be requested again, with
pending/failure status and no client countdown. PIN/authenticator help directs the
person to the site administrator. Password recovery retains the existing neutral
delivery statement. Local FI/EN copy is collected by the shared translator, and
startup only inserts missing keys or fills empty language values.

#### Password managers

The sign-in PIN is a numeric `one-time-code` text field, visually masked with
`-webkit-text-security: disc`. The eye button toggles that CSS mask; it never
changes the input type. Resetting or remounting the step restores the mask.
The first step remains the only login password field (`current-password`);
recovery's replacement password retains `new-password`. Authenticator, email
and recovery codes keep their existing one-time-code text-field descriptors.

Accessibility trade-off: a screen reader may echo the PIN digits in a masked text
field, whereas a password field is announced as secure. The translated label,
`aria-describedby` hint, polite errors and live status remain available.
Manual Firefox check: with a saved login, confirm that the PIN field offers no
saved login and that the first-step password field still offers it; also check
mask/reveal and reset. Browser password-manager heuristics need this manual proof.

### Post-login transition

Modal credentials or OTP success calls `completeSuccessfulModalLogin` in
[login_modal_printer.js](../../frontend/core_components/auth/login_modal_printer.js).
It applies the same-origin return path through `history.replaceState` (or clears
the login-entry query), publishes login to sibling tabs when configured, and
calls `runPostAuthBootstrap` in
[post_auth_bootstrap.js](../../frontend/core_components/auth/post_auth_bootstrap.js).
That shared bootstrap refreshes auth modes and permissions, rebuilds permitted
navigation containers, reloads datasets and initializes tabs in place. Successful
completion hides the modal without a document reload; failure uses the recovery
reload listed below.

The standalone login document has no application shell to rebuild. Its
credentials and OTP handlers load a new document after success, using
`resolvePostLoginTarget`: same-origin `redirect` query first, then the API's
same-origin redirect, then `/`. The modal fetch fragment does not independently
perform that standalone navigation.

### Intentional hard navigation boundaries

These are the current document navigations, identified by functions and source
files rather than changing line numbers. Distinguish a failed SPA recovery from
a standalone document boundary or an explicitly invoked recovery tool.

| Function / handler and file | Trigger and document action |
|---|---|
| `handleCredentialsPhase` and `handleOTPPhase` in [login_page_builder.js](../../frontend/core_components/auth/login_page_builder.js) | Standalone authentication succeeds: assign `window.location.href` to `resolvePostLoginTarget(...)`. There is no SPA shell on this document. |
| Anonymous `[data-auth-public-back]` click handler inside the `DOMContentLoaded` listener in `login_page_builder.js` | Return from standalone login: `window.location.replace(computeStandaloneLoginBackTarget(...))` chooses a safe same-origin public referrer or `/`. This is a document boundary, not an SPA failure. |
| `completeSuccessfulModalLogin` in `login_modal_printer.js` | Post-login shell rebuilding throws: close the modal and call `window.location.reload()` in the catch block. |
| `refreshTableUnified` in [table_refresh_unified.js](../../frontend/core_components/general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js) | A current refresh reports a missing dataset and `redirectToRootInSpa()` throws: `window.location.replace('/')`. |
| `drop_table`'s `onConfirmed` callback in [table_remover.js](../../frontend/core_components/general_tables/gt_3_table_crud/gt_3_2_table_delete/table_remover.js) | After hiding or permanently deleting a dataset, `redirectToRootInSpa()` throws: `window.location.replace('/')`. |
| `returnFromDatasetHeaderConfiguration` in [custom_view_reader.js](../../frontend/core_components/navigation/admin_and_user_tools/custom_view_reader.js) | First try the selected dataset's navigation button. If it is absent, `window.location.assign(...)` loads its dataset address or `/`; this availability fallback is not a catch block. |
| `window.__resetSession` in [error_monitor_handler.js](../../frontend/core_components/error_and_status_handling/error_monitor_handler.js) | Explicit browser-console recovery tool: POST the server's instance-scoped session reset, then `location.reload()` on success. |
| `requestSessionAccessPrompt`'s Home/Register click handlers in [session_access_prompt.js](../../frontend/core_components/auth/session_access_prompt.js) | Clear dataset selection, close the prompt, then `window.location.assign('/')` or `window.location.assign('/register')`. Register is offered only when registration is enabled and login is not restricted to administrators; Sign in opens the modal in place. These are current session-recovery document transitions. |
| `navigateDocument` in [shell_boot_recovery.js](../../backend/core_components/frontend_assets/shell_boot_recovery.js) | Failed document startup: restore the initial URL, then reload a GET document or `replace(initialURL)` to retry a POST document as GET. The bounded automatic retry and explicit recovery button follow [Document startup and recovery](#document-startup-and-recovery). |

### Session-end redirect: open owner decision

**Redirecting when a session ends remains WL118's open matter (owner decision
K228).** The following describes the current implementation, not a settled rule
requiring these redirects to remain:

- `requestLoginRedirect` in
  [login_redirect_handler.js](../../frontend/core_components/auth/login_redirect_handler.js)
  uses `window.location.assign(...)` for login-required browsing or explicit
  authentication failure, adding the session-ended notice for the latter.
  User-initiated login on a public-browsing site instead opens the modal.
- `RespondSignInNoLongerValid` in
  [session_expiry_responder.go](../../backend/core_components/session_expiry/session_expiry_responder.go)
  redirects browser document requests to login with the notice and return path;
  API requests receive a machine-readable authentication failure.
- `navigateToPostLogoutPath` in
  [logout_shell_reset.js](../../frontend/core_components/auth/logout_shell_reset.js)
  calls `locationObject.assign(...)` after local auth cleanup. `openNavTab` in
  [main_tab_printer.js](../../frontend/core_components/navigation/main_tabs/main_tab_printer.js)
  uses it after sign-out; `handleAuthBroadcastEvent` in
  [auth_broadcast_sync.js](../../frontend/core_components/auth/auth_broadcast_sync.js)
  also uses it for applicable cross-tab logout/reset events. The server's
  `LogoutHandler` in
  [logout_handler.go](../../backend/core_components/auth/logout_handler.go)
  chooses `/login` when browsing requires login, otherwise `/`, or a login notice
  when sign-out could not be recorded.
- The old `window.location` logout fallback in `main_tab_printer.js` is gone.
  Its catch now calls `navigateToSignOut` in `logout_shell_reset.js`, which submits
  a CSRF-bearing POST form to `/api/logout` and follows the server's redirect.
  If no token is available, it reports failure without navigating.

### Development rule

New features must keep normal user and administrator workflows inside the SPA.
Do not add `window.location` assignments, reloads or equivalent full-document
transitions to make ordinary navigation or a successful change take effect.
New hard-navigation error fallbacks belong in a catch block after an SPA-first
attempt fails. Keep the existing standalone entry, startup recovery and explicit
console-tool boundaries scoped to their purposes; the availability fallback and
session-recovery actions above do not authorize more normal-flow reloads.
Resolve session-end navigation policy through WL118/K228 rather than treating
the current redirects as an approved exception.

## Document startup and recovery

The application document and standalone login, registration and First Run forms
inline one nonce-authorized guard from `backend/core_components/frontend_assets/shell_boot_recovery.js`
and its independent stylesheet. Authentication fragments never arm this guard.
Only the unfinished shell is hidden, with layout retained. The base application
stylesheet (or the authentication stylesheet) supplies a computed-style sentinel;
the entry module signals evaluation at its first executable statement. Authentication
entry modules check the document's authentication CSS probe before signalling, since
the application also imports registration helpers. Both gates
reveal the shell immediately. The later `ready()` signal records development timing
and disarms diagnostics; a slow or failed data-driven startup never hides, reloads
or announces failure after the shell has been revealed.

A pending document shows translated loading text after three visible seconds.
Required-asset errors, pre-evaluation exceptions/rejections, a missing CSS sentinel
after stylesheet load, or thirty visible seconds without both gates trigger recovery.
Hidden/frozen time is excluded; visibility and page restoration recheck the gates.
After at least 1.5 visible seconds, a GET document may reload its initial URL once.
The session-storage allowance is per initial URL, with a ten-minute cooldown and
an unresolved-episode flag which cannot expire into a retry loop. Success ends the
episode while retaining the cooldown. Offline, storage-denied, non-GET and already
interacted documents offer the translated reload button immediately at that point.
Before reveal or interaction, automatic recovery reserves the initial URL's
allowance, restores that exact address with `history.replaceState` while preserving
history state, verifies the result, then reloads. A failed or ineffective restoration
offers the button and keeps the allowance reserved; no extra history entry is added.
The button makes a fresh GET document request, retaining the initial query bytes
(including repeated values and encoding) and fragment even after a POST-rendered
failure. GET documents restore the captured address and reload; POST documents use
`location.replace`, first adding a temporary query marker through `replaceState`
when a fragment could cause same-document navigation. Cancelled navigation restores
the previous address and state without resetting the budget. Nothing clears sessions
or user preferences. Unsupported browsers and disabled JavaScript receive escaped,
server-rendered notices. Emergency fi/en copy covers unavailable language keys;
the first available request `?lang` then `Accept-Language` preference in descending
quality order (stable for ties, excluding `q=0`) determines recovery copy, falling
back to the canonical enabled default before frontend preferences load. Ordinary
dataset metadata keeps its existing language resolver. Generic site previews
use that same shell language and already-read Home wording, as described in
[Home's shared-link metadata](Frontend_Home_Page.md#shared-link-metadata).
Recovery respects the stored
light/dark/system theme.

Every rendered shell and maintenance response is no-store; this reduces stale
asset references but does not guarantee browser session-restoration behavior.
Authentication renderers apply cache protection before session/template work and
buffer template output. Missing, broken or failing standalone templates return the
shared translated recovery document; fragment failures retain their JSON response.
Development-only records in sessionStorage keep at most ten entries for thirty
minutes, with asset/source path, stage, probe state, timing, visibility and offline
state. Exception/rejection details contain only an allowed standard error name and
fixed category. They exclude free messages/stacks, URL queries/fragments, forms,
credentials and response bodies. Replay uses the same representation whitelist,
and recovery entries in the existing local development buffer capture only the
current address's pathname.
Early imports of the development transport leave pending-shell errors to the
guard, preventing an unsanitized duplicate in the normal error buffer.
The existing development error forwarder replays these after recovery and deletes
each only after an acknowledged 2xx. Production never forwards them. Resource-error
events cannot identify HTTP/TLS causes; diagnosis must not invent those details.

## Runtime JavaScript notices

After startup, the global monitor delegates runtime errors and rejected promises
through `client_error_classifier.js` in the error/status handling component.
Its exported `classifyClientError` contract is also intended for WO36's future
client error log: own, foreign or opaque. Attribution uses same-origin served
JavaScript paths, including source modules, dist bundles and component frontend
assets. An explicitly empty source is opaque; stack-only Error rejections can
supply their source through an own frame. When a stack exists it must contain
an own frame. Frame parsing removes the complete message/header, including
multiline messages; Firefox/Safari stacks without headers retain their first frame.
A supplied foreign source still vetoes an own frame. The document URL is always
foreign, as browser injections can report it. Extension errors and opaque errors remain console-only.

Own errors show a manually dismissed notice. Visitors and ordinary users see
`client_error_notice`, with early fi/en/ch/yue fallback copy and runtime
translation through the ordinary `data-lang-key` observer. Migration
`20261015000007_seed_client_error_notice_language_key.sql` seeds Finnish/English
in both stores and is included by the public bootstrap generator (DB 9.12.0,
before the release owner ending in `000099`). Site-authored copy is preserved.
Only a successful read of the existing administrator-protected version-info
endpoint permits technical copy; a cached route grant alone is insufficient.
Failed verification or a session change uses the generic notice. Technical
copy is at most 240 characters, replaces full URLs with basenames, and removes
queries and fragments. Already-visible technical notices are removed synchronously
on session-generation invalidation; logout invalidates before clearing auth artifacts,
including the in-place cross-tab reset. Generic notices remain visible.
ResizeObserver loop warnings remain ignored. The fetch monitor's existing
network/5xx policy is unchanged.

The browser proof is `J_modals/J4_client_error_notices.spec.ts`. Its init script
throws from a browser-injected context after monitor installation. Intercepted
`/frontend/wo35-error-probe.js` modules then throw asynchronously and reject an
Error promise, exercising native events without a production test hook. It
covers visitors, ordinary users and administrators, fi/en, both application
themes against the opposite operating-system theme, and the selected matrix
viewports. Preference responses are isolated; no database records are created.
Run it against a native instance serving this worktree, with public browsing
and reserved administrator/user test accounts, using:

```bash
nice -n 10 env FILTEREST_NODE_MODULES_ROOT="$PWD/data/runtime/node/node_modules" \
  FILTEREST_E2E_BASE_URL=https://localhost:8100 PLAYWRIGHT_HTML_OPEN=never \
  ./filterest test testing/e2e/J_modals/J4_client_error_notices.spec.ts \
  --project=desktop-card --project=mobile-card --workers=1
```
