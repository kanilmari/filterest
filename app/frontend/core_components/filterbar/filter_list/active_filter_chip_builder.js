// active_filter_chip_builder.js
// Builds the shared selected-filter chip and applies its logical remove side.
// Connects search, ordinary filters and categories with public presentation state.
// Keeps markup and interaction identical while label and removal owners stay separate.

// Server twin: backend/core_components/system_table_tools/site_presentation_settings.go.
// Both sides verify testing/shared_contracts/active_filter_remove_side.json.
export const ACTIVE_FILTER_REMOVE_SIDES = Object.freeze(['start', 'end']);

/** Reorder the non-interactive label so the existing remove button keeps focus. */
function applyChipRemoveSide(item, side) {
    const label = item.querySelector(':scope > .active-filter-label');
    const button = item.querySelector(':scope > .remove-active-filter');
    if (!label || !button) return;
    item.dataset.removeSide = side;
    if (side === 'start' && item.firstElementChild !== button) item.appendChild(label);
    if (side === 'end' && item.firstElementChild !== label) item.insertBefore(label, button);
}

/** Apply previews and saved values to existing chips without refreshing filters. */
export function applyActiveFilterRemoveSide(value) {
    if (typeof document === 'undefined') return;
    const side = ACTIVE_FILTER_REMOVE_SIDES.includes(value) ? value : 'start';
    document.documentElement.dataset.activeFilterRemoveSide = side;
    document.querySelectorAll('.active_filters .active-filter-item').forEach(item => applyChipRemoveSide(item, side));
}

/** Owners supply formatted labels and commands, then bind their translated aria label. */
export function buildActiveFilterChip({ label, onRemove, exclude = false }) {
    const item = document.createElement('div');
    item.className = 'active-filter-item';
    item.classList.toggle('active-filter-item--exclude', exclude);
    item.dataset.testid = 'active-filter-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-active-filter';
    button.dataset.testid = 'active-filter-remove';
    button.textContent = '×';
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void onRemove();
    });
    label.classList.add('active-filter-label');
    item.append(button, label);
    applyChipRemoveSide(item, document.documentElement.dataset.activeFilterRemoveSide === 'end' ? 'end' : 'start');
    return { item, button };
}
