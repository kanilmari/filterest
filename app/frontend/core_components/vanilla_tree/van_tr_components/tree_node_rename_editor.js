// tree_node_rename_editor.js
// Opens the modal dialog for renaming tree folders and datasets.
// Bridges rename form inputs and the rename-tree-node API with translation lookup helpers.
// Exists to keep tree-node rename workflow and validation in one reusable editor.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getTranslationForKey, getTranslationsForKey } from '../../lang/translation_handler.js';
import { getDatasetRouteUniquenessHint } from '../../navigation/nav_engine/dataset_aliases.js';
import { showWarningToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { treeNodeRenameFallback } from './tree_node_rename_copy.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';

const KEPT_TRANSLATIONS_NOTICE_KEY = 'rename_tree_node_kept_existing_translations';
const KEPT_TRANSLATIONS_NOTICE_MS = 12000;
const LANGUAGE_NAME_KEYS = { fi: 'finnish', en: 'english' };

/**
 * Avaa uudelleennimeämisdialogin ja palauttaa Promisen joka resolvataan
 * kun käyttäjä vahvistaa tai hylkää.
 *
 * @param {Object} options
 * @param {number} options.itemId     - DB id (system_table_folders.id tai system_db_tables.id)
 * @param {string} options.itemType   - "folder" tai "table"
 * @param {string} options.currentName - Nykyinen nimi (= nykyinen lang_key)
 * @returns {Promise<boolean>} true jos uudelleennimetty, false jos peruttu
 */
export async function openRenameDialog({ itemId, itemType, currentName }) {
    return new Promise((resolve) => {
        // Poistetaan mahdollinen vanha dialogi
        const existingOverlay = document.getElementById('rename-tree-node-overlay');
        if (existingOverlay) existingOverlay.remove();

        // Näytä dialogi heti — FI/EN-esitäytöt voidaan hydratoida rauhassa taustalla.
        const fallbackCurrentTranslation = getTranslationForKey(currentName, { countUsage: false }) || '';
        const dialogRefs = buildDialog(resolve, {
            itemId,
            itemType,
            currentName,
            prefillFi: fallbackCurrentTranslation,
            prefillEn: '',
        });

        (async () => {
            try {
                const translations = await getTranslationsForKey(currentName);
                hydratePrefill(dialogRefs.fiInput, translations.fi);
                hydratePrefill(dialogRefs.enInput, translations.en);
            } catch (err) {
                console.warn('rename dialog: could not fetch translations for', currentName, err);
            }
        })();
    });
}

/**
 * Rakentaa ja näyttää uudelleennimeämisdialogin.
 * Erotettu omaksi funktiokseen, jotta async-haku voidaan tehdä ensin.
 */
export function hydratePrefill(input, value) {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const hasUserEdited = input.dataset.userEdited === 'true';
        const currentValue = input.value.trim();
        const originalValue = (input.dataset.initialValue || '').trim();
        if (hasUserEdited || (currentValue && currentValue !== originalValue)) {
            return;
        }

        // Show the key's stored text, even when it is empty: the interface-language fallback the
        // dialog opened with must not be saved as this language's text. shownValue tells the
        // server what was displayed, so an untouched field is not written and a key changed
        // meanwhile is refused instead of overwritten.
        const shownValue = typeof value === 'string' ? value : '';
        input.value = shownValue;
        input.dataset.initialValue = shownValue;
        input.dataset.shownValue = shownValue;
}

/**
 * Tells the person when the new name already had translations and their typed text was not saved
 * for some languages (owner, 22.11.2026: a shared key is not changed from the rename dialog).
 * @returns {string} the notice shown, or '' when the answer reports nothing kept
 */
export function showKeptTranslationsNotice(response) {
        const kept = response?.label_kept;
        if (!kept || !Array.isArray(kept.languages) || kept.languages.length === 0) {
            return '';
        }
        const languages = kept.languages
            .map((code) => (LANGUAGE_NAME_KEYS[code] && getTranslationForKey(LANGUAGE_NAME_KEYS[code], { countUsage: false })) || code.toUpperCase())
            .join(', ');
        // Site-authored copy wins; until a site has it, the bootstrap copy in its own language.
        const template = getTranslationForKey(KEPT_TRANSLATIONS_NOTICE_KEY, { countUsage: false })
            || treeNodeRenameFallback(KEPT_TRANSLATIONS_NOTICE_KEY, getLanguageWithBrowserFallback());
        const notice = template.replace('$key', String(kept.lang_key || '')).replace('$languages', languages);
        showWarningToast(notice, KEPT_TRANSLATIONS_NOTICE_MS);
        return notice;
}

/**
 * Builds the rename request body. A language is sent only when the dialog showed its stored text
 * or the user typed in it: a field still holding the interface-language fallback, saved before
 * the stored texts arrived, is left out so it cannot overwrite a translation. shown_translations
 * lists the stored texts the dialog displayed.
 */
export function buildRenameRequestBody({ itemId, itemType, newName, fiInput, enInput }) {
        const translations = {};
        const shown = {};
        for (const [code, input] of [['fi', fiInput], ['en', enInput]]) {
            const wasShown = input.dataset.shownValue !== undefined;
            if (wasShown) {
                shown[code] = input.dataset.shownValue;
            }
            if (wasShown || input.dataset.userEdited === 'true') {
                translations[code] = input.value.trim();
            }
        }
        const body = { item_id: itemId, item_type: itemType, new_name: newName, translations };
        if (Object.keys(shown).length > 0) {
            body.shown_translations = shown;
        }
        return body;
}

function buildDialog(resolve, { itemId, itemType, currentName, prefillFi, prefillEn }) {

        // ── Overlay ──
        const overlay = document.createElement('div');
        overlay.id = 'rename-tree-node-overlay';
        overlay.dataset.testid = 'rename-tree-node-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.5)', zIndex: '10000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });

        // ── Dialogi ──
        const dialog = document.createElement('div');
        dialog.dataset.testid = 'rename-tree-node-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        Object.assign(dialog.style, {
            background: 'var(--bg_color_2, #fff)', color: 'var(--text_color, #000)',
            border: '1px solid var(--border_color, #ccc)', borderRadius: '8px',
            padding: '24px', minWidth: '380px', maxWidth: '500px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        });

        const typeLabel = itemType === 'folder'
            ? (getTranslationForKey('folder', { countUsage: false }) || 'Folder')
            : (getTranslationForKey('table', { countUsage: false }) || 'Table');

        const title = document.createElement('h3');
        title.style.marginTop = '0';
        title.textContent = `${getTranslationForKey('rename', { countUsage: false }) || 'Rename'}: ${typeLabel}`;
        dialog.appendChild(title);

        // ── Kenttien luontifunktio ──
        function createField(labelText, inputId, value, placeholder = '', testId = '') {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '12px';

            const label = document.createElement('label');
            label.textContent = labelText;
            label.htmlFor = inputId;
            Object.assign(label.style, {
                display: 'block', marginBottom: '4px',
                fontWeight: '600', fontSize: '0.9em',
            });

            const input = document.createElement('input');
            input.type = 'text';
            input.id = inputId;
            if (testId) {
                input.dataset.testid = testId;
            }
            input.value = value;
            input.dataset.initialValue = value;
            input.placeholder = placeholder;
            Object.assign(input.style, {
                width: '100%', padding: '8px', boxSizing: 'border-box',
                border: '1px solid var(--border_color, #ccc)', borderRadius: '4px',
                background: 'var(--bg_color, #fff)', color: 'var(--text_color, #000)',
                fontSize: '1em',
            });
            input.addEventListener('input', () => {
                input.dataset.userEdited = 'true';
            });

            wrapper.appendChild(label);
            wrapper.appendChild(input);
            return { wrapper, input };
        }

        // ── Kentät ──
        const langKeyLabel = getTranslationForKey('technical_name', { countUsage: false }) || 'Technical name (lang key)';
        const nameField = createField(langKeyLabel, 'rename-lang-key', currentName, 'e.g. my_table', 'rename-tree-node-name-input');
        dialog.appendChild(nameField.wrapper);

        if (itemType === 'table') {
            const routeHint = document.createElement('p');
            routeHint.className = 'rename-tree-node-route-hint';
            routeHint.dataset.testid = 'rename-tree-node-route-hint';
            routeHint.textContent = getDatasetRouteUniquenessHint();
            Object.assign(routeHint.style, {
                margin: '0 0 12px 0',
                fontSize: '0.9em',
                color: 'var(--text_color_2, var(--text_color, #000))',
            });
            dialog.appendChild(routeHint);
        }

        const fiLabel = getTranslationForKey('finnish', { countUsage: false }) || 'Suomeksi (FI)';
        const fiField = createField(fiLabel, 'rename-fi', prefillFi, 'esim. Oma taulu', 'rename-tree-node-fi-input');
        dialog.appendChild(fiField.wrapper);

        const enLabel = getTranslationForKey('english', { countUsage: false }) || 'English (EN)';
        const enField = createField(enLabel, 'rename-en', prefillEn, 'e.g. My table', 'rename-tree-node-en-input');
        dialog.appendChild(enField.wrapper);

        // ── Painikkeet ──
        const buttonRow = document.createElement('div');
        Object.assign(buttonRow.style, {
            display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px',
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.dataset.testid = 'rename-tree-node-cancel';
        cancelBtn.textContent = getTranslationForKey('cancel_changes', { countUsage: false }) || 'Cancel changes';
        Object.assign(cancelBtn.style, {
            padding: '8px 18px', border: '1px solid var(--border_color, #ccc)',
            borderRadius: '4px', background: 'var(--bg_color, #fff)',
            color: 'var(--text_color, #000)', cursor: 'pointer', fontSize: '0.95em',
        });

        const saveBtn = document.createElement('button');
        saveBtn.dataset.testid = 'rename-tree-node-save';
        saveBtn.textContent = getTranslationForKey('save', { countUsage: false }) || 'Save';
        Object.assign(saveBtn.style, {
            padding: '8px 18px', border: 'none', borderRadius: '4px',
            background: 'var(--primary_color, hsl(207deg 100% 50%))', color: '#fff',
            cursor: 'pointer', fontWeight: '600', fontSize: '0.95em',
        });

        // ── Tapahtumat ──
        cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });

        saveBtn.addEventListener('click', async () => {
            const newName = nameField.input.value.trim();

            if (!newName) {
                showWarningToast(getTranslationForKey('name_required', { countUsage: false }) || 'Name is required');
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '...';

            try {
                const response = await endpoint_router('renameTreeNode', {
                    method: 'POST',
                    body_data: buildRenameRequestBody({
                        itemId, itemType, newName, fiInput: fiField.input, enInput: enField.input,
                    }),
                });
                overlay.remove();
                showKeptTranslationsNotice(response);
                resolve(true);
            } catch (_err) {
                saveBtn.disabled = false;
                saveBtn.textContent = getTranslationForKey('save', { countUsage: false }) || 'Save';
            }
        });

        // Enter-näppäin tallentaa
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
            if (e.key === 'Escape') { overlay.remove(); resolve(false); }
        });

        buttonRow.appendChild(cancelBtn);
        buttonRow.appendChild(saveBtn);
        dialog.appendChild(buttonRow);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Fokusoi ensimmäiseen kenttään
        setTimeout(() => document.getElementById('rename-lang-key')?.focus(), 50);

        return {
            nameInput: nameField.input,
            fiInput: fiField.input,
            enInput: enField.input,
        };
}
