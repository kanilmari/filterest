// row_group_facet_card_builder.js
// Builds the persistent category card and its lazily mounted shared multiselect popups.
// Connects normalized facet metadata and translated copy to the existing selection callbacks.
// Keeps headings, match controls, search and focus stable across accepted listing refreshes.

import { bindDatasetLanguageRenderer } from '../../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { createMultiselectDropdown } from '../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js';

const VISIBLE_HEADING_LIMIT = 3;
const SELECTION_LIMIT = 20;
const headingKey = group => String(group.heading?.id ?? 'legacy');

/** Presentation only: the caller retains all reconciliation, URL and search boundaries. */
export function createRowGroupFacetCard({ host, topControls, tableName, getSelectedSlugs, getSelectedModes, getFacetTitle }) {
    const entries = new Map();
    const panelState = { expanded: false, openHeading: null };
    host.rowGroupPanelState = panelState;
    let groups = [];
    let callbacks = {};
    let chosenLanguage;
    let disposed = false;
    const ownerElement = topControls.closest('#tabs_container > .content_div')
        || topControls.closest('.content_div') || topControls.parentElement;
    const title = createPanelText('h2', 'row_group_categories', 'row-group-facets__title');
    const guidance = createPanelText('p', 'row_group_categories_modes_hint', 'row-group-facets__guidance');
    const headings = document.createElement('div');
    headings.className = 'row-group-facet-headings';
    const more = createActionButton('show_more');
    more.dataset.rowGroupFocus = 'more';
    more.addEventListener('click', event => {
        event.stopPropagation();
        panelState.expanded = !panelState.expanded;
        render();
    });
    const clear = createActionButton('clear_selections');
    clear.dataset.rowGroupFocus = 'clear-categories';
    clear.addEventListener('click', event => {
        event.stopPropagation();
        void runSelection(() => callbacks.onClear(tableName));
    });
    const emptyHint = createPanelText('p', 'row_group_no_results_hint', 'row-group-facets__empty-hint');
    emptyHint.setAttribute('role', 'status');
    host.append(title, guidance, headings, clear, emptyHint);
    headings.appendChild(more);
    const primaryCount = document.getElementById(`${tableName}_results_count`);
    topControls.addEventListener('results-count-updated', updateEmptyHint);
    topControls.addEventListener('active-filters-updated', render);
    primaryCount?.addEventListener('results-count-updated', updateEmptyHint);
    host.disposeRowGroupPanel = () => {
        if (disposed) return;
        disposed = true;
        topControls.removeEventListener('results-count-updated', updateEmptyHint);
        topControls.removeEventListener('active-filters-updated', render);
        primaryCount?.removeEventListener('results-count-updated', updateEmptyHint);
        entries.forEach(entry => entry.dropdown?.destroy());
        entries.clear();
        host.removeAttribute('data-dataset-language-renderer');
    };
    bindDatasetLanguageRenderer(host, language => { chosenLanguage = language; render(); });

    function updateEmptyHint() {
        const counter = topControls.querySelector('.results_count[data-result-count]') || primaryCount;
        emptyHint.hidden = counter?.dataset.resultCount !== '0' || getSelectedSlugs(tableName).length === 0;
    }

    function headingTitle(group) {
        return group.heading ? getFacetTitle(group.heading, chosenLanguage) : getTranslationForKey('filters');
    }

    function closePanel(key, { reason }) {
        if (disposed || panelState.openHeading !== key) return;
        const index = groups.findIndex(group => headingKey(group) === key);
        const selected = new Set(getSelectedSlugs(tableName));
        if (index >= VISIBLE_HEADING_LIMIT && !groups[index].values.some(facet => selected.has(facet.slug))
            && ['escape', 'close-button', 'trigger', 'tab-out'].includes(reason)) {
            panelState.expanded = true;
        }
        panelState.openHeading = null;
        render();
    }

    function createHeading(group) {
        const key = headingKey(group);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'row-group-facet-heading';
        button.id = `${host.id}_heading_${key}`;
        button.dataset.headingId = key;
        button.dataset.testid = 'row-group-facet-heading';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-haspopup', 'dialog');
        const label = document.createElement('span');
        const badge = document.createElement('span');
        badge.className = 'row-group-facet-heading__badge';
        const caret = document.createElement('span');
        caret.setAttribute('aria-hidden', 'true');
        caret.className = 'row-group-facet-heading__caret';
        button.append(label, badge, caret);
        const entry = { group, button, label, badge, caret, dropdown: null };
        button.addEventListener('click', () => {
            if (entry.dropdown) return; // The mounted library owns subsequent trigger interactions.
            mountDropdown(entry);
            entry.dropdown.open();
        });
        // A lazily mounted native button must support opening keys before its first click.
        button.addEventListener('keydown', event => {
            if (entry.dropdown || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            mountDropdown(entry);
            entry.dropdown.open();
        });
        return entry;
    }

    function mountDropdown(entry) {
        const key = headingKey(entry.group);
        const mount = document.createElement('div');
        const content = document.createElement('div');
        content.className = 'row-group-facet-popup-content';
        const hint = createPanelText('p', 'row_group_match_any_hint', 'row-group-facet-panel__hint');
        hint.id = `${entry.button.id}_hint`;
        const limit = createPanelText('p', 'row_group_selection_limit', 'row-group-facet-panel__hint');
        limit.setAttribute('role', 'status');
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'row-group-facet-mode';
        fieldset.setAttribute('aria-describedby', hint.id);
        fieldset.appendChild(createPanelText('legend', 'row_group_match_mode', 'row-group-facet-mode__legend'));
        for (const value of ['any', 'all']) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `${host.id}_mode_${key}`;
            radio.value = value;
            radio.dataset.testid = 'row-group-match-mode';
            radio.setAttribute('aria-describedby', hint.id);
            radio.addEventListener('change', () => {
                if (radio.checked) void runSelection(() => callbacks.onModeChange(tableName, entry.group.heading?.id ?? 0, value));
            });
            label.append(radio, createPanelText('span', `row_group_match_${value}`, ''));
            fieldset.appendChild(label);
        }
        content.append(fieldset, hint, limit);
        // Separate mounts avoid overwriting host.__dropdown when multiple headings have been opened.
        host.appendChild(mount);
        Object.assign(entry, { mount, content, fieldset, hint, limit });
        entry.dropdown = createMultiselectDropdown({
            containerElement: mount, triggerElement: entry.button, ownerElement, minPopupWidth: 360,
            options: [], allowExclude: false, preserveViewState: true,
            popupHeader: { title: headingTitle(entry.group), showCloseButton: true },
            closeLabel: getTranslationForKey('close'), beforeSearchElement: content,
            popupDescriptionId: hint.id, searchPlaceholder: getTranslationForKey('search'),
            noResultsLabel: getTranslationForKey('row_group_no_name_matches'),
            selectionLimit: { max: SELECTION_LIMIT, getSelectionCount: () => getSelectedSlugs(tableName).length },
            onOpen: () => {
                entries.get(panelState.openHeading)?.dropdown?.close();
                panelState.openHeading = key;
                render();
            },
            onClose: settings => closePanel(key, settings),
            onChange: next => {
                const selected = new Set(getSelectedSlugs(tableName));
                const nextValues = new Set(next.includeValues);
                const changed = entry.group.values.find(facet => selected.has(facet.slug) !== nextValues.has(facet.slug));
                if (changed) void runSelection(() => callbacks.onToggle(tableName, changed.slug));
                else render();
            },
        });
        patchPopup(entry);
    }

    function patchPopup(entry) {
        if (!entry.dropdown) return;
        const mode = getSelectedModes(tableName)[entry.group.heading?.id ?? 0] || 'any';
        const hintKey = entry.group.heading?.is_single ? 'row_group_single_value_hint'
            : mode === 'all' ? 'row_group_match_all_hint' : 'row_group_match_any_hint';
        entry.hint.dataset.langKey = hintKey;
        entry.fieldset.hidden = entry.group.heading?.is_single === true;
        entry.fieldset.querySelectorAll('input').forEach(radio => { radio.checked = radio.value === mode; });
        entry.limit.hidden = getSelectedSlugs(tableName).length < SELECTION_LIMIT;
        entry.content.querySelectorAll('[data-lang-key]').forEach(element => {
            element.textContent = getTranslationForKey(element.dataset.langKey);
        });
        entry.dropdown.setLabels({
            popupTitle: headingTitle(entry.group), closeLabel: getTranslationForKey('close'),
            searchPlaceholder: getTranslationForKey('search'), noResultsLabel: getTranslationForKey('row_group_no_name_matches'),
        });
        entry.dropdown.setOptions(entry.group.values.map(facet => ({
            value: facet.slug, label: getFacetTitle(facet, chosenLanguage), count: facet.row_count, dimmed: facet.zero_hit,
        })));
        entry.dropdown.setValue({ includeValues: getSelectedSlugs(tableName).filter(slug => entry.group.values.some(facet => facet.slug === slug)) });
    }

    function render() {
        if (disposed) return;
        const selected = new Set(getSelectedSlugs(tableName));
        host.setAttribute('aria-label', getTranslationForKey('row_group_categories'));
        host.dataset.expanded = String(panelState.expanded);
        for (const text of [title, guidance, clear, emptyHint]) text.textContent = getTranslationForKey(text.dataset.langKey);
        const keys = new Set(groups.map(headingKey));
        for (const [key, entry] of entries) {
            if (keys.has(key)) continue;
            entries.delete(key);
            entry.dropdown?.destroy();
            entry.button.remove();
            entry.mount?.remove();
        }
        groups.forEach((group, index) => {
            const key = headingKey(group);
            if (!entries.has(key)) entries.set(key, createHeading(group));
            const entry = entries.get(key);
            entry.group = group;
            const count = group.values.filter(facet => selected.has(facet.slug)).length;
            entry.label.textContent = headingTitle(group);
            entry.badge.classList.toggle('is-empty', count === 0);
            entry.badge.setAttribute('aria-hidden', String(count === 0));
            entry.badge.textContent = String(count);
            entry.badge.setAttribute('aria-label', `${count} ${getTranslationForKey('row_group_selected_count')}`);
            entry.button.classList.toggle('has-selection', count > 0);
            entry.button.hidden = !panelState.expanded && index >= VISIBLE_HEADING_LIMIT && !count && panelState.openHeading !== key;
            entry.caret.textContent = panelState.openHeading === key ? '▴' : '▾';
            if (headings.children[index] !== entry.button) headings.insertBefore(entry.button, headings.children[index] || more);
            patchPopup(entry);
        });
        more.hidden = groups.length <= VISIBLE_HEADING_LIMIT;
        more.dataset.langKey = panelState.expanded ? 'show_less' : 'show_more';
        more.textContent = getTranslationForKey(more.dataset.langKey);
        more.setAttribute('aria-expanded', String(panelState.expanded));
        clear.hidden = !selected.size && !Object.keys(getSelectedModes(tableName)).length;
        updateEmptyHint();
    }

    async function runSelection(action) {
        if (disposed || host.getAttribute('aria-busy') === 'true') { render(); return; }
        host.setAttribute('aria-busy', 'true');
        try { await action(); }
        catch (error) { console.warn('Category selection failed:', error); }
        finally { host.removeAttribute('aria-busy'); render(); }
    }

    return { update(nextGroups, nextCallbacks) { groups = nextGroups; callbacks = nextCallbacks; render(); } };
}

function createPanelText(tag, key, className) {
    const element = document.createElement(tag);
    element.className = className;
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}

function createActionButton(key) {
    const button = createPanelText('button', key, 'row-group-facet-action');
    button.type = 'button';
    return button;
}
