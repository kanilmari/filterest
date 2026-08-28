// database_view_fetcher.js
// Fetches and renders PostgreSQL database-view data for frontend users.
// Bridges database-view nav selections with endpoint reads, loading feedback, and simple table rendering.
// Exists to keep database-view display logic separate from standard dataset-view flows.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { getOrCreateManagementFormsContainer } from '../reusable_components/dom_container_builder.js';
import { withLoadingIndicator } from '../reusable_components/loading/loading_indicator_printer.js';

/**
 * Loads a database view's data and renders it as a simple HTML table.
 * Creates or reuses a container in tabs_container.
 *
 * @param {string} viewName - The PostgreSQL view name to query
 */
export async function loadDatabaseView(viewName) {
    const containerId = `dbview_${viewName}_container`;
    const management_div = getOrCreateManagementFormsContainer(containerId);

    // Always refresh the data when navigating to a view
    management_div.replaceChildren();

    try {
        await withLoadingIndicator(containerId, async () => {
            const result = await endpoint_router('fetchViewData', {
                url_params: `?view=${encodeURIComponent(viewName)}`
            });

            management_div.replaceChildren();

            // Title
            const heading = document.createElement('h2');
            heading.textContent = viewName;
            heading.dataset.langKey = viewName;
            management_div.appendChild(heading);

            // Row count info
            const info = document.createElement('p');
            info.textContent = `${result.row_count || 0} rows`;
            info.style.cssText = 'color: var(--text-secondary, #888); margin-bottom: 10px;';
            management_div.appendChild(info);

            const columns = result.columns || [];
            const data = result.data || [];

            if (columns.length === 0) {
                const emptyMsg = document.createElement('p');
                emptyMsg.textContent = 'No data.';
                management_div.appendChild(emptyMsg);
                return;
            }

            // Scrollable table wrapper
            const tableWrapper = document.createElement('div');
            tableWrapper.style.cssText = 'overflow-x: auto; max-width: 100%;';

            const table = document.createElement('table');
            table.className = 'data-table';
            table.style.cssText = 'border-collapse: collapse; width: 100%; font-size: 0.9em;';

            // Header row
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            for (const col of columns) {
                const th = document.createElement('th');
                th.textContent = col;
                th.style.cssText = 'padding: 6px 10px; border-bottom: 2px solid var(--border-color, #444); text-align: left; white-space: nowrap;';
                headerRow.appendChild(th);
            }
            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Data rows
            const tbody = document.createElement('tbody');
            for (const row of data) {
                const tr = document.createElement('tr');
                for (const col of columns) {
                    const td = document.createElement('td');
                    const val = row[col];
                    td.textContent = val != null ? String(val) : '';
                    td.style.cssText = 'padding: 4px 10px; border-bottom: 1px solid var(--border-color, #333);';
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            tableWrapper.appendChild(table);
            management_div.appendChild(tableWrapper);
        });

    } catch (err) {
        management_div.replaceChildren();
        const errorEl = document.createElement('p');
        errorEl.style.color = 'var(--danger-color, red)';
        errorEl.textContent = `Error loading view: ${err.message}`;
        management_div.appendChild(errorEl);
    }
}
