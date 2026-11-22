// view_presentation_media_resolver.js
// The one picture predicate (showsPicture) and the readers of what the displayed view paints behind its content.
// Bridges Home's mounted image or video and a dataset's drawn background with the frosted bars' backdrop.
// The side menu's tab shape applies the same predicate to every menu dataset (side_menu_tab_shape.js).
const readComputed = (element, pseudo) => window.getComputedStyle(element, pseudo);

// The shell-boot guard keeps the page under visibility: hidden until the chosen language is applied (K522 A), and
// Home is drawn inside that phase. That is the boot overlay, not the view's own state, so it must not hide Home's
// media (cut 9.6.0, G18).
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

/** Home's configured image or video; its opacity and wash resolve in the explicit application theme. */
function readHomePictureLayers(computed = readComputed) {
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

/** Whether Home shows its image or video in the current theme (the frosted bars' backdrop reads it). */
export function homeShowsPicture(computed = readComputed) {
    return showsPicture(readHomePictureLayers(computed));
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
        if (!homeShowsPicture() || media.querySelector('video')) return null;
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
