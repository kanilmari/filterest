// view_presentation_media_resolver.test.js
// Proves the shared dataset/Home media state and its lifecycle-driven shell flag.
// Exercises real SVG state updates against mounted Home backgrounds in jsdom.
// Covers asynchronous media, hidden/disabled backgrounds and explicit themes.
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { resolveViewHasPresentationMedia, VIEW_PRESENTATION_MEDIA_ATTRIBUTE } from './view_presentation_media_resolver.js';
import { applyMainTabActiveState, clearMainTabActiveState } from './main_tab_active_state.js';

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
    document.body.className = '';
    document.body.innerHTML = '<div id="navbar" style="--navtab-presentation-transition-duration:0ms"></div>'
        + '<div class="navtabs"><button class="navtablinks" data-id="media" data-has-presentation-media="true"></button>'
        + '<button class="navtablinks" data-id="plain" data-has-presentation-media="false"></button></div>';
    clearMainTabActiveState('tool');
});
const flag = () => document.body.getAttribute(VIEW_PRESENTATION_MEDIA_ATTRIBUTE);
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('dataset media comes only from the active dataset metadata', () => {
    home();
    expect(resolveViewHasPresentationMedia('media')).toBe(true);
    expect(resolveViewHasPresentationMedia('plain')).toBe(false);
    expect(resolveViewHasPresentationMedia('missing')).toBe(false);
});
test.each(['video', 'image'])('Home with shown %s has media', kind => {
    home(kind);
    expect(resolveViewHasPresentationMedia('', 'front_page')).toBe(true);
});
test('no current view, no configured background and other tool views have no media', () => {
    expect(resolveViewHasPresentationMedia()).toBe(false);
    home('none');
    expect(resolveViewHasPresentationMedia()).toBe(false);
    expect(resolveViewHasPresentationMedia('', 'tool')).toBe(false);
});
test.each(['home-hidden', 'layer-hidden', 'display-none', 'invisible', 'zero-opacity', 'full-wash'])('Home media hidden by %s does not count', mode => {
    const element = home();
    if (mode === 'home-hidden') element.classList.add('hidden');
    if (mode === 'layer-hidden') element.firstElementChild.hidden = true;
    if (mode === 'display-none') element.firstElementChild.style.display = 'none';
    if (mode === 'invisible') element.firstElementChild.style.visibility = 'hidden';
    if (mode === 'zero-opacity') element.style.setProperty('--home-media-opacity', '0');
    if (mode === 'full-wash') element.style.setProperty('--home-media-wash', '1');
    expect(resolveViewHasPresentationMedia()).toBe(false);
});
test('flag follows dataset → Home → dataset, including a late Home GET and media removal', async () => {
    applyMainTabActiveState('media');expect(flag()).toBe('true');
    clearMainTabActiveState('front_page');expect(flag()).toBe('false');
    const element = home();await settle();expect(flag()).toBe('true');
    element.replaceChildren();await settle();expect(flag()).toBe('false');
    element.remove();
    applyMainTabActiveState('plain');expect(flag()).toBe('false');
    applyMainTabActiveState('media');expect(flag()).toBe('true');
});
test('a queued media refresh reads the replacement shell without replaying the old active dataset', async () => {
    applyMainTabActiveState('media');
    document.body.innerHTML = '<div class="navtabs"><button class="navtablinks active" data-id="plain"></button></div>';
    await settle();
    expect(document.querySelector('.navtablinks.active')?.dataset.id).toBe('plain');
    expect(flag()).toBe('false');
});
test('preview opacity, theme switches and deactivation refresh the same flag', async () => {
    // Resolved CSS values differ by explicit theme, just as front_page.css does.
    const sheet = document.createElement('style');
    sheet.textContent = '#front_page_container { --home-media-opacity: 0; }'
        + 'body.dark-mode #front_page_container { --home-media-opacity: 0.2; }';
    document.body.append(sheet);
    const element = home('image');element.style.removeProperty('--home-media-opacity');
    clearMainTabActiveState('front_page');expect(flag()).toBe('false');
    document.body.className = 'dark-mode';await settle();expect(flag()).toBe('true');
    element.style.setProperty('--home-media-opacity', '0');await settle();expect(flag()).toBe('false');
    element.style.setProperty('--home-media-opacity', '1');await settle();expect(flag()).toBe('true');
    element.classList.add('hidden');await settle();expect(flag()).toBe('false');
});
