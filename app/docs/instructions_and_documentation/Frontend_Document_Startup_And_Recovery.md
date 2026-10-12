<!-- Frontend_Document_Startup_And_Recovery.md: explains how page shells start and recover. -->
<!-- Connects the inline boot guard, entry modules and server-rendered recovery documents. -->
<!-- Exists to keep startup and recovery guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Document Startup and Recovery

Part of the [Frontend Guide](Frontend_Guide.md).

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
page metadata keeps its existing language resolver. Recovery respects the stored
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
