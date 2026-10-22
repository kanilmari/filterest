// front_page_printer.js
// Presents the session's newest readable rows in compact dataset blocks.
// Reuses the shared group renderer, translations and dataset-background treatment.
// Discards all content on deactivation; no account's blocks survive a hidden visit.

import { applyHomePresentation, applyHomeMediaPresentation } from './front_page_presentation_renderer.js';
import { renderHomeHeroText } from './front_page_text_style_renderer.js';
import { readHomePresentation } from '../../shared/front_page_presentation/validator.js';
import { createFrontPageTopRow } from './front_page_top_row_builder.js';
import { loadFrontPageNavigationLanguage } from './front_page_link.js';
import { mountFrontPagePhoneLayout } from './front_page_phone_layout.js';
import { loadCustomRoot } from './custom_root_navigation.js';
import { createFrontPageArticleButtons } from './front_page_article_buttons.js';
import { mountBackgroundVideo } from './front_page_background_video.js';
import { getOrCreateContainer } from '../../reusable_components/dom_container_builder.js';
import { hasContentBesideLoadingIndicator } from '../../reusable_components/loading/loading_indicator_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { createSupplementalDatasetGroup } from '../table_views/compact_dataset_group.js';
import { encodeCssUrlValue } from '../table_views/storage_media_urls.js';
import { formatSiteNameForDisplay, getCurrentSiteName } from '../state_stores/site_identity_reader.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getSessionGeneration, acceptSessionIdentity, isSessionValidationRequired,
    revalidateSessionIdentity, subscribeToSessionGeneration } from '../auth/session_generation_store.js';
import { beginFrontPageAvailabilityRequest, isSeparateFrontPageEnabled,
    setFrontPageAvailability } from './front_page_availability.js';
import { isLeavingNetworkAbort } from '../error_and_status_handling/request_failure_notice.js';

const FRONT_PAGE_TIMEOUT_MS = 15000;
const NAVIGATION_LANGUAGE_WAIT_MS = 3000;
const visits = new WeakMap();

function isHomeUnavailable(error) {
    if (error?.status !== 404 || typeof error.responseBody !== 'string') return false;
    try { return JSON.parse(error.responseBody)?.error === 'front page unavailable'; }
    catch { return error.responseBody.trim() === 'front page unavailable'; }
}

function translatedElement(tag, key) {
    const element = document.createElement(tag);
    bindDatasetLanguageRenderer(element, () => {
        element.textContent = getTranslationForKey(key, { countUsage: false });
    });
    return element;
}

function createBackground(background, visit) {
    const match = background?.storage_key?.match(/^site_media\/front_page\/original\/([^/]+)$/);
    if (!match) return null;
    const layer = document.createElement('div');
    layer.className = 'front-page-background';
    layer.setAttribute('aria-hidden', 'true');
    if (background.mime_type?.startsWith('video/')) {
        visit.backgroundCleanup = mountBackgroundVideo(layer,
            `/storage/site_media/front_page/original/${encodeURIComponent(match[1])}`,
            `${background.focal_x * 100}% ${background.focal_y * 100}%`);
        return layer;
    }
    for (const variant of ['1000', '2160']) {
        layer.style.setProperty(`--front-page-background-${variant}`,
            encodeCssUrlValue(`/storage/site_media/front_page/${variant}/${match[1]}`));
    }
    layer.style.backgroundPosition = `${background.focal_x * 100}% ${background.focal_y * 100}%`;
    return layer;
}

function renderBlocks(container, data, visit) {
    const page = document.createElement('div');
    page.className = 'front-page-content';
    const hero = document.createElement('header');
    hero.className = 'front-page-hero morphing-header';
    const heading = document.createElement('h1');
    heading.className = 'morphing-title';
    const slogan = document.createElement('div');
    slogan.className = 'front-page-slogan morphing-subtitle';
    const description = document.createElement('div');
    description.className = 'front-page-description';
    const stage = document.createElement('div');
    let presentation = readHomePresentation(data.presentation);
    let renderedLanguage;
    function renderText() {
        const code = renderedLanguage === 'fi' ? 'fi' : 'en';
        visit.textCleanup?.();
        visit.textCleanup = renderHomeHeroText({ hero, heading, slogan, description, language: code,
            title: data.hero?.title?.[code]?.trim()
                || formatSiteNameForDisplay(data.site_name || getCurrentSiteName())
                || getTranslationForKey('front_page', { countUsage: false }),
            accent: data.hero?.slogan?.[code] || '', text: data.hero?.description?.[code] || '',
            textStyle: presentation.text_style });
    }
    hero.append(heading, slogan, description);
    const articleButtons = createFrontPageArticleButtons(data.article_buttons);
    if (articleButtons && data.article_buttons_placement === 'below_text') hero.append(articleButtons);
    stage.append(hero);
    page.append(stage);
    const grid = document.createElement('div');
    grid.className = 'front-page-blocks';
    for (const block of (data.show_blocks === false ? [] : data.blocks || [])) {
        const group = createSupplementalDatasetGroup({
            dataset: block.dataset, text: block.dataset, langKey: block.dataset,
        }, '', {
            rowCap: block.result_limit,
            headingTag: 'h2',
            preselectArticle: true,
            includeThumbnails: true,
            showAllKey: 'front_page_show_all', emptyKey: 'front_page_no_results',
            replacementParams: { sort_column: '__newest', sort_order: 'DESC', view: 'card' },
        });
        group.render(block.data || [], block.columns || [], block.types || {});
        grid.append(group.element);
    }
    // A Home without boxes shows no box area at all; an empty box still says so inside itself.
    if (grid.hasChildNodes()) page.append(grid);
    const scroller = document.createElement('div');
    scroller.className = 'front-page-scroller scrollable_content';
    scroller.append(page);
    function renderPresentation(value) {
        presentation = readHomePresentation(value);
        applyHomePresentation(page, scroller, stage, hero, value);
        applyHomeMediaPresentation(container, value);
        if (renderedLanguage) renderText();
    }
    renderPresentation(data.presentation);
    bindDatasetLanguageRenderer(hero, language => {
        renderedLanguage = language;
        renderText();
    });
    visit.topRow = createFrontPageTopRow(data.site_name, () => refreshFrontPage(), {
        snapshot: data, render: renderPresentation,
    }, { language: visit.language });
    if (articleButtons && data.article_buttons_placement === 'top_row') {
        visit.topRow.element.querySelector('.hero-dataset-tabs')?.after(articleButtons);
    }
    const background = createBackground(data.background, visit);
    container.replaceChildren(...(background ? [background] : []), visit.topRow.element, scroller);
    visit.topRow.mount();
    visit.phoneLayout = mountFrontPagePhoneLayout(visit.topRow.element, scroller);
}

/** Starts one bounded request for this visit and owns its render generation. */
function loadVisit(container, visit) {
    if (visit.pending) return visit.pending;
    visit.phoneLayout?.destroy();
    visit.phoneLayout = null;
    visit.topRow?.destroy();
    visit.topRow = null;
    visit.textCleanup?.();
    visit.textCleanup = null;
    visit.backgroundCleanup?.();
    visit.backgroundCleanup = null;
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
    let homeRevision;
    let retryWithNewerPolicy = false;
    let retryAfterLeave = false;
    const request = () => {
        if (!isCurrent()) throw new DOMException('Session changed', 'AbortError');
        visit.language = getLanguageWithBrowserFallback();
        homeRevision = beginFrontPageAvailabilityRequest();
        // Resolve navigation copy during the content read, rather than painting
        // formatted keys and waiting for main.js's later whole-page translation.
        // A slow dictionary waits at most 3 s; Home then paints and relabels later.
        return Promise.all([
            endpoint_router('frontPage', { signal: controller.signal, suppressErrorToast: true,
                url_params: new URLSearchParams({ lang: visit.language }).toString() }),
            Promise.race([loadFrontPageNavigationLanguage(visit.language),
                new Promise(resolve => { setTimeout(resolve, NAVIGATION_LANGUAGE_WAIT_MS); })]),
        ]).then(([data]) => data);
    };
    visit.pending = Promise.race([
        isSessionValidationRequired() ? revalidateSessionIdentity().then(request) : request(), deadline,
    ]).then(data => {
        visit.leaveRetried = false;
        if (isCurrent() && acceptSessionIdentity(data.viewer_id, sessionGeneration)) renderBlocks(container, data, visit);
    }).catch(async error => {
        if (!isCurrent()) return;
        // The endpoint's explicit disabled response is policy, not a failed visit.
        // Other 404s, server errors and timeouts retain the existing retry surface.
        if (isHomeUnavailable(error)) {
            // Reject obsolete policy writes without leaving the current visit unsettled.
            // Only confirmed enabled policy keeps Home; fetch content again after releasing this request.
            if (!setFrontPageAvailability({}, homeRevision) && isSeparateFrontPageEnabled()) {
                retryWithNewerPolicy = true;
                return;
            }
            container.replaceChildren();
            const { openNormalStartView } = await import('./front_page_navigation.js');
            if (isCurrent()) await openNormalStartView({ isCurrentNavigation: isCurrent });
            return;
        }
        // A leave the browser then cancelled (Back, then Forward at once) stopped this request while the page stayed:
        // load once more instead of reporting a failure.
        if (isLeavingNetworkAbort(error) && !visit.leaveRetried) {
            visit.leaveRetried = true;
            retryAfterLeave = true;
            return;
        }
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
        if (retryWithNewerPolicy || retryAfterLeave) return loadVisit(container, visit);
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
        const isVisible = () => container.isConnected && !container.classList.contains('hidden');
        // Every session notice starts a new generation, so a load still in flight is stale.
        const cancelPending = () => {
            visit.generation += 1;
            visit.cancel?.();
            visit.cancel = null;
            visit.controller = null;
            visit.pending = null;
        };
        const deactivateVisit = () => {
            cancelPending();
            visit.phoneLayout?.destroy();
            visit.phoneLayout = null;
            visit.topRow?.destroy();
            visit.topRow = null;
            visit.textCleanup?.();
            visit.textCleanup = null;
            visit.backgroundCleanup?.();
            visit.backgroundCleanup = null;
            container.replaceChildren();
            container.removeAttribute('aria-busy');
        };
        const unsubscribe = subscribeToSessionGeneration(reason => {
            // Losing or regaining window focus is not a session change, and the page
            // stayed in view: keep the blocks it shows (owner 7.10.2026: they used to
            // vanish whenever the address bar or another window took focus). A load the
            // notice made stale starts again at once.
            if (reason === 'blur' || reason === 'focus') {
                const rendered = Boolean(container.querySelector('.front-page-scroller'));
                cancelPending();
                if (rendered) container.dataset.sessionGeneration = String(getSessionGeneration());
                else if (isVisible()) void loadVisit(container, visit);
                return;
            }
            // A hidden or restored page, a sign-in or a sign-out may now belong to another
            // viewer: clear it until the server confirms who is browsing (WL143).
            deactivateVisit();
            if ((reason === 'resume' || reason === 'restore') && isVisible()) void loadVisit(container, visit);
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
        // Labels are resolved by the server. A language change invalidates even
        // an in-flight read and refreshes all visible Home content together.
        bindDatasetLanguageRenderer(container, language => {
            if (!isVisible() || !visit.language || visit.language === language) return;
            cancelPending();
            return loadVisit(container, visit);
        });
    }
    // Navigation's spinner may already be inside the emptied container.
    if (!hasContentBesideLoadingIndicator(container)) void loadVisit(container, visit);
    return container;
}

/** Refresh visible Home after settings save, or replace it with the newly enabled custom document. */
export async function refreshFrontPage() {
    if (window.location.pathname === '/' && await loadCustomRoot({ replace: true })) return;
    const container = document.getElementById('front_page_container');
    const visit = container && visits.get(container);
    if (!visit || container.classList.contains('hidden')) return Promise.resolve();
    return loadVisit(container, visit);
}
