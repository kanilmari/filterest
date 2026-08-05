# Core Workflows

This document consolidates information regarding Easelect's core workflows, including adding rows, refreshing embeddings, and API features.

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
1.  **Dataset Listing**: Fetched from `/api/embedding-datasets`. Lists datasets where `system_db_tables.multi_lang_embeddings` is `true`.
2.  **Language Selection**: Checkboxes for languages (e.g., `en`, `fi`).
3.  **Pending Counter**: `refresh_embeddings_pending_counter` shows the total number of unprocessed rows via `/api/count-lang-embeddings`.
4.  **Start Refresh**: The `refresh_embeddings_start_button` sends requests to `/api/refresh-lang-embeddings` for each selected dataset/language combination.

### Server-Side Functions
-   **GetEmbeddingDatasetsHandler** (`/api/embedding-datasets`): Returns datasets with multi-lang embeddings enabled.
-   **CountLangEmbeddingsHandler** (`/api/count-lang-embeddings`): Counts rows needing updates.
-   **RefreshLangEmbeddingsHandler** (`/api/refresh-lang-embeddings`): Iterates rows, generates vectors via OpenAI, writes to `<dataset>_lang_embeddings`, and returns stats.

## 3. API and Features Overview

This section covers specific features and API endpoints of Easelect.

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
Dynamic route names live in `frontend/core_components/endpoints/endpoint_router.js`. Stable allowlisted wrappers live in `frontend/core_components/endpoints/stable_endpoint_router.js`, with route inventory metadata in `frontend/core_components/endpoints/stable_api_inventory.js`.
-   **Frontend Helper**: `applyPermission(element, route, { remove: true })` hides or removes elements based on user rights.
-   **Conditional Rendering**: Components like the navigation tree are created only if `hasRoutePermission()` confirms access.

### Rendering Sanitized HTML
Use `renderAllowedHtml()` from `frontend/reusable_components/dom_container_builder.js` to safely display a subset of HTML tags (e.g., `<b>`, `<i>`, `<ul>`).

### Multi-table Permission Editing
The permissions view supports selecting multiple tables. Shared rights are shown; conflicting rights appear ambiguous. Changes apply to all selected tables.

### Navigation
-   **URL State**: Changing tabs or filters updates the URL (`/{name}?param=value`).
-   **Persistence**: Refreshing restores the tab and parameters. Tabs remember their own filters.
