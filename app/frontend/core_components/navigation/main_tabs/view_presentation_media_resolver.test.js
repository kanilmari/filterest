// view_presentation_media_resolver.test.js
// Proves the one picture rule behind the side menu's tab shape and its lifecycle-driven shell flag.
// Covers the owner's decision table for dataset backgrounds, dataset covers and Home media,
// mounted dataset views and Home in jsdom, hidden pictures, explicit themes and async rendering.
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { readDatasetPictureLayers, resolveViewHasPresentationMedia, showsPicture,
    VIEW_PRESENTATION_MEDIA_ATTRIBUTE } from './view_presentation_media_resolver.js';
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
/** A mounted dataset view as the result builders draw it; a picture switched off gets no class. */
function dataset(name, { background = false, cover = false } = {}) {
    const view = document.createElement('div');
    view.id = `${name}_container`;
    view.className = 'content_div';
    view.innerHTML = `<div id="${name}_tab_parts_container" class="tab_parts_container"><div class="tab-content-area">`
        + '<div class="tab-content-body"><div class="scrollable_content"><div class="filterbar-inline-hero"></div>'
        + '</div></div></div></div>';
    const area = view.querySelector('.tab-content-area');
    const hero = view.querySelector('.filterbar-inline-hero');
    area.classList.toggle('tab-content-area--has-dataset-background', background);
    hero.classList.toggle('filterbar-inline-hero--has-cover', cover);
    if (cover) hero.style.setProperty('--dataset-cover-image', 'url("/storage/104/dataset_media/cover/1000/c.webp")');
    document.body.append(view);
    return { view, area, hero };
}
beforeEach(() => {
    document.documentElement.removeAttribute('data-shell-boot-pending');
    document.body.className = '';
    document.body.innerHTML = '<div id="navbar" style="--navtab-presentation-transition-duration:0ms"></div>'
        + '<div class="navtabs"><button class="navtablinks" data-id="media"></button>'
        + '<button class="navtablinks" data-id="plain"></button></div>';
    clearMainTabActiveState('tool');
});
const flag = () => document.body.getAttribute(VIEW_PRESENTATION_MEDIA_ATTRIBUTE);
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

// Owner rule (2026-11-21): uniform background → rounded tabs; a set but hidden picture → rounded; a shown picture → boxes.
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

test('dataset views decide from the picture they draw, not from catalogue metadata', () => {
    dataset('media', { background: true });
    dataset('plain');
    expect(resolveViewHasPresentationMedia('media')).toBe(true);
    expect(resolveViewHasPresentationMedia('plain')).toBe(false);
    expect(resolveViewHasPresentationMedia('missing')).toBe(false);
});
test.each([
    ['background shown', { background: true }, {}, true],
    ['background switched off', {}, {}, false],
    ['cover shown in the current theme', { cover: true }, { opacity: '1', wash: '0' }, true],
    ['cover switched off', {}, { opacity: '1', wash: '0' }, false],
    ['cover hidden by the current theme', { cover: true }, { opacity: '0', wash: '0' }, false],
    ['cover fully washed', { cover: true }, { opacity: '1', wash: '1' }, false],
    ['cover cut away by its oval mask', { cover: true }, { opacity: '1', wash: '0', oval: ['0', '0', '0'] }, false],
    ['cover kept by its oval mask at the edge', { cover: true }, { opacity: '1', wash: '0', oval: ['0', '0', '1'] }, true],
    ['cover with the oval off ignores its zones', { cover: true }, { opacity: '1', wash: '0', oval: ['0', '0', '0'],
        maskImage: 'none' }, true],
])('a dataset %s', (_label, pictures, coverStyle, expected) => {
    const { hero } = dataset('media', pictures);
    if (coverStyle.opacity !== undefined) hero.style.setProperty('--dataset-cover-image-opacity', coverStyle.opacity);
    if (coverStyle.wash !== undefined) hero.style.setProperty('--dataset-cover-overlay-opacity', coverStyle.wash);
    ['center', 'mid', 'edge'].forEach((zone, index) => coverStyle.oval
        && hero.style.setProperty(`--dataset-cover-mask-${zone}-opacity`, coverStyle.oval[index]));
    if (coverStyle.maskImage) hero.style.setProperty('--dataset-cover-mask-image', coverStyle.maskImage);
    expect(resolveViewHasPresentationMedia('media')).toBe(expected);
});
test('a dataset without a menu tab keeps its decision when a refresh names no view (project subfolder)', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = 'body.dark-mode .filterbar-inline-hero--has-cover { --dataset-cover-image-opacity: 0; }';
    document.body.append(sheet);
    dataset('nested', { cover: true });
    // Navigation names the dataset although the menu has no button for it.
    applyMainTabActiveState('nested', { viewDatasetName: 'nested' });expect(flag()).toBe('true');
    expect(document.querySelector('.navtablinks.active')).toBeNull();
    // The theme and appearance refreshes find no active menu tab; the displayed view still decides.
    document.body.className = 'dark-mode';await settle();expect(flag()).toBe('false');
    document.body.className = '';await settle();expect(flag()).toBe('true');
    expect(resolveViewHasPresentationMedia('', 'nested')).toBe(true);
    expect(resolveViewHasPresentationMedia('', 'tool')).toBe(false);
});
test('between two datasets without menu tabs the shown decision stands; Home and tools still clear it', async () => {
    const first = dataset('nested', { background: true }).view;
    applyMainTabActiveState('nested', { viewDatasetName: 'nested' });expect(flag()).toBe('true');
    // The gap: the first view is hidden and the next one is still loading; the refresh names no view.
    first.classList.add('hidden');await settle();expect(flag()).toBe('true');
    const next = dataset('nested_two', { cover: true });
    next.hero.style.setProperty('--dataset-cover-image-opacity', '0');await settle();expect(flag()).toBe('false');
    next.view.classList.add('hidden');
    clearMainTabActiveState('tool');expect(flag()).toBe('false');
    first.classList.remove('hidden');
    applyMainTabActiveState('nested', { viewDatasetName: 'nested' });expect(flag()).toBe('true');
    first.classList.add('hidden');
    const element = home('none');clearMainTabActiveState('front_page');expect(flag()).toBe('false');
    element.classList.add('hidden');await settle();expect(flag()).toBe('false');
});
test('a hidden dataset view, content area or hero draws no picture', () => {
    const { view, area, hero } = dataset('media', { background: true, cover: true });
    hero.style.setProperty('--dataset-cover-image-opacity', '1');
    area.classList.remove('tab-content-area--has-dataset-background');
    hero.hidden = true;
    expect(resolveViewHasPresentationMedia('media')).toBe(false);
    hero.hidden = false;
    expect(resolveViewHasPresentationMedia('media')).toBe(true);
    view.classList.add('hidden');
    expect(resolveViewHasPresentationMedia('media')).toBe(false);
});
test('the background strength is read from the drawn layer', () => {
    const { area } = dataset('media', { background: true });
    const computed = (element, pseudo) => (element === area && pseudo === '::before'
        ? { opacity: '0' } : window.getComputedStyle(element, pseudo));
    expect(readDatasetPictureLayers('media', computed)[0]).toMatchObject({ set: true, opacity: '0' });
    expect(resolveViewHasPresentationMedia('media', '', computed)).toBe(false);
});
test('a cover follows the explicit theme', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = '.filterbar-inline-hero--has-cover { --dataset-cover-image-opacity: 1; }'
        + 'body.dark-mode .filterbar-inline-hero--has-cover { --dataset-cover-image-opacity: 0; }';
    document.body.append(sheet);
    dataset('media', { cover: true });
    applyMainTabActiveState('media');expect(flag()).toBe('true');
    document.body.className = 'dark-mode';await settle();expect(flag()).toBe('false');
    document.body.className = '';await settle();expect(flag()).toBe('true');
});
test('a dataset picture drawn after the tab settles refreshes the flag', async () => {
    const { area, hero } = dataset('media');
    applyMainTabActiveState('media');expect(flag()).toBe('false');
    area.classList.add('tab-content-area--has-dataset-background');await settle();expect(flag()).toBe('true');
    area.classList.remove('tab-content-area--has-dataset-background');await settle();expect(flag()).toBe('false');
    hero.classList.add('filterbar-inline-hero--has-cover');await settle();expect(flag()).toBe('true');
    // The appearance painter writes the theme strength on the hero itself.
    hero.style.setProperty('--dataset-cover-image-opacity', '0');await settle();expect(flag()).toBe('false');
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
test('the shell-boot overlay does not hide Home media, and the reveal resolves the flag again (cut 9.6.0)', async () => {
    const element = home();
    // While pending, the shell-boot guard hides the whole page with visibility: hidden; Home is drawn inside that phase.
    element.style.visibility = 'hidden';
    document.documentElement.setAttribute('data-shell-boot-pending', '');
    expect(resolveViewHasPresentationMedia()).toBe(true);
    clearMainTabActiveState('front_page');await settle();expect(flag()).toBe('true');
    // The reveal changes <html>, outside the observed body: only its event re-resolves. The view's own hiding stays
    // here, so the flag must now follow it.
    document.documentElement.removeAttribute('data-shell-boot-pending');
    await settle();expect(flag()).toBe('true');
    window.dispatchEvent(new Event('filterest-shell-boot-recovered'));
    expect(flag()).toBe('false');
});
test('flag follows dataset → Home → dataset, including a late Home GET and media removal', async () => {
    const media = dataset('media', { background: true }).view;
    const plain = dataset('plain').view;
    applyMainTabActiveState('media');expect(flag()).toBe('true');
    media.classList.add('hidden');
    clearMainTabActiveState('front_page');expect(flag()).toBe('false');
    const element = home();await settle();expect(flag()).toBe('true');
    element.replaceChildren();await settle();expect(flag()).toBe('false');
    element.remove();
    applyMainTabActiveState('plain');expect(flag()).toBe('false');
    plain.classList.add('hidden');media.classList.remove('hidden');
    applyMainTabActiveState('media');expect(flag()).toBe('true');
});
test('a queued media refresh reads the replacement shell without replaying the old active dataset', async () => {
    dataset('media', { background: true });
    applyMainTabActiveState('media');
    document.body.innerHTML = '<div class="navtabs"><button class="navtablinks active" data-id="plain"></button></div>';
    dataset('plain');
    await settle();
    expect(document.querySelector('.navtablinks.active')?.dataset.id).toBe('plain');
    expect(flag()).toBe('false');
});
test('between two views the shown decision stands until the next view is drawn', async () => {
    const media = dataset('media', { background: true }).view;
    applyMainTabActiveState('media');expect(flag()).toBe('true');
    // Navigation hides the previous view first; a refresh in that gap must not flash rounded tabs.
    media.classList.add('hidden');await settle();expect(flag()).toBe('true');
    applyMainTabActiveState('other');expect(flag()).toBe('true');
    const other = dataset('other', { cover: true });
    other.hero.style.setProperty('--dataset-cover-image-opacity', '0');
    applyMainTabActiveState('other');expect(flag()).toBe('false');
    // Without an earlier decision an undrawn view starts from a uniform background.
    document.body.removeAttribute('data-view-has-presentation-media');
    applyMainTabActiveState('missing');expect(flag()).toBe('false');
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
