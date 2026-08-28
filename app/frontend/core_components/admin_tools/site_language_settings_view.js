// site_language_settings_view.js
// Renders the administrator's site-language availability and fallback settings.
// Bridges the canonical UI-language API with the Admin → Site settings navigation view.
// Exists so public language choices are reviewed deliberately instead of inferred in the browser.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';

function translatedText(langKey, fallback) {
    return getTranslationForKey(langKey, { fallback }) || fallback;
}

function createHeaderCell(langKey, fallback) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.dataset.langKey = langKey;
    cell.textContent = translatedText(langKey, fallback);
    return cell;
}

function createStatusCell(value, className) {
    const cell = document.createElement('td');
    const badge = document.createElement('span');
    badge.classList.add('site-language-settings-badge', className);
    badge.textContent = String(value || '').replaceAll('_', ' ');
    cell.appendChild(badge);
    return cell;
}

function renderLanguageRows(tableBody, languages) {
    tableBody.replaceChildren();
    languages.forEach((language) => {
        const row = document.createElement('tr');
        row.dataset.languageCode = language.language_code;

        const identityCell = document.createElement('th');
        identityCell.scope = 'row';
        const nativeName = document.createElement('strong');
        nativeName.textContent = language.native_name;
        const technicalIdentity = document.createElement('span');
        technicalIdentity.classList.add('site-language-settings-code');
        technicalIdentity.textContent = `${language.language_code} · ${language.english_name}`;
        identityCell.append(nativeName, technicalIdentity);

        const enabledCell = document.createElement('td');
        const enabledInput = document.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.checked = Boolean(language.is_enabled);
        enabledInput.dataset.setting = 'is_enabled';
        enabledInput.setAttribute('aria-label', `${language.language_code}: enabled`);
        enabledCell.appendChild(enabledInput);

        const defaultCell = document.createElement('td');
        const defaultInput = document.createElement('input');
        defaultInput.type = 'radio';
        defaultInput.name = 'site-default-language';
        defaultInput.checked = Boolean(language.is_default);
        defaultInput.dataset.setting = 'is_default';
        defaultInput.setAttribute('aria-label', `${language.language_code}: default language`);
        defaultCell.appendChild(defaultInput);

        const fallbackCell = document.createElement('td');
        const fallbackSelect = document.createElement('select');
        fallbackSelect.dataset.setting = 'fallback_language_code';
        fallbackSelect.setAttribute('aria-label', `${language.language_code}: fallback language`);
        const rootOption = document.createElement('option');
        rootOption.value = '';
        rootOption.textContent = translatedText('no_fallback_root', 'No fallback (root)');
        fallbackSelect.appendChild(rootOption);
        languages.forEach((candidate) => {
            if (candidate.language_code === language.language_code) return;
            const option = document.createElement('option');
            option.value = candidate.language_code;
            option.textContent = `${candidate.native_name} (${candidate.language_code})`;
            fallbackSelect.appendChild(option);
        });
        fallbackSelect.value = language.fallback_language_code || '';
        fallbackSelect.disabled = Boolean(language.is_default);
        fallbackCell.appendChild(fallbackSelect);

        const publicCell = document.createElement('td');
        const publicInput = document.createElement('input');
        publicInput.type = 'checkbox';
        publicInput.checked = Boolean(language.public_selector_ready);
        publicInput.dataset.setting = 'public_selector_ready';
        publicInput.disabled = language.coverage_status !== 'complete'
            || language.review_status !== 'approved';
        publicInput.setAttribute('aria-label', `${language.language_code}: public selector`);
        publicCell.appendChild(publicInput);

        row.append(
            identityCell,
            enabledCell,
            defaultCell,
            fallbackCell,
            createStatusCell(language.coverage_status, 'coverage'),
            createStatusCell(language.review_status, 'review'),
            publicCell,
        );
        tableBody.appendChild(row);
    });
}

function readLanguageSettingsFromTable(tableBody, immutableLanguages) {
    const immutableByCode = new Map(
        immutableLanguages.map((language) => [language.language_code, language])
    );
    return Array.from(tableBody.querySelectorAll('tr[data-language-code]')).map((row) => {
        const language = immutableByCode.get(row.dataset.languageCode);
        const fallbackValue = row.querySelector('[data-setting="fallback_language_code"]')?.value || '';
        return {
            ...language,
            is_enabled: Boolean(row.querySelector('[data-setting="is_enabled"]')?.checked),
            is_default: Boolean(row.querySelector('[data-setting="is_default"]')?.checked),
            fallback_language_code: fallbackValue || null,
            public_selector_ready: Boolean(row.querySelector('[data-setting="public_selector_ready"]')?.checked),
        };
    });
}

function attachDefaultLanguageBehavior(tableBody) {
    tableBody.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        const changedRow = target.closest('tr[data-language-code]');
        if (!changedRow) return;

        if (target.dataset.setting === 'is_enabled' && !target.checked) {
            const publicInput = changedRow.querySelector('[data-setting="public_selector_ready"]');
            if (publicInput instanceof HTMLInputElement) publicInput.checked = false;
            return;
        }
        if (target.dataset.setting === 'public_selector_ready' && target.checked) {
            const enabledInput = changedRow.querySelector('[data-setting="is_enabled"]');
            if (enabledInput instanceof HTMLInputElement) enabledInput.checked = true;
            return;
        }
        if (target.dataset.setting !== 'is_default') return;

        const defaultRow = changedRow;

        const defaultCode = defaultRow.dataset.languageCode;
        tableBody.querySelectorAll('tr[data-language-code]').forEach((row) => {
            const isDefault = row === defaultRow;
            const enabledInput = row.querySelector('[data-setting="is_enabled"]');
            const fallbackSelect = row.querySelector('[data-setting="fallback_language_code"]');
            if (isDefault && enabledInput instanceof HTMLInputElement) {
                enabledInput.checked = true;
            }
            if (fallbackSelect instanceof HTMLSelectElement) {
                fallbackSelect.disabled = isDefault;
                fallbackSelect.value = isDefault ? '' : (fallbackSelect.value || defaultCode);
            }
        });
    });
}

/**
 * Generates the canonical Admin → Site settings → Languages view.
 *
 * @param {HTMLElement} container - Management-view container supplied by navigation.
 */
export async function generate_site_language_settings_view(container) {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();
    container.classList.add('site-language-settings-view');

    const heading = document.createElement('h2');
    heading.dataset.langKey = 'site_languages';
    heading.textContent = translatedText('site_languages', 'Languages');
    const description = document.createElement('p');
    description.dataset.langKey = 'site_languages_description';
    description.textContent = translatedText(
        'site_languages_description',
        'Choose the site languages, one default, explicit fallbacks, and which reviewed languages may appear publicly.'
    );
    const status = document.createElement('p');
    status.classList.add('site-language-settings-status');
    status.setAttribute('role', 'status');
    container.append(heading, description, status);

    try {
        const response = await endpoint_router('adminUiLanguages');
        const languages = Array.isArray(response?.languages) ? response.languages : [];
        if (languages.length === 0) throw new Error('Language registry is empty.');

        const tableWrapper = document.createElement('div');
        tableWrapper.classList.add('site-language-settings-table-wrapper');
        const table = document.createElement('table');
        table.classList.add('site-language-settings-table');
        table.dataset.testid = 'site-language-settings-table';
        const tableHead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        [
            ['language', 'Language'],
            ['enabled', 'Enabled'],
            ['default_language', 'Default language'],
            ['fallback_language', 'Fallback language'],
            ['translation_coverage', 'Translation coverage'],
            ['review_status', 'Review status'],
            ['public_selector', 'Public selector'],
        ].forEach(([key, fallback]) => headerRow.appendChild(createHeaderCell(key, fallback)));
        tableHead.appendChild(headerRow);
        const tableBody = document.createElement('tbody');
        renderLanguageRows(tableBody, languages);
        attachDefaultLanguageBehavior(tableBody);
        table.append(tableHead, tableBody);
        tableWrapper.appendChild(table);

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.classList.add('fw-btn', 'fw-btn--primary');
        saveButton.dataset.testid = 'site-language-settings-save';
        saveButton.dataset.langKey = 'save';
        saveButton.textContent = translatedText('save', 'Save');
        saveButton.addEventListener('click', async () => {
            saveButton.disabled = true;
            status.textContent = translatedText('saving', 'Saving…');
            try {
                const saved = await endpoint_router('adminUiLanguages', {
                    method: 'POST',
                    body_data: {
                        languages: readLanguageSettingsFromTable(tableBody, languages),
                    },
                });
                const savedLanguages = Array.isArray(saved?.languages) ? saved.languages : languages;
                languages.splice(0, languages.length, ...savedLanguages);
                renderLanguageRows(tableBody, savedLanguages);
                status.textContent = translatedText('settings_saved', 'Settings saved.');
            } catch (error) {
                console.warn('site_language_settings_view: save failed', error);
                status.textContent = error?.message || translatedText('save_failed', 'Save failed.');
            } finally {
                saveButton.disabled = false;
            }
        });

        container.append(tableWrapper, saveButton);
    } catch (error) {
        console.warn('site_language_settings_view: load failed', error);
        status.textContent = error?.message || translatedText('load_failed', 'Loading failed.');
    }
}
