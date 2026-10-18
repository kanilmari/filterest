// row_group_facet_card_builder.js
// Builds the persistent category card and its lazily mounted shared multiselect popups.
// Connects normalized facet metadata and translated copy to the existing selection callbacks.
// Keeps headings, match controls, search and focus stable across accepted listing refreshes.

import { bindDatasetLanguageRenderer } from '../../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { createMultiselectDropdown } from '../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js';
import { createSymbolMaskElement } from '../../../reusable_components/symbol_asset_resolver.js';
import { createRowGroupHeadingOrder } from './row_group_heading_order.js';

// Full-key catalogues keep helper arguments visible to the startup language scan.
const MATCH_MODE_COPY = Object.freeze({
    legendKey: 'row_group_match_legend',
    helpLabelKey: 'row_group_match_help_label',
    headingsHintKey: 'row_group_match_headings_hint',
    modes: [
        { value: 'any', labelKey: 'row_group_match_any', effectKey: 'row_group_match_any_effect', hintKey: 'row_group_match_any_hint' },
        { value: 'all', labelKey: 'row_group_match_all', effectKey: 'row_group_match_all_effect', hintKey: 'row_group_match_all_hint' },
    ],
});
const PANEL_COPY = Object.freeze({
    categoriesKey: 'row_group_categories',
    // Single-word shared names use the scanner's explicit langKey declaration.
    filters: { langKey: 'filters' },
    moreKey: 'show_more',
    lessKey: 'show_less',
    clearKey: 'clear_selections',
    emptyHintKey: 'row_group_no_results_hint',
    limitKey: 'row_group_selection_limit',
    singleHintKey: 'row_group_single_value_hint',
    close: { langKey: 'close' },
    search: { langKey: 'search' },
    noMatchesKey: 'row_group_no_name_matches',
    selectedCountKey: 'row_group_selected_count',
});

const VISIBLE_HEADING_LIMIT = 3;
const SELECTION_LIMIT = 20;
const headingKey = group => String(group.heading?.id ?? 'legacy');

/** Presentation only: the caller retains all reconciliation, URL and search boundaries. */
export function createRowGroupFacetCard({ host, topControls, tableName, getSelectedSlugs, getSelectedModes, getFacetTitle,
    headingOrder = 'manual' }) {
    const entries = new Map();
    const ordering = createRowGroupHeadingOrder();
    const panelState = { expanded: false, openHeading: null };
    host.rowGroupPanelState = panelState;
    let groups = [];
    let callbacks = {};
    let chosenLanguage;
    let disposed = false;
    let pendingSelections = 0;
    const ownerElement = topControls.closest('#tabs_container > .content_div')
        || topControls.closest('.content_div') || topControls.parentElement;
    const title = createPanelText('h2', PANEL_COPY.categoriesKey, 'row-group-facets__title');
    const headings = document.createElement('div');
    headings.className = 'row-group-facet-headings';
    const more = createActionButton(PANEL_COPY.moreKey);
    more.dataset.rowGroupFocus = 'more';
    more.addEventListener('click', event => {
        event.stopPropagation();
        panelState.expanded = !panelState.expanded;
        render();
    });
    const clear = createActionButton(PANEL_COPY.clearKey);
    clear.dataset.rowGroupFocus = 'clear-categories';
    clear.addEventListener('click', event => {
        event.stopPropagation();
        void runSelection(() => callbacks.onClear(tableName));
    });
    const emptyHint = createPanelText('p', PANEL_COPY.emptyHintKey, 'row-group-facets__empty-hint');
    emptyHint.setAttribute('role', 'status');
    host.append(title, headings, clear, emptyHint);
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
        return group.heading ? getFacetTitle(group.heading, chosenLanguage) : getTranslationForKey(PANEL_COPY.filters.langKey);
    }

    function closePanel(key, { reason }) {
        if (disposed || panelState.openHeading !== key) return;
        const index = groups.findIndex(group => headingKey(group) === key);
        const selected = new Set(getSelectedSlugs(tableName));
        if (index >= VISIBLE_HEADING_LIMIT && !groups[index].values.some(facet => selected.has(facet.slug))
            && ['escape', 'close-button', 'trigger', 'tab-out'].includes(reason)) {
            panelState.expanded = true;
        }
        const entry = entries.get(key);
        if (entry?.help) {
            entry.help.hidden = true;
            entry.helpButton.setAttribute('aria-expanded', 'false');
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
        const hint = createPanelText('p', MATCH_MODE_COPY.modes[0].hintKey, 'row-group-facet-panel__hint');
        hint.id = `${entry.button.id}_hint`;
        const limit = createPanelText('p', PANEL_COPY.limitKey, 'row-group-facet-panel__hint');
        limit.setAttribute('role', 'status');
        const modeBlock = document.createElement('div');
        modeBlock.className = 'row-group-facet-mode-block';
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'row-group-facet-mode';
        fieldset.setAttribute('aria-describedby', hint.id);
        fieldset.appendChild(createPanelText('legend', MATCH_MODE_COPY.legendKey, 'row-group-facet-mode__legend'));
        const rows = document.createElement('div');
        rows.className = 'row-group-facet-mode__rows';
        const help = document.createElement('div');
        help.id = `${entry.button.id}_help`;
        help.className = 'row-group-facet-mode__help';
        help.tabIndex = 0;
        help.setAttribute('role', 'region');
        help.hidden = true;
        for (const { value, labelKey, effectKey, hintKey } of MATCH_MODE_COPY.modes) {
            const label = document.createElement('label');
            label.className = 'row-group-facet-mode__option';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `${host.id}_mode_${key}`;
            radio.value = value;
            radio.dataset.testid = 'row-group-match-mode';
            radio.setAttribute('aria-describedby', hint.id);
            radio.addEventListener('change', () => {
                if (radio.checked) void runSelection(() => callbacks.onModeChange(tableName, entry.group.heading?.id ?? 0, value));
            });
            label.append(radio, createPanelText('span', labelKey, 'row-group-facet-mode__text'),
                createPanelText('span', effectKey, 'row-group-facet-mode__tag'));
            rows.appendChild(label);
            const line = document.createElement('p');
            line.append(createPanelText('strong', labelKey, ''), document.createTextNode(' – '), createPanelText('span', hintKey, ''));
            help.appendChild(line);
        }
        fieldset.appendChild(rows);
        help.appendChild(createPanelText('p', MATCH_MODE_COPY.headingsHintKey, ''));
        // Outside the legend so the disclosure name is not part of the radio-group name.
        const helpButton = document.createElement('button');
        helpButton.id = `${entry.button.id}_help_toggle`;
        helpButton.type = 'button';
        helpButton.className = 'row-group-facet-mode__help-button';
        helpButton.setAttribute('aria-expanded', 'false');
        helpButton.setAttribute('aria-controls', help.id);
        help.setAttribute('aria-labelledby', helpButton.id);
        helpButton.appendChild(createSymbolMaskElement('help', 'row-group-facet-mode__help-icon'));
        helpButton.addEventListener('click', () => {
            help.hidden = !help.hidden;
            helpButton.setAttribute('aria-expanded', String(!help.hidden));
        });
        modeBlock.append(fieldset, helpButton);
        content.append(modeBlock, hint, limit);
        // Separate mounts avoid overwriting host.__dropdown when multiple headings have been opened.
        host.appendChild(mount);
        Object.assign(entry, { mount, content, modeBlock, fieldset, helpButton, help, hint, limit });
        entry.dropdown = createMultiselectDropdown({
            containerElement: mount, triggerElement: entry.button, ownerElement, minPopupWidth: 360,
            options: [], allowExclude: false, preserveViewState: true,
            popupHeader: { title: headingTitle(entry.group), showCloseButton: true },
            closeLabel: getTranslationForKey(PANEL_COPY.close.langKey), beforeSearchElement: content,
            popupDescriptionId: hint.id, searchPlaceholder: getTranslationForKey(PANEL_COPY.search.langKey),
            noResultsLabel: getTranslationForKey(PANEL_COPY.noMatchesKey),
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
        // A direct popup child can shrink independently of the radios/search in
        // the shared 400 px shell. Keyboard users can focus and scroll the help.
        content.after(help);
        patchPopup(entry);
    }

    function patchPopup(entry) {
        if (!entry.dropdown) return;
        const mode = getSelectedModes(tableName)[entry.group.heading?.id ?? 0] || 'any';
        const isSingle = entry.group.heading?.is_single === true;
        const hintKey = isSingle ? PANEL_COPY.singleHintKey : MATCH_MODE_COPY.modes.find(copy => copy.value === mode).hintKey;
        entry.hint.dataset.langKey = hintKey;
        entry.hint.hidden = !isSingle;
        entry.modeBlock.hidden = isSingle || entry.group.values.length < 2;
        entry.fieldset.hidden = entry.modeBlock.hidden;
        if (entry.modeBlock.hidden) {
            entry.help.hidden = true;
            entry.helpButton.setAttribute('aria-expanded', 'false');
        }
        entry.helpButton.setAttribute('aria-label', getTranslationForKey(MATCH_MODE_COPY.helpLabelKey));
        entry.fieldset.querySelectorAll('input').forEach(radio => { radio.checked = radio.value === mode; });
        entry.limit.hidden = getSelectedSlugs(tableName).length < SELECTION_LIMIT;
        for (const root of [entry.content, entry.help]) {
            root.querySelectorAll('[data-lang-key]').forEach(element => {
                element.textContent = getTranslationForKey(element.dataset.langKey);
            });
        }
        entry.dropdown.setLabels({
            popupTitle: headingTitle(entry.group), closeLabel: getTranslationForKey(PANEL_COPY.close.langKey),
            searchPlaceholder: getTranslationForKey(PANEL_COPY.search.langKey), noResultsLabel: getTranslationForKey(PANEL_COPY.noMatchesKey),
        });
        entry.dropdown.setOptions(entry.group.values.map(facet => ({
            value: facet.slug, label: getFacetTitle(facet, chosenLanguage), count: facet.row_count, dimmed: facet.zero_hit,
        })));
        entry.dropdown.setValue({ includeValues: getSelectedSlugs(tableName).filter(slug => entry.group.values.some(facet => facet.slug === slug)) });
    }

    function render() {
        if (disposed) return;
        const selected = new Set(getSelectedSlugs(tableName));
        host.setAttribute('aria-label', getTranslationForKey(PANEL_COPY.categoriesKey));
        host.dataset.expanded = String(panelState.expanded);
        for (const text of [title, clear, emptyHint]) text.textContent = getTranslationForKey(text.dataset.langKey);
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
            entry.badge.setAttribute('aria-label', `${count} ${getTranslationForKey(PANEL_COPY.selectedCountKey)}`);
            entry.button.classList.toggle('has-selection', count > 0);
            entry.button.hidden = !panelState.expanded && index >= VISIBLE_HEADING_LIMIT && !count && panelState.openHeading !== key;
            entry.caret.textContent = panelState.openHeading === key ? '▴' : '▾';
            if (headings.children[index] !== entry.button) headings.insertBefore(entry.button, headings.children[index] || more);
            patchPopup(entry);
        });
        more.hidden = groups.length <= VISIBLE_HEADING_LIMIT;
        more.dataset.langKey = panelState.expanded ? PANEL_COPY.lessKey : PANEL_COPY.moreKey;
        more.textContent = getTranslationForKey(more.dataset.langKey);
        more.setAttribute('aria-expanded', String(panelState.expanded));
        clear.hidden = !selected.size && !Object.keys(getSelectedModes(tableName)).length;
        updateEmptyHint();
    }

    async function runSelection(action) {
        if (disposed) return;
        // Busy describes outstanding work; it must not discard the next choice.
        // The listing/search owners reject superseded responses before rendering.
        pendingSelections += 1;
        host.setAttribute('aria-busy', 'true');
        try { await action(); }
        catch (error) { console.warn('Category selection failed:', error); }
        finally {
            pendingSelections -= 1;
            if (!pendingSelections) host.removeAttribute('aria-busy');
            if (!disposed) render();
        }
    }

    return {
        update(nextGroups, nextCallbacks, { authoritative = false } = {}) {
            ordering.accept(nextGroups, authoritative);
            groups = ordering.sort(nextGroups, headingOrder);
            callbacks = nextCallbacks;
            render();
        },
        setHeadingOrder(value) {
            if (headingOrder === value) return;
            headingOrder = value;
            groups = ordering.sort(groups, headingOrder);
            render();
        },
    };
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
