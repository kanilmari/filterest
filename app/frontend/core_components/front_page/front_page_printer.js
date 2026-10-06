// front_page_printer.js
// Presents the session's newest readable rows in compact dataset blocks.
// Reuses the shared group renderer, translations and dataset-background treatment.
// Discards all content on deactivation; no account's blocks survive a hidden visit.

import { getOrCreateContainer } from '../../reusable_components/dom_container_builder.js';
import { hasContentBesideLoadingIndicator } from '../../reusable_components/loading/loading_indicator_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { createSupplementalDatasetGroup } from '../table_views/compact_dataset_group.js';
import { encodeCssUrlValue } from '../table_views/storage_media_urls.js';
import { formatSiteNameForDisplay } from '../state_stores/site_identity_reader.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getSessionGeneration, acceptSessionIdentity, isSessionValidationRequired,
    revalidateSessionIdentity, subscribeToSessionGeneration } from '../auth/session_generation_store.js';

const FRONT_PAGE_TIMEOUT_MS = 15000;
const visits = new WeakMap();

function translatedElement(tag, key) {
    const element = document.createElement(tag);
    bindDatasetLanguageRenderer(element, () => {
        element.textContent = getTranslationForKey(key, { countUsage: false });
    });
    return element;
}

function createBackground(background) {
    const match = background?.storage_key?.match(/^site_media\/front_page\/original\/([^/]+)$/);
    if (!match) return null;
    const layer = document.createElement('div');
    layer.className = 'front-page-background';
    layer.setAttribute('aria-hidden', 'true');
    for (const variant of ['1000', '2160']) {
        layer.style.setProperty(`--front-page-background-${variant}`,
            encodeCssUrlValue(`/storage/site_media/front_page/${variant}/${match[1]}`));
    }
    layer.style.backgroundPosition = `${background.focal_x * 100}% ${background.focal_y * 100}%`;
    return layer;
}

function renderBlocks(container, data) {
    const page = document.createElement('div');
    page.className = 'front-page-content';
    const heading = translatedElement('h1', 'front_page');
    const siteName = formatSiteNameForDisplay(data.site_name);
    if (siteName) {
        bindDatasetLanguageRenderer(heading, () => { heading.textContent = siteName; });
    }
    page.append(heading);
    const grid = document.createElement('div');
    grid.className = 'front-page-blocks';
    for (const block of data.blocks || []) {
        const group = createSupplementalDatasetGroup({
            dataset: block.dataset, text: block.dataset, langKey: block.dataset,
        }, '', {
            rowCap: block.result_limit,
            headingTag: 'h2',
            preselectArticle: true,
            showAllKey: 'front_page_show_all', emptyKey: 'front_page_no_results',
            replacementParams: { sort_column: '__newest', sort_order: 'DESC', view: 'card' },
        });
        group.render(block.data || [], block.columns || [], block.types || {});
        grid.append(group.element);
    }
    if (!grid.hasChildNodes()) grid.append(translatedElement('p', 'front_page_no_results'));
    page.append(grid);
    const background = createBackground(data.background);
    container.replaceChildren(...(background ? [background] : []), page);
}

/** Starts one bounded request for this visit and owns its render generation. */
function loadVisit(container, visit) {
    if (visit.pending) return visit.pending;
    const generation = ++visit.generation;
    const sessionGeneration = getSessionGeneration();
    container.dataset.sessionGeneration = String(sessionGeneration);
    const controller = new AbortController();
    visit.controller = controller;
    container.setAttribute('aria-busy', 'true');
    const skeleton = document.createElement('div');
    skeleton.className = 'front-page-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    const status = document.createElement('div');
    status.className = 'front-page-status';
    status.setAttribute('aria-live', 'polite');
    container.replaceChildren(skeleton, status);
    const isCurrent = () => visit.generation === generation && container.isConnected
        && sessionGeneration === getSessionGeneration();
    let timeout;
    const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('front_page_timeout'));
        }, FRONT_PAGE_TIMEOUT_MS);
        visit.cancel = () => {
            clearTimeout(timeout);
            controller.abort();
            reject(new DOMException('Home visit ended', 'AbortError'));
        };
    });
    const request = () => {
        if (!isCurrent()) throw new DOMException('Session changed', 'AbortError');
        return endpoint_router('frontPage', { signal: controller.signal, suppressErrorToast: true,
            url_params: new URLSearchParams({ lang: getLanguageWithBrowserFallback() }).toString() });
    };
    visit.pending = Promise.race([
        isSessionValidationRequired() ? revalidateSessionIdentity().then(request) : request(), deadline,
    ]).then(data => {
        if (isCurrent() && acceptSessionIdentity(data.viewer_id, sessionGeneration)) renderBlocks(container, data);
    }).catch(() => {
        if (!isCurrent()) return;
        skeleton.remove();
        status.append(translatedElement('p', 'front_page_load_failed'));
        const retry = translatedElement('button', 'shell_boot_reload');
        retry.type = 'button';
        retry.addEventListener('click', () => { void loadVisit(container, visit); });
        status.append(retry);
    }).finally(() => {
        clearTimeout(timeout);
        if (!isCurrent()) return;
        container.setAttribute('aria-busy', 'false');
        visit.pending = null;
        visit.controller = null;
        visit.cancel = null;
    });
    return visit.pending;
}

/** The navigation loader returns the skeleton immediately, so leaving it never
 * waits on the network or lets an old navigation re-show a hidden page.
 */
export function renderFrontPage() {
    const container = getOrCreateContainer('front_page_container');
    container.classList.add('front-page', 'tab-content-area--has-dataset-background');
    let visit = visits.get(container);
    if (!visit) {
        visit = { generation: 0, pending: null, controller: null };
        visits.set(container, visit);
        const deactivateVisit = () => {
            visit.generation += 1;
            visit.cancel?.();
            visit.cancel = null;
            visit.controller = null;
            visit.pending = null;
            container.replaceChildren();
            container.removeAttribute('aria-busy');
        };
        const unsubscribe = subscribeToSessionGeneration(reason => {
            deactivateVisit();
            if (reason === 'resume' && container.isConnected && !container.classList.contains('hidden')) {
                void loadVisit(container, visit);
            }
        });
        let ended = false;
        // Navigation cleans every mounted container, including retained Home.
        // A later visit must recreate both its listener and session subscription.
        const endVisit = () => {
            if (ended) return;
            ended = true;
            deactivateVisit();
            unsubscribe();
            container.removeEventListener(VIEW_DEACTIVATE_EVENT, deactivateVisit);
            visits.delete(container);
            delete container.__cleanupListeners;
        };
        container.__cleanupListeners = endVisit;
        container.addEventListener(VIEW_DEACTIVATE_EVENT, deactivateVisit);
    }
    // Navigation's spinner may already be inside the emptied container.
    if (!hasContentBesideLoadingIndicator(container)) void loadVisit(container, visit);
    return container;
}
