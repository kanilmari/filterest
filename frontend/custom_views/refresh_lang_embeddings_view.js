// refresh_lang_embeddings_view.js
// Admin view to refresh multilingual embeddings on demand.
// Bridges the embedding-refresh backend endpoints and the admin UI.
// Exists to let admins regenerate language embeddings per dataset and language without a deploy.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { applyPermission } from '../core_components/route_permission_checker.js';
import { showSuccessToast } from '../reusable_components/notifications/toast_notification_printer.js';

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
    const warning = document.createElement('p');
    warning.classList.add('fw-card', 'fw-text-sm');
    warning.dataset.langKey = 'embedding_external_warning';
    warning.textContent = 'Enable a table to send its selected, technically eligible text fields to the configured external embedding provider. Restricted-schema fields are never available here.';
    container.appendChild(warning);

    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const thDataset = document.createElement('th');
    thDataset.textContent = 'Dataset';
    thDataset.dataset.langKey = 'dataset';
    hRow.appendChild(thDataset);
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
    counter.textContent = 'Rows to process: 0';
    counter.dataset.langKey = 'rows_to_process';
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
        counter.textContent = `Rows to process: ${total}`;
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
        tdFields.textContent = 'Loading…';
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

    const btn = document.createElement('button');
    btn.id = 'refresh_embeddings_start_button';
    btn.type = 'button';
    btn.textContent = 'Start embedding';
    btn.dataset.langKey = 'start_embedding';
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
        showSuccessToast('Embeddings refreshed');
        updateCounter();
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
        container.textContent = 'Field policy unavailable';
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
        const empty = document.createElement('span');
        empty.classList.add('fw-text-muted', 'fw-text-sm');
        empty.textContent = 'No eligible text fields';
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
            showSuccessToast('Embedding field selection saved and refresh queued');
        } catch (error) {
            console.warn('embedding field policy save failed', error);
        } finally {
            save.disabled = false;
        }
    });
    container.appendChild(save);
}
