// view_presentation_media_resolver.js
// Resolves presentation media for the current dataset or the mounted Home view.
// Connects authoritative tab metadata and visible Home media to one shell flag,
// and reads the displayed picture for the frosted bars' wide-screen layer.
// Home visibility also distinguishes its side-menu buttons from dataset tabs.

export const VIEW_PRESENTATION_MEDIA_ATTRIBUTE = 'data-view-has-presentation-media';
// Dispatched by the shell-boot guard when it reveals the page.
const SHELL_BOOT_REVEALED_EVENT = 'filterest-shell-boot-recovered';

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

/** Dataset metadata owns its rule; Home counts only configured, displayed media.
 * Media opacity and wash resolve on Home in the explicit application theme.
 * A paused/reduced-motion video still presents media, including its still frame.
 */
export function resolveViewHasPresentationMedia(activeTabId = '', viewName = '') {
    if (activeTabId) {
        const activeTab = Array.from(document.querySelectorAll('.navtablinks'))
            .find(button => button.dataset.id === activeTabId);
        return activeTab?.dataset.hasPresentationMedia === 'true';
    }
    if (viewName && viewName !== 'front_page') return false;
    const home = document.getElementById('front_page_container');
    const media = home?.querySelector('.front-page-background');
    if (!isShown(home) || !isShown(media)) return false;
    const style = window.getComputedStyle(home);
    const opacity = Number.parseFloat(style.getPropertyValue('--home-media-opacity'));
    const wash = Number.parseFloat(style.getPropertyValue('--home-media-wash'));
    if (opacity === 0 || wash === 1) return false;
    return Boolean(media.querySelector('video[src]')
        || media.style.getPropertyValue('--front-page-background-2160'));
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

/** The sole writer of the flag consumed by SVG tabs and hero/Home button CSS. */
export function syncViewPresentationMediaFlag(activeTabId = '', viewName = '') {
    document.body.setAttribute(VIEW_PRESENTATION_MEDIA_ATTRIBUTE,
        String(resolveViewHasPresentationMedia(activeTabId, viewName)));
}

let observer;
let refreshPresentation;
/** Watch Home mounts, preview edits, hiding and theme changes, including async GET rendering, and the shell-boot
 * reveal (it changes <html>, outside the observed body). Observe only relevant records so SVG morph frames cannot
 * retrigger themselves.
 */
export function observeViewPresentationMedia(refresh) {
    refreshPresentation = refresh;
    if (observer) return;
    observer = new MutationObserver(records => {
        if (records.some(({ target }) => target === document.body
            || target.id === 'front_page_container'
            || target.classList?.contains('front-page-background'))) refreshPresentation();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener(SHELL_BOOT_REVEALED_EVENT, () => refreshPresentation?.());
}
