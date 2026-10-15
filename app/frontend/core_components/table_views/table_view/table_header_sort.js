// table_header_sort.js
// Displays the primary sort independently of the user's chosen semantic mode.
// Connects get-results effective_sort metadata to header marks and translated labels.
// Keeps SQL fallback policy on the server and header click cycling on chosen state.
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../dataset_value_localizer.js';

// Keep the dropdown's existing key visible to the startup language-key scanner.
const NEWEST_LABEL_LANG_KEY = 'sort_newest';

/** Paint one primary direction; a missing server resolution never guesses a column. */
export function applyTableHeaderSort(header, indicator, column, chosenSort, effectiveSort) {
    const newest = chosenSort?.column === '__newest';
    const primarySort = newest ? effectiveSort : chosenSort;
    const direction = primarySort?.column === column ? primarySort.direction : null;
    indicator.textContent = direction === 'ASC' ? '▲' : direction === 'DESC' ? '▼' : '⇵';
    if (!newest || direction !== 'DESC') return;

    header.setAttribute('aria-sort', 'descending');
    indicator.dataset.titleLangKey = NEWEST_LABEL_LANG_KEY;
    header.dataset.ariaLabelLangKey = NEWEST_LABEL_LANG_KEY;
    indicator.dataset.titleLangContext = column;
    header.dataset.ariaLabelLangContext = column;
    bindDatasetLanguageRenderer(header, language => {
        const label = `${getTranslationForKey(NEWEST_LABEL_LANG_KEY, { fallback: 'Newest', language })}: ${column}`;
        indicator.title = label;
        header.setAttribute('aria-label', label);
    });
}
