// front_page_settings_view.js
// Renders the administrator's common and personal Home configuration.
// Bridges Site settings, display-name search and versioned scope/background APIs.
// Preserves drafts and refuses stale scope writes instead of overwriting another editor.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { setAuthModes } from './auth_mode_handler.js';
import { openFrontPage } from '../front_page/front_page_navigation.js';
import { renderNavbarFrontPage } from '../front_page/navbar_front_page.js';
import { refreshFrontPage } from '../front_page/front_page_printer.js';
import { createLangKeyEditor, applyLangKeyConfig } from './lang_key_editor_builder.js';
import { createFrontPageBackgroundControl } from './front_page_background_control.js';
import {
    frontPageText, frontPageLabel, frontPageButton, frontPageField, frontPageSection, frontPageStatus,
} from './front_page_settings_controls.js';

const MAX_BLOCKS = 20;

function datasetLabel(dataset) {
    return getTranslationForKey(dataset, { fallback: dataset });
}

// Strip response-only fields and derive sequential positions for the strict write API.
function scopePayload(blocks) {
    return blocks.map((block, index) => ({
        dataset: block.dataset, result_limit: Number(block.result_limit),
        sort_order: index + 1, enabled: block.enabled,
    }));
}

function scopeSignature(blocks) {
    return JSON.stringify(blocks.map(block => [block.dataset, String(block.result_limit), block.enabled]));
}

/** Generates Admin → Site settings → Home settings using the existing management container. */
export async function generate_front_page_settings_view(container, { onSaved = refreshFrontPage, modal = false } = {}) {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();
    container.classList.add('front-page-settings-view');
    const heading = frontPageLabel(document.createElement('h2'), 'front_page_settings');
    const status = frontPageStatus('status');
    const reloadButton = frontPageButton('front_page_reload', 'reload');
    const openButton = frontPageButton('front_page_open', 'open');
    // In the dialog the modal's own title names the editor, and Home is already behind it.
    openButton.hidden = modal;
    const toolbar = document.createElement('div');
    toolbar.className = 'front-page-settings-actions';
    toolbar.append(reloadButton, openButton);

    const settingsSection = frontPageSection('front_page_settings');
    const enabledInput = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const siteNameInput = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const showBlocksInput = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const settingsSave = frontPageButton('save', 'settings-save', true);
    const settingsStatus = frontPageStatus('settings-status');
    settingsSection.append(
        frontPageField('front_page_enabled', enabledInput, 'enabled'),
        frontPageField('front_page_button_shows_site_name', siteNameInput, 'site-name'),
        frontPageField('front_page_show_blocks', showBlocksInput, 'show-blocks'),
        settingsStatus, settingsSave,
    );

    const heroSection = frontPageSection('front_page_hero');
    const titleEditor = createLangKeyEditor('title', { includeChinese: false });
    const sloganEditor = createLangKeyEditor('slogan', { includeChinese: false, multiline: true });
    const descriptionEditor = createLangKeyEditor('description', { includeChinese: false, multiline: true });
    const heroHelp = frontPageLabel(document.createElement('p'), 'front_page_hero_help');
    const heroSave = frontPageButton('save', 'hero-save', true);
    heroSection.append(heroHelp, titleEditor.wrapper, sloganEditor.wrapper, descriptionEditor.wrapper, heroSave);
    let heroBaseline = '';
    [titleEditor, sloganEditor, descriptionEditor].forEach((editor, index) => {
        ['keyInput', 'fiInput', 'enInput', 'usageExplanationInput'].forEach(name => {
            const control = editor[name];
            control.id = `front-page-${['title', 'slogan', 'description'][index]}-${name}`;
            control.dataset.testid = control.id;
            control.closest('label').htmlFor = control.id;
            if (name !== 'keyInput') control.addEventListener('input', updateState);
        });
    });

    const scopeSection = frontPageSection('system_front_page_blocks');
    const scopeSelect = document.createElement('select');
    const commonOption = frontPageLabel(document.createElement('option'), 'front_page_common');
    commonOption.value = '';
    scopeSelect.append(commonOption);
    const searchForm = document.createElement('form');
    searchForm.className = 'front-page-settings-user-search';
    const userSearch = Object.assign(document.createElement('input'), { type: 'search', maxLength: 100, autocomplete: 'off' });
    const searchButton = frontPageButton('search', 'user-search-button');
    searchButton.type = 'submit';
    const searchStatus = frontPageStatus('user-search-status');
    searchForm.append(frontPageField('front_page_find_user', userSearch, 'user-search'), searchButton);
    const sourceStatus = frontPageStatus('source');
    const blockList = document.createElement('ol');
    blockList.className = 'front-page-settings-block-list';
    blockList.dataset.testid = 'front-page-block-list';
    const addSelect = document.createElement('select');
    const addButton = frontPageButton('front_page_add_block', 'add');
    const addRow = document.createElement('div');
    addRow.className = 'front-page-settings-add-row';
    addRow.append(frontPageField('dataset', addSelect, 'dataset'), addButton);
    const scopeSave = frontPageButton('save', 'blocks-save', true);
    const resetButton = frontPageButton('front_page_reset', 'reset');
    const copyButton = frontPageButton('front_page_copy_common', 'copy');
    const scopeActions = document.createElement('div');
    scopeActions.className = 'front-page-settings-actions';
    const dirtyStatus = frontPageStatus('blocks-status');
    const blocksHelp = frontPageLabel(document.createElement('p'), 'front_page_blocks_help');
    scopeActions.append(scopeSave, resetButton, copyButton);
    scopeSection.append(searchForm, searchStatus, frontPageField('front_page_user_scope', scopeSelect, 'scope'),
        sourceStatus, blocksHelp, blockList, addRow, dirtyStatus, scopeActions);

    let settingsBaseline = '';
    let blockBaseline = '';
    let currentScope = '';
    let version = 'none';
    let blocks = [];
    let datasets = [];
    let inherited = false;
    let saved = false;
    let busy = false;
    let ready = false;
    let conflicted = false;
    let disposed = false;
    let searchRevision = 0;
    let searchController = null;
    const lifetime = new AbortController();
    const background = createFrontPageBackgroundControl({
        onChange: () => { if (ready) updateState(); }, report,
        isEnabled: () => localStorage.getItem('separate_front_page') === 'true',
    });
    container.append(...(modal ? [] : [heading]), toolbar, status, settingsSection, heroSection, scopeSection, background.element);

    function settingsValue() {
        return { separate_front_page: enabledInput.checked, front_page_button_shows_site_name: siteNameInput.checked,
            front_page_show_blocks: showBlocksInput.checked };
    }

    function heroValue() {
        const value = editor => ({ fi: editor.fiInput.value.trim(), en: editor.enInput.value.trim(),
            usage_explanation: editor.usageExplanationInput.value.trim() });
        return { title: value(titleEditor), slogan: value(sloganEditor), description: value(descriptionEditor) };
    }
    function heroDirty() { return JSON.stringify(heroValue()) !== heroBaseline; }
    function blocksDirty() { return scopeSignature(blocks) !== blockBaseline; }
    function settingsDirty() { return JSON.stringify(settingsValue()) !== settingsBaseline; }
    function anyDirty() { return settingsDirty() || heroDirty() || blocksDirty() || background.dirty(); }

    function report(key) {
        if (!disposed) frontPageLabel(status, key);
    }

    function updateState() {
        [settingsSection, heroSection, background.element].forEach(section => { section.disabled = busy || !ready; });
        scopeSection.disabled = busy || !ready || !showBlocksInput.checked;
        scopeSection.classList.toggle('front-page-settings-section--disabled', !showBlocksInput.checked);
        heroSave.disabled = busy || !ready || !heroDirty();
        container.setAttribute('aria-busy', String(busy));
        settingsSave.disabled = busy || !ready || !settingsDirty();
        scopeSave.disabled = busy || !ready || !showBlocksInput.checked || conflicted || !blocksDirty();
        resetButton.hidden = copyButton.hidden = !currentScope;
        resetButton.disabled = busy || conflicted || !ready || (!saved && !blocksDirty());
        copyButton.disabled = busy || conflicted || !ready;
        reloadButton.disabled = busy;
        openButton.disabled = busy || !ready || localStorage.getItem('separate_front_page') !== 'true';
        if (blocksDirty()) frontPageLabel(dirtyStatus, 'unsaved_changes');
        else { dirtyStatus.textContent = ''; delete dirtyStatus.dataset.langKey; }
        if (settingsDirty()) frontPageLabel(settingsStatus, 'unsaved_changes');
        else { settingsStatus.textContent = ''; delete settingsStatus.dataset.langKey; }
        background.saveButton.disabled = busy || !ready || !background.dirty();
        container.classList.toggle('front-page-settings-dirty', ready && anyDirty());
        updateAddChoices();
    }

    function updateAddChoices() {
        const previous = addSelect.value;
        const choices = datasets.filter(dataset => dataset.newest_capable === true
            && !blocks.some(block => block.dataset === dataset.dataset));
        addSelect.replaceChildren(...choices.map(dataset => {
            const option = document.createElement('option');
            option.value = dataset.dataset;
            option.textContent = datasetLabel(dataset.dataset);
            return option;
        }));
        if (choices.some(dataset => dataset.dataset === previous)) addSelect.value = previous;
        addSelect.disabled = addButton.disabled = busy || !showBlocksInput.checked || conflicted || blocks.length >= MAX_BLOCKS || choices.length === 0;
    }

    function updateSource() {
        sourceStatus.textContent = '';
        delete sourceStatus.dataset.langKey;
        if (inherited) frontPageLabel(sourceStatus, 'front_page_inherits');
        else if (!saved) frontPageLabel(sourceStatus, 'front_page_default_not_saved');
    }

    function renderBlocks(focusDataset = '', focusAction = '') {
        blockList.replaceChildren(...blocks.map((block, index) => {
            const row = document.createElement('li');
            row.className = 'front-page-settings-block';
            row.dataset.dataset = block.dataset;
            const title = document.createElement('strong');
            title.className = 'front-page-settings-block-title';
            title.dataset.frontPageDatasetLabel = block.dataset;
            title.textContent = datasetLabel(block.dataset);
            const warning = frontPageLabel(document.createElement('p'), 'front_page_hidden_for_user');
            warning.className = 'front-page-settings-warning';
            warning.id = `front-page-block-${index}-warning`;
            warning.hidden = !currentScope || block.can_read !== false;
            if (!warning.hidden) row.setAttribute('aria-describedby', warning.id);
            const count = Object.assign(document.createElement('input'), {
                type: 'number', min: '1', max: '20', step: '1', value: String(block.result_limit),
            });
            count.addEventListener('input', () => { block.result_limit = count.value; updateState(); });
            const enabled = Object.assign(document.createElement('input'), { type: 'checkbox', checked: block.enabled });
            enabled.addEventListener('change', () => { block.enabled = enabled.checked; updateState(); });
            const actions = document.createElement('div');
            actions.className = 'front-page-settings-actions';
            const up = frontPageButton('front_page_move_up', `block-${index}-up`);
            const down = frontPageButton('front_page_move_down', `block-${index}-down`);
            const remove = frontPageButton('front_page_remove_block', `block-${index}-remove`);
            [up, down, remove].forEach(button => {
                button.dataset.frontPageAction = button.dataset.testid.split('-').at(-1);
                button.setAttribute('aria-label', `${frontPageText(button.dataset.langKey)}: ${datasetLabel(block.dataset)}`);
            });
            up.disabled = index === 0;
            down.disabled = index === blocks.length - 1;
            function move(offset) {
                const target = index + offset;
                [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
                const action = offset < 0 ? (target === 0 ? 'down' : 'up')
                    : (target === blocks.length - 1 ? 'up' : 'down');
                renderBlocks(block.dataset, action);
                updateState();
            }
            up.addEventListener('click', () => move(-1));
            down.addEventListener('click', () => move(1));
            remove.addEventListener('click', () => {
                blocks.splice(index, 1);
                renderBlocks(blocks[Math.min(index, blocks.length - 1)]?.dataset, 'remove');
                updateState();
                if (blocks.length === 0) addSelect.focus();
            });
            actions.append(up, down, remove);
            row.append(title, warning, frontPageField('front_page_result_limit', count, `block-${index}-count`),
                frontPageField('enabled', enabled, `block-${index}-enabled`), actions);
            return row;
        }));
        const focusedRow = Array.from(blockList.children).find(row => row.dataset.dataset === focusDataset);
        focusedRow?.querySelector(`[data-front-page-action="${focusAction}"]`)?.focus();
    }

    function validateBlocks() {
        let key = '';
        let invalidIndex = -1;
        if (blocks.length > MAX_BLOCKS) key = 'front_page_blocks_invalid';
        const seen = new Set();
        blocks.forEach((block, index) => {
            const count = Number(block.result_limit);
            const invalidCount = String(block.result_limit).trim() === ''
                || !Number.isInteger(count) || count < 1 || count > 20;
            blockList.children[index]?.querySelector('input[type="number"]')?.setAttribute('aria-invalid', String(invalidCount));
            if (invalidCount && !key) { key = 'front_page_limit_invalid'; invalidIndex = index; }
            if (seen.has(block.dataset) || !datasets.some(dataset => dataset.dataset === block.dataset && dataset.newest_capable)) {
                if (!key) key = 'front_page_blocks_invalid';
            }
            seen.add(block.dataset);
        });
        if (!key) return true;
        report(key);
        blockList.children[invalidIndex]?.querySelector('input[type="number"]')?.focus();
        return false;
    }

    async function confirmDiscard(dirty) {
        if (!dirty) return true;
        return showConfirmModal({
            messageLangKey: 'front_page_discard_changes', messagePlainText: frontPageText('front_page_discard_changes'),
            confirmLangKey: 'front_page_discard', confirmText: frontPageText('front_page_discard'),
            cancelText: frontPageText('cancel'),
        });
    }

    async function fetchScope(scope, { global = false } = {}) {
        const data = await endpoint_router('adminFrontPage', {
            url_params: scope ? `?${new URLSearchParams({ user_id: scope })}` : '',
            suppressErrorToast: true, signal: lifetime.signal,
        });
        if (disposed) return;
        currentScope = scope;
        scopeSelect.value = scope;
        version = data.version;
        blocks = (data.blocks || []).map(block => ({ ...block }));
        datasets = data.datasets || [];
        inherited = data.inherits_common === true;
        saved = data.saved === true;
        blockBaseline = scopeSignature(blocks);
        conflicted = false;
        if (global) {
            enabledInput.checked = data.settings.separate_front_page === true;
            siteNameInput.checked = data.settings.front_page_button_shows_site_name === true;
            showBlocksInput.checked = data.settings.front_page_show_blocks !== false;
            applyLangKeyConfig(titleEditor, data.hero?.title || { lang_key: 'site_front_page_title' });
            applyLangKeyConfig(sloganEditor, data.hero?.slogan || { lang_key: 'site_front_page_slogan' });
            applyLangKeyConfig(descriptionEditor, data.hero?.description || { lang_key: 'site_front_page_description' });
            heroBaseline = JSON.stringify(heroValue());
            settingsBaseline = JSON.stringify(settingsValue());
            background.setSnapshot(data.background, data.background_error);
        }
        ready = true;
        renderBlocks();
        updateSource();
    }

    // One operation owns the controls. Failed writes retain the draft and its old revision.
    async function operate(operation, failureKey = 'front_page_save_failed', successKey = 'settings_saved') {
        if (busy || disposed) return false;
        busy = true;
        updateState();
        report('saving');
        try {
            await operation();
            if (disposed) return false;
            await onSaved?.();
            if (disposed) return false;
            report(successKey);
            return true;
        } catch (error) {
            if (disposed) return false;
            if (error?.status === 409) {
                conflicted = true;
                report('front_page_save_conflict');
            } else report(error?.frontPageSaved ? 'front_page_refresh_failed' : failureKey);
            return false;
        } finally {
            busy = false;
            if (!disposed) updateState();
        }
    }

    async function saveScope(mode = 'blocks') {
        if (conflicted || !ready || busy) return;
        if (mode === 'blocks' && (!blocksDirty() || !validateBlocks())) return;
        if (mode !== 'blocks' && !await confirmDiscard(blocksDirty())) return;
        await operate(async () => {
            const response = await endpoint_router('adminFrontPage', {
                method: 'POST', suppressErrorToast: true, signal: lifetime.signal,
                body_data: { user_id: currentScope ? Number(currentScope) : null, version,
                    ...(mode === 'blocks' ? { blocks: scopePayload(blocks) } : { [mode]: true }) },
            });
            if (disposed) return;
            version = response.version;
            if (mode !== 'blocks' || blocks.length === 0) {
                // The write succeeded; if its refresh fails, require a fresh GET before another write.
                conflicted = true;
                try { await fetchScope(currentScope); }
                catch (error) {
                    const refreshError = new Error('Saved scope could not be refreshed', { cause: error });
                    refreshError.frontPageSaved = true;
                    throw refreshError;
                }
            } else {
                blockBaseline = scopeSignature(blocks);
                inherited = false;
                saved = true;
                updateSource();
            }
        });
    }

    scopeSave.addEventListener('click', () => { void saveScope(); });
    resetButton.addEventListener('click', () => { void saveScope('reset'); });
    copyButton.addEventListener('click', () => { void saveScope('copy_from_common'); });
    addButton.addEventListener('click', () => {
        if (blocks.length >= MAX_BLOCKS || !addSelect.value) return;
        const dataset = datasets.find(candidate => candidate.dataset === addSelect.value && candidate.newest_capable);
        if (!dataset || blocks.some(block => block.dataset === dataset.dataset)) return;
        blocks.push({ dataset: dataset.dataset, result_limit: 5, enabled: true, can_read: dataset.can_read });
        renderBlocks(dataset.dataset, 'remove');
        updateState();
    });
    [enabledInput, siteNameInput, showBlocksInput].forEach(input => input.addEventListener('change', updateState));
    settingsSave.addEventListener('click', () => {
        if (!ready || !settingsDirty()) return;
        void operate(async () => {
            await endpoint_router('adminFrontPage', {
                method: 'POST', body_data: { settings: settingsValue() }, suppressErrorToast: true, signal: lifetime.signal,
            });
            if (disposed) return;
            settingsBaseline = JSON.stringify(settingsValue());
            await setAuthModes();
            if (disposed) return;
            renderNavbarFrontPage({ isLoggedIn: localStorage.getItem('button_state') === 'logout' });
            background.update();
        });
    });
    heroSave.addEventListener('click', () => {
        if (!ready || !heroDirty()) return;
        void operate(async () => {
            await endpoint_router('adminFrontPage', { method: 'POST', body_data: { hero: heroValue() },
                suppressErrorToast: true, signal: lifetime.signal });
            if (!disposed) heroBaseline = JSON.stringify(heroValue());
        });
    });
    background.saveButton.addEventListener('click', () => {
        if (!background.dirty() || !background.validate()) return;
        void operate(() => background.save(lifetime.signal), 'front_page_background_save_failed');
    });

    scopeSelect.addEventListener('change', async () => {
        const target = scopeSelect.value;
        scopeSelect.value = currentScope;
        if (target === currentScope || busy) return;
        if (!await confirmDiscard(blocksDirty()) || disposed) return;
        await operate(() => fetchScope(target), 'front_page_load_failed', 'front_page_loaded');
    });
    searchForm.addEventListener('submit', async event => {
        event.preventDefault();
        const query = userSearch.value.trim();
        if (!query || busy) return;
        const revision = ++searchRevision;
        searchController?.abort();
        searchController = new AbortController();
        frontPageLabel(searchStatus, 'loading');
        try {
            const data = await endpoint_router('adminFrontPage', {
                url_params: `?${new URLSearchParams({ user_query: query })}`, suppressErrorToast: true,
                signal: searchController.signal,
            });
            if (disposed || revision !== searchRevision) return;
            // Only display names supplied by the dedicated API enter the picker.
            const selected = Array.from(scopeSelect.options).find(option => option.value === currentScope);
            const users = (data.users || []).filter(user => Number.isInteger(user.user_id) && user.user_id > 1
                && typeof user.display_name === 'string' && user.display_name.trim()).slice(0, 20);
            scopeSelect.replaceChildren(commonOption);
            if (selected && currentScope && !users.some(user => String(user.user_id) === currentScope)) scopeSelect.append(selected);
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = String(user.user_id);
                option.textContent = user.display_name;
                scopeSelect.append(option);
            });
            scopeSelect.value = currentScope;
            frontPageLabel(searchStatus, users.length ? 'front_page_choose_user' : 'front_page_no_users');
        } catch (_error) {
            if (!disposed && revision === searchRevision) frontPageLabel(searchStatus, 'front_page_user_search_failed');
        }
    });
    userSearch.addEventListener('input', () => {
        searchRevision++;
        searchController?.abort();
        searchStatus.textContent = '';
        delete searchStatus.dataset.langKey;
    });
    reloadButton.addEventListener('click', async () => {
        if (busy || !await confirmDiscard(ready && anyDirty()) || disposed) return;
        await operate(() => fetchScope(currentScope, { global: true }), 'front_page_load_failed', 'front_page_loaded');
    });
    openButton.addEventListener('click', () => { void openFrontPage({ forceReload: true }); });

    // Reuse the navigation pipeline's dirty hook and the shell's existing cleanup contract.
    const checkDirty = async () => !busy && await confirmDiscard(ready && anyDirty());
    if (!modal) window.check_manage_permissions_dirty = checkDirty;
    const beforeUnload = event => { if (busy || (ready && anyDirty())) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const owner = modal ? container : container.closest('.content_div') || container;
    owner.__cleanupListeners = () => {
        disposed = true;
        lifetime.abort();
        searchController?.abort();
        background.destroy();
        window.removeEventListener('beforeunload', beforeUnload);
        if (window.check_manage_permissions_dirty === checkDirty) delete window.check_manage_permissions_dirty;
        container.replaceChildren(); // Returning through loadManagementView fetches a fresh scope.
    };
    bindDatasetLanguageRenderer(container, () => {
        container.querySelectorAll('[data-lang-key]').forEach(element => frontPageLabel(element, element.dataset.langKey));
        container.querySelectorAll('[data-front-page-dataset-label]').forEach(element => {
            element.textContent = datasetLabel(element.dataset.frontPageDatasetLabel);
        });
        blockList.querySelectorAll('[data-front-page-action]').forEach(button => {
            button.setAttribute('aria-label', `${frontPageText(button.dataset.langKey)}: ${datasetLabel(button.closest('li').dataset.dataset)}`);
        });
        updateAddChoices();
    });

    busy = true;
    updateState();
    report('loading');
    try {
        await fetchScope('', { global: true });
        if (!disposed) { status.textContent = ''; delete status.dataset.langKey; }
    } catch (_error) { report('front_page_load_failed'); }
    finally { busy = false; if (!disposed) updateState(); }
}
