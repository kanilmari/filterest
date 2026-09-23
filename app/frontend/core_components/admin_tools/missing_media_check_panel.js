// missing_media_check_panel.js
// Renders the administration section that reports media files a row uses but storage no longer has.
// Bridges the missing-media check endpoint and the existing media maintenance screen.
// Exists because a lost picture is otherwise silent: the row stays, the page simply shows
// nothing, and nobody learns that the file left the disk.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getBackendRoutePathByHandler } from '../endpoints/backend_route_manifest_reader.js';
import { registerEndpointRoute } from '../pipeline/api_pipeline.js';

const MISSING_MEDIA_CHECK_ROUTE = 'adminMissingMediaCheck';
const MISSING_MEDIA_CHECK_HANDLER = 'missing_media_check.AdminMissingMediaCheckHandler';

registerEndpointRoute(
    MISSING_MEDIA_CHECK_ROUTE,
    getBackendRoutePathByHandler(MISSING_MEDIA_CHECK_HANDLER),
);

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150;

/**
 * Adds the missing-media-files section to an existing administration screen.
 *
 * @param {HTMLElement} parentElement - Container the section is appended to.
 * @returns {Promise<HTMLElement|null>} The section element, or null without a container.
 */
export async function generate_missing_media_check_panel(parentElement) {
    if (!parentElement) return null;

    const section = document.createElement('section');
    section.className = 'missing-media-check';
    section.dataset.testid = 'missing-media-check';
    parentElement.appendChild(section);

    const title = document.createElement('h3');
    title.dataset.langKey = 'missing_media_check';
    title.textContent = 'Missing media files';
    section.appendChild(title);

    const description = document.createElement('p');
    description.className = 'missing-media-check__description';
    description.dataset.langKey = 'missing_media_check_description';
    description.textContent =
        'Checks whether the pictures and attachments that rows use are still on disk. '
        + 'It repairs nothing and deletes nothing; it only reports what is missing.';
    section.appendChild(description);

    const settingsForm = buildSettingsForm(section);
    const actions = document.createElement('div');
    actions.className = 'missing-media-check__actions';
    section.appendChild(actions);

    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'button';
    runButton.dataset.langKey = 'missing_media_check_run_now';
    runButton.dataset.testid = 'missing-media-check-run';
    runButton.textContent = 'Check now';
    actions.appendChild(runButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'button';
    saveButton.dataset.langKey = 'missing_media_check_save_settings';
    saveButton.dataset.testid = 'missing-media-check-save';
    saveButton.textContent = 'Save settings';
    actions.appendChild(saveButton);

    const statusArea = document.createElement('div');
    statusArea.className = 'missing-media-check__status';
    statusArea.dataset.testid = 'missing-media-check-status';
    statusArea.setAttribute('role', 'status');
    statusArea.setAttribute('aria-live', 'polite');
    statusArea.setAttribute('aria-busy', 'false');
    section.appendChild(statusArea);

    const resultArea = document.createElement('div');
    resultArea.className = 'missing-media-check__result';
    resultArea.dataset.testid = 'missing-media-check-result';
    section.appendChild(resultArea);

    let pollTimer = null;

    // The status line reports only what is happening now. Once a run has ended,
    // it is cleared so a finished report is never read under "still running".
    async function refreshState() {
        const state = await endpoint_router(MISSING_MEDIA_CHECK_ROUTE);
        applySettings(settingsForm, state.settings || {});
        renderResult(resultArea, state);
        statusArea.setAttribute('aria-busy', state.running ? 'true' : 'false');
        if (state.running) {
            setStatus(statusArea, 'missing_media_check_running', 'The check is running…');
        } else {
            statusArea.replaceChildren();
        }
        return state;
    }

    function stopPolling() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function startPolling() {
        stopPolling();
        let attempts = 0;
        pollTimer = setInterval(async () => {
            attempts += 1;
            try {
                const state = await refreshState();
                if (!state.running || attempts >= MAX_POLL_ATTEMPTS) {
                    stopPolling();
                    runButton.disabled = false;
                }
            } catch (error) {
                stopPolling();
                runButton.disabled = false;
                renderError(statusArea, error);
            }
        }, POLL_INTERVAL_MS);
    }

    runButton.addEventListener('click', async () => {
        runButton.disabled = true;
        statusArea.setAttribute('aria-busy', 'true');
        try {
            const response = await endpoint_router(MISSING_MEDIA_CHECK_ROUTE, {
                method: 'POST',
                body_data: { action: 'run' },
            });
            if (!response.started && response.reason === 'disabled') {
                statusArea.setAttribute('aria-busy', 'false');
                runButton.disabled = false;
                setStatus(statusArea, 'missing_media_check_disabled', 'The check is switched off in the settings.');
                return;
            }
            setStatus(statusArea, 'missing_media_check_running', 'The check is running…');
            startPolling();
        } catch (error) {
            statusArea.setAttribute('aria-busy', 'false');
            runButton.disabled = false;
            renderError(statusArea, error);
        }
    });

    saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        try {
            const state = await endpoint_router(MISSING_MEDIA_CHECK_ROUTE, {
                method: 'POST',
                body_data: { action: 'save_settings', settings: readSettings(settingsForm) },
            });
            applySettings(settingsForm, state.settings || {});
            renderResult(resultArea, state);
            setStatus(statusArea, 'missing_media_check_settings_saved', 'Settings saved.');
        } catch (error) {
            renderError(statusArea, error);
        } finally {
            saveButton.disabled = false;
        }
    });

    try {
        const state = await refreshState();
        if (state.running) {
            runButton.disabled = true;
            startPolling();
        }
    } catch (error) {
        renderError(statusArea, error);
    }

    return section;
}

function buildSettingsForm(section) {
    const form = document.createElement('div');
    form.className = 'missing-media-check__settings';
    section.appendChild(form);

    const enabled = appendCheckboxField(
        form,
        'missing-media-check-enabled',
        'missing_media_check_enabled_setting',
        'Check switched on',
    );
    const maxRows = appendNumberField(
        form,
        'missing-media-check-max-rows',
        'missing_media_check_max_rows_setting',
        'Row limit for one run',
        1,
    );
    const maxSeconds = appendNumberField(
        form,
        'missing-media-check-max-seconds',
        'missing_media_check_max_seconds_setting',
        'Time limit in seconds',
        1,
    );
    const unusedFiles = appendCheckboxField(
        form,
        'missing-media-check-unused-files',
        'missing_media_check_unused_files_setting',
        'Also report files that no row uses',
    );

    return { enabled, maxRows, maxSeconds, unusedFiles, storedSettings: {} };
}

function appendCheckboxField(form, testId, langKey, fallbackText) {
    const label = document.createElement('label');
    label.className = 'missing-media-check__field missing-media-check__field--checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.testid = testId;
    const text = document.createElement('span');
    text.dataset.langKey = langKey;
    text.textContent = fallbackText;
    label.appendChild(input);
    label.appendChild(text);
    form.appendChild(label);
    return input;
}

function appendNumberField(form, testId, langKey, fallbackText, minimum) {
    const label = document.createElement('label');
    label.className = 'missing-media-check__field';
    const text = document.createElement('span');
    text.dataset.langKey = langKey;
    text.textContent = fallbackText;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(minimum);
    input.dataset.testid = testId;
    label.appendChild(text);
    label.appendChild(input);
    form.appendChild(label);
    return input;
}

function applySettings(settingsForm, settings) {
    settingsForm.storedSettings = settings;
    settingsForm.enabled.checked = settings.enabled !== false;
    settingsForm.maxRows.value = String(settings.max_total_rows_checked ?? '');
    settingsForm.maxSeconds.value = String(settings.max_run_seconds ?? '');
    settingsForm.unusedFiles.checked = settings.report_unused_files === true;
}

// readSettings keeps every stored value the screen does not show, so saving the
// two visible limits cannot silently reset a setting an administrator edited
// somewhere else.
function readSettings(settingsForm) {
    return {
        ...settingsForm.storedSettings,
        enabled: settingsForm.enabled.checked,
        max_total_rows_checked: Number(settingsForm.maxRows.value) || 0,
        max_run_seconds: Number(settingsForm.maxSeconds.value) || 0,
        report_unused_files: settingsForm.unusedFiles.checked,
    };
}

function setStatus(statusArea, langKey, fallbackText) {
    statusArea.replaceChildren();
    const line = document.createElement('p');
    line.dataset.langKey = langKey;
    line.textContent = fallbackText;
    statusArea.appendChild(line);
}

function renderError(statusArea, error) {
    statusArea.replaceChildren();
    const line = document.createElement('p');
    line.className = 'missing-media-check__error';
    line.textContent = `Error: ${error && error.message ? error.message : error}`;
    statusArea.appendChild(line);
}

function renderResult(resultArea, state) {
    resultArea.replaceChildren();
    const result = state && state.last_result;
    if (!state || !state.has_result || !result) {
        const never = document.createElement('p');
        never.className = 'missing-media-check__muted';
        never.dataset.langKey = 'missing_media_check_never_run';
        never.textContent = 'The check has not run yet.';
        resultArea.appendChild(never);
        return;
    }

    resultArea.appendChild(buildSummaryLine(
        'missing_media_check_last_run',
        'Last check',
        `${result.finished_at || ''} (${result.trigger || ''})`,
    ));
    resultArea.appendChild(buildSummaryLine(
        'missing_media_check_datasets_checked',
        'Datasets checked',
        `${result.datasets_checked ?? 0} / ${result.datasets_total ?? 0}`,
    ));
    resultArea.appendChild(buildSummaryLine(
        'missing_media_check_rows_checked',
        'Rows checked',
        `${result.rows_checked ?? 0} / ${result.rows_total ?? 0}`,
    ));
    resultArea.appendChild(buildSummaryLine(
        'missing_media_check_missing_files',
        'Missing files',
        String(result.missing_count ?? 0),
    ));
    if (result.unused_files_requested) {
        resultArea.appendChild(buildSummaryLine(
            'missing_media_check_unused_files',
            'Unused files',
            String(result.unused_files_count ?? 0),
        ));
    }

    appendNotice(resultArea, result.datasets_exceed_budget,
        'missing_media_check_datasets_exceed_budget',
        'There are more datasets than the work limit allows rows, so some datasets were not checked at all. Raise the limit.');
    appendNotice(resultArea, result.time_budget_reached,
        'missing_media_check_time_budget_reached',
        'The time limit was reached, so the check stopped early.');
    appendNotice(resultArea, result.row_budget_reached && !result.datasets_exceed_budget,
        'missing_media_check_row_budget_reached',
        'The work limit was reached: a sample was checked instead of every row.');

    const missingRows = Array.isArray(result.missing_rows) ? result.missing_rows : [];
    if (missingRows.length === 0) {
        const allPresent = document.createElement('p');
        allPresent.className = 'missing-media-check__ok';
        allPresent.dataset.langKey = 'missing_media_check_all_present';
        allPresent.textContent = 'Every checked file was found on disk.';
        resultArea.appendChild(allPresent);
        return;
    }

    const list = document.createElement('ul');
    list.className = 'missing-media-check__missing-list';
    list.dataset.testid = 'missing-media-check-missing-list';
    for (const row of missingRows) {
        const item = document.createElement('li');
        const identity = document.createElement('span');
        identity.className = 'missing-media-check__missing-identity';
        identity.textContent = `${row.dataset} #${row.parent_row_id}`;
        const path = document.createElement('code');
        path.textContent = row.expected_path || row.stored_value || '';
        item.appendChild(identity);
        item.appendChild(path);
        if (row.reason === 'unresolved_reference') {
            item.appendChild(buildTag(
                'missing_media_check_unresolved_reference',
                'the reference cannot be placed on disk',
            ));
        } else if (row.legacy_flat_filename) {
            item.appendChild(buildTag('missing_media_check_legacy_filename', 'retired filename form'));
        }
        list.appendChild(item);
    }
    resultArea.appendChild(list);
}

function buildSummaryLine(langKey, fallbackText, value) {
    const line = document.createElement('p');
    line.className = 'missing-media-check__summary-line';
    const label = document.createElement('span');
    label.dataset.langKey = langKey;
    label.textContent = fallbackText;
    const valueElement = document.createElement('strong');
    valueElement.textContent = value;
    line.appendChild(label);
    line.appendChild(valueElement);
    return line;
}

function appendNotice(resultArea, condition, langKey, fallbackText) {
    if (!condition) return;
    const notice = document.createElement('p');
    notice.className = 'missing-media-check__notice';
    notice.dataset.langKey = langKey;
    notice.textContent = fallbackText;
    resultArea.appendChild(notice);
}

function buildTag(langKey, fallbackText) {
    const tag = document.createElement('span');
    tag.className = 'missing-media-check__tag';
    tag.dataset.langKey = langKey;
    tag.textContent = fallbackText;
    return tag;
}
