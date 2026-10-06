// front_page_settings_modal.test.js
// Proves the Home gear uses the existing permission, editor and shared modal.
// Connects save refresh callbacks and cleanup to the actual modal lifecycle.
// Keeps unauthorized visitors from seeing the administrator action.
// @vitest-environment jsdom

import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ editor: vi.fn(), cleanup: vi.fn() }));
vi.mock('./front_page_settings_view.js', () => ({ generate_front_page_settings_view: mocks.editor }));
vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn(async () => {}) }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: () => 'Home settings' }));
import { createFrontPageSettingsHeroButton } from './front_page_settings_modal.js';
import { hideModal } from '../../reusable_components/modal/modal_builder.js';
import { clearPermissionCache } from '../route_permission_checker.js';

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    sessionStorage.clear(); clearPermissionCache();
    mocks.editor.mockImplementation(async content => {
        content.__cleanupListeners = mocks.cleanup;
        content.append(document.createElement('input'));
    });
});
afterEach(() => { hideModal(); });

test('gear is absent without the Home settings permission', () => {
    sessionStorage.setItem('user_permissions', JSON.stringify([]));
    expect(createFrontPageSettingsHeroButton(vi.fn())).toBeNull();
});

test('gear opens the existing editor, refreshes Home on save and releases it on close', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/api/admin/front-page']));
    const onSaved = vi.fn();
    const button = createFrontPageSettingsHeroButton(onSaved);
    document.body.append(button);
    expect(button.getAttribute('aria-label')).toBe('Home settings');
    button.click();
    await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
    const options = mocks.editor.mock.calls[0][1];
    expect(options.modal).toBe(true);
    await options.onSaved();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="front-page-settings-modal"]')).not.toBeNull();
    hideModal();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
});
