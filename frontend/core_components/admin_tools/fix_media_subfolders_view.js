// fix_media_subfolders_view.js
// Renders the admin tool for checking and fixing media storage subfolders.
// Bridges admin actions, dataset media endpoints, and result rendering in the tool view.
// Exists to let admins repair missing media directories and thumbnails from one screen.

import { endpoint_router } from '../endpoints/endpoint_router.js';

/**
 * Generoi media-alikansioiden korjausnäkymän annettuun containeriin.
 * @param {HTMLElement} container - Kohde-elementti johon näkymä rakennetaan
 */
export async function generate_fix_media_subfolders_view(container) {
    if (!container) return;
    container.replaceChildren();

    const frame = document.createElement('div');
    frame.className = 'tool-content-frame';
    container.appendChild(frame);

    // Otsikko
    const header = document.createElement('h2');
    header.dataset.langKey = 'fix_media_subfolders';
    header.textContent = 'Fix Media Subfolders';
    frame.appendChild(header);

    // Kuvaus
    const desc = document.createElement('p');
    desc.dataset.langKey = 'fix_media_subfolders_description';
    desc.textContent = 'Checks and fixes missing media subfolders (300, 1000, 2160, original) for all datasets. Generates missing thumbnails from originals.';
    desc.style.marginBottom = '16px';
    desc.style.color = 'var(--text_color_secondary, #888)';
    frame.appendChild(desc);

    // --- Yksittäinen dataset -osio ---
    const singleSection = document.createElement('div');
    singleSection.style.marginBottom = '24px';

    const singleTitle = document.createElement('h3');
    singleTitle.dataset.langKey = 'check_single_dataset';
    singleTitle.textContent = 'Check & Fix Single Dataset';
    singleSection.appendChild(singleTitle);

    const selectRow = document.createElement('div');
    selectRow.style.display = 'flex';
    selectRow.style.gap = '8px';
    selectRow.style.alignItems = 'center';
    selectRow.style.flexWrap = 'wrap';

    const datasetSelect = document.createElement('select');
    datasetSelect.className = 'button';
    datasetSelect.style.minWidth = '200px';

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = 'Loading datasets...';
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    datasetSelect.appendChild(placeholderOpt);

    const checkOneBtn = document.createElement('button');
    checkOneBtn.className = 'button';
    checkOneBtn.dataset.langKey = 'check';
    checkOneBtn.textContent = 'Check';

    const fixOneBtn = document.createElement('button');
    fixOneBtn.className = 'button';
    fixOneBtn.dataset.langKey = 'fix';
    fixOneBtn.textContent = 'Fix';

    selectRow.appendChild(datasetSelect);
    selectRow.appendChild(checkOneBtn);
    selectRow.appendChild(fixOneBtn);
    singleSection.appendChild(selectRow);

    const singleResults = document.createElement('div');
    singleResults.style.marginTop = '12px';
    singleSection.appendChild(singleResults);

    frame.appendChild(singleSection);

    // --- Kaikki datasetit -osio ---
    const allSection = document.createElement('div');
    allSection.style.borderTop = '2px solid var(--border-color, #ccc)';
    allSection.style.paddingTop = '16px';

    const allTitle = document.createElement('h3');
    allTitle.dataset.langKey = 'check_and_fix_all_datasets';
    allTitle.textContent = 'Check & Fix All Datasets';
    allSection.appendChild(allTitle);

    const allActions = document.createElement('div');
    allActions.style.display = 'flex';
    allActions.style.gap = '8px';
    allActions.style.flexWrap = 'wrap';

    const checkAllBtn = document.createElement('button');
    checkAllBtn.type = 'button';
    checkAllBtn.className = 'button';
    checkAllBtn.dataset.langKey = 'check_all_media_subfolders';
    checkAllBtn.dataset.testid = 'check-all-media-subfolders';
    checkAllBtn.textContent = 'Check All Datasets';
    checkAllBtn.style.minWidth = '160px';

    const fixAllBtn = document.createElement('button');
    fixAllBtn.type = 'button';
    fixAllBtn.className = 'button';
    fixAllBtn.dataset.langKey = 'fix_all_media_subfolders';
    fixAllBtn.dataset.testid = 'fix-all-media-subfolders';
    fixAllBtn.textContent = 'Fix All Datasets';
    fixAllBtn.style.minWidth = '160px';

    allActions.appendChild(checkAllBtn);
    allActions.appendChild(fixAllBtn);
    allSection.appendChild(allActions);

    const allResults = document.createElement('div');
    allResults.style.marginTop = '12px';
    allResults.setAttribute('role', 'status');
    allResults.setAttribute('aria-live', 'polite');
    allResults.setAttribute('aria-busy', 'false');
    allSection.appendChild(allResults);

    frame.appendChild(allSection);

    // Ladataan dataset-nimet
    try {
        const names = await endpoint_router('datasetNames');
        datasetSelect.replaceChildren();
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '— Select dataset —';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;
        datasetSelect.appendChild(defaultOpt);

        const list = Array.isArray(names) ? names : (names.names || []);
        for (const name of list) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            datasetSelect.appendChild(opt);
        }
    } catch (err) {
        console.warn('Failed to load dataset names:', err);
        placeholderOpt.textContent = 'Error loading datasets';
    }

    // Check single
    checkOneBtn.addEventListener('click', async () => {
        const ds = datasetSelect.value;
        if (!ds) return;
        const idleLabel = checkOneBtn.textContent;
        checkOneBtn.disabled = true;
        checkOneBtn.textContent = 'Checking...';
        singleResults.replaceChildren();
        try {
            const data = await endpoint_router('checkMediaSubfolders', {
                url_params: `?dataset=${encodeURIComponent(ds)}`
            });
            renderCheckResults(singleResults, ds, data);
        } catch (err) {
            renderError(singleResults, err);
        } finally {
            checkOneBtn.disabled = false;
            checkOneBtn.textContent = idleLabel;
        }
    });

    // Fix single
    fixOneBtn.addEventListener('click', async () => {
        const ds = datasetSelect.value;
        if (!ds) return;
        const idleLabel = fixOneBtn.textContent;
        fixOneBtn.disabled = true;
        fixOneBtn.textContent = 'Fixing...';
        singleResults.replaceChildren();
        try {
            const data = await endpoint_router('fixMediaSubfolders', {
                method: 'POST',
                url_params: `?dataset=${encodeURIComponent(ds)}`
            });
            renderFixResults(singleResults, ds, data);
        } catch (err) {
            renderError(singleResults, err);
        } finally {
            fixOneBtn.disabled = false;
            fixOneBtn.textContent = idleLabel;
        }
    });

    // Check all (read-only)
    checkAllBtn.addEventListener('click', async () => {
        const idleLabel = checkAllBtn.textContent;
        checkAllBtn.disabled = true;
        fixAllBtn.disabled = true;
        checkAllBtn.textContent = 'Checking all...';
        allResults.setAttribute('aria-busy', 'true');
        allResults.replaceChildren();

        try {
            const names = await endpoint_router('datasetNames');
            const list = Array.isArray(names) ? names : (names.names || []);
            let affectedRows = 0;
            let affectedDatasets = 0;
            let errorCount = 0;

            for (const ds of list) {
                const statusLine = document.createElement('div');
                statusLine.style.padding = '4px 0';
                statusLine.textContent = `${ds}: checking...`;
                statusLine.style.color = 'var(--text_color_secondary, #888)';
                allResults.appendChild(statusLine);

                try {
                    const data = await endpoint_router('checkMediaSubfolders', {
                        url_params: `?dataset=${encodeURIComponent(ds)}`
                    });
                    const rows = data.rows || [];
                    if (rows.length === 0) {
                        statusLine.textContent = `${ds}: OK ✓`;
                        statusLine.style.color = 'green';
                        continue;
                    }

                    affectedDatasets += 1;
                    affectedRows += rows.length;
                    statusLine.textContent = `${ds}: ${rows.length} row(s) need attention`;
                    statusLine.style.color = 'orange';
                    statusLine.style.fontWeight = '500';

                    for (const row of rows) {
                        const detail = document.createElement('div');
                        detail.style.marginLeft = '16px';
                        detail.style.fontSize = '0.85em';
                        detail.style.color = 'var(--text_color_secondary, #888)';
                        detail.textContent = `id=${row.id}: missing [${(row.missing || []).join(', ')}]`;
                        allResults.appendChild(detail);
                    }
                } catch (err) {
                    errorCount += 1;
                    statusLine.textContent = `${ds}: error — ${err.message || err}`;
                    statusLine.style.color = 'red';
                }
            }

            const summary = document.createElement('p');
            summary.style.fontWeight = 'bold';
            summary.style.marginTop = '16px';
            summary.style.borderTop = '1px solid var(--border-color, #ccc)';
            summary.style.paddingTop = '8px';
            if (errorCount > 0) {
                summary.textContent = `Found ${affectedRows} row(s) needing attention across ${affectedDatasets} dataset(s), with ${errorCount} error(s). No files were changed.`;
                summary.style.color = 'red';
            } else if (affectedRows === 0) {
                summary.textContent = 'All datasets OK. No files were changed.';
                summary.style.color = 'green';
            } else {
                summary.textContent = `Found ${affectedRows} row(s) needing attention across ${affectedDatasets} dataset(s). No files were changed.`;
                summary.style.color = 'orange';
            }
            allResults.appendChild(summary);
        } catch (err) {
            renderError(allResults, err);
        } finally {
            checkAllBtn.disabled = false;
            fixAllBtn.disabled = false;
            checkAllBtn.textContent = idleLabel;
            allResults.setAttribute('aria-busy', 'false');
        }
    });

    // Fix all
    fixAllBtn.addEventListener('click', async () => {
        const idleLabel = fixAllBtn.textContent;
        checkAllBtn.disabled = true;
        fixAllBtn.disabled = true;
        fixAllBtn.textContent = 'Fixing all...';
        allResults.setAttribute('aria-busy', 'true');
        allResults.replaceChildren();

        try {
            const names = await endpoint_router('datasetNames');
            const list = Array.isArray(names) ? names : (names.names || []);
            let totalFixed = 0;
            let errorCount = 0;

            for (const ds of list) {
                const statusLine = document.createElement('div');
                statusLine.style.padding = '4px 0';
                statusLine.textContent = `${ds}: fixing...`;
                statusLine.style.color = 'var(--text_color_secondary, #888)';
                allResults.appendChild(statusLine);

                try {
                    const data = await endpoint_router('fixMediaSubfolders', {
                        method: 'POST',
                        url_params: `?dataset=${encodeURIComponent(ds)}`
                    });
                    const rows = data.rows || [];
                    if (rows.length > 0) {
                        const fixCount = rows.reduce((sum, r) => sum + (r.fixed ? r.fixed.length : 0), 0);
                        totalFixed += fixCount;
                        statusLine.textContent = `${ds}: fixed ${fixCount} item(s) in ${rows.length} row(s)`;
                        statusLine.style.color = 'orange';
                        statusLine.style.fontWeight = '500';

                        // Näytä fix-yksityiskohdat
                        for (const row of rows) {
                            for (const fix of (row.fixed || [])) {
                                const detail = document.createElement('div');
                                detail.style.marginLeft = '16px';
                                detail.style.fontSize = '0.85em';
                                detail.style.color = 'var(--text_color_secondary, #888)';
                                detail.textContent = `id=${row.id}: ${fix}`;
                                allResults.appendChild(detail);
                            }
                        }
                    } else {
                        statusLine.textContent = `${ds}: OK ✓`;
                        statusLine.style.color = 'green';
                    }
                } catch (err) {
                    errorCount += 1;
                    statusLine.textContent = `${ds}: error — ${err.message || err}`;
                    statusLine.style.color = 'red';
                }
            }

            // Yhteenveto
            const summary = document.createElement('p');
            summary.style.fontWeight = 'bold';
            summary.style.marginTop = '16px';
            summary.style.borderTop = '1px solid var(--border-color, #ccc)';
            summary.style.paddingTop = '8px';
            if (errorCount > 0) {
                summary.textContent = `Fix completed with ${errorCount} error(s). Fixed ${totalFixed} total item(s).`;
                summary.style.color = 'red';
            } else if (totalFixed === 0) {
                summary.textContent = 'All datasets OK — no fixes needed.';
                summary.style.color = 'green';
            } else {
                summary.textContent = `Done. Fixed ${totalFixed} total item(s).`;
                summary.style.color = 'orange';
            }
            allResults.appendChild(summary);
        } catch (err) {
            renderError(allResults, err);
        } finally {
            checkAllBtn.disabled = false;
            fixAllBtn.disabled = false;
            fixAllBtn.textContent = idleLabel;
            allResults.setAttribute('aria-busy', 'false');
        }
    });
}

/**
 * Renderöi check-tulokset (puuttuvat alikansiot).
 */
function renderCheckResults(area, dataset, data) {
    area.replaceChildren();
    const rows = data.rows || [];
    if (rows.length === 0) {
        const ok = document.createElement('p');
        ok.textContent = `${dataset}: No missing subfolders found.`;
        ok.style.color = 'green';
        area.appendChild(ok);
        return;
    }
    const title = document.createElement('p');
    title.style.fontWeight = 'bold';
    title.style.color = 'orange';
    title.textContent = `${dataset}: ${rows.length} row(s) with missing subfolders`;
    area.appendChild(title);

    for (const row of rows) {
        const line = document.createElement('div');
        line.style.marginLeft = '12px';
        line.style.padding = '2px 0';
        line.textContent = `id=${row.id}: missing [${(row.missing || []).join(', ')}]`;
        area.appendChild(line);
    }
}

/**
 * Renderöi fix-tulokset (tehdyt korjaukset).
 */
function renderFixResults(area, dataset, data) {
    area.replaceChildren();
    const rows = data.rows || [];
    if (rows.length === 0) {
        const ok = document.createElement('p');
        ok.textContent = `${dataset}: No fixes needed — everything OK.`;
        ok.style.color = 'green';
        area.appendChild(ok);
        return;
    }
    const title = document.createElement('p');
    title.style.fontWeight = 'bold';
    title.style.color = 'orange';
    title.textContent = `${dataset}: Fixed ${rows.length} row(s)`;
    area.appendChild(title);

    for (const row of rows) {
        for (const fix of (row.fixed || [])) {
            const line = document.createElement('div');
            line.style.marginLeft = '12px';
            line.style.padding = '2px 0';
            line.style.fontSize = '0.9em';
            line.textContent = `id=${row.id}: ${fix}`;
            area.appendChild(line);
        }
    }
}

/**
 * Renderöi virheviesti.
 */
function renderError(area, err) {
    const errorP = document.createElement('p');
    errorP.textContent = 'Error: ' + (err.message || err);
    errorP.style.color = 'red';
    area.appendChild(errorP);
}
