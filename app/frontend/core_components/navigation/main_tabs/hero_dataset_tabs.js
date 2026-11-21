// hero_dataset_tabs.js
// Shows the accepted main dataset tabs inside the scrolling dataset hero.
// Reads the shared main-tab model; it owns no permission, ordering or URL state.
// Uses ordinary links so navbar-only SVG geometry remains isolated: search engines
// follow them and a person can open a dataset in a new tab, while an ordinary
// click still opens it in place.

import { getMainDatasetTabs, subscribeMainDatasetTabs } from './main_dataset_tabs.js';
import { openNavTab } from './main_tab_printer.js';
import { buildDatasetPath } from '../nav_engine/dataset_aliases.js';
import { DATASET_PREFIX } from '../nav_engine/query_params.js';
import { asksBrowserToOpenElsewhere, bindLiveLinkAddress, withAddressLanguage } from '../nav_engine/live_link_address.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { createSymbolMaskElement } from '../../../reusable_components/symbol_asset_resolver.js';
import { createNavigationFitController } from './navigation_fit_controller.js';

const NAV_LABELS = Object.freeze({
    fi: 'Aineistot',
    en: 'Datasets',
    ch: '数据集',
    yue: '資料集',
});

function navigationLabel(code) {
    const language = String(code || document.documentElement.lang || getLanguageWithBrowserFallback()).toLowerCase();
    const key = language.startsWith('zh-hk') || language.startsWith('zh-hant') ? 'yue'
        : language.startsWith('zh') ? 'ch' : language.split('-')[0];
    return NAV_LABELS[key] || NAV_LABELS.en;
}

/** Build one view-scoped projection of the latest accepted main-tab snapshot. */
export function createHeroDatasetTabs(activeDataset, { language } = {}) {
    const element = document.createElement('nav');
    element.className = 'hero-dataset-tabs';
    element.dataset.testid = 'hero-dataset-tabs';
    const entries = new Map();
    let destroyed = false;
    let navigating = false;
    const fit = createNavigationFitController(element);

    function updateCopy() {
        if (destroyed) return;
        element.setAttribute('aria-label', navigationLabel(language));
        for (const { link, label, tab } of entries.values()) {
            const fallback = String(tab.text || tab.dataset);
            const text = getTranslationForKey(tab.langKey, { fallback, countUsage: false, language });
            if (label.textContent !== text) label.textContent = text;
            if (link.title !== text) link.title = text;
        }
        fit.sync();
    }

    function render(snapshot) {
        if (destroyed) return;
        const focused = element.contains(document.activeElement) ? document.activeElement : null;
        const present = new Set();
        for (const tab of snapshot) {
            const dataset = String(tab.dataset || '').trim();
            if (!dataset || present.has(dataset)) continue;
            present.add(dataset);
            let entry = entries.get(dataset);
            if (!entry) {
                const link = document.createElement('a');
                link.className = 'hero-dataset-tabs__button';
                link.dataset.dataset = dataset;
                link.dataset.testid = 'hero-dataset-tab';
                // The dataset's public address, kept current when its alias changes.
                bindLiveLinkAddress(link, () => withAddressLanguage(buildDatasetPath(dataset, DATASET_PREFIX)));
                const label = document.createElement('span');
                label.className = 'hero-dataset-tabs__label';
                link.appendChild(label);
                entry = { link, label, tab, icon: null, iconKey: null };
                entries.set(dataset, entry);
            }
            entry.tab = tab;
            const iconKey = tab.iconKey || 'table';
            if (iconKey !== entry.iconKey) {
                entry.icon?.remove();
                entry.icon = createSymbolMaskElement(iconKey, 'hero-dataset-tabs__icon');
                entry.iconKey = iconKey;
                entry.link.prepend(entry.icon);
            }
            if (dataset === activeDataset) entry.link.setAttribute('aria-current', 'page');
            else entry.link.removeAttribute('aria-current');
            // Reuse existing links when order changes, including the focused one.
            element.appendChild(entry.link);
        }
        for (const [dataset, entry] of entries) {
            if (present.has(dataset)) continue;
            entry.link.remove();
            entries.delete(dataset);
        }
        element.hidden = entries.size === 0 && !element.querySelector('.top-nav-home-button');
        updateCopy();
        if (focused?.isConnected && element.contains(focused) && document.activeElement !== focused) {
            focused.focus({ preventScroll: true });
        }
    }

    async function navigate(event) {
        const link = event.target.closest?.('.hero-dataset-tabs__button[data-dataset]');
        if (destroyed || !link || !element.contains(link)) return;
        const entry = entries.get(link.dataset.dataset);
        if (entry?.link !== link) return;
        // Ctrl, Cmd, Shift or Alt asks the browser for a new tab or window.
        if (asksBrowserToOpenElsewhere(event, link)) return;
        // Every ordinary click stays in the application, also one made while
        // an earlier one is still opening: the link must not load a new page.
        event.preventDefault();
        if (navigating) return;
        navigating = true;
        element.setAttribute('aria-busy', 'true');
        try {
            // The shared navigation path owns dirty checks, permissions and active state.
            // Never optimistically select a target that the user may cancel opening.
            await openNavTab(entry.tab.dataset);
        } catch (error) {
            console.warn('Hero dataset navigation failed', error);
        } finally {
            navigating = false;
            if (!destroyed) element.removeAttribute('aria-busy');
        }
    }

    element.addEventListener('click', navigate);
    const unsubscribe = subscribeMainDatasetTabs(render);
    render(getMainDatasetTabs());
    const languageObserver = new MutationObserver(() => {
        language = document.documentElement.lang || getLanguageWithBrowserFallback();
        updateCopy();
    });
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    return {
        element,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            unsubscribe();
            languageObserver.disconnect();
            fit.destroy();
            element.removeEventListener('click', navigate);
            entries.clear();
            element.remove();
        },
    };
}
