<!-- Core_Workflows.md
Explains the product's shared data, permission, navigation, and authentication workflows.
Connects operator settings and user actions to their common API and browser boundaries.
Keeps feature setup and access behavior understandable across standalone installations. -->
# Core Workflows

This document consolidates information regarding Filterest's core workflows, including adding rows, refreshing embeddings, and API features.

## 1. Adding a Row

This section outlines how a new row is inserted through the generic table interface.

### Overview
1.  **User Action**: The user clicks **Lisää Rivi** in the table-specific filter bar panel (`.filterbar-panel`). `createAddRowButton` wires the button to `open_add_row_modal`.
2.  **Modal**: `open_add_row_modal` fetches column specs and relationships, builds the form, and shows the modal.
3.  **Submission**: Submitting the form packages the data and files into a `FormData` object and calls the `addRowMultipart` endpoint.
4.  **Backend**: `AddRowMultipartHandlerWrapper` validates the request and passes it to `AddRowMultipartHandler`, which inserts the main row, child rows and files, then creates optional embeddings.
5.  **Result**: A successful insert returns HTTP `201` and the frontend refreshes the table. Errors trigger alerts or HTTP responses.

### Error Handling
-   **Frontend**: Alerts cover missing column info, fetch failures or upload errors.
-   **Backend**: Responds with HTTP errors for missing parameters, malformed JSON or other failures.

## 2. Refreshing Embeddings

The Refresh Embeddings view updates multi-language embedding tables so that the search field (`dataset-search-input`) can find results in all selected languages.

### Usage
1.  **Status**: A read-only table at the top shows, per dataset, whether it is embedded, how many rows have an embedding, how many rows changed after their language embedding, which languages are covered, how many stored vectors do not match the configured model, the newest language-embedding time, and whether a row change re-embeds the row automatically (with queued and failing refreshes). A line above the table names the configured provider, model, vector length and whether its API key is present. The general embedding keeps no time, so its age and staleness show as not tracked.
2.  **Table and field policy**: The admin view lists current-project public-schema tables that have stable `text` or `varchar` field metadata. The administrator can save the allowed fields and table switch before vector storage exists; that state queues and sends no row content until a technical embedding target is available. Restricted-schema tables are excluded.
3.  **Technical capability**: The same response reports whether a general vector column or multilingual vector table is already available. Manual language-refresh checkboxes appear only for the multilingual capability.
4.  **Language Selection**: Checkboxes select languages such as `en` and `fi` for technically ready multilingual tables.
5.  **Pending Counter**: `refresh_embeddings_pending_counter` shows the total number of unprocessed rows via `/api/count-lang-embeddings`.
6.  **Start Refresh**: The `refresh_embeddings_start_button` sends requests to `/api/refresh-lang-embeddings` for each selected, technically ready dataset/language combination.

### Server-Side Functions
-   **GetEmbeddingDatasetsHandler** (`/api/embedding-datasets`): Preserves the capability-only legacy list by default. With `include_policy_candidates=true`, it returns technically eligible tables in the current project together with their general/multilingual target readiness. With `include_status=true`, it returns the status report (`BuildEmbeddingStatusReport`): the provider configuration and one entry per dataset that stores embeddings, may send rows to the provider, or belongs to the current project. It only reads, measures each dataset in its own savepoint and limits each statement to 15 seconds.
-   **CountLangEmbeddingsHandler** (`/api/count-lang-embeddings`): Counts rows needing updates.
-   **RefreshLangEmbeddingsHandler** (`/api/refresh-lang-embeddings`): Iterates rows, generates vectors through the configured embedding provider, writes to `<dataset>_lang_embeddings`, and returns stats.

### Automatic Refresh and Provider
-   **Row changes**: Creating a row, or changing one of its approved fields, queues it in `system_embedding_refresh_jobs` when the dataset has embedding storage and external embeddings are enabled with at least one approved field. A background worker re-embeds queued rows every few seconds and retries failures with growing delays. Without those conditions nothing is re-embedded automatically; the status table names which condition is missing.
-   **Provider**: `EMBEDDING_PROVIDER=google` selects Google (`GOOGLE_EMBEDDING_MODEL`, default `gemini-embedding-001`, requested at 1536 dimensions, not scaled to unit length); any other value selects OpenAI (`OPENAI_EMBEDDING_MODEL`, default `text-embedding-ada-002`, 1536 dimensions, unit length). These are process environment settings of each installation, not `system_config` rows. Stored vectors do not record their model: vectors made before a provider change stay in the other model's space and cannot be compared with new queries until they are created again.
-   **Related-enough cut-off**: The AI search measures cosine distance, which ignores vector length, so Google's unscaled vectors and OpenAI's unit vectors are judged alike. Each model has its own cut-off, set once beside the model settings (`SemanticDistanceCutoff`): 0.245 for `text-embedding-ada-002` (the former Euclidean 0.70 on unit vectors) and 0.43 for `gemini-embedding-001` (measured on the local service catalog). An uncalibrated model uses its provider's value. The streamed AI group and the one-shot answer both drop rows beyond it; the vector listing only orders by the same distance.

## 3. API and Features Overview

This section covers specific features and API endpoints of Filterest.

### Transaction Handling
Most HTTP requests flow through the pipeline's `transaction` stage
(`WithLazyTx`), which provides a lazy database transaction opened only when a
handler needs one through `dbutils.GetTx()` or `dbutils.RequireTx()`. Explicit
profiles such as `AccessControlNoTxProfile` may skip the transaction stage for
long-lived responses. The separate `audit` stage logs semantic operation
outcomes to `system_audit_log`.
-   **Audit**: Outcomes stored in `system_audit_log` (not `system_transaction_log`).
-   **Logging**: Set `transaction_console_logs` in `system_config` to `true` for verbose logs.
-   **Lang Usage**: Set `lang_last_used_updates` to `true` to track translation key usage.

### Rate Limiting
Rate limiting is enforced as the first stage of the request pipeline (`rate_limit` in `pipeline_order.go`, `AlwaysEnforced: true`). Per-route limits are configured through `rate_limit_amount` and `rate_limit_minutes` in the `system_functions` table; inspect that table or route registration output for current numeric values instead of copying them into workflow docs.

### API Permissions
-   `/api/user-permissions`: Lists allowed routes for the logged-in user.
-   `/api/dataset_permissions`: Manages entries in `system_group_table_func_rights`. Supports GET, POST (create/update), and PATCH (partial update).

### UI Permission Checks
Dynamic route names live in `app/frontend/core_components/endpoints/endpoint_router.js`. Stable allowlisted wrappers live in `app/frontend/core_components/endpoints/stable_endpoint_router.js`, with route inventory metadata in `app/frontend/core_components/endpoints/stable_api_inventory.js`.
-   **Frontend Helper**: `applyPermission(element, route, { remove: true })` hides or removes elements based on user rights.
-   **Conditional Rendering**: Components like the navigation tree are created only if `hasRoutePermission()` confirms access.

### Rendering Sanitized HTML
Use `renderAllowedHtml()` from `app/frontend/reusable_components/dom_container_builder.js` to safely display a subset of HTML tags (e.g., `<b>`, `<i>`, `<ul>`).

### Multi-table Permission Editing
The permissions view supports selecting multiple tables. Shared rights are shown; conflicting rights appear ambiguous. Changes apply to all selected tables.

### Navigation
-   **URL State**: Changing tabs or filters updates the URL (`/{name}?param=value`).
-   **Persistence**: Refreshing restores the tab and parameters. Tabs remember their own filters.


### Public browsing and administrator sign-in

Administrators configure these independent booleans in `system_config` through
the existing administrative dataset UI or its validated row API:

| Key | Default for the new settings | Meaning |
| --- | --- | --- |
| `show_login_button` | `true` | Show visitor sign-in entry points. Setting it to `false` hides the navigation login button and sign-in recovery offer. It does not disable the direct `/login` route or hide account/logout controls from an authenticated administrator. |
| `only_admin_can_login` | `false` | Admit only enabled users who have the canonical administrator role and `admin_access_allowed=true`. The server checks this after credentials, before completing verification, and when validating existing signed sessions. |
| `registration_enabled` | Existing site value retained | Controls self-registration. Administrator-only sign-in suppresses effective registration, including the direct registration API, without overwriting the saved registration preference. |
| `login_to_browse` | Existing site value retained | Whether browsing requires authentication. It is independent of login-button visibility and sign-in eligibility. |

For a public catalogue with administration through `/login`, set
`show_login_button=false`, `only_admin_can_login=true`,
`registration_enabled=false`, and `login_to_browse=false`. Also grant the guest
principal only the intended dataset, row and media read permissions; these
settings do not grant data access by themselves.

Enabling administrator-only sign-in invalidates a non-administrator's existing
authenticated identity on the next checked server request. Guest browsing
continues according to the site's existing permissions. Changing either login
setting does not delete users or modify their group memberships. Turning
administrator-only mode off restores normal account eligibility and the stored
registration setting takes effect again.

Keep at least one enabled administrator with administrator access before
restricting sign-in. Use the existing protected administrator recovery workflow
if a site has lost all eligible administrators. The First Run workflow remains
limited to an uninitialized installation; hiding a login button does not reopen
setup or replace administrator recovery.

The additive migration and fresh public bootstrap use the same defaults. The
migration creates missing keys only and preserves existing values. Missing keys
use compatible runtime defaults; malformed configured values or a failed
policy read do not silently bypass a sign-in restriction. Temporary development
access restrictions are operator state and should not rewrite public About
content describing the intended service.


## Site notices

About information, privacy notices and cookie notices are editable content
rows in the About dataset (`system_about`), with multilingual titles and
descriptions. The set of rows belongs to the installation; a separate cookie
notice is content, not an automatically generated cookie catalogue. The About
navigation entry opens this dataset through ordinary dataset navigation.

Both the standalone sign-in page and the sign-in modal retrieve the privacy
notice at `/api/about?id=4`. The server reads that row's title and description;
the browser selects the current language with an English fallback and renders
allowed HTML in a modal. The sign-in form includes a required privacy-notice
acceptance checkbox. This fixed row selection does not provide document kinds,
publication versions or a record of acceptance tied to a published version.

[Future site notices](../future_documentation/Site_Notices.md) describe the
missing configuration, preview, publication and cookie-catalogue capabilities.

## Workline Observatory layout

Above 900 px, the observatory uses the shared results scrollport
(`.tab-content-body > .scrollable_content`) for both vertical and horizontal
scrolling. The application shell owns the viewport height; its flex/grid chain
uses `min-height: 0` and divides the available space instead of adding another
viewport-height management view. The legacy management host remains supported
as the sole scrollport when the renderer is mounted there directly.

The result wrapper and phase board have visible overflow on desktop. Setting
only `overflow-x: auto` would also make vertical overflow automatic and capture
sticky positioning inside those wrappers. The status toolbar sticks at the
shared scrollport's top; the phase heading sticks immediately below its measured
height, including during compaction and when translated guidance wraps. Wide
phase rows, the final workline and its publication action stay in that same
scrollport. Toolbar compaction listens directly to that scrollport above 900 px,
including before overflow is measurable. Resizing rebinds the listener; redraws
and teardown release it and the toolbar's size observer. Filters retain their
separate control-panel scrolling.

At 900 px and below, existing padding, detail stacking, horizontal board
scrolling and toolbar positioning are retained. The board also retains its
original vertical overflow beside the shared content scroller. Compaction keeps
the original window capture listener and ancestor boundary calculation, so
scrolls from either owner still update it. Context menus capture every scroll
owner at either width and release those listeners on redraw or teardown.
Both explicit application themes use the same layout rules. The focused browser proof is
`T16_workline_observatory_scroll.spec.ts`, independent of T13: it expands existing
board rows in a GET response only, checks scroll ownership, sticky alignment,
keyboard scrolling and focus visibility, and captures the desktop/phone layouts
in both themes against the opposite operating-system theme. It saves no test
data or account preferences. The shared scroller also contains the hero/search
header, so the desktop proof scrolls past the measured phase heading before
checking compaction and sticky alignment; a fixed distance can stop too early.

## Publications in the Workline Observatory

The release decisions panel is **Julkaisut / Publications**. Significant
publications reuse `dev_agent_release_goals` and their existing workline
requirements (`dev_agent_release_goal_contracts`); there is no parallel
publication or versions table. A future publication records the target date,
required features, the plan towards them (outcome), and what readers gain on
desktop and mobile (reader description).

The integer `version` remains the accepted contract revision for an identity.
The separate `publication_version` is software version **text**, such as
`9.4.0`. Published Git tags remain authoritative: saving this record creates
neither a Git tag nor a release artifact. Existing rows retain their identity,
contract revision, lock and contracts; their new fields start empty or null,
with `published=false` and `publication_revision=0`.

The dedicated administrator endpoint remains
`/api/app/workline-observatory/release-goals`. Its GET returns up to 100
publications ordered unpublished first, then by creation time and id descending.
The board response includes the same `publications` list and exposes its first
row as `release_goal`. **Newest** means newest-created, rather than latest
edited or furthest target date. The newest unpublished row is marked
`is_current_publication=true`; when all are published the newest published row
opens without that highlight. The stored legacy selection flag and select
action remain compatible, but do not override this focus rule. The panel's
picker browses older publications without changing the board's workline scope.

POST accepts the existing identity, integer contract version, title, outcome
and selected flag, plus `publication_version`, nullable `target_date`
(`YYYY-MM-DD`), `reader_description` (up to 6000 characters), `published`
(default false), and nullable `published_at` (RFC3339 with timezone).
PATCH with `action="update"` and `id` replaces these five publication fields
as a group and requires the observed `expected_revision`. A missing revision
returns 400, a stale revision 409, and a missing publication 404. The separate
publication revision advances only when these fields actually change.

Publishing requires nonempty version text. The server records the time at first
publication when none is supplied; later edits that omit it or resend the saved
instant preserve it, while an administrator may correct it with the current
publication revision (a stale correction returns 409). Unpublishing clears the
time; publishing again without a supplied time records a new server time.
The browser edits time in the person's local zone and sends a timezone-qualified
instant, retaining the exact saved instant when the control was not changed.
A save refreshes the panel and current plan.

The existing administrator permission profile, session, CSRF and transaction
pipeline still govern every call. All active worklines must have a completion
classification before locking. A lock continues to freeze title, outcome,
identity, integer version and requirements. Scheduling, software version text,
reader information and publication state remain editable after locking, guarded
by their separate revision. Contract editing remains on the existing contracts
endpoint; starting a new scope revision creates another release-goal row.

Migrations `20261009000070`–`20261009000073` belong to unreleased DB 9.11.0:
they add checked storage, language keys and column metadata; migration 73 repairs
missing canonical translations on development instances that applied old 71.
The schema migration's final check verifies column shapes, constraint validation, the
revision trigger and ordering index before writing its completion marker.
Bootstrap generation includes all four and accepts them only after completion
markers and the final check pass; baseline evidence does not claim execution.
