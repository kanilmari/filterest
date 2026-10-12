// label_value_layout_adapter.test.js
// Verifies core registration and live experimental availability for shared field placement.
// Connects the core adapter, portable layout API and reusable KV pair factories.
// Protects initialization order, both availability states and unchanged field contents.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete document.documentElement.dataset.labelValueLayout;
});
afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete document.documentElement.dataset.labelValueLayout;
});

test('standalone reusable layout safely defaults to Stacked before core registration', async () => {
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    const layout = await import('../../reusable_components/key_value_container/label_value_layout.js');
    expect(layout.normalizeLabelValueLayout('auto')).toBe('stacked');
    expect(layout.normalizeLabelValueLayout('inline')).toBe('inline');
    expect(layout.normalizeLabelValueLayout('stacked')).toBe('stacked');
});

test('core registers before use and every layout API reads current availability', async () => {
    const shared = await import('../../reusable_components/key_value_container/label_value_layout.js');
    const { createKvPairBuilders } = await import('../../reusable_components/key_value_container/kv_pair_builder.js');
    // Factory creation does not read availability; its pairs are built after registration.
    const builders = createKvPairBuilders({ translate: key => key });
    const core = await import('./label_value_layout_adapter.js');
    expect(core.applyLabelValueLayout).toBe(shared.applyLabelValueLayout);
    expect(core.normalizeLabelValueLayout).toBe(shared.normalizeLabelValueLayout);

    // Registration happens with no app-env metadata. Adding/changing/removing it
    // afterwards must still give exactly the experimental card owner's result.
    for (const [environment, expected] of [[null, 'stacked'], ['dev', 'auto'],
        ['test', 'stacked'], ['prod', 'stacked'], ['dev', 'auto'], [null, 'stacked']]) {
        document.head.innerHTML = environment ? `<meta name="app-env" content="${environment}">` : '';
        document.documentElement.dataset.labelValueLayout = 'auto';
        expect(core.normalizeLabelValueLayout('auto')).toBe(expected);
        expect(core.readSiteLabelValueLayout()).toBe(expected);
        for (const setting of ['inline', 'stacked']) {
            expect(core.normalizeLabelValueLayout(setting)).toBe(setting);
        }
        const pair = document.createElement('div');
        pair.innerHTML = '<span lang="fi">Osoite</span><a href="https://example.test">Arvo</a>';
        const [label, value] = pair.children;
        document.body.append(pair);
        core.applyLabelValueLayout(pair, label, value);
        expect(pair.dataset.labelValueLayout).toBe(expected);
        expect([...pair.children]).toEqual([label, value]);
        expect(label.textContent).toBe('Osoite');
        expect(value.getAttribute('href')).toBe('https://example.test');
        for (const build of Object.values(builders)) {
            const kvPair = build({ key: 'name', labelText: 'Nimi', value: 'Arvo' });
            expect(kvPair.dataset.labelValueLayout).toBe(expected);
            expect(kvPair.textContent).toContain('Nimi');
            expect(kvPair.textContent).toContain('Arvo');
        }
        core.applySiteLabelValueLayoutSetting('auto');
        expect(pair.dataset.labelValueLayout).toBe(expected);
        expect(document.documentElement.dataset.labelValueLayout).toBe(expected);
        pair.remove();
    }
});
