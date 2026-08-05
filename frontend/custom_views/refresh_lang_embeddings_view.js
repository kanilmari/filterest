// refresh_lang_embeddings_view.js
// Admin view to refresh multilingual embeddings on demand.
// Bridges the embedding-refresh backend endpoints and the admin UI.
// Exists to let admins regenerate language embeddings per dataset and language without a deploy.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { applyPermission } from '../core_components/route_permission_checker.js';
import { showSuccessToast } from '../reusable_components/notifications/toast_notification_printer.js';

// normalizeEmbeddingDatasetList accepts only concrete dataset names from the backend.
function normalizeEmbeddingDatasetList(response) {
    return Array.isArray(response)
        ? response.filter(name => typeof name === 'string' && name.trim() !== '')
        : [];
}

export async function generate_refresh_lang_embeddings_view(container) {
    container.replaceChildren();
    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const thDataset = document.createElement('th');
    thDataset.textContent = 'Dataset';
    thDataset.dataset.langKey = 'dataset';
    hRow.appendChild(thDataset);
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
            const langs = Array.from(row.querySelectorAll('input:checked')).map(cb => cb.dataset.lang);
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
        datasets = normalizeEmbeddingDatasetList(await endpoint_router('embeddingDatasets'));
    } catch (e) {
        console.warn('dataset fetch error', e);
    }
    datasets.forEach(name => {
        const tr = document.createElement('tr');
        tr.dataset.name = name;
        const tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);
        languages.forEach(lang => {
            const td = document.createElement('td');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.classList.add(`cb-${lang}`);
            cb.dataset.lang = lang;
            cb.addEventListener('change', updateCounter);
            td.appendChild(cb);
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
            const langs = Array.from(row.querySelectorAll('input:checked')).map(cb => cb.dataset.lang);
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
