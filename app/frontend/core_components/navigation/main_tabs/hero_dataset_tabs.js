// Shows the accepted main dataset tabs inside the scrolling dataset hero.
// Reads the shared main-tab model; it owns no permission, ordering or URL state.
// Uses ordinary navigation buttons so navbar-only SVG geometry remains isolated.

import { getMainDatasetTabs, subscribeMainDatasetTabs } from './main_dataset_tabs.js';
import { openNavTab } from './main_tab_printer.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { createSymbolMaskElement } from '../../../reusable_components/symbol_asset_resolver.js';

const NAV_LABELS = Object.freeze({
    fi: 'Aineistot',
    en: 'Datasets',
    ch: '数据集',
    yue: '資料集',
});

function navigationLabel() {
    const language = String(document.documentElement.lang || getLanguageWithBrowserFallback()).toLowerCase();
    const key = language.startsWith('zh-hk') || language.startsWith('zh-hant') ? 'yue'
        : language.startsWith('zh') ? 'ch' : language.split('-')[0];
    return NAV_LABELS[key] || NAV_LABELS.en;
}

/** Build one view-scoped projection of the latest accepted main-tab snapshot. */
export function createHeroDatasetTabs(activeDataset) {
    const element = document.createElement('nav');
    element.className = 'hero-dataset-tabs';
    element.dataset.testid = 'hero-dataset-tabs';
    const entries = new Map();
    let destroyed = false;
    let navigating = false;

    function updateCopy() {
        if (destroyed) return;
        element.setAttribute('aria-label', navigationLabel());
        for (const { button, label, tab } of entries.values()) {
            const fallback = String(tab.text || tab.dataset);
            const text = getTranslationForKey(tab.langKey, { fallback, countUsage: false });
            label.textContent = text;
            button.title = text;
        }
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
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'hero-dataset-tabs__button';
                button.dataset.dataset = dataset;
                button.dataset.testid = 'hero-dataset-tab';
                const label = document.createElement('span');
                label.className = 'hero-dataset-tabs__label';
                button.appendChild(label);
                entry = { button, label, tab, icon: null, iconKey: null };
                entries.set(dataset, entry);
            }
            entry.tab = tab;
            const iconKey = tab.iconKey || 'table';
            if (iconKey !== entry.iconKey) {
                entry.icon?.remove();
                entry.icon = createSymbolMaskElement(iconKey, 'hero-dataset-tabs__icon');
                entry.iconKey = iconKey;
                entry.button.prepend(entry.icon);
            }
            if (dataset === activeDataset) entry.button.setAttribute('aria-current', 'page');
            else entry.button.removeAttribute('aria-current');
            // Reuse existing buttons when order changes, including the focused one.
            element.appendChild(entry.button);
        }
        for (const [dataset, entry] of entries) {
            if (present.has(dataset)) continue;
            entry.button.remove();
            entries.delete(dataset);
        }
        element.hidden = entries.size === 0;
        updateCopy();
        if (focused?.isConnected && element.contains(focused) && document.activeElement !== focused) {
            focused.focus({ preventScroll: true });
        }
    }

    async function navigate(event) {
        const button = event.target.closest?.('.hero-dataset-tabs__button');
        if (destroyed || navigating || !button || !element.contains(button)) return;
        const entry = entries.get(button.dataset.dataset);
        if (entry?.button !== button) return;
        event.preventDefault();
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
    const languageObserver = new MutationObserver(updateCopy);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    return {
        element,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            unsubscribe();
            languageObserver.disconnect();
            element.removeEventListener('click', navigate);
            entries.clear();
            element.remove();
        },
    };
}
