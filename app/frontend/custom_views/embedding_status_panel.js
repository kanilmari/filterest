// embedding_status_panel.js
// Read-only status table of every dataset's embeddings on the embedding refresh admin page.
// Bridges the embedding-datasets status response and the page's translated, theme-aware table.
// Exists so an administrator can see which datasets are embedded, how completely, by which model and whether they stay current.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { getLanguageWithBrowserFallback } from '../core_components/state_stores/lang_preference_reader.js';
import { formatTimestampDisplayText } from '../core_components/table_views/timestamp_display_formatter.js';
import { renderEmbeddingProviderKeyForm } from './embedding_provider_key_form.js';
import { englishEmbeddingAdminCopy, keyedElement } from './embedding_status_translation_fallbacks.js';

const STATUS_QUERY = '?include_status=true';
const PROVIDER_LABELS = Object.freeze({ google: 'Google', openai: 'OpenAI' });
const AUTOMATIC_REFRESH_BLOCKERS = Object.freeze([
    'no_embedding_storage',
    'provider_sending_disabled',
    'no_approved_fields',
    'queue_unavailable',
]);

// Dataset states, in the order an administrator acts on them.
export const EMBEDDING_STATE_EMBEDDED = 'embedded';
export const EMBEDDING_STATE_PARTIAL = 'partial';
export const EMBEDDING_STATE_NONE = 'none';
export const EMBEDDING_STATE_UNAVAILABLE = 'unavailable';

function wholeNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
}

function optionalWholeNumber(value) {
    return value === null || value === undefined ? null : wholeNumber(value);
}

/**
 * Accepts only the fields the table shows, with safe defaults, so a partial or
 * older server answer can never break the page.
 *
 * @param {unknown} response - The `include_status=true` answer.
 * @returns {{provider: object, datasets: object[]}}
 */
export function normalizeEmbeddingStatusReport(response) {
    const provider = response?.provider ?? {};
    const datasets = Array.isArray(response?.datasets) ? response.datasets : [];
    return {
        provider: {
            provider: typeof provider.provider === 'string' ? provider.provider : '',
            model: typeof provider.model === 'string' ? provider.model : '',
            dimensions: wholeNumber(provider.dimensions),
            key_configured: provider.key_configured === true,
        },
        datasets: datasets
            .filter(status => typeof status?.dataset === 'string' && status.dataset.trim() !== '')
            .map(status => ({
                dataset: status.dataset,
                general_embedding: status.general_embedding === true,
                multilingual_embedding: status.multilingual_embedding === true,
                automatic_refresh: status.automatic_refresh === true,
                automatic_refresh_blocker: AUTOMATIC_REFRESH_BLOCKERS.includes(status.automatic_refresh_blocker)
                    ? status.automatic_refresh_blocker
                    : '',
                total_rows: optionalWholeNumber(status.total_rows),
                embedded_rows: wholeNumber(status.embedded_rows),
                changed_since_embedding: optionalWholeNumber(status.changed_since_embedding),
                languages: Array.isArray(status.languages)
                    ? status.languages
                        .filter(entry => typeof entry?.language === 'string' && entry.language !== '')
                        .map(entry => ({ language: entry.language, rows: wholeNumber(entry.rows) }))
                    : [],
                other_model_embeddings: wholeNumber(status.other_model_embeddings),
                last_refreshed: typeof status.last_refreshed === 'string' ? status.last_refreshed : null,
                pending_refreshes: wholeNumber(status.pending_refreshes),
                failing_refreshes: wholeNumber(status.failing_refreshes),
                orphan_language_embeddings: wholeNumber(status.orphan_language_embeddings),
                unavailable: status.unavailable === true,
            })),
    };
}

/**
 * Says whether a dataset is embedded, partly embedded or not at all.
 *
 * @param {object} status - One normalized dataset status.
 * @returns {string} One of the EMBEDDING_STATE_* values.
 */
export function describeEmbeddingState(status) {
    if (status.unavailable) return EMBEDDING_STATE_UNAVAILABLE;
    if (status.total_rows === null || status.embedded_rows === 0) return EMBEDDING_STATE_NONE;
    if (status.embedded_rows >= status.total_rows) return EMBEDDING_STATE_EMBEDDED;
    return EMBEDDING_STATE_PARTIAL;
}

function withHint(element, hintKey) {
    element.dataset.titleLangKey = hintKey;
    element.title = englishEmbeddingAdminCopy(hintKey);
    return element;
}

function mutedLine(langKey, variable, extraClass = '') {
    const line = keyedElement('div', langKey, variable);
    line.classList.add('embedding-status-note');
    if (extraClass) line.classList.add(extraClass);
    return line;
}

function renderProviderSummary(provider) {
    const summary = document.createElement('p');
    summary.classList.add('embedding-status-provider');

    const providerLabel = keyedElement('span', 'embedding_status_provider');
    providerLabel.classList.add('embedding-status-label');
    summary.appendChild(providerLabel);
    summary.appendChild(document.createTextNode(` ${PROVIDER_LABELS[provider.provider] || provider.provider} · `));

    const modelLabel = keyedElement('span', 'embedding_status_model');
    modelLabel.classList.add('embedding-status-label');
    summary.appendChild(modelLabel);
    summary.appendChild(document.createTextNode(` ${provider.model}`));

    if (provider.dimensions > 0) {
        summary.appendChild(document.createTextNode(' · '));
        summary.appendChild(keyedElement('span', 'embedding_status_dimensions', provider.dimensions));
    }
    summary.appendChild(document.createTextNode(' · '));
    const key = keyedElement('span', provider.key_configured ? 'embedding_status_key_configured' : 'embedding_status_key_missing');
    if (!provider.key_configured) key.classList.add('embedding-status-warning');
    summary.appendChild(key);
    return summary;
}

const STATE_KEYS = Object.freeze({
    [EMBEDDING_STATE_EMBEDDED]: 'embedding_status_state_embedded',
    [EMBEDDING_STATE_PARTIAL]: 'embedding_status_state_partial',
    [EMBEDDING_STATE_NONE]: 'embedding_status_state_none',
    [EMBEDDING_STATE_UNAVAILABLE]: 'embedding_status_state_unavailable',
});

function notTrackedCell(cell) {
    const text = withHint(keyedElement('span', 'embedding_status_not_tracked'), 'embedding_status_not_tracked_hint');
    text.classList.add('embedding-status-muted');
    cell.appendChild(text);
}

function renderDatasetRow(status) {
    const row = document.createElement('tr');
    row.dataset.dataset = status.dataset;
    const state = describeEmbeddingState(status);
    row.dataset.embeddingState = state;

    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.textContent = status.dataset;
    row.appendChild(nameCell);

    const stateCell = document.createElement('td');
    const badge = keyedElement('span', STATE_KEYS[state]);
    badge.classList.add('embedding-status-badge', `embedding-status-badge--${state}`);
    stateCell.appendChild(badge);
    row.appendChild(stateCell);

    const rowsCell = document.createElement('td');
    const changedCell = document.createElement('td');
    const languagesCell = document.createElement('td');
    const modelCell = document.createElement('td');
    const refreshedCell = document.createElement('td');
    const automaticCell = document.createElement('td');
    row.append(rowsCell, changedCell, languagesCell, modelCell, refreshedCell, automaticCell);

    if (status.total_rows !== null && !status.unavailable) {
        rowsCell.textContent = `${status.embedded_rows} / ${status.total_rows}`;
        const without = status.total_rows - status.embedded_rows;
        if (without > 0) {
            rowsCell.appendChild(mutedLine('embedding_status_rows_without', without));
        }

        if (status.changed_since_embedding === null) notTrackedCell(changedCell);
        else changedCell.textContent = String(status.changed_since_embedding);

        const languageNames = status.languages.map(entry => `${entry.language} ${entry.rows}`);
        if (languageNames.length > 0) languagesCell.textContent = languageNames.join(' · ');
        if (status.general_embedding) {
            languagesCell.appendChild(mutedLine('embedding_status_general_embedding', null));
        }
        if (status.orphan_language_embeddings > 0) {
            languagesCell.appendChild(mutedLine('embedding_status_orphans', status.orphan_language_embeddings));
        }

        if (status.other_model_embeddings > 0) {
            modelCell.appendChild(withHint(
                mutedLine('embedding_status_other_model', status.other_model_embeddings, 'embedding-status-warning'),
                'embedding_status_other_model_hint',
            ));
        } else if (status.embedded_rows > 0) {
            modelCell.appendChild(keyedElement('span', 'embedding_status_current_model'));
        }

        const refreshed = status.last_refreshed
            ? formatTimestampDisplayText(status.last_refreshed, '', {
                // The language the page is shown in, which may differ from a stored preference it could not apply.
                force: true, displayMode: 'date_time', locale: document.documentElement.lang || getLanguageWithBrowserFallback(),
            })
            : null;
        if (refreshed) refreshedCell.textContent = refreshed;
        else notTrackedCell(refreshedCell);
    }

    if (status.automatic_refresh) {
        automaticCell.appendChild(keyedElement('span', 'embedding_status_automatic_on'));
    } else if (status.automatic_refresh_blocker) {
        automaticCell.appendChild(keyedElement('span', `embedding_status_blocker_${status.automatic_refresh_blocker}`));
    }
    if (status.pending_refreshes > 0) {
        automaticCell.appendChild(mutedLine('embedding_status_pending', status.pending_refreshes));
    }
    if (status.failing_refreshes > 0) {
        automaticCell.appendChild(mutedLine('embedding_status_failing', status.failing_refreshes, 'embedding-status-warning'));
    }
    return row;
}

const COLUMN_HEADINGS = Object.freeze([
    ['embedding_status_column_dataset'],
    ['embedding_status_column_state'],
    ['embedding_status_column_rows'],
    ['embedding_status_column_changed', 'embedding_status_changed_hint'],
    ['embedding_status_column_languages'],
    ['embedding_status_model'],
    ['embedding_status_column_refreshed'],
    ['embedding_status_column_automatic'],
]);

function renderStatusTable(datasets) {
    const scroller = document.createElement('div');
    scroller.classList.add('embedding-status-scroller');
    const table = document.createElement('table');
    table.classList.add('embedding-status-table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    COLUMN_HEADINGS.forEach(([langKey, hintKey]) => {
        const heading = keyedElement('th', langKey);
        heading.scope = 'col';
        if (hintKey) withHint(heading, hintKey);
        headRow.appendChild(heading);
    });
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    datasets.forEach(status => body.appendChild(renderDatasetRow(status)));
    table.append(head, body);
    scroller.appendChild(table);
    return scroller;
}

/**
 * Renders the read-only embedding status into the given container.
 *
 * @param {HTMLElement} container - The panel's host element.
 * @returns {Promise<void>}
 */
export async function renderEmbeddingStatusPanel(container) {
    if (!container) return;
    container.replaceChildren();
    container.classList.add('embedding-status-panel', 'fw-card');

    const title = keyedElement('h3', 'embedding_status_title');
    const intro = keyedElement('p', 'embedding_status_intro');
    intro.classList.add('embedding-status-muted');
    const body = document.createElement('div');
    body.appendChild(keyedElement('p', 'embedding_status_loading'));
    container.append(title, intro, body);

    let report;
    try {
        report = normalizeEmbeddingStatusReport(await endpoint_router('embeddingDatasets', {
            method: 'GET',
            url_params: STATUS_QUERY,
        }));
    } catch (error) {
        console.warn('embedding status fetch failed', error);
        body.replaceChildren(keyedElement('p', 'embedding_status_unavailable'));
        return;
    }

    body.replaceChildren(renderProviderSummary(report.provider));
    // The summary above only ever says whether a key exists. When it does not,
    // the administrator gets the field to install one right where they noticed
    // it was missing, instead of an instruction to edit a file on the server.
    if (!report.provider.key_configured) {
        body.appendChild(renderEmbeddingProviderKeyForm({
            provider: report.provider.provider,
            onSaved: () => renderEmbeddingStatusPanel(container),
        }));
    }
    if (report.datasets.length === 0) {
        body.appendChild(keyedElement('p', 'embedding_status_empty'));
        return;
    }
    body.appendChild(renderStatusTable(report.datasets));
}
