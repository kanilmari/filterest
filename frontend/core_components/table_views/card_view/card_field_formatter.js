// card_field_formatter.js
// Formats individual card fields and manages the in-place editing lifecycle.
// Bridges raw column role metadata and field values with rendered, editable card DOM elements.
// Exists to centralise role parsing, column-name formatting, and edit send/disable logic for card fields.

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { renderAllowedHtml, containsAllowedHtml } from '../../../reusable_components/dom_container_builder.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { readCachedUserPermissions, canEditServiceCatalogColumn } from '../../service_catalog/service_catalog_moderation.js';
import { formatTimestampDisplayParts } from '../timestamp_display_formatter.js';
import {
    formatTemporalValueForInput,
    getTemporalValueKind,
    serializeTemporalInputValue,
} from '../temporal_value_formatter.js';
import {
    resolveMultilingualValue,
    reconstructMultilingualValue,
    resolveInputType,
    buildColumnInfoMap,
    getTicketStatusOptions,
    getTicketStatusTone,
    isTicketStatusField,
    normalizeTicketStatusForClient,
    normalizeTicketStatusForDb,
} from './card_field_formatter_helpers.js';

/**
 * parseRoleString - tukee useita pilkulla erotettuja rooleja 
 * (esim. "image,header+lang-key" tai "header+lang_key").
 * Palauttaa:
 *   {
 *     baseRoles: [...],  // esim. ['image','header']
 *     hasLangKey: boolean
 *   }
 */
export function parseRoleString(roleStr) {
    if (!roleStr) return { baseRoles: [], hasLangKey: false };

    const rolesRaw = roleStr.split(',').map(r => r.trim());
    let hasLangKey = false;
    const baseRoles = [];

    rolesRaw.forEach(role => {
        if (role.includes('+')) {
            // rooli esim. "header+lang-key" tai "header+lang_key"
            const [mainRole, extra] = role.split('+').map(r => r.trim());
            baseRoles.push(mainRole);
            if (extra === 'lang-key' || extra === 'lang_key') {
                hasLangKey = true;
            }
        } else {
            baseRoles.push(role);
        }
    });

    return { baseRoles, hasLangKey };
}

/**
 * Pieni apufunktio, joka erottaa labelin ja arvon eri elementteihin.
 * - Avain näytetään vain, jos sitä ei ole tyhjennetty jo (ts. jos haluttiin näyttää se).
 * - Arvo tallennetaan valueDiv:iin, jossa on data-column-attribuutti.
 * - Jos hasLangKey on true, arvon sijaan asetetaan data-lang-key-attribuutti.
 */
export function createKeyValueElement(
    column_label,
    raw_value,
    column,
    hasLangKey,
    cssClass = "big_card_generic_field",
    display_value = raw_value,
    columnMeta = {}
) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("key_value_wrapper");

    /* ---------- LABEL ---------- */
    if (column_label) {
        const labelDiv = document.createElement("div");
        labelDiv.classList.add("kv_label");
        // Kieliavain attribuuttiin, ei varatekstiä
        labelDiv.dataset.langKey = column;
        wrapper.appendChild(labelDiv);
    }

    /* ---------- VALUE ---------- */
    const valueDiv = document.createElement("div");
    valueDiv.classList.add(cssClass);
    valueDiv.setAttribute("data-column", column);

    // Tallennetaan raaka arvo muokkausta varten
    valueDiv.setAttribute("data-raw-value", raw_value);
    const displayText = String(display_value ?? '');
    const timestampDisplay = formatTimestampDisplayParts(displayText, columnMeta);
    const resolvedDisplayText = timestampDisplay?.displayText ?? displayText;

    if (hasLangKey) {
        valueDiv.dataset.langKey = resolvedDisplayText || String(raw_value ?? '');
    } else {
        if (timestampDisplay?.titleText) {
            valueDiv.title = timestampDisplay.titleText;
        }
        if (containsAllowedHtml(resolvedDisplayText)) {
            valueDiv.appendChild(renderAllowedHtml(resolvedDisplayText));
        } else {
            valueDiv.textContent = resolvedDisplayText;
            valueDiv.style.whiteSpace = "pre-wrap";
        }
    }

    wrapper.appendChild(valueDiv);

    return wrapper;
}

function restoreReadOnlyFieldContent(fieldElem, displayValue, fallbackText = '') {
    const resolvedDisplayValue = (typeof displayValue === 'boolean')
        ? String(displayValue)
        : String(displayValue || fallbackText || '');

    fieldElem.textContent = '';

    if (containsAllowedHtml(resolvedDisplayValue)) {
        fieldElem.appendChild(renderAllowedHtml(resolvedDisplayValue));
    } else {
        fieldElem.textContent = resolvedDisplayValue;
        fieldElem.style.whiteSpace = 'pre-wrap';
    }
}

function normalizeComparableCardValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'boolean') {
        return String(value);
    }
    return String(value).trim();
}

/**
 * Palauttaa kentät takaisin tavalliseen tilaan
 * ja kerää uudet arvot olioon { columnNimi: 'uusiArvo' }.
 */
export function disableEditing(container) {
    const langSelector = container.querySelector('.multilang-selector');
    if (langSelector) langSelector.remove();
    const tableName = container.dataset.cardEditTable || '';

    const textFields = container.querySelectorAll('[data-column]');
    const updatedValues = {};

    textFields.forEach((fieldElem) => {
        // Jos on <details>, ohitetaan
        const detailsEl = fieldElem.querySelector('details');
        if (detailsEl) {
            return;
        }
        const columnName = fieldElem.getAttribute('data-column') || '';
        const originalText = fieldElem.getAttribute('data-original-text') || '';
        const inputEl = fieldElem.querySelector('input, textarea, select');

        if (!inputEl) {
            return;
        }

        const originalRawValue = fieldElem.getAttribute('data-raw-value');
        const temporalDataType = fieldElem.getAttribute('data-edit-data-type') || '';
        const temporalKind = getTemporalValueKind(temporalDataType);
        const originalEditorValue = fieldElem.getAttribute('data-original-input-value') || '';
        let newValue;
        if (inputEl.type === 'checkbox') {
            newValue = inputEl.checked;
        } else {
            newValue = inputEl.value.trim();
        }

        const inputValue = newValue;
        let temporalSerializationValid = true;
        if (temporalKind) {
            newValue = serializeTemporalInputValue(inputValue, temporalDataType);
            if (newValue === null) {
                temporalSerializationValid = false;
                newValue = originalRawValue ?? '';
            }
        }

        let displayValue = newValue;

        // If the field was a multilingual JSON, reconstruct the full object
        // with only the edited language updated.
        const multiLangJson = fieldElem.getAttribute('data-multilang-json');
        const editLang = fieldElem.getAttribute('data-multilang-edit-lang');
        if (multiLangJson && editLang && typeof newValue === 'string') {
            const reconstructed = reconstructMultilingualValue(multiLangJson, editLang, newValue);
            if (reconstructed !== null) {
                newValue = reconstructed;
                const resolvedMultilang = resolveMultilingualValue(
                    reconstructed,
                    true,
                    getLanguageWithBrowserFallback()
                );
                displayValue = resolvedMultilang?.displayText ?? newValue;
            }
            fieldElem.removeAttribute('data-multilang-json');
            fieldElem.removeAttribute('data-multilang-edit-lang');
        }

        const originalComparableValue = multiLangJson
            ? (originalRawValue ?? '')
            : originalText;
        const valueChanged = temporalKind
            ? temporalSerializationValid
                && normalizeComparableCardValue(inputValue) !== normalizeComparableCardValue(originalEditorValue)
            : normalizeComparableCardValue(newValue) !== normalizeComparableCardValue(originalComparableValue);

        if (valueChanged) {
            if (
                Object.prototype.hasOwnProperty.call(updatedValues, columnName)
                && typeof updatedValues[columnName] === 'string'
                && typeof newValue === 'string'
            ) {
                updatedValues[columnName] = `${updatedValues[columnName]}, ${newValue}`;
            } else {
                updatedValues[columnName] = newValue;
            }
        }

        // Palautetaan tekstinä
        const savedRawValue = temporalKind && !valueChanged
            ? (originalRawValue ?? newValue)
            : newValue;
        const temporalDisplay = temporalKind
            ? formatTimestampDisplayParts(savedRawValue, temporalDataType)
            : null;
        const resolvedDisplayValue = isTicketStatusField(tableName, columnName)
            ? normalizeTicketStatusForClient(newValue)
            : (temporalDisplay?.displayText ?? displayValue);

        restoreReadOnlyFieldContent(fieldElem, resolvedDisplayValue, originalText);
        if (temporalKind) {
            if (temporalDisplay?.titleText) {
                fieldElem.title = temporalDisplay.titleText;
            } else {
                fieldElem.removeAttribute('title');
            }
        }
        if (isTicketStatusField(tableName, columnName)) {
            fieldElem.dataset.statusTone = getTicketStatusTone(resolvedDisplayValue);
            fieldElem.title = resolvedDisplayValue;
        }
        fieldElem.setAttribute('data-raw-value', String(savedRawValue ?? ''));
        fieldElem.removeAttribute('data-original-text');
        fieldElem.removeAttribute('data-original-input-value');
        fieldElem.removeAttribute('data-edit-data-type');
    });

    return updatedValues;
}

/**
 * Peru editointi ilman tallennusta ja palauta kenttien alkuperäinen lukunäkymä.
 */
export function cancelEditing(container) {
    const langSelector = container.querySelector('.multilang-selector');
    if (langSelector) langSelector.remove();

    const textFields = container.querySelectorAll('[data-column]');

    textFields.forEach((fieldElem) => {
        const detailsEl = fieldElem.querySelector('details');
        if (detailsEl) {
            return;
        }

        const inputEl = fieldElem.querySelector('input, textarea, select');
        if (!inputEl) {
            return;
        }

        const originalText = fieldElem.getAttribute('data-original-text') || '';
        restoreReadOnlyFieldContent(fieldElem, originalText);
        fieldElem.removeAttribute('data-original-text');
        fieldElem.removeAttribute('data-multilang-json');
        fieldElem.removeAttribute('data-multilang-edit-lang');
    });
}

/** 
 * Pieni apufunktio sarakenimen siistimiseen 
 */
export function format_column_name(column) {
    const replaced = column.replace(/_/g, ' ');
    return replaced.charAt(0).toUpperCase() + replaced.slice(1);
}

/**
 * Lähettää kerralla kortin päivittyneet sarake-arvot palvelimelle.
 * Käyttää yksitellen 'id + column + value' -formaattia.
 */
export async function sendCardUpdates(table_name, rowId, updatedData) {
    if (IS_DEV_MODE) console.log(`[${table_name}] Lähetetään kortin uudet arvot, rowId=${rowId}`, updatedData);

    for (const [column, value] of Object.entries(updatedData)) {
        const normalizedValue = isTicketStatusField(table_name, column)
            ? normalizeTicketStatusForDb(value)
            : value;
        const payload = {
            id: rowId,
            column: column,
            value: normalizedValue
        };

        try {
            const result = await endpoint_router('updateRow', {
                method: 'POST',
                url_params: `?dataset=${table_name}`,
                body_data: payload,
            });
            if (IS_DEV_MODE) console.log(`[${table_name}] OK, sarake=${column} päivitetty, vastaus:`, result);

        } catch (err) {
            console.warn("virhe: " + err.message);
        }
    }
}

/**
 * Korvaa tekstisisällöt <input>- tai <textarea>-kentillä,
 * mutta vain, jos rakenteessa editable_in_ui on true kyseiselle sarakkeelle ja taululle.
 */
export function enableEditing(container, table_name) {
    if (IS_DEV_MODE) console.log('enabling editing... table= ' + table_name);
    container.dataset.cardEditTable = table_name;
    let parsedFullTreeData = null;
    const userPermissions = readCachedUserPermissions();

    // Haetaan schema-/column-tiedot localStoragesta
    try {
        const rawFullTreeData = localStorage.getItem('full_tree_data');
        if (rawFullTreeData) {
            parsedFullTreeData = JSON.parse(rawFullTreeData);
        }
    } catch (e) {
        console.warn(`enableEditing: ei voitu jäsentää full_tree_data taululle ${table_name}:`, e);
    }

    // Muodostetaan nopeat hakurakenteet: { column_name -> { editable_in_ui, data_type } }
    const columnInfoMap = parsedFullTreeData
        ? buildColumnInfoMap(parsedFullTreeData.column_details, table_name)
        : {};

    // Käydään läpi kaikki elementit, joissa data-column-attribuutti
    const textFields = container.querySelectorAll('[data-column]');
    textFields.forEach((fieldElem) => {
        const columnName = fieldElem.getAttribute('data-column');
        if (!columnInfoMap[columnName]) {
            if (IS_DEV_MODE) console.log(`[${table_name}] sarakkeelle ${columnName} ei löydy columnInfoMap:ia => ei muokata.`);
            return;
        }

        const isEditable = columnInfoMap[columnName].editable_in_ui;
        const dataType = columnInfoMap[columnName].data_type;

        // Jos sisällä on <details>, ohitetaan
        if (fieldElem.querySelector('details')) {
            if (IS_DEV_MODE) console.log(`[${table_name}] sarake: ${columnName}, sis. <details>, jätetään ennalleen.`);
            return;
        }

        // Jos editable_in_ui ei ole true, jätetään kenttä lukutilaan
        if (!isEditable) {
            if (IS_DEV_MODE) console.log(`[${table_name}] sarake: ${columnName}, editable_in_ui=false => ei muokata.`);
            return;
        }

        if (!canEditServiceCatalogColumn(table_name, columnName, userPermissions)) {
            if (IS_DEV_MODE) console.log(`[${table_name}] sarake: ${columnName}, service moderation column stays read-only for this actor.`);
            return;
        }

        // data-raw-value — may be a multilingual JSON string like {"en":"...","fi":"..."}
        const rawValueAttr = fieldElem.getAttribute('data-raw-value');
        let originalText = (rawValueAttr !== null)
            ? rawValueAttr
            : fieldElem.textContent.trim();

        // Detect multilingual column: prefer metadata flag, fall back to heuristic
        const isMultilingualMeta = columnInfoMap[columnName]?.is_multilingual;
        const multiLangResult = resolveMultilingualValue(
            originalText, isMultilingualMeta, getLanguageWithBrowserFallback()
        );
        if (multiLangResult) {
            originalText = multiLangResult.displayText;
            // Store the full JSON so disableEditing can reconstruct it
            fieldElem.setAttribute('data-multilang-json', JSON.stringify(multiLangResult.multiLangObj));
            fieldElem.setAttribute('data-multilang-edit-lang', multiLangResult.editLang);
        }

        const temporalKind = getTemporalValueKind(dataType);
        const originalDisplayText = fieldElem.textContent.trim();
        const normalizedOriginalText = isTicketStatusField(table_name, columnName)
            ? normalizeTicketStatusForClient(originalText)
            : (temporalKind ? originalDisplayText : originalText);

        fieldElem.setAttribute('data-original-text', normalizedOriginalText);
        if (temporalKind) {
            fieldElem.setAttribute('data-edit-data-type', dataType);
        }
        fieldElem.textContent = ''; // tyhjennetään

        if (isTicketStatusField(table_name, columnName)) {
            const statusSelect = document.createElement('select');
            statusSelect.classList.add('ticket_status_select');
            const statusOptions = getTicketStatusOptions(originalText);
            const currentValue = normalizeTicketStatusForClient(originalText);

            statusOptions.forEach(({ value, label }) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                statusSelect.appendChild(option);
            });

            statusSelect.value = currentValue || statusOptions[0]?.value || '';
            fieldElem.appendChild(statusSelect);
            return;
        }

        // Päätellään syötekomponentti dataType:n perusteella
        const { type: inputType } = resolveInputType(dataType, originalText.length);
        if (IS_DEV_MODE) console.log(`[${table_name}] sarake: ${columnName}, data_type=${dataType} => <input type="${inputType}">.`);

        if (inputType === 'checkbox') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = (originalText.toLowerCase() === 'true' || originalText === '1');
            fieldElem.appendChild(checkbox);

        } else if (inputType === 'date') {
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.value = formatTemporalValueForInput(originalText, dataType);
            fieldElem.setAttribute('data-original-input-value', dateInput.value);
            fieldElem.appendChild(dateInput);

        } else if (inputType === 'datetime-local') {
            const dtInput = document.createElement('input');
            dtInput.type = 'datetime-local';
            dtInput.value = formatTemporalValueForInput(originalText, dataType);
            fieldElem.setAttribute('data-original-input-value', dtInput.value);
            fieldElem.appendChild(dtInput);

        } else if (inputType === 'number') {
            const numberInput = document.createElement('input');
            numberInput.type = 'number';
            numberInput.value = originalText || '';
            fieldElem.appendChild(numberInput);

        } else if (inputType === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.value = originalText;
            textarea.style.width = '100%';
            textarea.rows = 4;
            fieldElem.appendChild(textarea);

        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = originalText;
            input.style.width = '100%';
            fieldElem.appendChild(input);
        }
    });

    const multiLangFields = Array.from(container.querySelectorAll('[data-multilang-json]'));
    const availableLanguages = new Set();

    multiLangFields.forEach((fieldElem) => {
        const multiLangJson = fieldElem.getAttribute('data-multilang-json');
        if (!multiLangJson) return;

        try {
            const langObj = JSON.parse(multiLangJson);
            if (langObj && typeof langObj === 'object' && !Array.isArray(langObj)) {
                Object.keys(langObj).forEach((langKey) => availableLanguages.add(langKey));
            }
        } catch (_e) { /* ignore invalid JSON */ }
    });

    if (availableLanguages.size === 0) {
        return;
    }

    const sortedLanguages = Array.from(availableLanguages).sort();
    const browserLang = getLanguageWithBrowserFallback();
    const activeLanguage = availableLanguages.has(browserLang)
        ? browserLang
        : sortedLanguages[0];

    const selectorDiv = document.createElement('div');
    selectorDiv.className = 'multilang-selector';

    const selectorHeading = document.createElement('div');
    selectorHeading.className = 'multilang-selector__heading';
    selectorHeading.textContent = '🌐';
    selectorDiv.appendChild(selectorHeading);

    sortedLanguages.forEach((langCode) => {
        const label = document.createElement('label');
        label.className = 'multilang-selector__option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = langCode;
        checkbox.setAttribute('data-multilang-selector', '');
        checkbox.checked = (langCode === activeLanguage);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${langCode}`));
        selectorDiv.appendChild(label);
    });

    multiLangFields.forEach((fieldElem) => {
        const inputEl = fieldElem.querySelector('input, textarea');
        const multiLangJson = fieldElem.getAttribute('data-multilang-json');
        if (!inputEl || !multiLangJson) return;

        try {
            const langObj = JSON.parse(multiLangJson);
            if (!langObj || typeof langObj !== 'object' || Array.isArray(langObj)) return;

            inputEl.value = langObj[activeLanguage] || '';
            fieldElem.setAttribute('data-multilang-edit-lang', activeLanguage);
        } catch (_e) { /* ignore invalid JSON */ }
    });

    selectorDiv.addEventListener('change', (e) => {
        const target = e.target;
        if (!target || target.type !== 'checkbox') return;

        if (!target.checked) {
            if (!selectorDiv.querySelector('input[type="checkbox"]:checked')) {
                target.checked = true;
            }
            return;
        }

        const newLang = target.value;

        selectorDiv.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
            if (checkbox !== target) {
                checkbox.checked = false;
            }
        });

        if (!selectorDiv.querySelector('input[type="checkbox"]:checked')) {
            target.checked = true;
        }

        container.querySelectorAll('[data-multilang-json]').forEach((fieldElem) => {
            const multiLangJson = fieldElem.getAttribute('data-multilang-json');
            const prevLang = fieldElem.getAttribute('data-multilang-edit-lang');
            const inputEl = fieldElem.querySelector('input, textarea');
            if (!multiLangJson || !inputEl) return;

            try {
                const langObj = JSON.parse(multiLangJson);
                if (!langObj || typeof langObj !== 'object' || Array.isArray(langObj)) return;

                if (prevLang) {
                    langObj[prevLang] = inputEl.value;
                }
                fieldElem.setAttribute('data-multilang-json', JSON.stringify(langObj));
                inputEl.value = langObj[newLang] || '';
                fieldElem.setAttribute('data-multilang-edit-lang', newLang);
            } catch (_e) { /* ignore invalid JSON */ }
        });
    });

    container.prepend(selectorDiv);
}

export function createTicketStatusBadge(status) {
    const normalizedStatus = normalizeTicketStatusForClient(status);
    const badge = document.createElement('span');
    badge.classList.add('ticket_status_badge');
    badge.dataset.statusTone = getTicketStatusTone(normalizedStatus);
    badge.textContent = normalizedStatus;
    badge.title = normalizedStatus;
    return badge;
}
