// chart_unavailable_notice.js
// Explains an unsuitable chart address above the permitted fallback view.
// Connects the common chart fit rule with existing view selectors and permissions.
// Gives readers a useful destination rather than an empty unsupported chart.
import { getDatasetViewSelectorOptions, getDatasetViewPermissionRoute } from '../dataset_view_registry.js';
import { createGenericViewSelector } from '../view_selector_printer.js';
import { hasRoutePermission } from '../../route_permission_checker.js';
import { getTranslationForKey } from '../../lang/component_language_dictionary.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { chartFallback } from './chart_copy.js';

export function createChartUnavailableNotice(dataset, currentView, columns, dataTypes) {
    const notice = document.createElement('section');
    notice.className = 'price-chart-view';
    notice.dataset.testid = 'chart-unavailable';
    notice.setAttribute('role', 'status');
    for (const [tag, key] of [['h2', 'chart_unavailable_title'], ['p', 'chart_unavailable_body']]) {
        const text = document.createElement(tag);
        text.dataset.langKey = key;
        if (tag === "h2") text.classList.add("chart-unavailable-title");
        text.textContent = getTranslationForKey(key, { fallback: chartFallback(key, getLanguageWithBrowserFallback()) });
        notice.appendChild(text);
    }
    const context = { datasetName: dataset, columns, dataTypes };
    const allowed = ['direct', 'more'].flatMap(group => getDatasetViewSelectorOptions(group, context))
        .filter(option => {
            const route = getDatasetViewPermissionRoute(option.viewKey);
            return !route || hasRoutePermission(route);
        });
    notice.appendChild(createGenericViewSelector(dataset, currentView, allowed, [], { includeHeading: false }));
    return notice;
}
