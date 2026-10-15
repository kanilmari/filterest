// table_header_sort.js
// Displays the primary sort independently of the user's chosen semantic mode.
// Connects get-results effective_sort metadata to header marks and translated labels.
// Keeps SQL fallback policy on the server and header click cycling on chosen state.
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../dataset_value_localizer.js';

// Keep the dropdown's existing keys visible to the startup language-key scanner.
const NEWEST_LABEL_LANG_KEY = 'sort_newest';
const OLDEST_LABEL_LANG_KEY = 'sort_oldest';

/** Paint one primary direction; a missing server resolution never guesses a column. */
export function applyTableHeaderSort(header, indicator, column, chosenSort, effectiveSort) {
    const newest = chosenSort?.column === '__newest';
    const primarySort = newest ? effectiveSort : chosenSort;
    const direction = primarySort?.column === column ? primarySort.direction : null;
    indicator.textContent = direction === 'ASC' ? '▲' : direction === 'DESC' ? '▼' : '⇵';

    // Reused headers must lose the previous sort's direction and semantic name.
    header.removeAttribute('aria-sort');
    header.removeAttribute('aria-label');
    delete header.dataset.ariaLabelLangKey;
    delete header.dataset.ariaLabelLangContext;
    indicator.removeAttribute('title');
    delete indicator.dataset.titleLangKey;
    delete indicator.dataset.titleLangContext;
    if (direction !== 'ASC' && direction !== 'DESC') return;

    header.setAttribute('aria-sort', direction === 'ASC' ? 'ascending' : 'descending');
    if (!newest) return;

    const oldest = chosenSort.direction === 'ASC';
    const labelKey = oldest ? OLDEST_LABEL_LANG_KEY : NEWEST_LABEL_LANG_KEY;
    indicator.dataset.titleLangKey = labelKey;
    header.dataset.ariaLabelLangKey = labelKey;
    indicator.dataset.titleLangContext = column;
    header.dataset.ariaLabelLangContext = column;
    bindDatasetLanguageRenderer(header, language => {
        // A later repaint can clear the name while this renderer remains registered.
        if (header.dataset.ariaLabelLangKey !== labelKey) return;
        const label = `${getTranslationForKey(labelKey, { fallback: oldest ? 'Oldest' : 'Newest', language })}: ${column}`;
        indicator.title = label;
        header.setAttribute('aria-label', label);
    });
}
