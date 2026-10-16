// database_consistency_view.js
// Renders the admin tool for checking and fixing database consistency issues.
// Bridges consistency-check endpoints, fix actions, and categorized result rendering.
// Exists to give admins one place to inspect detected integrity problems and trigger repairs.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { getTranslationForKey } from '../lang/component_language_dictionary.js';
import { splitTranslationKey, applyTranslationVariable } from '../lang/translation_handler_helpers.js';

/**
 * Generoi tietokannan yhtenäisyystarkistus-näkymän annettuun containeriin.
 * @param {HTMLElement} container - Kohde-elementti johon näkymä rakennetaan
 */
export async function generate_database_consistency_view(container) {
    if (!container) return;
    container.replaceChildren();

    // Kehys joka rajoittaa työkalun leveyttä (oletuksena 1200px, ks. form.css)
    const frame = document.createElement('div');
    frame.className = 'tool-content-frame';
    container.appendChild(frame);

    // Otsikko
    const header = document.createElement('h2');
    header.dataset.langKey = 'database_consistency_check';
    header.textContent = 'Database Consistency Check';
    frame.appendChild(header);

    // Tarkista-nappi
    const checkButton = document.createElement('button');
    checkButton.className = 'button';
    checkButton.dataset.langKey = 'run_consistency_check';
    checkButton.textContent = 'Run Check';
    frame.appendChild(checkButton);

    // Tulosalue
    const resultsArea = document.createElement('div');
    resultsArea.style.marginTop = '16px';
    frame.appendChild(resultsArea);

    checkButton.addEventListener('click', async () => {
        checkButton.disabled = true;
        checkButton.textContent = 'Checking...';
        resultsArea.replaceChildren();

        try {
            const data = await endpoint_router('checkDbConsistency');
            renderResults(resultsArea, data);
        } catch (err) {
            const errorP = document.createElement('p');
            errorP.textContent = 'Error: ' + err.message;
            errorP.style.color = 'red';
            resultsArea.appendChild(errorP);
        } finally {
            checkButton.disabled = false;
            checkButton.textContent = 'Run Check';
            checkButton.dataset.langKey = 'run_consistency_check';
        }
    });
}

/**
 * Builds the language-key source scan freshness line (fresh, stale or unknown) for category 8.
 * @param {Object} cat - Category 8 of the backend response (source_scan_stale, source_scan_at)
 * @returns {HTMLElement}
 */
function buildSourceScanStatus(cat) {
    const status = document.createElement('p');
    status.classList.add('fw-text-sm', 'fw-text-muted');
    const stateKey = cat.source_scan_stale !== false
        ? 'consistency_source_scan_stale' : 'consistency_source_scan_fresh';
    const state = document.createElement('span');
    state.dataset.langKey = stateKey;
    state.textContent = getTranslationForKey(stateKey);
    status.appendChild(state);
    status.appendChild(document.createTextNode(' '));
    const scan = document.createElement(cat.source_scan_at ? 'time' : 'span');
    const scanKey = cat.source_scan_at ? 'consistency_source_scan_at' : 'consistency_source_scan_unknown';
    scan.dataset.langKey = cat.source_scan_at ? `${scanKey}+${cat.source_scan_at}` : scanKey;
    if (cat.source_scan_at) scan.dateTime = cat.source_scan_at;
    scan.textContent = applyTranslationVariable(getTranslationForKey(scanKey), cat.source_scan_at || null);
    status.appendChild(scan);
    return status;
}

/**
 * Renderöi tarkistustulokset kategorioittain
 * @param {HTMLElement} resultsArea - Kohde-elementti
 * @param {Object} data - Backend-vastaus (categories, total_count)
 */
function renderResults(resultsArea, data) {
    resultsArea.replaceChildren();

    if (!data || !data.categories) {
        const p = document.createElement('p');
        p.textContent = 'Ei dataa.';
        resultsArea.appendChild(p);
        return;
    }

    // Yhteenveto
    const summary = document.createElement('p');
    summary.style.fontWeight = 'bold';
    summary.style.marginBottom = '16px';
    if (data.total_count === 0) {
        summary.textContent = 'No issues found.';
        summary.style.color = 'green';
        summary.dataset.langKey = 'consistency_no_issues';
        resultsArea.appendChild(summary);
        // A clean report must still say how fresh the language-key source scan is (stale or unknown included).
        const sourceScan = data.categories.find(cat => cat.number === 8);
        if (sourceScan) resultsArea.appendChild(buildSourceScanStatus(sourceScan));
        return;
    }
    summary.textContent = `Found ${data.total_count} issue(s).`;
    summary.style.color = 'orange';
    resultsArea.appendChild(summary);

    // Kerätään kaikki korjattavat issue-ID:t Fix All -nappia varten
    const allFixableIds = [];

    for (const cat of data.categories) {
        // Kategorian otsikko
        const catSection = document.createElement('div');
        catSection.style.marginBottom = '20px';

        const catTitle = document.createElement('h3');
        catTitle.style.borderBottom = '1px solid var(--border-color, #ccc)';
        catTitle.style.paddingBottom = '4px';
        if (cat.title_lang_key) {
            catTitle.dataset.langKey = cat.title_lang_key;
        }
        catTitle.textContent = `${cat.number}. ${cat.title}`;
        catSection.appendChild(catTitle);

        if (cat.number === 8) catSection.appendChild(buildSourceScanStatus(cat));

        if (cat.number === 2) {
            const cat2Note = document.createElement('p');
            cat2Note.textContent = 'Choose Drop to remove from PostgreSQL, or Register to add to system tables.';
            cat2Note.style.margin = '6px 0 10px 0';
            cat2Note.style.fontSize = '0.9em';
            cat2Note.style.color = 'var(--text_color_secondary, #666)';
            catSection.appendChild(cat2Note);
        }

        if (!cat.issues || cat.issues.length === 0) {
            const noIssue = document.createElement('p');
            noIssue.textContent = 'OK';
            noIssue.style.color = 'green';
            noIssue.style.marginLeft = '12px';
            catSection.appendChild(noIssue);
            resultsArea.appendChild(catSection);
            continue;
        }

        // Ongelmalista
        const issueList = document.createElement('div');
        issueList.style.marginLeft = '12px';

        for (const issue of cat.issues) {
            const issueRow = document.createElement('div');
            issueRow.style.display = 'flex';
            issueRow.style.alignItems = 'center';
            issueRow.style.justifyContent = 'space-between';
            issueRow.style.padding = '6px 8px';
            issueRow.style.borderBottom = '1px solid var(--border-color, #eee)';
            issueRow.style.gap = '12px';

            const labelContainer = document.createElement('div');
            labelContainer.style.flex = '1';
            labelContainer.style.minWidth = '0';

            const label = document.createElement('span');
            label.textContent = issue.table;
            label.style.fontWeight = '500';
            labelContainer.appendChild(label);

            // Näytetään kuvaus näkyvänä tekstinä avaimen alla (ei pelkkänä tooltipinä)
            // Keep pause copy in the normal translation lifecycle, including
            // language changes after the report has already been rendered.
            for (const langKey of issue.description_lang_keys || []) {
                const descSpan = document.createElement('div');
                const { baseKey, variablePart } = splitTranslationKey(langKey);
                descSpan.dataset.langKey = langKey;
                descSpan.textContent = applyTranslationVariable(getTranslationForKey(baseKey), variablePart);
                descSpan.style.fontSize = '0.85em';
                descSpan.style.color = 'var(--text_color_secondary, #888)';
                labelContainer.appendChild(descSpan);
            }
            if (issue.description) {
                const descSpan = document.createElement('div');
                descSpan.textContent = issue.description;
                descSpan.style.fontSize = '0.85em';
                descSpan.style.color = 'var(--text_color_secondary, #888)';
                descSpan.style.marginTop = '2px';
                labelContainer.appendChild(descSpan);
            }

            issueRow.appendChild(labelContainer);

            if (cat.number === 8) {
                // Report-only while language-key archiving is paused.
            } else if (cat.number !== 2) {
                // Garbage keys require explicit, guarded single-key review.
                if (cat.number !== 7) allFixableIds.push(issue.id);

                const fixBtn = document.createElement('button');
                fixBtn.className = 'button';
                fixBtn.dataset.langKey = 'fix';
                fixBtn.textContent = 'Fix';
                fixBtn.style.minWidth = '60px';
                fixBtn.addEventListener('click', async () => {
                    fixBtn.disabled = true;
                    fixBtn.textContent = '...';
                    try {
                        const result = await endpoint_router('fixDbConsistency', {
                            method: 'POST',
                            body_data: { fix_ids: [issue.id] }
                        });
                        if (!result.fixed) {
                            fixBtn.disabled = false;
                            fixBtn.textContent = getTranslationForKey('fix');
                            fixBtn.dataset.langKey = 'fix';
                            return;
                        }
                        issueRow.style.opacity = '0.4';
                        fixBtn.textContent = 'Done';
                        fixBtn.dataset.langKey = 'done';
                    } catch (err) {
                        fixBtn.textContent = 'Error';
                        fixBtn.style.color = 'red';
                        console.warn('Fix error:', err);
                    }
                });
                issueRow.appendChild(fixBtn);
            } else {
                const actionButtons = document.createElement('div');
                actionButtons.style.display = 'flex';
                actionButtons.style.gap = '8px';
                actionButtons.style.flexWrap = 'wrap';
                actionButtons.style.justifyContent = 'flex-end';

                const dropBtn = document.createElement('button');
                dropBtn.className = 'button danger-button';
                dropBtn.textContent = 'Drop';
                dropBtn.style.minWidth = '70px';
                dropBtn.style.backgroundColor = '#b42318';
                dropBtn.style.borderColor = '#b42318';
                dropBtn.style.color = '#fff';

                const registerBtn = document.createElement('button');
                registerBtn.className = 'button';
                registerBtn.textContent = 'Register';
                registerBtn.style.minWidth = '90px';
                registerBtn.style.backgroundColor = '#2e9b57';
                registerBtn.style.borderColor = '#2e9b57';
                registerBtn.style.color = '#fff';

                const runCategory2Action = async (btn, action) => {
                    dropBtn.disabled = true;
                    registerBtn.disabled = true;
                    btn.textContent = '...';
                    try {
                        await endpoint_router('fixDbConsistency', {
                            method: 'POST',
                            body_data: {
                                fix_ids: [issue.id],
                                fix_action: { [issue.id]: action }
                            }
                        });
                        issueRow.style.opacity = '0.4';
                        btn.textContent = 'Done';
                    } catch (err) {
                        btn.textContent = 'Error';
                        btn.style.color = 'red';
                        dropBtn.disabled = false;
                        registerBtn.disabled = false;
                        console.warn(`Fix error (${action}):`, err);
                    }
                };

                dropBtn.addEventListener('click', async () => {
                    await runCategory2Action(dropBtn, 'drop');
                });
                registerBtn.addEventListener('click', async () => {
                    await runCategory2Action(registerBtn, 'register');
                });

                actionButtons.appendChild(dropBtn);
                actionButtons.appendChild(registerBtn);
                issueRow.appendChild(actionButtons);
            }

            issueList.appendChild(issueRow);
        }

        catSection.appendChild(issueList);
        resultsArea.appendChild(catSection);
    }

    // Fix All -nappi alhaalla, vain jos on korjattavia ongelmia
    if (allFixableIds.length > 0) {
        const fixAllContainer = document.createElement('div');
        fixAllContainer.style.marginTop = '24px';
        fixAllContainer.style.borderTop = '2px solid var(--border-color, #ccc)';
        fixAllContainer.style.paddingTop = '16px';

        const fixAllBtn = document.createElement('button');
        fixAllBtn.className = 'button danger-button';
        fixAllBtn.dataset.langKey = 'fix_all';
        fixAllBtn.textContent = 'Fix All';
        fixAllBtn.style.minWidth = '120px';
        fixAllBtn.addEventListener('click', async () => {
            const ok = await showConfirmModal({
                messagePlainText: 'Fix all fixable issues? This cannot be undone.',
                messageLangKey: 'confirm_fix_all_issues',
                isDanger: true,
            });
            if (!ok) return;

            fixAllBtn.disabled = true;
            fixAllBtn.textContent = 'Fixing...';
            try {
                const result = await endpoint_router('fixDbConsistency', {
                    method: 'POST',
                    body_data: { fix_all: true }
                });
                fixAllBtn.textContent = `Fixed ${result.fixed || 0}`;
                if (result.errors && result.errors.length > 0) {
                    fixAllBtn.textContent += ` (${result.errors.length} errors)`;
                }
            } catch (err) {
                fixAllBtn.textContent = 'Error';
                fixAllBtn.style.color = 'red';
                console.warn('Fix all error:', err);
            }
        });

        fixAllContainer.appendChild(fixAllBtn);
        resultsArea.appendChild(fixAllContainer);
    }
}
