// empty_rows_view.js
// Renders the admin view for inspecting and deleting empty dataset rows.
// Bridges empty-row backend results with dropdowns, confirmation flows, and toast feedback.
// Exists to give admins one place to audit and clean up structurally empty records.

import { getOrCreateManagementFormsContainer } from '../../reusable_components/dom_container_builder.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { showSuccessToast, showWarningToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';

export async function generate_empty_rows_view(container) {
    try {
        container.replaceChildren();
        const data = await endpoint_router('fetchEmptyRows');
        if (!Array.isArray(data)) {
            container.textContent = 'No data.';
            return;
        }
        for (const tbl of data) {
            const title = document.createElement('h3');
            title.textContent = tbl.dataset;
            container.appendChild(title);

            const tableEl = document.createElement('table');
            tableEl.classList.add('empty-rows-table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            const selectAllTh = document.createElement('th');
            const selectAllCb = document.createElement('input');
            selectAllCb.type = 'checkbox';
            selectAllCb.addEventListener('change', () => {
                tableEl.querySelectorAll('.row-checkbox').forEach(cb => {
                    cb.checked = selectAllCb.checked;
                    cb.dispatchEvent(new Event('change'));
                });
            });
            selectAllTh.appendChild(selectAllCb);
            headerRow.appendChild(selectAllTh);

            for (const col of tbl.columns) {
                const th = document.createElement('th');
                th.textContent = col;
                headerRow.appendChild(th);
            }
            thead.appendChild(headerRow);
            tableEl.appendChild(thead);

            const tbody = document.createElement('tbody');
            for (const row of tbl.rows) {
                const tr = document.createElement('tr');

                const cbTd = document.createElement('td');
                cbTd.classList.add('select-cell');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.classList.add('row-checkbox');
                if (row.id !== undefined) {
                    cb.dataset.id = row.id;
                }
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        tr.classList.add('selected');
                    } else {
                        tr.classList.remove('selected');
                    }
                });
                cbTd.appendChild(cb);
                tr.appendChild(cbTd);

                for (const col of tbl.columns) {
                    const td = document.createElement('td');
                    td.textContent = row[col] ?? '';
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }
            tableEl.appendChild(tbody);
            container.appendChild(tableEl);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'delete_selected_rows';
            deleteBtn.addEventListener('click', async () => {
                const selected = tableEl.querySelectorAll('.row-checkbox:checked');
                if (selected.length === 0) {
                    showWarningToast('Valitse poistettavat rivit.');
                    return;
                }

                const ids = Array.from(selected).map(cb => parseInt(cb.dataset.id, 10)).filter(id => !isNaN(id));

                if (ids.length === 0) {
                    showWarningToast('Id:t puuttuvat valituista riveistä.');
                    return;
                }

                const ok = await showConfirmModal({
                    messagePlainText: `Poistetaanko ${ids.length} riviä?`,
                    messageLangKey: 'confirm_delete_rows',
                    isDanger: true,
                });
                if (!ok) return;

                try {
                    await endpoint_router('deleteRows', {
                        method: 'POST',
                        url_params: `?dataset=${tbl.dataset}`,
                        body_data: { ids },
                    });
                    showSuccessToast('Rivit poistettu!');
                    selected.forEach(cb => cb.closest('tr').remove());
                } catch (err) {
                    console.warn('Delete failed:', err);
                }
            });
            container.appendChild(deleteBtn);
        }
    } catch (err) {
        console.warn('Error generating empty rows view:', err);
        container.textContent = 'Failed to load empty rows.';
    }
}

export async function generate_media_tools_view(container) {
    container.replaceChildren();

    const topCheckDiv = document.createElement('div');
    const checkRootBtn = document.createElement('button');
    checkRootBtn.textContent = 'Check storage root folders';
    checkRootBtn.dataset.testid = 'check-storage-root-folders';
    const archiveRootBtn = document.createElement('button');
    archiveRootBtn.textContent = 'Archive unknown root folders';
    archiveRootBtn.dataset.testid = 'archive-storage-root-folders';
    const rootResult = document.createElement('pre');
    rootResult.dataset.testid = 'storage-root-result';
    topCheckDiv.appendChild(checkRootBtn);
    topCheckDiv.appendChild(archiveRootBtn);
    topCheckDiv.appendChild(rootResult);
    container.appendChild(topCheckDiv);

    const archivedCheckDiv = document.createElement('div');
    const checkArchivedBtn = document.createElement('button');
    checkArchivedBtn.textContent = 'Check archived storage_deleted roots';
    checkArchivedBtn.dataset.testid = 'check-archived-storage-root-folders';
    const pruneArchivedBtn = document.createElement('button');
    pruneArchivedBtn.textContent = 'Prune archived roots';
    pruneArchivedBtn.dataset.testid = 'prune-archived-storage-root-folders';
    const archivedResult = document.createElement('pre');
    archivedResult.dataset.testid = 'archived-storage-root-result';
    archivedCheckDiv.appendChild(checkArchivedBtn);
    archivedCheckDiv.appendChild(pruneArchivedBtn);
    archivedCheckDiv.appendChild(archivedResult);
    container.appendChild(archivedCheckDiv);

    checkRootBtn.addEventListener('click', async () => {
        try {
            const res = await endpoint_router('checkMediaTables');
            if (Array.isArray(res.unknown) && res.unknown.length > 0) {
                rootResult.textContent = res.unknown.join('\n');
            } else {
                rootResult.textContent = 'No unknown folders';
            }
        } catch (err) {
            console.warn('checkMediaTables failed:', err);
            rootResult.textContent = 'Error';
        }
    });

    archiveRootBtn.addEventListener('click', async () => {
        const ok = await showConfirmModal({
            messagePlainText: 'Arkistoidaanko kaikki tuntemattomat storage-juurikansiot storage_deleted-hakemistoon?',
            isDanger: true,
        });
        if (!ok) {
            return;
        }

        try {
            const res = await endpoint_router('archiveMediaTables', {
                method: 'POST',
            });
            const archived = Array.isArray(res.archived) ? res.archived : [];
            if (archived.length > 0) {
                rootResult.textContent = `Archived ${archived.length} folder(s):\n${archived.join('\n')}`;
                showSuccessToast(`Arkistoitiin ${archived.length} storage-kansiota.`);
            } else {
                rootResult.textContent = 'No unknown folders to archive';
                showSuccessToast('Ei tuntemattomia storage-kansioita arkistoitavaksi.');
            }
        } catch (err) {
            console.warn('archiveMediaTables failed:', err);
            rootResult.textContent = 'Archive failed';
        }
    });

    checkArchivedBtn.addEventListener('click', async () => {
        try {
            const res = await endpoint_router('checkArchivedMediaTables');
            archivedResult.textContent = formatArchivedRootStatus(res);
        } catch (err) {
            console.warn('checkArchivedMediaTables failed:', err);
            archivedResult.textContent = 'Error';
        }
    });

    pruneArchivedBtn.addEventListener('click', async () => {
        const ok = await showConfirmModal({
            messagePlainText: 'Poistetaanko pysyvästi kaikki arkistoidut storage_deleted-juurikansiot, joilla ei ole enää live-datasettia?',
            isDanger: true,
        });
        if (!ok) {
            return;
        }

        try {
            const res = await endpoint_router('pruneArchivedMediaTables', {
                method: 'POST',
            });
            const pruned = Array.isArray(res.pruned) ? res.pruned : [];
            if (pruned.length > 0) {
                archivedResult.textContent = `Pruned ${pruned.length} archived folder(s):\n${pruned.join('\n')}`;
                showSuccessToast(`Poistettiin ${pruned.length} arkistoitua storage-kansiota.`);
            } else {
                archivedResult.textContent = 'No archived folders eligible for pruning';
                showSuccessToast('Ei prunettavia arkistoituja storage-kansioita.');
            }
        } catch (err) {
            console.warn('pruneArchivedMediaTables failed:', err);
            archivedResult.textContent = 'Prune failed';
        }
    });

    const rowCheckDiv = document.createElement('div');
    const dropdownContainer = document.createElement('div');
    rowCheckDiv.appendChild(dropdownContainer);
    const checkRowsBtn = document.createElement('button');
    checkRowsBtn.textContent = 'Check row folders';
    const rowResult = document.createElement('pre');
    rowCheckDiv.appendChild(checkRowsBtn);
    rowCheckDiv.appendChild(rowResult);
    const checkSubsBtn = document.createElement('button');
    checkSubsBtn.textContent = 'Check image subfolders';
    checkSubsBtn.dataset.langKey = 'check_image_subfolders';
    const subsResult = document.createElement('pre');
    rowCheckDiv.appendChild(checkSubsBtn);
    rowCheckDiv.appendChild(subsResult);
    const fixSubsBtn = document.createElement('button');
    fixSubsBtn.textContent = 'Fix image subfolders';
    fixSubsBtn.dataset.langKey = 'fix_image_subfolders';
    const fixResult = document.createElement('pre');
    rowCheckDiv.appendChild(fixSubsBtn);
    rowCheckDiv.appendChild(fixResult);
    container.appendChild(rowCheckDiv);

    let tables = [];
    try {
        tables = await endpoint_router('datasetNames');
    } catch (err) {
        console.warn('fetch dataset names failed:', err);
    }

    const dropdown = createVanillaDropdown({
        containerElement: dropdownContainer,
        options: tables.map(t => ({ value: t, label: t })),
        placeholder: 'Select table...',
        searchPlaceholder: 'Search...'
    });

    checkRowsBtn.addEventListener('click', async () => {
        const table = dropdown.getValue();
        if (!table) {
            showWarningToast('Valitse taulu');
            return;
        }
        try {
            const data = await endpoint_router('checkMediaRows', {
                url_params: `?dataset=${encodeURIComponent(table)}`
            });
            if (Array.isArray(data.orphans) && data.orphans.length > 0) {
                rowResult.textContent = data.orphans.join('\n');
            } else {
                rowResult.textContent = 'No orphan folders';
            }
        } catch (err) {
            console.warn('checkMediaRows failed:', err);
            rowResult.textContent = 'Error';
        }
    });

    checkSubsBtn.addEventListener('click', async () => {
        const table = dropdown.getValue();
        if (!table) {
            showWarningToast('Valitse taulu');
            return;
        }
        try {
            const data = await endpoint_router('checkMediaSubfolders', {
                url_params: `?dataset=${encodeURIComponent(table)}`
            });
            if (Array.isArray(data.rows) && data.rows.length > 0) {
                subsResult.textContent = data.rows.map(r => `${r.id}: ${r.missing.join(', ')}`).join('\n');
            } else {
                subsResult.textContent = 'All rows have required folders';
            }
        } catch (err) {
            console.warn('checkMediaSubfolders failed:', err);
            subsResult.textContent = 'Error';
        }
    });

    fixSubsBtn.addEventListener('click', async () => {
        const table = dropdown.getValue();
        if (!table) {
            showWarningToast('Valitse taulu');
            return;
        }
        try {
            const data = await endpoint_router('fixMediaSubfolders', {
                method: 'POST',
                url_params: `?dataset=${encodeURIComponent(table)}`
            });
            if (Array.isArray(data.rows) && data.rows.length > 0) {
                fixResult.textContent = data.rows.map(r => `${r.id}: ${r.fixed.join(', ')}`).join('\n');
            } else {
                fixResult.textContent = 'No changes';
            }
        } catch (err) {
            console.warn('fixMediaSubfolders failed:', err);
            fixResult.textContent = 'Error';
        }
    });
}

function formatArchivedRootStatus(response) {
    const archived = Array.isArray(response?.archived) ? response.archived : [];
    if (archived.length === 0) {
        return 'No archived root folders';
    }

    return archived.map((entry) => {
        const folder = String(entry?.folder || '').trim();
        if (!folder) {
            return null;
        }
        if (entry?.prunable === true) {
            return `${folder} — prunable archived dataset root`;
        }
        const tableName = String(entry?.table_name || '').trim();
        return tableName
            ? `${folder} — kept because live dataset "${tableName}" still exists`
            : `${folder} — kept because a live dataset still exists`;
    }).filter(Boolean).join('\n');
}

export async function load_empty_rows_view() {
    const container = getOrCreateManagementFormsContainer('empty_rows_container');
    container.replaceChildren();

    const btnContainer = document.createElement('div');
    btnContainer.classList.add('er-mode-buttons-container');
    const rowsBtn = document.createElement('button');
    rowsBtn.textContent = 'Empty rows';
    const mediaBtn = document.createElement('button');
    mediaBtn.textContent = 'Storage tools';
    mediaBtn.dataset.testid = 'empty-rows-storage-tools-tab';
    btnContainer.appendChild(rowsBtn);
    btnContainer.appendChild(mediaBtn);
    container.appendChild(btnContainer);

    const viewContainer = document.createElement('div');
    container.appendChild(viewContainer);

    async function showRows() {
        viewContainer.replaceChildren();
        await generate_empty_rows_view(viewContainer);
    }

    async function showMedia() {
        viewContainer.replaceChildren();
        await generate_media_tools_view(viewContainer);
    }

    let mode = localStorage.getItem('empty_rows_mode') || 'rows';
    if (mode === 'media') {
        mode = 'storage';
        localStorage.setItem('empty_rows_mode', mode);
    }
    if (mode === 'storage') {
        await showMedia();
    } else {
        await showRows();
    }

    rowsBtn.addEventListener('click', async () => {
        mode = 'rows';
        localStorage.setItem('empty_rows_mode', mode);
        await showRows();
    });

    mediaBtn.addEventListener('click', async () => {
        mode = 'storage';
        localStorage.setItem('empty_rows_mode', mode);
        await showMedia();
    });
}
