// front_page_top_row_builder.test.js
// Verifies Home composes the live dataset tabs and releases their subscription.
// Connects main-tab snapshots to one real hero tab renderer, without navigation.
// Prevents detached Home rows from retaining stale permission-dependent tabs.
// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: [{ dataset: 'news', text: 'News', langKey: 'news' }], listeners: new Set(), unsubscribe: vi.fn() }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => mocks.snapshot,
    subscribeMainDatasetTabs: listener => {
        mocks.listeners.add(listener);
        return () => { mocks.listeners.delete(listener); mocks.unsubscribe(); };
    },
}));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ openNavTab: vi.fn() }));
vi.mock('../admin_tools/front_page_settings_modal.js', () => ({ createFrontPageSettingsHeroButton: () => null }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, options) => options.fallback }));
import { createFrontPageTopRow } from './front_page_top_row_builder.js';

test('Home tabs have no active dataset, update from the shared model and unsubscribe on teardown', () => {
    document.body.innerHTML = '<div id="navbar"></div>';
    const row = createFrontPageTopRow('Site');
    document.body.append(row.element);
    expect(row.element.querySelectorAll('.hero-dataset-tabs__button')).toHaveLength(1);
    expect(row.element.querySelector('[aria-current]')).toBeNull();
    for (const listener of mocks.listeners) listener([{ dataset: 'events', text: 'Events', langKey: 'events' }]);
    expect(row.element.querySelector('.hero-dataset-tabs__button').dataset.dataset).toBe('events');
    row.destroy();
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});
