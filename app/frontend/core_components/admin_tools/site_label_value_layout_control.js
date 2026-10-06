// site_label_value_layout_control.js
// Builds the site-wide field placement selector in the appearance palette.
// Reuses existing language keys and the palette's preview/save/reset lifecycle.
// The experimental card's availability check keeps Automatic development-only.

import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { isExperimentalFreeLayoutAvailable } from '../table_views/experimental_free_layout_card/experimental_free_layout_card_store.js';
import { normalizeLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';

const LAYOUT_COPY = Object.freeze({
    label_value_layout: { fi: 'Kentän otsikon ja arvon asettelu', en: 'Field label and value layout' },
    label_value_layout_stacked: { fi: 'Allekkain', en: 'Stacked' },
    label_value_layout_inline: { fi: 'Rinnakkain', en: 'Side by side' },
    label_value_layout_auto: { fi: 'Automaattinen', en: 'Automatic' },
});

/** Uses the same select structure as the site's style and article caption controls. */
export function buildLabelValueLayoutControl(onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    title.dataset.langKey = 'label_value_layout';
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-label-value-layout';
    const values = ['stacked', 'inline'];
    if (isExperimentalFreeLayoutAvailable()) values.push('auto');
    values.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.dataset.langKey = 'label_value_layout_' + value;
        select.append(option);
    });
    function setCopy() {
        const language = String(document.documentElement.lang || getLanguageWithBrowserFallback())
            .toLowerCase().split('-')[0];
        const text = key => {
            const fallback = LAYOUT_COPY[key][language] || LAYOUT_COPY[key].en;
            const translated = getTranslationForKey(key, { fallback });
            return translated === key ? fallback : translated;
        };
        title.textContent = text('label_value_layout');
        select.setAttribute('aria-label', title.textContent);
        [...select.options].forEach(option => { option.textContent = text(option.dataset.langKey); });
    }
    select.addEventListener('change', () => onChange(normalizeLabelValueLayout(select.value)));
    element.append(title, select);
    setCopy();
    return { element, setCopy, setValue(value) { select.value = normalizeLabelValueLayout(value); } };
}
