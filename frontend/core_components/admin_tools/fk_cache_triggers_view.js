// fk_cache_triggers_view.js
// Renders the admin view for inspecting FK cache invalidation triggers.
// Bridges trigger status data and maintenance actions with the admin tools container.
// Exists to help admins verify and refresh foreign-key cache trigger infrastructure.

import { fetchFKCacheTriggers, refreshFKCacheTrigger } from '../endpoints/stable_endpoint_router.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';

/** @typedef {import('../../generated/go_contract_types').FKCacheTriggerInfo} FKCacheTriggerInfo */
/** @typedef {import('../../generated/go_contract_types').FKCacheTriggersResponse} FKCacheTriggersResponse */
/** @typedef {import('../../generated/go_contract_types').FKCacheRefreshResponse} FKCacheRefreshResponse */

/**
 * Generates the FK cache triggers admin view.
 * @param {HTMLElement} container - Target element to render into.
 */
export async function generate_fk_cache_triggers_view(container) {
    if (!container) return;
    container.replaceChildren();

    const frame = document.createElement('div');
    frame.className = 'tool-content-frame';
    container.appendChild(frame);

    // Title
    const header = document.createElement('h2');
    header.dataset.langKey = 'fk_cache_triggers';
    header.textContent = 'FK Cache Triggers';
    frame.appendChild(header);

    // Description
    const desc = document.createElement('p');
    desc.dataset.langKey = 'fk_cache_triggers_desc';
    desc.textContent = 'Manage PostgreSQL triggers that keep cached columns in sync when source data changes.';
    desc.style.marginBottom = '16px';
    desc.style.color = 'var(--text-secondary)';
    frame.appendChild(desc);

    // Results area
    const resultsArea = document.createElement('div');
    frame.appendChild(resultsArea);

    await loadTriggers(resultsArea);
}

/**
 * Loads trigger data from the backend and renders the table.
 * @param {HTMLElement} resultsArea
 */
async function loadTriggers(resultsArea) {
    resultsArea.replaceChildren();

    const loading = document.createElement('p');
    loading.textContent = 'Loading...';
    loading.style.color = 'var(--text-secondary)';
    resultsArea.appendChild(loading);

    try {
        const data = /** @type {FKCacheTriggersResponse} */ (await fetchFKCacheTriggers());
        resultsArea.replaceChildren();

        if (!data.triggers || data.triggers.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'No FK cache triggers registered.';
            empty.style.color = 'var(--text-secondary)';
            resultsArea.appendChild(empty);
            return;
        }

        renderTriggersTable(resultsArea, data.triggers);
    } catch (err) {
        resultsArea.replaceChildren();
        const errorP = document.createElement('p');
        errorP.textContent = 'Error: ' + err.message;
        errorP.style.color = 'var(--danger)';
        resultsArea.appendChild(errorP);
    }
}

/**
 * Renders the triggers as a table with status indicators and refresh buttons.
 * @param {HTMLElement} container
 * @param {FKCacheTriggerInfo[]} triggers
 */
function renderTriggersTable(container, triggers) {
    const table = document.createElement('table');
    table.className = 'admin-tool-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Status', 'Source', 'Target', 'Events', 'Cached Rows', 'Actions'];
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.padding = '8px 12px';
        th.style.textAlign = 'left';
        th.style.borderBottom = '2px solid var(--border-color)';
        th.style.fontSize = '0.85rem';
        th.style.fontWeight = '600';
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    triggers.forEach(trigger => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border-color)';

        // Status indicator
        const statusCell = document.createElement('td');
        statusCell.style.padding = '8px 12px';
        const statusDot = document.createElement('span');
        statusDot.style.display = 'inline-block';
        statusDot.style.width = '10px';
        statusDot.style.height = '10px';
        statusDot.style.borderRadius = '50%';
        statusDot.style.marginRight = '6px';
        if (trigger.trigger_exists && trigger.enabled) {
            statusDot.style.backgroundColor = 'var(--success, #22c55e)';
            statusDot.title = 'Active';
        } else if (trigger.trigger_exists && !trigger.enabled) {
            statusDot.style.backgroundColor = 'var(--warning, #f59e0b)';
            statusDot.title = 'Exists but disabled';
        } else {
            statusDot.style.backgroundColor = 'var(--danger, #ef4444)';
            statusDot.title = 'Trigger missing in PG';
        }
        statusCell.appendChild(statusDot);
        const statusLabel = document.createElement('span');
        statusLabel.textContent = trigger.trigger_exists ? (trigger.enabled ? 'Active' : 'Disabled') : 'Missing';
        statusLabel.style.fontSize = '0.85rem';
        statusCell.appendChild(statusLabel);
        row.appendChild(statusCell);

        // Source (table.column)
        const sourceCell = document.createElement('td');
        sourceCell.style.padding = '8px 12px';
        sourceCell.innerHTML = `<code>${trigger.source_table}.${trigger.source_column}</code>`;
        row.appendChild(sourceCell);

        // Target (table.column)
        const targetCell = document.createElement('td');
        targetCell.style.padding = '8px 12px';
        targetCell.innerHTML = `<code>${trigger.target_table}.${trigger.target_column}</code>`;
        row.appendChild(targetCell);

        // Events
        const eventsCell = document.createElement('td');
        eventsCell.style.padding = '8px 12px';
        eventsCell.style.fontSize = '0.85rem';
        eventsCell.textContent = trigger.trigger_events;
        row.appendChild(eventsCell);

        // Cached count
        const cachedCell = document.createElement('td');
        cachedCell.style.padding = '8px 12px';
        cachedCell.textContent = trigger.cached_count.toString();
        row.appendChild(cachedCell);

        // Actions
        const actionsCell = document.createElement('td');
        actionsCell.style.padding = '8px 12px';
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'button button--small';
        refreshBtn.textContent = 'Refresh All';
        refreshBtn.title = 'Re-sync all cached values from source data';
        refreshBtn.addEventListener('click', () => handleRefresh(trigger.id, refreshBtn, container));
        actionsCell.appendChild(refreshBtn);
        row.appendChild(actionsCell);

        // Notes (as a subtitle row)
        if (trigger.notes) {
            const notesRow = document.createElement('tr');
            const notesCell = document.createElement('td');
            notesCell.colSpan = headers.length;
            notesCell.style.padding = '0 12px 8px 36px';
            notesCell.style.fontSize = '0.8rem';
            notesCell.style.color = 'var(--text-tertiary)';
            notesCell.textContent = trigger.notes;
            notesRow.appendChild(notesCell);
            tbody.appendChild(row);
            tbody.appendChild(notesRow);
            return;
        }

        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

/**
 * Handles the refresh button click for a specific trigger.
 * @param {number} triggerId
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} container
 */
async function handleRefresh(triggerId, button, container) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Refreshing...';

    try {
        const result = /** @type {FKCacheRefreshResponse} */ (await refreshFKCacheTrigger({
            trigger_id: triggerId,
        }));

        if (result.errors && result.errors.length > 0) {
            showToast({
                message: `Refresh completed with errors: ${result.errors.join(', ')}`,
                level: 'warning',
            });
        } else {
            showToast({
                message: `Refreshed ${result.updated} row(s)`,
                level: 'success',
            });
        }

        // Reload the table to show updated counts
        await loadTriggers(container);
    } catch (err) {
        showToast({
            message: 'Refresh failed: ' + err.message,
            level: 'error',
        });
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}
