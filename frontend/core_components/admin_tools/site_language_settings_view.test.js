// site_language_settings_view.test.js
// Verifies the dedicated site-language administration table and save payload.
// Bridges mocked canonical language API rows with DOM controls and public gates.
// Exists to prevent locale identity or completeness rules from disappearing in the UI.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();

vi.mock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));

vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (_key, { fallback } = {}) => fallback || '',
}));

const languageFixture = [
    { language_code: 'en', english_name: 'English', native_name: 'English', is_enabled: true, is_default: true, fallback_language_code: null, coverage_status: 'complete', review_status: 'approved', public_selector_ready: true, sort_order: 10 },
    { language_code: 'fi', english_name: 'Finnish', native_name: 'Suomi', is_enabled: true, is_default: false, fallback_language_code: 'en', coverage_status: 'complete', review_status: 'approved', public_selector_ready: true, sort_order: 20 },
    { language_code: 'zh-CN', english_name: 'Chinese', native_name: '简体中文', is_enabled: false, is_default: false, fallback_language_code: 'en', coverage_status: 'partial', review_status: 'needs_review', public_selector_ready: false, sort_order: 30 },
    { language_code: 'zh-TW', english_name: 'Chinese', native_name: '繁體中文（台灣）', is_enabled: false, is_default: false, fallback_language_code: 'en', coverage_status: 'not_started', review_status: 'unreviewed', public_selector_ready: false, sort_order: 40 },
    { language_code: 'zh-HK', english_name: 'Chinese', native_name: '繁體中文（香港）', is_enabled: false, is_default: false, fallback_language_code: 'en', coverage_status: 'not_started', review_status: 'unreviewed', public_selector_ready: false, sort_order: 50 },
];

describe('site_language_settings_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '<main id="target"></main>';
        endpointRouterMock.mockReset();
        endpointRouterMock.mockResolvedValue({ languages: languageFixture.map((item) => ({ ...item })) });
    });

    test('shows all five canonical locales and keeps incomplete Chinese public toggles disabled', async () => {
        const { generate_site_language_settings_view } = await import('./site_language_settings_view.js');
        await generate_site_language_settings_view(document.getElementById('target'));

        expect(document.querySelectorAll('tr[data-language-code]')).toHaveLength(5);
        expect(document.querySelector('tr[data-language-code="zh-CN"] [data-setting="public_selector_ready"]').disabled).toBe(true);
        expect(document.querySelector('tr[data-language-code="en"] [data-setting="public_selector_ready"]').disabled).toBe(false);
    });

    test('saves one default and explicit fallbacks through the admin endpoint', async () => {
        const { generate_site_language_settings_view } = await import('./site_language_settings_view.js');
        await generate_site_language_settings_view(document.getElementById('target'));

        const finnishDefault = document.querySelector('tr[data-language-code="fi"] [data-setting="is_default"]');
        finnishDefault.checked = true;
        finnishDefault.dispatchEvent(new Event('change', { bubbles: true }));
        await document.querySelector('[data-testid="site-language-settings-save"]').click();

        expect(endpointRouterMock).toHaveBeenLastCalledWith('adminUiLanguages', expect.objectContaining({
            method: 'POST',
            body_data: expect.objectContaining({
                languages: expect.arrayContaining([
                    expect.objectContaining({ language_code: 'fi', is_default: true, fallback_language_code: null }),
                    expect.objectContaining({ language_code: 'en', is_default: false, fallback_language_code: 'fi' }),
                ]),
            }),
        }));
    });

    test('keeps public selection and enablement internally consistent', async () => {
        const { generate_site_language_settings_view } = await import('./site_language_settings_view.js');
        await generate_site_language_settings_view(document.getElementById('target'));

        const finnishRow = document.querySelector('tr[data-language-code="fi"]');
        const enabled = finnishRow.querySelector('[data-setting="is_enabled"]');
        const publicSelector = finnishRow.querySelector('[data-setting="public_selector_ready"]');
        enabled.checked = false;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
        expect(publicSelector.checked).toBe(false);

        publicSelector.checked = true;
        publicSelector.dispatchEvent(new Event('change', { bubbles: true }));
        expect(enabled.checked).toBe(true);
    });
});
