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
1.  **Table and field policy**: The admin view lists current-project public-schema tables that have stable `text` or `varchar` field metadata. The administrator can save the allowed fields and table switch before vector storage exists; that state queues and sends no row content until a technical embedding target is available. Restricted-schema tables are excluded.
2.  **Technical capability**: The same response reports whether a general vector column or multilingual vector table is already available. Manual language-refresh checkboxes appear only for the multilingual capability.
3.  **Language Selection**: Checkboxes select languages such as `en` and `fi` for technically ready multilingual tables.
4.  **Pending Counter**: `refresh_embeddings_pending_counter` shows the total number of unprocessed rows via `/api/count-lang-embeddings`.
5.  **Start Refresh**: The `refresh_embeddings_start_button` sends requests to `/api/refresh-lang-embeddings` for each selected, technically ready dataset/language combination.

### Server-Side Functions
-   **GetEmbeddingDatasetsHandler** (`/api/embedding-datasets`): Preserves the capability-only legacy list by default. With `include_policy_candidates=true`, it returns technically eligible tables in the current project together with their general/multilingual target readiness.
-   **CountLangEmbeddingsHandler** (`/api/count-lang-embeddings`): Counts rows needing updates.
-   **RefreshLangEmbeddingsHandler** (`/api/refresh-lang-embeddings`): Iterates rows, generates vectors through the configured embedding provider, writes to `<dataset>_lang_embeddings`, and returns stats.

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
