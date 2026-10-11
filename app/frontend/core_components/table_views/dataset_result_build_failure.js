// dataset_result_build_failure.js
// Replaces an unsuccessful listing with the existing translated failure notice.
// Connects full-view and searched-card replacement errors with shared controls and retained rows.
// Keeps the chosen filters available without presenting old rows or counts as their results.
import { clearLoadedDatasetRows } from './dataset_loaded_rows.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';
import { showRequestFailureNotice } from '../error_and_status_handling/request_failure_notice.js';

/** Clear stale rows only for the current request; callers retain their freshness guard. */
export function showDatasetResultBuildFailure(tableName, container, error) {
    if (!container?.isConnected) return;
    const controls = document.getElementById(`${tableName}_card_top_controls`);
    const surface = document.createElement('div');
    surface.className = 'dataset-results-surface';
    if (controls) surface.appendChild(controls);
    disposeCardResources(container);
    clearLoadedDatasetRows(container);
    container.replaceChildren(surface);
    // A failed build has no committed row count. Zero would falsely claim a
    // successful empty listing, so clear the old count instead. Keep its host
    // for the ordinary count printer to fill when a later retry succeeds.
    document.querySelectorAll(`#${tableName}_results_count, [data-results-count-for="${tableName}"]`)
        .forEach(count => { count.replaceChildren(); delete count.dataset.resultCount; });
    const notice = showRequestFailureNotice(error?.failureNotice?.langKey || 'request_failed_notice', {
        status: error?.failureNotice?.status,
    });
    // Keep the same keyed notice on the results surface after the toast expires.
    const explanation = notice.element.querySelector('.toast-notification-text').cloneNode(true);
    explanation.className = 'dataset-results-error';
    explanation.setAttribute('role', 'alert');
    surface.appendChild(explanation);
    container.style.display = 'block';
}
