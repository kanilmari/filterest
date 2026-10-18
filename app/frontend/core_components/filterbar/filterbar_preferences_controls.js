// filterbar_preferences_controls.js
// Explains shared/personal order and visibility memory with translated form controls.
// Connects the settings view and style disclosure to the same validated APIs.
// Provides accessible up/down ordering on phones without showing configuration JSON.
import { getTranslationForKey } from '../lang/translation_handler.js';
import { showErrorToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getFilterbarPreferences, loadFilterbarPreferences, subscribeFilterbarPreferences,
    savePersonalFilterbarPreference, saveSharedFilterbarLayout, saveFilterbarOrder } from './filterbar_preferences_controller.js';
import { visibilityMemoryMode, setFilterbarVisibilityMemoryMode } from './filterbar_visibility_memory.js';

const SECTION_LABELS = {
    filters: 'filterbar_filter_results', tools: 'filterbar_add_manage_content',
    views: 'filterbar_view_content_as', field_sets: 'filterbar_select_visible_fields',
    style: 'filterbar_style_and_colors',
    search_overview: 'search_and_overview', search_controls: 'search_and_basic_controls',
};

function copy(tag, key) {
    const element = document.createElement(tag);
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}

/** One settings surface, owned by its parent lifetime, for every supported role. */
export function buildFilterbarPreferenceControls({ signal } = {}) {
    const root = document.createElement('fieldset');
    root.className = 'filterbar-preference-controls';
    root.dataset.testid = 'filterbar-preferences';
    root.append(copy('legend', 'filterbar_preferences'));
    let busy = false;
    let destroyed = false;
    async function change(operation) {
        busy = true; render();
        try { await operation(); }
        catch { showErrorToast(getTranslationForKey('save_failed')); }
        finally { busy = false; if (!destroyed) render(); }
    }
    function choice(key, value, choices, onChange) {
        const label = document.createElement('label');
        label.append(copy('span', key));
        const select = document.createElement('select');
        select.dataset.testid = key;
        for (const [optionValue, optionKey, disabled = false] of choices) {
            const option = copy('option', optionKey);
            option.value = optionValue; option.disabled = disabled;
            select.append(option);
        }
        select.value = value;
        select.disabled = busy;
        select.addEventListener('change', () => { void change(() => onChange(select.value)); });
        label.append(select); root.append(label); return select;
    }
    function render() {
        const state = getFilterbarPreferences();
        root.disabled = busy || !state.loaded;
        root.replaceChildren(copy('legend', 'filterbar_preferences'));
        const authenticated = localStorage.getItem('button_state') === 'logout';
        const orderChoice = choice('filterbar_order_title', state.mode, [
                ['shared', 'filterbar_order_shared'], ['own', 'filterbar_order_own', !state.ownAllowed],
            ], value => savePersonalFilterbarPreference({ order_mode: value }));
        orderChoice.disabled = busy || !authenticated;
        root.append(copy('p', 'filterbar_order_help'));
        if (state.canEditShared) {
            const label = document.createElement('label');
            const allow = document.createElement('input');
            allow.type = 'checkbox'; allow.checked = state.shared.allow_own_order;
            allow.disabled = busy; allow.dataset.testid = 'filterbar-allow-own';
            allow.addEventListener('change', () => { void change(() => saveSharedFilterbarLayout({ allow_own_order: allow.checked })); });
            label.append(allow, copy('span', 'filterbar_own_allow')); root.append(label);
            root.append(copy('p', 'filterbar_own_allow_help'));
        }
        if (state.canEditShared || state.mode === 'own') {
            const list = document.createElement('ol');
            list.dataset.testid = 'filterbar-order-list';
            const movable = state.order.filter(key => key !== 'chat');
            movable.forEach((key, index) => {
                const row = document.createElement('li'); row.dataset.sectionKey = key;
                row.append(copy('span', SECTION_LABELS[key]));
                for (const [step, labelKey] of [[-1, 'filterbar_move_up'], [1, 'filterbar_move_down']]) {
                    const button = copy('button', labelKey); button.type = 'button';
                    button.classList.add('fw-btn');
                    button.disabled = busy || index + step < 0 || index + step >= movable.length;
                    button.addEventListener('click', () => {
                        const order = [...movable];
                        [order[index], order[index + step]] = [order[index + step], order[index]];
                        void change(() => saveFilterbarOrder([...order, 'chat']));
                    });
                    row.append(button);
                }
                list.append(row);
            });
            root.append(list);
        }
        choice('filterbar_visibility_title', visibilityMemoryMode(), [
            ['shared', 'filterbar_visibility_shared'], ['dataset', 'filterbar_visibility_dataset'],
        ], async value => {
            if (authenticated) await savePersonalFilterbarPreference({ visibility_memory: value });
            setFilterbarVisibilityMemoryMode(value);
        });
        root.append(copy('p', 'filterbar_visibility_help'));
    }
    const unsubscribe = subscribeFilterbarPreferences(render);
    root.destroy = () => { destroyed = true; unsubscribe(); };
    signal?.addEventListener('abort', root.destroy, { once: true });
    render();
    void loadFilterbarPreferences().then(() => { if (!destroyed) render(); }).catch(() => {
        if (!destroyed) { root.disabled = true; showErrorToast(getTranslationForKey('save_failed')); }
    });
    return root;
}
