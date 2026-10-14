<!-- Frontend_Document_Startup_And_Recovery.md: explains how page shells start and recover. -->
<!-- Connects SPA navigation, authentication entry, the boot guard and recovery documents. -->
<!-- Exists to keep startup and recovery guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Document Startup and Recovery

Part of the [Frontend Guide](Frontend_Guide.md).

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
