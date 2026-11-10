// row_article_presentation_control.js
// Edits the row opening default in the site and dataset appearance scopes.
// An inherited selection can be pinned to the same presentation as the site.
import { getRowPresentationLabel, ROW_PRESENTATIONS } from '../table_views/row_presentation/row_presentation_choice.js';
import { getTranslationForKey } from '../lang/translation_handler.js';

export function buildRowArticlePresentationControl(copy, onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    title.dataset.langKey = 'row_article_default_presentation';
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-row-article-default';
    const inherited = document.createElement('option');
    inherited.value = '';
    inherited.disabled = true;
    select.append(inherited);
    const options = ROW_PRESENTATIONS.map(({ viewKey }) => {
        const option = document.createElement('option');
        option.value = viewKey;
        select.append(option);
        return option;
    });
    function setCopy(nextCopy) {
        copy = nextCopy;
        title.textContent = getTranslationForKey(title.dataset.langKey, { fallback: copy.rowOpening });
        for (const option of options) option.textContent = getRowPresentationLabel(option.value);
    }
    function setValue(value, inherits) {
        inherited.hidden = !inherits;
        if (inherits) inherited.textContent = copy.inherited + ' (' + getRowPresentationLabel(value) + ')';
        select.value = inherits ? '' : value;
    }
    select.addEventListener('change', () => onChange(select.value));
    element.append(title, select);
    setCopy(copy);
    return { element, setValue, setCopy };
}
