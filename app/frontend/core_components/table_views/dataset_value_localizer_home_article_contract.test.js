// dataset_value_localizer_home_article_contract.test.js
// Holds Home labels and article display values to shared language examples.
// Connects the browser localizer and the Go Home title resolver without rendering UI.
// Keeps language fallback and explicit JSON metadata from drifting across runtimes.
import { describe, expect, test } from 'vitest';
import examples from '../../../testing/shared_contracts/home_article_label_examples.json' with { type: 'json' };
import { resolveDatasetDisplayValue } from './dataset_value_localizer.js';

describe('Home and article display value contract', () => {
    test.each(examples)('resolves $language label as $expected', (example) => {
        expect(resolveDatasetDisplayValue(example.raw_value, example.metadata, example.language).trim())
            .toBe(example.expected);
    });
});
