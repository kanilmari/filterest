// active_filter_remove_side_control.js
// Builds the shared selected-chip remove-side selector in the appearance palette.
// Connects the palette's own translated copy with its preview/save/reset lifecycle.
// Logical before/after choices follow the language's reading direction.

/** Keep the selector and its labels mounted when the palette changes language. */
export function buildActiveFilterRemoveSideControl(copy, onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-active-filter-remove-side';
    const choices = [['start', 'activeFilterRemoveBefore'], ['end', 'activeFilterRemoveAfter']].map(([value, key]) => {
        const option = document.createElement('option');
        option.value = value;
        select.append(option);
        return { option, key };
    });
    function setCopy(nextCopy) {
        title.textContent = nextCopy.activeFilterRemoveSide;
        select.setAttribute('aria-label', nextCopy.activeFilterRemoveSide);
        choices.forEach(({ option, key }) => { option.textContent = nextCopy[key]; });
    }
    select.addEventListener('change', () => onChange(select.value));
    element.append(title, select);
    setCopy(copy);
    return { element, setCopy, setValue(value) { select.value = value; } };
}
