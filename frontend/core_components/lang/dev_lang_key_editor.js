// dev_lang_key_editor.js
// Dev-only overlay that edits one lang key directly from the rendered page.
// Bridges translation_handler state, lang endpoints, and temporary editor DOM controls.
// Exists to speed up translation maintenance without navigating away from the current view.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';

let _editorOverlay = null;

/**
 * Initialises the dev lang key editor. Call once after DOM is ready.
 * Attaches a single delegated Alt+right-click listener on document.body.
 */
export function initDevLangKeyEditor() {
    const isDev = document.querySelector('meta[name="app-env"]')?.content === 'dev';
    if (!isDev) return;

    document.body.addEventListener('contextmenu', _onAltRightClick);
}

// _onAltRightClick opens the editor for the nearest lang-key-bearing element.
function _onAltRightClick(e) {
    if (!e.altKey) return;

    // Walk up from target to find nearest element with data-lang-key
    const target = e.target.closest('[data-lang-key], [data-html-lang-key]');
    if (!target) return;

    const langKey = target.getAttribute('data-lang-key') || target.getAttribute('data-html-lang-key');
    if (!langKey) return;

    // Strip variable suffix (e.g. "manage_table+users" → "manage_table")
    const baseKey = langKey.split('+')[0];

    e.preventDefault();
    e.stopPropagation();

    _openEditor(baseKey);
}

// _openEditor fetches the current translations and renders the overlay for one base key.
async function _openEditor(langKey) {
    // Close any existing editor
    _closeEditor();

    // Fetch current translations + usage_explanation
    let translations = { fi: '', en: '', ch: '', yue: '', usage_explanation: '' };
    try {
        translations = await endpoint_router('getLangKeyTranslations', {
            url_params: `?lang_key=${encodeURIComponent(langKey)}`
        });
    } catch (err) {
        console.warn('[DevLangKeyEditor] Could not fetch translations for', langKey, err);
    }

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'dev-lang-editor-overlay';
    overlay.innerHTML = `
        <div class="dev-lang-editor-panel">
            <div class="dev-lang-editor-header">
                <span class="dev-lang-editor-key">${_escapeHtml(langKey)}</span>
                <button class="dev-lang-editor-close" title="Sulje">&times;</button>
            </div>
            <div class="dev-lang-editor-fields">
                <label>
                    <span>Usage / Context</span>
                    <textarea data-field="usage_explanation" rows="2" placeholder="Describe what this key means in context...">${_escapeHtml(translations.usage_explanation || '')}</textarea>
                </label>
                <div class="dev-lang-editor-ai-row">
                    <button class="dev-lang-editor-ai-btn" title="Generate translations with AI using the usage explanation above">AI Translate</button>
                </div>
                <label>
                    <span>FI</span>
                    <textarea data-lang="fi" rows="2">${_escapeHtml(translations.fi || '')}</textarea>
                </label>
                <label>
                    <span>EN</span>
                    <textarea data-lang="en" rows="2">${_escapeHtml(translations.en || '')}</textarea>
                </label>
                <label>
                    <span>CH</span>
                    <textarea data-lang="ch" rows="2">${_escapeHtml(translations.ch || '')}</textarea>
                </label>
                <label>
                    <span>YUE (廣東話)</span>
                    <textarea data-lang="yue" rows="2">${_escapeHtml(translations.yue || '')}</textarea>
                </label>
            </div>
            <div class="dev-lang-editor-actions">
                <button class="dev-lang-editor-save">Tallenna</button>
                <button class="dev-lang-editor-cancel">Peruuta</button>
            </div>
        </div>
    `;

    // Events
    overlay.querySelector('.dev-lang-editor-close').addEventListener('click', _closeEditor);
    overlay.querySelector('.dev-lang-editor-cancel').addEventListener('click', _closeEditor);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _closeEditor();
    });
    overlay.querySelector('.dev-lang-editor-save').addEventListener('click', () => _save(langKey, overlay));
    overlay.querySelector('.dev-lang-editor-ai-btn').addEventListener('click', () => _aiTranslate(langKey, overlay));

    // Keyboard: Escape to close, Ctrl+Enter to save
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') _closeEditor();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _save(langKey, overlay);
    });

    document.body.appendChild(overlay);
    _editorOverlay = overlay;

    // Focus usage explanation field
    overlay.querySelector('textarea[data-field="usage_explanation"]').focus();
}

// _aiTranslate fills the editor with AI suggestions for the current lang key.
async function _aiTranslate(langKey, overlay) {
    const aiBtn = overlay.querySelector('.dev-lang-editor-ai-btn');

    aiBtn.disabled = true;
    aiBtn.textContent = 'Translating...';

    try {
        const result = await endpoint_router('devAiTranslateSingle', {
            method: 'POST',
            body_data: buildDevLangEditorAITranslateRequest(langKey, overlay),
        });

        const filledCount = applyDevLangEditorAIResultToEmptyFields(overlay, result);
        if (filledCount === 0) {
            showToast({ message: 'AI-käännös ei muuttanut täytettyjä kenttiä', level: 'info', duration: 3000 });
            return;
        }

        showToast({ message: 'AI-käännökset haettu — tarkista ja tallenna', level: 'success', duration: 3000 });
    } catch (err) {
        console.error('[DevLangKeyEditor] AI translate failed:', err);
        showToast({ message: `AI-käännös epäonnistui: ${err.message || err}`, level: 'error', duration: 5000 });
    } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = 'AI Translate';
    }
}

// buildDevLangEditorAITranslateRequest reads current editor text for AI fill requests.
// Between editor DOM fields and the dev AI endpoint, it sends existing copy as source context.
export function buildDevLangEditorAITranslateRequest(langKey, overlay) {
    return {
        lang_key: langKey,
        usage_explanation: overlay.querySelector('textarea[data-field="usage_explanation"]')?.value || '',
        ...readDevLangEditorTranslationValues(overlay),
    };
}

// readDevLangEditorTranslationValues collects the current FI/EN/CH/YUE editor values.
// Between visible textareas and API payloads, it keeps polished translations available.
export function readDevLangEditorTranslationValues(overlay) {
    return {
        fi: overlay.querySelector('textarea[data-lang="fi"]')?.value || '',
        en: overlay.querySelector('textarea[data-lang="en"]')?.value || '',
        ch: overlay.querySelector('textarea[data-lang="ch"]')?.value || '',
        yue: overlay.querySelector('textarea[data-lang="yue"]')?.value || '',
    };
}

// applyDevLangEditorAIResultToEmptyFields fills only empty translation fields.
// Between AI suggestions and editor DOM state, it avoids overwriting good manual copy.
export function applyDevLangEditorAIResultToEmptyFields(overlay, result = {}) {
    let filledCount = 0;
    ['fi', 'en', 'ch', 'yue'].forEach((lang) => {
        const field = overlay.querySelector(`textarea[data-lang="${lang}"]`);
        if (!field || field.value.trim() !== '') return;
        const nextValue = String(result[lang] || '').trim();
        if (!nextValue) return;
        field.value = nextValue;
        filledCount += 1;
    });
    return filledCount;
}

// _save persists the edited values and refreshes translated nodes in place.
async function _save(langKey, overlay) {
    const fi = overlay.querySelector('textarea[data-lang="fi"]').value;
    const en = overlay.querySelector('textarea[data-lang="en"]').value;
    const ch = overlay.querySelector('textarea[data-lang="ch"]').value;
    const yue = overlay.querySelector('textarea[data-lang="yue"]').value;
    const usageExplanation = overlay.querySelector('textarea[data-field="usage_explanation"]').value;

    const saveBtn = overlay.querySelector('.dev-lang-editor-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Tallennetaan...';

    try {
        await endpoint_router('updateLangKey', {
            method: 'POST',
            body_data: { lang_key: langKey, fi, en, ch, yue, usage_explanation: usageExplanation },
        });

        showToast({ message: `Kieliavain "${langKey}" tallennettu`, level: 'success', duration: 3000 });

        // Update in-memory translations so the page reflects changes immediately
        _updateInMemoryTranslations(langKey, { fi, en, ch, yue });

        // Re-translate all elements with this key
        _retranslateKey(langKey);

        _closeEditor();
    } catch (err) {
        console.error('[DevLangKeyEditor] Save failed:', err);
        showToast({ message: `Tallennus epäonnistui: ${err.message || err}`, level: 'error', duration: 5000 });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Tallenna';
    }
}

/**
 * Updates the in-memory translation dictionaries exposed by translation_handler.
 * We access them through the window-level references set by initDevLangKeyEditor wiring.
 */
function _updateInMemoryTranslations(langKey, values) {
    if (window._devLangEditorCurrentTranslations) {
        const lang = document.documentElement.getAttribute('lang') || 'fi';
        if (values[lang] !== undefined) {
            window._devLangEditorCurrentTranslations[langKey] = values[lang];
        }
    }
    if (window._devLangEditorDefaultTranslations && values.en !== undefined) {
        window._devLangEditorDefaultTranslations[langKey] = values.en;
    }
}

// _retranslateKey retriggers translation updates for every DOM node that uses the saved key.
function _retranslateKey(langKey) {
    const selector = `[data-lang-key="${langKey}"], [data-lang-key^="${langKey}+"], [data-html-lang-key="${langKey}"], [data-html-lang-key^="${langKey}+"]`;
    document.querySelectorAll(selector).forEach(el => {
        // Dispatch a synthetic attribute change so the MutationObserver picks it up
        // and re-translates through the normal pipeline.
        const attr = el.hasAttribute('data-html-lang-key') ? 'data-html-lang-key' : 'data-lang-key';
        const val = el.getAttribute(attr);
        el.removeAttribute(attr);
        // Microtask to ensure MutationObserver sees the removal before re-add
        queueMicrotask(() => el.setAttribute(attr, val));
    });
}

// _closeEditor removes the overlay and clears the singleton reference.
function _closeEditor() {
    if (_editorOverlay) {
        _editorOverlay.remove();
        _editorOverlay = null;
    }
}

// _escapeHtml safely injects text values into the editor template.
function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
