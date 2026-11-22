// view_presentation_media_resolver.test.js
// Proves the one picture predicate and the Home picture reader the frosted bars' backdrop uses.
// Covers the owner's decision table for backgrounds, covers and Home media, and every way Home's media hides.
// The side menu's tab shape applies the same predicate per dataset (side_menu_tab_shape.test.js).
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { homeShowsPicture, isHomeNavigationView, showsPicture } from './view_presentation_media_resolver.js';

function home(kind = 'video') {
    const element = document.createElement('div');
    element.id = 'front_page_container';
    element.style.setProperty('--home-media-opacity', '0.75');
    element.style.setProperty('--home-media-wash', '0.15');
    element.innerHTML = '<div class="front-page-background"></div>';
    const media = element.firstElementChild;
    if (kind === 'video') media.innerHTML = '<video src="/storage/site_media/front_page/original/probe.mp4"></video>';
    if (kind === 'image') media.style.setProperty('--front-page-background-2160', 'url("/probe.webp")');
    document.body.append(element);
    return element;
}
beforeEach(() => {
    document.documentElement.removeAttribute('data-shell-boot-pending');
    document.body.innerHTML = '';
});

// Owner rule (2026-11-21): a set but hidden picture is a uniform background; only a drawn picture counts.
test.each([
    ['no background image', [{ set: false }], false],
    ['a background image hidden by its media switch', [{ set: true, hidden: true, opacity: '0.2' }], false],
    ['a shown background image', [{ set: true, opacity: '0.2' }], true],
    ['no cover image', [{ set: false }, { set: false }], false],
    ['a cover image hidden by its media switch', [{ set: false }, { set: true, hidden: true, opacity: '1' }], false],
    ['a cover image hidden by the current theme', [{ set: false }, { set: true, opacity: '0', wash: '0' }], false],
    ['a cover image fully covered by its wash', [{ set: false }, { set: true, opacity: '1', wash: '1' }], false],
    ['a cover image its oval mask cuts away', [{ set: false }, { set: true, opacity: '1', mask: 0, wash: '0' }], false],
    ['a cover image its oval mask keeps partly', [{ set: false }, { set: true, opacity: '1', mask: 0.4 }], true],
    ['a shown cover image', [{ set: false }, { set: true, opacity: '0.3', wash: '0' }], true],
    ['a shown cover over a hidden background', [{ set: true, hidden: true }, { set: true, opacity: '1' }], true],
    ['an unresolved strength', [{ set: true, opacity: '', wash: '' }], true],
])('decision table: %s shows a picture = %s', (_label, layers, expected) => {
    expect(showsPicture(layers)).toBe(expected);
});

test.each(['video', 'image'])('Home with a shown %s shows a picture', kind => {
    home(kind);
    expect(homeShowsPicture()).toBe(true);
});
test('Home without media shows none', () => {
    expect(homeShowsPicture()).toBe(false);
    home('none');
    expect(homeShowsPicture()).toBe(false);
});
test.each(['home-hidden', 'layer-hidden', 'display-none', 'invisible', 'zero-opacity', 'full-wash'])('Home media hidden by %s does not count', mode => {
    const element = home();
    if (mode === 'home-hidden') element.classList.add('hidden');
    if (mode === 'layer-hidden') element.firstElementChild.hidden = true;
    if (mode === 'display-none') element.firstElementChild.style.display = 'none';
    if (mode === 'invisible') element.firstElementChild.style.visibility = 'hidden';
    if (mode === 'zero-opacity') element.style.setProperty('--home-media-opacity', '0');
    if (mode === 'full-wash') element.style.setProperty('--home-media-wash', '1');
    expect(homeShowsPicture()).toBe(false);
});
test('the shell-boot overlay does not hide Home media (cut 9.6.0)', () => {
    const element = home();
    // While pending, the shell-boot guard hides the whole page with visibility: hidden; Home is drawn inside that phase.
    element.style.visibility = 'hidden';
    document.documentElement.setAttribute('data-shell-boot-pending', '');
    expect(homeShowsPicture()).toBe(true);
    document.documentElement.removeAttribute('data-shell-boot-pending');
    expect(homeShowsPicture()).toBe(false);
});
test('an explicit Home navigation and a shown Home both count as the Home view', () => {
    expect(isHomeNavigationView('', 'front_page')).toBe(true);
    expect(isHomeNavigationView('', '')).toBe(false);
    home('none');
    expect(isHomeNavigationView('', '')).toBe(true);
    expect(isHomeNavigationView('media', '')).toBe(false);
});
