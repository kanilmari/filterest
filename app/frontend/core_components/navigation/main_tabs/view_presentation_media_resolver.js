// view_presentation_media_resolver.js
// Resolves presentation media for the current dataset or the mounted Home view.
// Connects authoritative tab metadata and visible Home media to one shell flag.
// Keeps every navigation surface on the same media-dependent shape policy.

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
