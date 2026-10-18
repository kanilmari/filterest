// row_group_heading_order_control.js
// Builds the shared category heading order selector in the appearance palette.
// Connects the palette's own translated copy with its preview/save/reset lifecycle.
// Uses a native select so the new preference follows existing keyboard order.

/** Keep the selector and its labels mounted when the palette changes language. */
export function buildRowGroupHeadingOrderControl(copy, onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-row-group-heading-order';
    const choices = [['manual', 'rowGroupHeadingOrderManual'], ['result_count', 'rowGroupHeadingOrderResultCount']].map(([value, key]) => {
        const option = document.createElement('option');
        option.value = value;
        select.append(option);
        return { option, key };
    });
    function setCopy(nextCopy) {
        title.textContent = nextCopy.rowGroupHeadingOrder;
        select.setAttribute('aria-label', nextCopy.rowGroupHeadingOrder);
        choices.forEach(({ option, key }) => { option.textContent = nextCopy[key]; });
    }
    select.addEventListener('change', () => onChange(select.value));
    element.append(title, select);
    setCopy(copy);
    return { element, setCopy, setValue(value) { select.value = value; } };
}
