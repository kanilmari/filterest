// custom_root_settings_control.test.js
// Verifies source-owned four-language copy and private file status in Home settings.
// Uses real labelled controls and the shared live-language renderer under jsdom.
// Keeps paths as text and preserves drafts when the interface language changes.
import { beforeEach, expect, test } from 'vitest';
import { createCustomRootSettingsControl } from './custom_root_settings_control.js';
import { CUSTOM_ROOT_COPY, getCustomRootCopy } from './custom_root_copy.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';

beforeEach(() => { localStorage.clear(); localStorage.setItem('chosen_language', 'en'); document.body.replaceChildren(); });

test.each(['en', 'fi', 'ch', 'yue'])('renders the switch, guidance and ready status in %s', async language => {
    const control = createCustomRootSettingsControl();
    document.body.append(...control.elements);
    control.input.checked = true;
    control.setSnapshot({ exists: true, ready: true, path: '/operator/data/storage/site_root/index.html' });
    await refreshLocalizedDatasetValues(language);
    const copy = CUSTOM_ROOT_COPY[language];
    expect(document.querySelector('label').textContent).toBe(copy.enabled);
    expect(control.elements[1].textContent).toBe(copy.help);
    expect(control.elements[2].textContent).toContain(copy.ready);
    expect(document.querySelector('label').htmlFor).toBe(control.input.id);
    expect(control.input.checked).toBe(true);
    expect(control.elements[2].getAttribute('aria-live')).toBe('polite');
    expect(control.elements[2].textContent).toContain('/operator/data/storage/site_root/index.html');
});

test('reports missing, unsafe and unknown files and never interprets a path as markup', () => {
    const control = createCustomRootSettingsControl();
    document.body.append(...control.elements);
    expect(control.elements[2].textContent).toBe(CUSTOM_ROOT_COPY.en.unknown);
    control.setSnapshot({ exists: false, ready: false, path: '<img src=x onerror=alert(1)>' });
    expect(control.elements[2].textContent).toContain(CUSTOM_ROOT_COPY.en.missing);
    expect(control.elements[2].querySelector('img')).toBeNull();
    control.setSnapshot({ exists: true, ready: false, path: '/site/index.html' });
    expect(control.elements[2].textContent).toContain(CUSTOM_ROOT_COPY.en.unavailable);
});

test('normalizes supported browser language variants and falls back to English', () => {
    expect(getCustomRootCopy('fi-FI')).toBe(CUSTOM_ROOT_COPY.fi);
    expect(getCustomRootCopy('zh-CN')).toBe(CUSTOM_ROOT_COPY.ch);
    expect(getCustomRootCopy('zh-HK')).toBe(CUSTOM_ROOT_COPY.yue);
    expect(getCustomRootCopy('yue-HK')).toBe(CUSTOM_ROOT_COPY.yue);
    expect(getCustomRootCopy('de')).toBe(CUSTOM_ROOT_COPY.en);
});
