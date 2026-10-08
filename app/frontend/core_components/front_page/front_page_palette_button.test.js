// front_page_palette_button.test.js
// Verifies Home's palette trigger is administrator-only and its editor loads on demand.
// Connects the top-row lifecycle to the shared mask icon and detached-import guard.
// Prevents navigation from mounting a late editor or retaining its language observer.
import { afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allowed: false, mount: vi.fn(), destroy: vi.fn(), open: vi.fn() }));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => mocks.allowed }));
vi.mock('../admin_tools/front_page_settings_modal.js', () => ({ createFrontPageSettingsHeroButton: () => document.createElement('button') }));
vi.mock('../admin_tools/home_palette_builder.js', () => ({ mountHomePalette: mocks.mount }));
vi.mock('../navigation/main_tabs/hero_dataset_tabs.js', () => ({ createHeroDatasetTabs: () => ({ element: document.createElement('div'), destroy() {} }) }));
import { createFrontPageTopRow } from './front_page_top_row_builder.js';
let row;
afterEach(() => { row?.destroy(); row = null; document.body.replaceChildren(); mocks.allowed = false; vi.clearAllMocks(); });

test('visitors have no palette; administrator trigger is beside gear and uses original currentColor mask', async () => {
    row = createFrontPageTopRow('Site');
    expect(row.element.querySelector('[data-testid="home-palette-button"]')).toBeNull(); row.destroy();
    mocks.allowed = true;
    mocks.mount.mockReturnValue({ destroy: mocks.destroy, openPanel: mocks.open });
    document.documentElement.lang = 'en';
    const snapshot = { presentation: null, presentation_version: 'none' };
    const render = vi.fn(); row = createFrontPageTopRow('Site', undefined, { snapshot, render });
    document.body.append(row.element);
    const button = row.element.querySelector('[data-testid="home-palette-button"]');
    expect(button.previousElementSibling.tagName).toBe('BUTTON');
    expect(button.querySelector('span').style.maskImage).toContain('home-palette-icon.svg');
    expect(mocks.mount).not.toHaveBeenCalled(); button.click();
    await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledWith(button, { snapshot, render }));
    expect(mocks.open).toHaveBeenCalledOnce();
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Etusivun paletti'));
    row.destroy(); row = null; expect(mocks.destroy).toHaveBeenCalledOnce();
});

test('leaving Home before lazy import completes cannot mount a detached palette', async () => {
    mocks.allowed = true; row = createFrontPageTopRow('Site', undefined, {});
    row.element.querySelector('[data-testid="home-palette-button"]').click(); row.destroy(); row = null;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mocks.mount).not.toHaveBeenCalled();
});
