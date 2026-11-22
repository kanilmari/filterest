// view_presentation_media_resolver.js
// The one owner of whether the displayed view shows a picture: a dataset's background or cover image, or
// Home's image or video. The side menu draws box-like buttons over a picture and rounded tabs over a uniform
// background (owner 2026-11-21); the frosted bars' wide-screen layer reads the same picture layers.

export const VIEW_PRESENTATION_MEDIA_ATTRIBUTE = 'data-view-has-presentation-media';
// Dispatched by the shell-boot guard when it reveals the page.
const SHELL_BOOT_REVEALED_EVENT = 'filterest-shell-boot-recovered';
const readComputed = (element, pseudo) => window.getComputedStyle(element, pseudo);

// The shell-boot guard keeps the page under visibility: hidden until the chosen language is applied (K522 A), and
// Home is drawn inside that phase. That is the boot overlay, not the view's own state, so it must not hide Home's
// media; the reveal resolves the flag again (cut 9.6.0, G18).
function shellBootPending() {
    return document.documentElement.hasAttribute('data-shell-boot-pending');
}

function isShown(element) {
    if (!element || element.hidden || element.classList.contains('hidden')) return false;
    const style = window.getComputedStyle(element);
    const visibilityHidden = style.visibility === 'hidden' || style.visibility === 'collapse';
    return style.display !== 'none' && (!visibilityHidden || shellBootPending()) && style.opacity !== '0';
}

/** An explicit Home navigation can precede mounting. Layout refreshes use the visible view. */
export function isHomeNavigationView(activeTabId, viewName) {
    return !activeTabId && (viewName === 'front_page'
        || (!viewName && isShown(document.getElementById('front_page_container'))));
}

/**
 * The rule (owner 2026-11-21): the view shows a picture when one of its picture layers is set, not hidden,
 * drawn with some strength in the current theme, not cut away entirely by its mask and not fully covered by its
 * wash. Anything else is a uniform background. Every way of hiding counts the same: the dataset media switch, a
 * hidden element, a theme's visibility switch (opacity 0), an oval mask that keeps nothing and a full wash.
 * An unknown strength counts as drawn.
 * @param {Array<{ set: boolean, hidden?: boolean, opacity?: number|string, mask?: number|string,
 *     wash?: number|string }>} layers
 */
export function showsPicture(layers) {
    return layers.some(({ set, hidden = false, opacity, mask, wash }) => Boolean(set) && !hidden
        && !(Number.parseFloat(opacity) <= 0) && !(Number.parseFloat(mask) <= 0) && !(Number.parseFloat(wash) >= 1));
}

function drawnDatasetView(datasetName) {
    const parts = datasetName ? document.getElementById(`${datasetName}_tab_parts_container`) : null;
    return isShown(parts) && isShown(parts.closest('.content_div')) ? parts : null;
}

/** The dataset view the shell shows, also one without a menu tab (a dataset in a project subfolder). */
function displayedDatasetView() {
    return Array.from(document.querySelectorAll('.content_div:not(.hidden) > [id$="_tab_parts_container"]'))
        .find(parts => isShown(parts) && isShown(parts.closest('.content_div'))) || null;
}

/** How much of the cover its oval mask keeps: the strongest zone, or nothing to subtract when the oval is off. */
function coverMaskStrength(cover) {
    if (cover.getPropertyValue('--dataset-cover-mask-image').trim() === 'none') return undefined;
    const zones = ['center', 'mid', 'edge'].map(zone =>
        Number.parseFloat(cover.getPropertyValue(`--dataset-cover-mask-${zone}-opacity`)));
    return zones.some(Number.isNaN) ? undefined : Math.max(...zones);
}

function readDrawnPictureLayers(parts, computed) {
    const area = parts.querySelector('.tab-content-area');
    const hero = parts.querySelector('.filterbar-inline-hero');
    const cover = hero?.classList.contains('filterbar-inline-hero--has-cover') ? computed(hero) : null;
    return [
        { set: Boolean(area?.classList.contains('tab-content-area--has-dataset-background')),
            hidden: !isShown(area), opacity: area ? computed(area, '::before').opacity : undefined },
        { set: Boolean(cover), hidden: !isShown(hero),
            opacity: cover?.getPropertyValue('--dataset-cover-image-opacity'),
            mask: cover ? coverMaskStrength(cover) : undefined,
            wash: cover?.getPropertyValue('--dataset-cover-overlay-opacity') },
    ];
}

/**
 * A dataset view's picture layers as it draws them. The result builders add the classes only for a set picture
 * whose media switch is on: the background behind the content (dataset_view_printer.js) and the cover in the
 * search hero (filter_bar_builder.js), whose strength, oval mask and wash the dataset's theme settings resolve
 * (dataset_cover_theme.css). A view that is not drawn has no layers.
 */
export function readDatasetPictureLayers(datasetName, computed = readComputed) {
    const parts = drawnDatasetView(datasetName);
    return parts ? readDrawnPictureLayers(parts, computed) : [];
}

/** Home's configured image or video; its opacity and wash resolve in the explicit application theme. */
export function readHomePictureLayers(computed = readComputed) {
    const home = document.getElementById('front_page_container');
    const media = home?.querySelector('.front-page-background');
    if (!media) return [];
    const style = computed(home);
    return [{
        // A paused/reduced-motion video still presents media, including its still frame.
        set: Boolean(media.querySelector('video[src]') || media.style.getPropertyValue('--front-page-background-2160')),
        hidden: !isShown(home) || !isShown(media),
        opacity: style.getPropertyValue('--home-media-opacity'),
        wash: style.getPropertyValue('--home-media-wash'),
    }];
}

// Whether the flag on screen was decided by a dataset view. Between two dataset views the shell shows none, and a
// refresh in that gap keeps the flag, also for a dataset without a menu tab; Home, tools and an empty shell clear it.
let decidedByDatasetView = false;

/**
 * Whether the view to decide shows a picture (`shows`, null while a dataset view is not drawn yet) and whether a
 * dataset view decided it: the active dataset's view, a named view (a dataset without a menu tab; a tool view has
 * none), Home, or, when nothing names the view (a refresh without an active menu tab, e.g. a dataset in a project
 * subfolder), the dataset view the shell shows.
 */
function resolvePictureState(activeTabId, viewName, computed) {
    const fromDataset = parts => ({ shows: showsPicture(readDrawnPictureLayers(parts, computed)), dataset: true });
    if (activeTabId) {
        const parts = drawnDatasetView(activeTabId);
        return parts ? fromDataset(parts) : { shows: null, dataset: true };
    }
    if (viewName && viewName !== 'front_page') {
        const parts = drawnDatasetView(viewName);
        return parts ? fromDataset(parts) : { shows: false, dataset: false };
    }
    if (viewName === 'front_page' || isShown(document.getElementById('front_page_container'))) {
        return { shows: showsPicture(readHomePictureLayers(computed)), dataset: false };
    }
    const parts = displayedDatasetView();
    if (parts) return fromDataset(parts);
    return decidedByDatasetView ? { shows: null, dataset: true } : { shows: false, dataset: false };
}

/** Whether the displayed view shows a picture (see resolvePictureState); a view not drawn yet shows none. */
export function resolveViewHasPresentationMedia(activeTabId = '', viewName = '', computed = readComputed) {
    return resolvePictureState(activeTabId, viewName, computed).shows === true;
}

/**
 * The picture the displayed view paints behind its content, as the view's own layers resolve it
 * (bar_surface_backdrop.js shows it beneath docked frosted bars, WL182). Reads the computed layers
 * rather than restating their strength: a dataset's background ::before, or Home's image ::before
 * and wash ::after in the current theme. Returns null for a Home video, hidden or absent media,
 * and views without a background picture.
 */
export function resolveViewPresentationBackdrop(computed = (element, pseudo) => window.getComputedStyle(element, pseudo)) {
    const home = document.getElementById('front_page_container');
    if (isShown(home)) {
        const media = home.querySelector('.front-page-background');
        if (!resolveViewHasPresentationMedia('', 'front_page') || media.querySelector('video')) return null;
        const picture = computed(media, '::before');
        const wash = computed(media, '::after');
        return readBackdrop(picture, { washColor: wash.backgroundColor, wash: wash.opacity });
    }
    const area = Array.from(document.querySelectorAll(
        '.content_div:not(.hidden) .tab-content-area--has-dataset-background'))
        .find(element => isShown(element) && isShown(element.closest('.content_div')));
    return area ? readBackdrop(computed(area, '::before'), { washColor: 'transparent', wash: '0' }) : null;
}

function readBackdrop(picture, { washColor, wash }) {
    const opacity = Number.parseFloat(picture.opacity);
    if (!/^url\(/.test(picture.backgroundImage || '') || !(opacity > 0)) return null;
    return { image: picture.backgroundImage, position: picture.backgroundPosition || 'center top',
        opacity: String(opacity), washColor: washColor || 'transparent', wash: String(Number.parseFloat(wash) || 0) };
}

/** The sole writer of the flag consumed by the side menu's tab shape (main_tab_active_state.js). */
export function syncViewPresentationMediaFlag(activeTabId = '', viewName = '') {
    // Navigation hides the previous view before the next one is drawn. Until the next dataset view is drawn, the
    // decision already shown stands, so moving between two picture datasets does not flash rounded tabs; the
    // drawn view decides again (its reveal calls the active state, and its render reaches the observer).
    const { shows, dataset } = resolvePictureState(activeTabId, viewName, readComputed);
    if (shows === null && document.body.hasAttribute(VIEW_PRESENTATION_MEDIA_ATTRIBUTE)) return;
    decidedByDatasetView = dataset && shows !== null;
    document.body.setAttribute(VIEW_PRESENTATION_MEDIA_ATTRIBUTE, String(shows === true));
}

// Elements whose class or style decides a drawn picture: Home and its media layer, a dataset's content area
// (background) and search hero (cover, and the theme settings the appearance painter writes on it).
function decidesPicture(target) {
    const classes = target.classList;
    return target.id === 'front_page_container' || Boolean(classes && (classes.contains('front-page-background')
        || classes.contains('tab-content-area') || classes.contains('filterbar-inline-hero')));
}

let observer;
let refreshPresentation;
/** Watch Home mounts, dataset result renders, preview edits, hiding and theme changes, including async GET
 * rendering, and the shell-boot reveal (it changes <html>, outside the observed body). Observe only relevant
 * records so SVG morph frames cannot retrigger themselves.
 */
export function observeViewPresentationMedia(refresh) {
    refreshPresentation = refresh;
    if (observer) return;
    observer = new MutationObserver(records => {
        if (records.some(({ target }) => target === document.body || decidesPicture(target))) refreshPresentation();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener(SHELL_BOOT_REVEALED_EVENT, () => refreshPresentation?.());
}
