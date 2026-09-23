// refresh_lang_embeddings_view.js
// Admin view that shows every dataset's embedding status and refreshes multilingual embeddings on demand.
// Bridges the embedding status and refresh backend endpoints and the admin UI.
// Exists to let admins see what is embedded and regenerate language embeddings per dataset and language without a deploy.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { applyPermission } from '../core_components/route_permission_checker.js';
import { showToast } from '../reusable_components/notifications/toast_notification_printer.js';
import { renderEmbeddingStatusPanel } from './embedding_status_panel.js';
import { englishEmbeddingAdminCopy, keyedElement } from './embedding_status_translation_fallbacks.js';

// Shows the pending-row count through its language key, so the number never
// replaces the translated sentence around it.
export function showPendingRowCount(counter, total) {
    counter.dataset.langKey = `embedding_refresh_rows_to_process+${total}`;
    counter.textContent = englishEmbeddingAdminCopy('embedding_refresh_rows_to_process', total);
}

// normalizeEmbeddingDatasetList accepts the capability-aware admin response
// while preserving compatibility with the legacy string-only response.
export function normalizeEmbeddingDatasetList(response) {
    return Array.isArray(response)
        ? response.map(item => {
            if (typeof item === 'string' && item.trim() !== '') {
                return {
                    dataset: item,
                    general_embedding: false,
                    multilingual_embedding: true,
                };
            }
            if (typeof item?.dataset !== 'string' || item.dataset.trim() === '') {
                return null;
            }
            return {
                dataset: item.dataset,
                general_embedding: item.general_embedding === true,
                multilingual_embedding: item.multilingual_embedding === true,
            };
        }).filter(Boolean)
        : [];
}

// normalizeEmbeddingPolicyResponse accepts stable column UIDs and explicit consent only.
export function normalizeEmbeddingPolicyResponse(response, dataset = '') {
    const columns = Array.isArray(response?.columns)
        ? response.columns.filter(column => (
            Number.isInteger(Number(column?.column_uid))
            && typeof column?.column_name === 'string'
            && column.column_name.trim() !== ''
        )).map(column => ({
            column_uid: Number(column.column_uid),
            column_name: column.column_name,
            allowed: column.allowed === true,
        }))
        : [];
    return {
        dataset: typeof response?.dataset === 'string' && response.dataset ? response.dataset : dataset,
        table_uid: Number.isInteger(Number(response?.table_uid)) ? Number(response.table_uid) : 0,
        provider: typeof response?.provider === 'string' ? response.provider : '',
        enabled: response?.enabled === true,
        configured: response?.configured === true,
        columns,
    };
}

// selectedEmbeddingColumnUIDs returns a deterministic, duplicate-free policy payload.
export function selectedEmbeddingColumnUIDs(container) {
    return Array.from(container.querySelectorAll('input[data-column-uid]:checked'))
        .map(input => Number(input.dataset.columnUid))
        .filter(Number.isInteger)
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort((left, right) => left - right);
}

// selectedEmbeddingLanguages deliberately ignores the adjacent field-policy
// checkboxes so consent changes cannot become language refresh requests.
export function selectedEmbeddingLanguages(container) {
    return Array.from(container.querySelectorAll('input[data-lang]:checked'))
        .map(input => input.dataset.lang)
        .filter(language => typeof language === 'string' && language !== '');
}

export async function generate_refresh_lang_embeddings_view(container) {
    container.replaceChildren();
    // Read-only status first: what is embedded, how fully, by which model.
    const statusPanel = document.createElement('section');
    statusPanel.id = 'embedding_status_panel';
    container.appendChild(statusPanel);
    void renderEmbeddingStatusPanel(statusPanel);

    const warning = document.createElement('p');
    warning.classList.add('fw-card', 'fw-text-sm');
    warning.dataset.langKey = 'embedding_external_warning';
    warning.textContent = 'When a table is enabled, its technically eligible text fields are initially selected. Clear any fields you do not want sent to the configured external embedding provider. Restricted-schema fields cannot be selected here.';
    container.appendChild(warning);

    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    hRow.appendChild(keyedElement('th', 'embedding_status_column_dataset'));
    const thFields = document.createElement('th');
    thFields.textContent = 'Fields sent to the external embedding provider';
    thFields.dataset.langKey = 'embedding_external_fields';
    hRow.appendChild(thFields);
    const languages = ['en', 'fi'];
    languages.forEach(lang => {
        const th = document.createElement('th');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => {
            tbl.querySelectorAll(`.cb-${lang}`).forEach(el => {
                el.checked = cb.checked;
            });
            updateCounter();
        });
        th.appendChild(document.createTextNode(lang));
        th.appendChild(cb);
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbl.appendChild(tbody);
    container.appendChild(tbl);

    const counter = document.createElement('div');
    counter.id = 'refresh_embeddings_pending_counter';
    showPendingRowCount(counter, 0);
    container.appendChild(counter);

    async function updateCounter() {
        let total = 0;
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
            const dataset = row.dataset.name;
            const langs = selectedEmbeddingLanguages(row);
            if (langs.length === 0) continue;
            try {
                const res = await endpoint_router('countLangEmbeddings', {
                    method: 'POST',
                    body_data: { dataset, languages: langs },
                });
                if (res && typeof res.pending === 'number') {
                    total += res.pending;
                }
            } catch (err) {
                console.warn('count failed', err);
            }
        }
        showPendingRowCount(counter, total);
    }

    let datasets = [];
    try {
        datasets = normalizeEmbeddingDatasetList(await endpoint_router('embeddingDatasets', {
            method: 'GET',
            url_params: '?include_capabilities=true&include_policy_candidates=true',
        }));
    } catch (e) {
        console.warn('dataset fetch error', e);
    }
    datasets.forEach(datasetSummary => {
        const name = datasetSummary.dataset;
        const tr = document.createElement('tr');
        tr.dataset.name = name;
        tr.dataset.embeddingTargetReady = String(
            datasetSummary.general_embedding || datasetSummary.multilingual_embedding,
        );
        const tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);
        const tdFields = document.createElement('td');
        tdFields.appendChild(keyedElement('span', 'embedding_refresh_loading'));
        tr.appendChild(tdFields);
        void renderEmbeddingFieldPolicy(tdFields, name);
        languages.forEach(lang => {
            const td = document.createElement('td');
            if (datasetSummary.multilingual_embedding) {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.classList.add(`cb-${lang}`);
                cb.dataset.lang = lang;
                cb.addEventListener('change', updateCounter);
                td.appendChild(cb);
            } else {
                td.textContent = '—';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    updateCounter();

    const btn = keyedElement('button', 'embedding_refresh_start');
    btn.id = 'refresh_embeddings_start_button';
    btn.type = 'button';
    applyPermission(btn, '/api/refresh-lang-embeddings');
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
            const dataset = row.dataset.name;
            const langs = selectedEmbeddingLanguages(row);
            if (langs.length === 0) continue;
            try {
                await endpoint_router('refreshLangEmbeddings', {
                    method: 'POST',
                    body_data: { dataset, languages: langs },
                });
            } catch (err) {
                console.warn('refresh failed', err);
            }
        }
        showToast({ langKey: 'embedding_refresh_done', level: 'success' });
        updateCounter();
        void renderEmbeddingStatusPanel(statusPanel);
    });
    container.appendChild(btn);
}

async function renderEmbeddingFieldPolicy(container, dataset) {
    let policy;
    try {
        policy = normalizeEmbeddingPolicyResponse(await endpoint_router('embeddingSourcePolicy', {
            method: 'GET',
            url_params: `?dataset=${encodeURIComponent(dataset)}`,
        }), dataset);
    } catch (error) {
        console.warn('embedding field policy fetch failed', error);
        container.replaceChildren(keyedElement('span', 'embedding_refresh_field_policy_unavailable'));
        return;
    }

    container.replaceChildren();
    const enabledLabel = document.createElement('label');
    enabledLabel.classList.add('fw-flex', 'fw-gap-2', 'fw-items-center');
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.checked = policy.enabled;
    enabledCheckbox.dataset.embeddingDatasetEnabled = 'true';
    const enabledText = document.createElement('span');
    enabledText.textContent = 'Enable external embeddings for this table';
    enabledText.dataset.langKey = 'embedding_enable_dataset';
    enabledLabel.appendChild(enabledCheckbox);
    enabledLabel.appendChild(enabledText);
    container.appendChild(enabledLabel);

    const fieldList = document.createElement('div');
    fieldList.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');
    policy.columns.forEach(column => {
        const label = document.createElement('label');
        label.classList.add('fw-flex', 'fw-gap-2', 'fw-items-center');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = column.allowed;
        checkbox.dataset.columnUid = String(column.column_uid);
        const name = document.createElement('span');
        name.textContent = column.column_name;
        label.appendChild(checkbox);
        label.appendChild(name);
        fieldList.appendChild(label);
    });
    if (policy.columns.length === 0) {
        const empty = keyedElement('span', 'embedding_refresh_no_eligible_fields');
        empty.classList.add('fw-text-muted', 'fw-text-sm');
        fieldList.appendChild(empty);
    }
    container.appendChild(fieldList);

    const save = document.createElement('button');
    save.type = 'button';
    save.classList.add('fw-btn', 'fw-btn--secondary');
    save.textContent = 'Save field selection';
    save.dataset.langKey = 'embedding_save_field_policy';
    applyPermission(save, '/api/admin/embedding-source-policy');
    save.addEventListener('click', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
            await endpoint_router('embeddingSourcePolicy', {
                method: 'POST',
                body_data: {
                    dataset,
                    enabled: enabledCheckbox.checked,
                    allowed_column_uids: selectedEmbeddingColumnUIDs(fieldList),
                },
            });
            showToast({ langKey: 'embedding_field_policy_saved', level: 'success' });
        } catch (error) {
            console.warn('embedding field policy save failed', error);
        } finally {
            save.disabled = false;
        }
    });
    container.appendChild(save);
}
