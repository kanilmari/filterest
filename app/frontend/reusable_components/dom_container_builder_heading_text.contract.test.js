// @vitest-environment jsdom
// dom_container_builder_heading_text.contract.test.js
// Holds readInlineHeadingText to the heading examples the server's reader also answers.
// Connects the browser reader with its Go twin, publicArticleHeadingText in
// app/backend/core_components/system_table_tools/public_article_heading_text.go.
// Keeps the title the server prints and the heading the app shows from drifting apart.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInlineHeadingText } from './dom_container_builder.js';

describe('readInlineHeadingText', () => {
    // The server prints the same heading into the page title, the link preview
    // and the plain article page. Both sides read these examples, so the two
    // texts cannot drift apart. An expected value is only ever what this
    // function returns here; an input on which this test DOM and real browsers
    // disagree does not belong in the file.
    const sharedHeadingExamples = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
        '../../testing/shared_contracts/heading_text_examples.json'), 'utf8')).headingText;

    test('the shared examples are there', () => {
        expect(sharedHeadingExamples.length).toBeGreaterThan(0);
    });

    test.each(sharedHeadingExamples)('shared example: $why', ({ stored, expected }) => {
        expect(readInlineHeadingText(stored)).toBe(expected);
    });
});
