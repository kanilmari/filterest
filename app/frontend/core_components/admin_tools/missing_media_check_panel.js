// missing_media_check_panel.js
// Renders the administration section that reports media files a row uses but storage no longer has.
// Bridges the missing-media check endpoint, its settings and the existing media maintenance screen.
// Exists because a lost picture is otherwise silent: the row stays, the page simply shows
// nothing, and nobody learns that the file left the disk.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getBackendRoutePathByHandler } from '../endpoints/backend_route_manifest_reader.js';
import { registerEndpointRoute } from '../pipeline/api_pipeline.js';
import { renderMissingMediaCheckResult } from './missing_media_check_result_printer.js';
import { missingMediaCheckTextElement } from './missing_media_check_translation_fallbacks.js';

const MISSING_MEDIA_CHECK_ROUTE = 'adminMissingMediaCheck';
const MISSING_MEDIA_CHECK_HANDLER = 'missing_media_check.AdminMissingMediaCheckHandler';

registerEndpointRoute(
    MISSING_MEDIA_CHECK_ROUTE,
    getBackendRoutePathByHandler(MISSING_MEDIA_CHECK_HANDLER),
);

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150;

// Used only until the server answers with its own list.
const DEFAULT_SAMPLING_METHODS = Object.freeze(['even', 'random']);

/**
 * Every setting of the check, in the order the section shows them. Number ranges
 * come from the server's `limits`, the table the server also clamps with.
 */
const SETTING_FIELDS = Object.freeze([
    { name: 'enabled', kind: 'checkbox', langKey: 'missing_media_check_enabled_setting', testId: 'missing-media-check-enabled' },
    { name: 'max_total_rows_checked', kind: 'number', langKey: 'missing_media_check_max_rows_setting', testId: 'missing-media-check-max-rows' },
    { name: 'min_rows_per_dataset', kind: 'number', langKey: 'missing_media_check_min_rows_setting', testId: 'missing-media-check-min-rows' },
    { name: 'sampling', kind: 'choice', langKey: 'missing_media_check_sampling_setting', testId: 'missing-media-check-sampling' },
    { name: 'max_run_seconds', kind: 'number', langKey: 'missing_media_check_max_seconds_setting', testId: 'missing-media-check-max-seconds' },
    { name: 'run_after_update', kind: 'checkbox', langKey: 'missing_media_check_run_after_update_setting', testId: 'missing-media-check-run-after-update' },
    { name: 'run_on_startup', kind: 'checkbox', langKey: 'missing_media_check_run_on_startup_setting', testId: 'missing-media-check-run-on-startup' },
    { name: 'startup_delay_seconds', kind: 'number', langKey: 'missing_media_check_startup_delay_setting', testId: 'missing-media-check-startup-delay' },
    { name: 'exact_count_max_rows', kind: 'number', langKey: 'missing_media_check_exact_count_setting', testId: 'missing-media-check-exact-count' },
    { name: 'report_unused_files', kind: 'checkbox', langKey: 'missing_media_check_unused_files_setting', testId: 'missing-media-check-unused-files' },
    { name: 'max_reported_missing', kind: 'number', langKey: 'missing_media_check_max_reported_missing_setting', testId: 'missing-media-check-max-reported-missing' },
    { name: 'max_reported_unused_files', kind: 'number', langKey: 'missing_media_check_max_reported_unused_setting', testId: 'missing-media-check-max-reported-unused' },
]);

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

    section.appendChild(missingMediaCheckTextElement('h3', 'missing_media_check'));
    const description = missingMediaCheckTextElement('p', 'missing_media_check_description');
    description.className = 'missing-media-check__description';
    section.appendChild(description);

    const problemArea = document.createElement('div');
    problemArea.className = 'missing-media-check__problem';
    problemArea.dataset.testid = 'missing-media-check-settings-problem';
    section.appendChild(problemArea);

    const settingsForm = buildSettingsForm(section);
    const actions = document.createElement('div');
    actions.className = 'missing-media-check__actions';
    section.appendChild(actions);

    const runButton = missingMediaCheckTextElement('button', 'missing_media_check_run_now');
    runButton.type = 'button';
    runButton.className = 'button';
    runButton.dataset.testid = 'missing-media-check-run';
    actions.appendChild(runButton);

    const saveButton = missingMediaCheckTextElement('button', 'missing_media_check_save_settings');
    saveButton.type = 'button';
    saveButton.className = 'button';
    saveButton.dataset.testid = 'missing-media-check-save';
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
    // The details stay open or closed across the re-renders of a running check.
    let detailsOpen = false;
    const resultOptions = { onDetailsToggle: (open) => { detailsOpen = open; } };

    // Polling a running check leaves the settings alone, so a value an administrator
    // is typing is not replaced by the stored one every two seconds.
    function showState(state, { withSettings = true } = {}) {
        if (withSettings) {
            applySettings(settingsForm, state);
            renderSettingsProblem(problemArea, state.settings_problem);
        }
        renderMissingMediaCheckResult(resultArea, state, { ...resultOptions, detailsOpen });
    }

    // The status line reports only what is happening now. Once a run has ended,
    // it is cleared so a finished report is never read under "still running".
    async function refreshState({ withSettings = true } = {}) {
        const state = await endpoint_router(MISSING_MEDIA_CHECK_ROUTE);
        showState(state, { withSettings });
        statusArea.setAttribute('aria-busy', state.running ? 'true' : 'false');
        if (state.running) {
            setStatus(statusArea, 'missing_media_check_running');
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
                const state = await refreshState({ withSettings: false });
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
            if (!response.started && (response.reason === 'disabled' || response.reason === 'settings_problem')) {
                statusArea.setAttribute('aria-busy', 'false');
                runButton.disabled = false;
                renderSettingsProblem(problemArea, response.settings_problem);
                setStatus(statusArea, response.reason === 'disabled'
                    ? 'missing_media_check_disabled'
                    : 'missing_media_check_settings_problem');
                return;
            }
            setStatus(statusArea, 'missing_media_check_running');
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
            showState(state);
            setStatus(statusArea, 'missing_media_check_settings_saved');
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

    const fields = {};
    for (const field of SETTING_FIELDS) {
        fields[field.name] = appendSettingField(form, field);
    }
    return { fields, storedSettings: {} };
}

function appendSettingField(form, field) {
    const label = document.createElement('label');
    label.className = 'missing-media-check__field';
    const text = missingMediaCheckTextElement('span', field.langKey);
    let input;
    let range = null;
    if (field.kind === 'checkbox') {
        label.classList.add('missing-media-check__field--checkbox');
        input = document.createElement('input');
        input.type = 'checkbox';
        label.append(input, text);
    } else if (field.kind === 'choice') {
        input = document.createElement('select');
        label.append(text, input);
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        range = document.createElement('span');
        range.className = 'missing-media-check__range';
        range.dataset.testid = `${field.testId}-range`;
        label.append(text, input, range);
    }
    input.dataset.testid = field.testId;
    input.name = field.name;
    form.appendChild(label);
    return { field, input, range };
}

function applySamplingOptions(select, methods, selected) {
    const known = Array.isArray(methods) && methods.length > 0 ? methods : DEFAULT_SAMPLING_METHODS;
    const current = [...select.options].map((option) => option.value).join('|');
    if (current !== known.join('|')) {
        select.replaceChildren(...known.map((method) => {
            const option = missingMediaCheckTextElement('option', `missing_media_check_sampling_${method}`);
            option.value = method;
            return option;
        }));
    }
    select.value = known.includes(selected) ? selected : known[0];
}

function applySettings(settingsForm, state) {
    const settings = state.settings || {};
    const limits = state.limits || {};
    settingsForm.storedSettings = settings;
    for (const { field, input, range } of Object.values(settingsForm.fields)) {
        const value = settings[field.name];
        if (field.kind === 'checkbox') {
            // An absent "enabled" reads as on, as the server's own default does.
            input.checked = field.name === 'enabled' ? value !== false : value === true;
        } else if (field.kind === 'choice') {
            applySamplingOptions(input, state.sampling_methods, value);
        } else {
            input.value = String(value ?? '');
            const limit = limits[field.name];
            if (limit && Number.isFinite(limit.min) && Number.isFinite(limit.max)) {
                input.min = String(limit.min);
                input.max = String(limit.max);
                range.textContent = `${limit.min}–${limit.max}`;
            }
        }
    }
}

// readSettings keeps every stored value the screen does not show, such as the
// schema version, so saving can never silently reset one.
function readSettings(settingsForm) {
    const settings = { ...settingsForm.storedSettings };
    for (const { field, input } of Object.values(settingsForm.fields)) {
        if (field.kind === 'checkbox') {
            settings[field.name] = input.checked;
        } else if (field.kind === 'choice') {
            settings[field.name] = input.value;
        } else {
            settings[field.name] = Number(input.value) || 0;
        }
    }
    return settings;
}

function renderSettingsProblem(problemArea, problem) {
    problemArea.replaceChildren();
    if (!problem) return;
    const message = missingMediaCheckTextElement('p', 'missing_media_check_settings_problem');
    message.className = 'missing-media-check__notice';
    problemArea.appendChild(message);
    const detail = document.createElement('code');
    detail.className = 'missing-media-check__problem-detail';
    detail.textContent = String(problem);
    problemArea.appendChild(detail);
}

function setStatus(statusArea, langKey) {
    statusArea.replaceChildren(missingMediaCheckTextElement('p', langKey));
}

function renderError(statusArea, error) {
    statusArea.replaceChildren();
    const line = document.createElement('p');
    line.className = 'missing-media-check__error';
    line.textContent = `Error: ${error && error.message ? error.message : error}`;
    statusArea.appendChild(line);
}
