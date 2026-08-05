// search_vector_maintenance_view.js
// Admin view to rebuild search_vector_simple indexes for selected datasets.
// Bridges the search-vector maintenance backend endpoints and the admin UI.
// Exists to let admins trigger index rebuilds without direct database access.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { applyPermission } from '../core_components/route_permission_checker.js';
import { showSuccessToast } from '../reusable_components/notifications/toast_notification_printer.js';

// normalizeTextIndexStatus accepts only status rows with a concrete dataset name.
function normalizeTextIndexStatus(response) {
    const rows = Array.isArray(response) ? response : [];
    return rows.filter(datasetInfo => typeof datasetInfo?.dataset === 'string');
}

export async function generate_search_vector_maintenance_view(container) {
    container.replaceChildren();

    const frame = document.createElement('div');
    frame.classList.add('tool-content-frame');

    const controlsWrapper = document.createElement('div');
    controlsWrapper.classList.add('text-index-maintenance-controls');

    const showSystemUsersWrapper = document.createElement('label');
    showSystemUsersWrapper.classList.add('text-index-maintenance-toggle-system-users');
    const showSystemUsersCheckbox = document.createElement('input');
    showSystemUsersCheckbox.type = 'checkbox';
    showSystemUsersCheckbox.classList.add('text-index-maintenance-checkbox-system-users');
    showSystemUsersWrapper.appendChild(showSystemUsersCheckbox);
    const showSystemUsersText = document.createElement('span');
    showSystemUsersText.textContent = 'Show system_users dataset';
    showSystemUsersText.dataset.langKey = 'show_system_users_dataset';
    showSystemUsersWrapper.appendChild(showSystemUsersText);

    const showSystemTablesWrapper = document.createElement('label');
    showSystemTablesWrapper.classList.add('text-index-maintenance-toggle-system-datasets');
    const showSystemTablesCheckbox = document.createElement('input');
    showSystemTablesCheckbox.type = 'checkbox';
    showSystemTablesCheckbox.classList.add('text-index-maintenance-checkbox-system-datasets');
    showSystemTablesWrapper.appendChild(showSystemTablesCheckbox);
    const showSystemTablesText = document.createElement('span');
    showSystemTablesText.textContent = 'Show system datasets';
    showSystemTablesText.dataset.langKey = 'show_system_datasets';
    showSystemTablesWrapper.appendChild(showSystemTablesText);

    controlsWrapper.appendChild(showSystemUsersWrapper);
    controlsWrapper.appendChild(showSystemTablesWrapper);

    frame.appendChild(controlsWrapper);

    const listDiv = document.createElement('div');
    listDiv.classList.add('text-index-maintenance-dataset-list');
    let datasets = [];
    try {
        datasets = normalizeTextIndexStatus(await endpoint_router('textIndexStatus'));
    } catch (e) {
        console.warn('dataset fetch error', e);
    }

    const renderList = () => {
        const previouslySelected = new Set(
            Array.from(listDiv.querySelectorAll('input:checked')).map(cb => cb.value),
        );
        listDiv.replaceChildren();
        datasets
            .filter(datasetInfo => {
                if (!datasetInfo.dataset.startsWith('system_')) {
                    return true;
                }
                if (showSystemTablesCheckbox.checked) {
                    return true;
                }
                if (datasetInfo.dataset === 'system_users' && showSystemUsersCheckbox.checked) {
                    return true;
                }
                return false;
            })
            .forEach(datasetInfo => {
                const label = document.createElement('label');
                label.classList.add('text-index-maintenance-dataset-entry');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = datasetInfo.dataset;
                cb.classList.add('text-index-maintenance-dataset-checkbox');
                if (previouslySelected.has(datasetInfo.dataset)) {
                    cb.checked = true;
                }
                label.appendChild(cb);
                const datasetName = document.createElement('span');
                datasetName.textContent = datasetInfo.dataset;
                datasetName.classList.add('text-index-maintenance-dataset-label');
                label.appendChild(datasetName);
                if (!datasetInfo.has_index) {
                    const flag = document.createElement('span');
                    flag.textContent = 'no index';
                    flag.dataset.langKey = 'no_index';
                    flag.classList.add('text-index-maintenance-no-index-flag');
                    label.appendChild(flag);
                }
                listDiv.appendChild(label);
            });
    };

    showSystemUsersCheckbox.addEventListener('change', () => {
        if (showSystemTablesCheckbox.checked) {
            showSystemUsersCheckbox.checked = true;
        }
        renderList();
    });

    showSystemTablesCheckbox.addEventListener('change', () => {
        if (!showSystemTablesCheckbox.checked && showSystemUsersCheckbox.checked) {
            renderList();
            return;
        }
        if (showSystemTablesCheckbox.checked) {
            showSystemUsersCheckbox.checked = true;
        }
        renderList();
    });

    renderList();
    frame.appendChild(listDiv);

    const btn = document.createElement('button');
    btn.classList.add('fw-btn', 'fw-btn--primary', 'fw-mt-4');
    btn.textContent = 'Rebuild search index';
    btn.dataset.langKey = 'rebuild_search_index';
    applyPermission(btn, '/api/rebuild-search-vectors');
    btn.addEventListener('click', async () => {
        const selected = Array.from(listDiv.querySelectorAll('input:checked')).map(cb => cb.value);
        for (const dataset of selected) {
            try {
                await endpoint_router('rebuildSearchVectors', { method: 'POST', body_data: { dataset } });
            } catch (err) {
                console.warn('rebuild failed', err);
            }
        }
        showSuccessToast('Indexing complete');
    });
    frame.appendChild(btn);
    container.appendChild(frame);
}
