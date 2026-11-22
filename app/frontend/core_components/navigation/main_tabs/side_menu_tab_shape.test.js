// side_menu_tab_shape.test.js
// Proves the one rule for the side menu's tab shape (owner 2026-11-22) and when it may decide again.
// Covers each dataset's pictures in both themes, all-or-nothing over the visible menu tabs, the stored
// decision before a catalogue, failed or cleared catalogues and forced catalogue refreshes.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    datasetShowsPicture, onSideMenuTabShapeChange, resetSideMenuTabShapeForTests, SIDE_MENU_RENDERED_ATTRIBUTE,
    SIDE_MENU_TAB_SHAPE_ATTRIBUTE, sideMenuShowsPicture, sideMenuTabsBoxLike, syncSideMenuTabShape,
} from './side_menu_tab_shape.js';
import { clearDatasetAccessRegistry, primeDatasetAccessRegistry } from '../nav_engine/dataset_access_registry.js';

const strength = (overrides = {}) => ({ image_opacity: 1, overlay_opacity: 0, oval_enabled: false,
    center_opacity: 0.4, mid_opacity: 0.7, edge_opacity: 1, ...overrides });
const cover = (light, dark) => ({ background: false, cover: true, cover_themes: { light: strength(light), dark: strength(dark) } });
const NONE = { background: false, cover: false };
const entry = (name, picture) => ({ dataset_name: name, table_uid: name.length, names: [name], can_read_rows: true,
    ...(picture === undefined ? {} : { presentation_picture: picture }) });

function menu(ids, { rendered = true } = {}) {
    document.body.innerHTML = '<nav id="navmenu"></nav>';
    const element = document.getElementById('navmenu');
    for (const id of ids) {
        const button = document.createElement('a');
        button.className = 'navtablinks';
        button.dataset.id = id;
        element.append(button);
    }
    element.setAttribute(SIDE_MENU_RENDERED_ATTRIBUTE, String(rendered));
    return element;
}
beforeEach(() => {
    localStorage.clear();
    resetSideMenuTabShapeForTests();
});
afterEach(() => {
    clearDatasetAccessRegistry();
    vi.restoreAllMocks();
});

test.each([
    ['no pictures', NONE, false],
    ['a shown background', { background: true, cover: false }, true],
    ['a cover shown in both themes', cover({}, { image_opacity: 0.3 }), true],
    ['a cover shown only in the dark theme', cover({ image_opacity: 0 }, { image_opacity: 0.3 }), true],
    ['a cover shown only in the light theme', cover({}, { image_opacity: 0 }), true],
    ['a cover hidden by both theme switches (fintravel.fi, 9.6.14)', cover({ image_opacity: 0 }, { image_opacity: 0 }), false],
    ['a cover fully washed in both themes', cover({ overlay_opacity: 1 }, { overlay_opacity: 1 }), false],
    ['a cover its oval keeps nothing of in either theme',
        cover({ oval_enabled: true, center_opacity: 0, mid_opacity: 0, edge_opacity: 0 },
            { oval_enabled: true, center_opacity: 0, mid_opacity: 0, edge_opacity: 0 }), false],
    ['a cover whose oval keeps its edge', cover({ oval_enabled: true, center_opacity: 0, mid_opacity: 0, edge_opacity: 0.5 },
        { image_opacity: 0 }), true],
    ['a cover with the oval off, whatever its zones say', cover({ center_opacity: 0, mid_opacity: 0, edge_opacity: 0 },
        { image_opacity: 0 }), true],
    ['a cover hidden one way in light and another in dark', cover({ overlay_opacity: 1 }, { image_opacity: 0 }), false],
    ['a cover whose strengths could not be read', { background: false, cover: true }, true],
])('a dataset with %s shows a picture = %s', (_label, picture, expected) => {
    expect(datasetShowsPicture(picture)).toBe(expected);
});

test('one shown picture among the menu datasets makes the whole menu box-like', () => {
    const catalogue = { datasets: [entry('plain', NONE), entry('hidden', cover({ image_opacity: 0 }, { image_opacity: 0 })),
        entry('dark_only', cover({ image_opacity: 0 }, { image_opacity: 0.3 }))] };
    expect(sideMenuShowsPicture(['plain', 'hidden'], catalogue)).toBe(false);
    expect(sideMenuShowsPicture(['plain', 'hidden', 'dark_only'], catalogue)).toBe(true);
});
test('datasets without a menu tab, unknown tabs and entries the viewer may not open do not count', () => {
    const catalogue = { datasets: [entry('plain', NONE), entry('subfolder', { background: true, cover: false }),
        entry('unreadable')] };
    expect(sideMenuShowsPicture(['plain', 'login', 'unreadable'], catalogue)).toBe(false);
    expect(sideMenuShowsPicture([], catalogue)).toBe(false);
});

test('a first visit is box-like before any catalogue decides', () => {
    expect(sideMenuTabsBoxLike()).toBe(true);
    expect(document.body.getAttribute(SIDE_MENU_TAB_SHAPE_ATTRIBUTE)).toBe('box');
});
test('the stored last decision stands until a catalogue decides', () => {
    localStorage.setItem('side_menu_tab_shape', 'rounded');
    resetSideMenuTabShapeForTests();
    expect(sideMenuTabsBoxLike()).toBe(false);
    localStorage.setItem('side_menu_tab_shape', 'nonsense');
    resetSideMenuTabShapeForTests();
    expect(sideMenuTabsBoxLike()).toBe(true);
});
test('the rendered menu decides, stores the decision and reports only changes', () => {
    const listener = vi.fn();
    const stop = onSideMenuTabShapeChange(listener);
    const element = menu(['plain', 'hidden']);
    const catalogue = { datasets: [entry('plain', NONE), entry('hidden', cover({ image_opacity: 0 }, { image_opacity: 0 })),
        entry('dark_only', cover({ image_opacity: 0 }, { image_opacity: 0.3 }))] };
    syncSideMenuTabShape(element, catalogue);
    expect(sideMenuTabsBoxLike()).toBe(false);
    expect(localStorage.getItem('side_menu_tab_shape')).toBe('rounded');
    expect(document.body.getAttribute(SIDE_MENU_TAB_SHAPE_ATTRIBUTE)).toBe('rounded');
    expect(listener).toHaveBeenCalledTimes(1);
    syncSideMenuTabShape(element, catalogue);
    expect(listener).toHaveBeenCalledTimes(1);
    const late = document.createElement('a');
    late.className = 'navtablinks';
    late.dataset.id = 'dark_only';
    late.style.display = 'none';
    element.append(late);
    syncSideMenuTabShape(element, catalogue);
    expect(sideMenuTabsBoxLike()).toBe(false);
    // A permission fallback reveals the tab: it joins the deciding set.
    late.style.display = '';
    syncSideMenuTabShape(element, catalogue);
    expect(sideMenuTabsBoxLike()).toBe(true);
    expect(localStorage.getItem('side_menu_tab_shape')).toBe('box');
    expect(listener).toHaveBeenLastCalledWith('box');
    stop();
});
test('an empty rendered menu decides rounded', () => {
    syncSideMenuTabShape(menu([]), { datasets: [] });
    expect(sideMenuTabsBoxLike()).toBe(false);
});
test('a menu still rebuilding, a missing or cleared catalogue and unreadable picture settings keep the decision', () => {
    localStorage.setItem('side_menu_tab_shape', 'box');
    resetSideMenuTabShapeForTests();
    const plain = { datasets: [entry('plain', NONE)] };
    syncSideMenuTabShape(menu(['plain'], { rendered: false }), plain);
    syncSideMenuTabShape(menu(['plain']), null);
    syncSideMenuTabShape(menu(['plain']), { datasets: [entry('plain')], presentation_pictures_unavailable: true });
    syncSideMenuTabShape(null, plain);
    expect(sideMenuTabsBoxLike()).toBe(true);
    syncSideMenuTabShape(menu(['plain']), plain);
    expect(sideMenuTabsBoxLike()).toBe(false);
});
test('a forced catalogue refresh decides again; the registry clearing in between does not', () => {
    const element = menu(['media']);
    primeDatasetAccessRegistry({ datasets: [entry('media', NONE)] });
    expect(sideMenuTabsBoxLike()).toBe(false);
    // An administrator shows the cover in the dark theme and the catalogue refreshes.
    primeDatasetAccessRegistry({ datasets: [entry('media', cover({ image_opacity: 0 }, { image_opacity: 0.3 }))] });
    expect(sideMenuTabsBoxLike()).toBe(true);
    clearDatasetAccessRegistry();
    expect(sideMenuTabsBoxLike()).toBe(true);
    element.remove();
});
test('a browser that refuses storage still decides for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    resetSideMenuTabShapeForTests();
    expect(sideMenuTabsBoxLike()).toBe(true);
    syncSideMenuTabShape(menu(['plain']), { datasets: [entry('plain', NONE)] });
    expect(sideMenuTabsBoxLike()).toBe(false);
});
