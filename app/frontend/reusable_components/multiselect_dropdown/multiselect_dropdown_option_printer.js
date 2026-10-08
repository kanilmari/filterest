// multiselect_dropdown_option_printer.js
// Prints searchable multiselect options with optional counts and selectable dimming.
// Connects option metadata and selection callbacks to stable accessible DOM nodes.
// Retains focus and list scroll during opted-in updates without retaining obsolete facet data.

import { ariaCheckedValueForMultiselectState, normalizeMultiselectSearchText,
    searchableMultiselectOptionText } from './multiselect_dropdown_data.js';

/** Keyed updates never replace a surviving focused option or move it unnecessarily. */
export function createMultiselectOptionPrinter({
    optionsList, emptyStatus, labels, allowExclude, singleTarget, getOptionState,
    isDisabled, isBlocked, toggleCheckboxState, setOptionStateAndSync, searchInput,
}) {
    const rows = new Map();
    const groups = new Map();

    function getRenderedOptions() { return Array.from(optionsList.querySelectorAll('.msd-option')); }

    function revealWithin(container, item) {
        const box = item.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        if (box.top < viewport.top) container.scrollTop -= viewport.top - box.top;
        else if (box.bottom > viewport.bottom) container.scrollTop += box.bottom - viewport.bottom;
    }

    // Every focus move inside the popup goes through here: the page never scrolls, and the element comes into view in
    // the option list (for an option) and in the popup, which scrolls as a whole on short screens.
    function focusInView(element) {
        if (!element) return;
        element.focus({ preventScroll: true });
        if (optionsList.contains(element)) revealWithin(optionsList, element);
        const popup = optionsList.closest('.msd-dropdown-list');
        if (popup && /^(auto|scroll)$/.test(getComputedStyle(popup).overflowY)) revealWithin(popup, element);
    }

    function focusOptionAt(index) { focusInView(getRenderedOptions()[index]); }

    function focusOptionValue(value) {
        focusOptionAt(getRenderedOptions().findIndex(item => item.dataset.optionValue === String(value)));
    }

    function createOptionRow(value) {
        const item = document.createElement('div');
        item.className = 'msd-option';
        item.dataset.optionValue = value;
        item.setAttribute('role', 'option');
        const checkbox = document.createElement(singleTarget ? 'span' : 'button');
        checkbox.className = 'msd-option-checkbox';
        if (singleTarget) checkbox.setAttribute('aria-hidden', 'true');
        else {
            checkbox.type = 'button';
            checkbox.setAttribute('role', 'checkbox');
            checkbox.value = value;
            checkbox.addEventListener('click', toggleOption);
        }
        const label = document.createElement('span');
        label.className = 'msd-option-label';
        const count = document.createElement('span');
        count.className = 'msd-option-count';
        count.setAttribute('aria-hidden', 'true');
        item.append(checkbox, label, count);
        let action = null;
        if (allowExclude) {
            action = document.createElement('button');
            action.type = 'button';
            action.className = 'msd-option-action';
            action.addEventListener('click', event => {
                event.stopPropagation();
                if (!isDisabled()) setOptionStateAndSync(value,
                    getOptionState(value) === 'exclude' ? 'neutral' : 'exclude');
            });
            item.appendChild(action);
        }
        function toggleOption(event) {
            event?.stopPropagation();
            if (!isDisabled()) toggleCheckboxState(value);
        }
        item.addEventListener('click', toggleOption);
        item.addEventListener('keydown', event => {
            if (event.target !== item && event.target !== checkbox) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleOption(event);
                focusOptionValue(value);
                return;
            }
            const rendered = getRenderedOptions();
            const index = rendered.indexOf(item);
            const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rendered.length - 1 }[event.key];
            if (next != null) {
                event.preventDefault();
                focusOptionAt(Math.max(0, Math.min(next, rendered.length - 1)));
            }
        });
        return { item, checkbox, label, count, action };
    }

    function patchOption(row, option) {
        const { item, checkbox, label, count, action } = row;
        const state = getOptionState(option.value);
        const disabled = isDisabled();
        const blocked = state === 'neutral' && isBlocked(option.value);
        const hasCount = Number.isSafeInteger(option.count) && option.count >= 0;
        item.tabIndex = disabled ? -1 : 0;
        item.dataset.state = state;
        item.classList.toggle('msd-option--include', state === 'include');
        item.classList.toggle('msd-option--exclude', state === 'exclude');
        item.classList.toggle('msd-option--dimmed', option.dimmed === true);
        item.classList.toggle('msd-option--has-count', hasCount);
        item.setAttribute('aria-selected', String(state === 'include'));
        item.setAttribute('aria-label', `${option.label}${hasCount ? `: ${option.count}` : ''}`);
        if (disabled || blocked) item.setAttribute('aria-disabled', 'true');
        else item.removeAttribute('aria-disabled');
        checkbox.dataset.state = state;
        if (!singleTarget) {
            checkbox.disabled = disabled;
            checkbox.setAttribute('aria-checked', ariaCheckedValueForMultiselectState(state));
            checkbox.setAttribute('aria-label', item.getAttribute('aria-label'));
        }
        label.textContent = option.label;
        count.hidden = !hasCount;
        count.textContent = hasCount ? String(option.count) : '';
        if (action) {
            const excluded = state === 'exclude';
            const actionLabel = excluded ? labels.resetLabel : labels.excludeLabel;
            action.disabled = disabled;
            action.dataset.action = excluded ? 'reset' : 'exclude';
            action.dataset.langKey = excluded ? 'reset' : 'exclude';
            action.dataset.titleLangKey = excluded ? 'reset_filter_option' : 'exclude_filter_option';
            action.textContent = actionLabel;
            action.title = excluded ? labels.resetTooltip : labels.excludeTooltip;
            action.setAttribute('aria-label', `${actionLabel} ${option.label}`);
        }
    }

    function renderList(currentOptions, filterText = '', preserveViewState = false) {
        const active = document.activeElement;
        const focusedValue = active?.closest('.msd-option')?.dataset.optionValue;
        const hadFocus = optionsList.contains(active);
        const hadPopupFocus = Boolean(optionsList.closest('.msd-dropdown-list')?.contains(active));
        const scroll = optionsList.scrollTop;
        if (!preserveViewState) { optionsList.replaceChildren(); rows.clear(); groups.clear(); }
        const query = normalizeMultiselectSearchText(filterText);
        const filtered = currentOptions.filter(option => searchableMultiselectOptionText(option).includes(query));
        const groupOptions = new Map();
        for (const option of filtered) {
            const key = String(option.groupLabel || '');
            if (!groupOptions.has(key)) groupOptions.set(key, []);
            groupOptions.get(key).push(option);
        }
        const visibleValues = new Set();
        let groupIndex = 0;
        for (const [key, options] of groupOptions) {
            let group = groups.get(key);
            if (!group) {
                group = document.createElement('div');
                group.className = 'msd-option-group';
                if (key) {
                    group.setAttribute('role', 'group');
                    group.setAttribute('aria-label', key);
                    const heading = document.createElement('div');
                    heading.className = 'msd-option-group-label';
                    heading.setAttribute('aria-hidden', 'true');
                    heading.textContent = key;
                    group.appendChild(heading);
                }
                groups.set(key, group);
            }
            if (optionsList.children[groupIndex] !== group) optionsList.insertBefore(group, optionsList.children[groupIndex] || null);
            groupIndex++;
            let rowIndex = key ? 1 : 0;
            for (const option of options) {
                const value = String(option.value);
                visibleValues.add(value);
                if (!rows.has(value)) rows.set(value, createOptionRow(value));
                const row = rows.get(value);
                patchOption(row, option);
                if (group.children[rowIndex] !== row.item) group.insertBefore(row.item, group.children[rowIndex] || null);
                rowIndex++;
            }
        }
        for (const [value, row] of rows) if (!visibleValues.has(value)) { row.item.remove(); rows.delete(value); }
        for (const [key, group] of groups) if (!groupOptions.has(key)) { group.remove(); groups.delete(key); }
        emptyStatus.textContent = labels.noResultsLabel;
        emptyStatus.hidden = filtered.length !== 0;
        if (preserveViewState) {
            // The saved scroll comes back first; then focus that the update (or caller content above search) moved is
            // revealed wherever it is in the popup, and focus still in view leaves both scroll positions as they were.
            optionsList.scrollTop = scroll;
            if (hadFocus && !visibleValues.has(focusedValue)) focusInView(searchInput);
            else if (hadPopupFocus && active.isConnected) focusInView(active);
        }
    }
    return { renderList, focusOptionAt, focusOptionValue, focusInView };
}
