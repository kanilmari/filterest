// chart_copy.test.js
// Checks bundled chart copy for each supported language and language alias.
// Connects chart label keys and the registry fallbacks to the translation handler.
// Keeps the general rename available without rewriting existing address or permission identities.
import { expect, test } from 'vitest';
import { CHART_TRANSLATION_FALLBACKS, chartFallback } from './chart_copy.js';
import { getDatasetViewLocalTranslationFallbacks, getDatasetViewDefinition } from '../dataset_view_registry.js';

test('all chart copy has four local fallbacks registered in the translation system', () => {
    const registered = getDatasetViewLocalTranslationFallbacks();
    for (const [key, translations] of Object.entries(CHART_TRANSLATION_FALLBACKS)) {
        for (const language of ['fi', 'en', 'ch', 'yue']) {
            expect(translations[language].trim()).not.toBe('');
            expect(registered[key][language]).toBe(translations[language]);
        }
    }
    expect(['fi', 'en', 'ch', 'yue'].map(language => chartFallback('view_chart', language)))
        .toEqual(['Kaavio', 'Chart', '图表', '圖表']);
    expect(chartFallback('view_chart', 'zh-HK')).toBe('圖表');
    expect(getDatasetViewDefinition('price_chart').viewKey).toBe('price_chart');
    expect(getDatasetViewDefinition('price_chart').langKey).toBe('view_chart');
});
