// client_error_classifier.test.js
// Pins browser-error attribution for the monitor and future client log.
// Exercises native bundle paths and Chromium/Firefox/WebKit stack formats.
// Prevents browser injections and opaque errors from becoming app notices.
import { describe, expect, test } from 'vitest';
import { classifyClientError } from './client_error_classifier.js';

const page = 'https://fintravel.fi/travel_deals?view=card';
const own = 'https://fintravel.fi/frontend/main.js';
const classify = (details) => classifyClientError(details, page);
const errorWithStack = (stack) => Object.assign(new Error('failure'), { stack });

describe('classifyClientError (WO35 / WO36 contract)', () => {
    test.each([
        own,
        'https://fintravel.fi/frontend/dist/main.123.min.js?revision=2',
        '/components/example/frontend/index.mjs',
        '/core_components/example.js',
        '/main.js',
        '/ui_config.js',
        '/generated/backend_route_manifest.js',
        '/styles/example.js',
        '/@fs/work/app/components/example/frontend/index.js',
    ])('recognizes served own script %s', (source) => {
        expect(classify({ source })).toBe('own');
    });

    test.each([
        page,
        'https://fintravel.fi/travel_deals',
        'chrome-extension://wallet/content.js',
        'moz-extension://wallet/content.js',
        'safari-web-extension://wallet/content.js',
        'https://other.example/frontend/main.js',
        '/components/example/backend/private.js',
        '/uploads/frontend.js',
        '/frontend/main.css',
    ])('rejects foreign source %s', (source) => {
        expect(classify({ source, line: 1, column: 16 })).toBe('foreign');
    });

    test('opaque cross-origin error and missing source', () => {
        expect(classify({ message: 'Script error.', source: own, line: 0, column: 0 })).toBe('opaque');
        expect(classify({})).toBe('opaque');
        expect(classify({ source: '', error: errorWithStack(`Error\n    at app (${own}:2:1)`) })).toBe('opaque');
        expect(classify({ error: Object.assign(new Error('no location'), { stack: '' }) })).toBe('opaque');
    });

    test.each([
        'Error: failure\n    at wallet (chrome-extension://wallet/inject.js:1:16)',
        'wallet@safari-web-extension://wallet/inject.js:1:16',
        'wallet@https://fintravel.fi/travel_deals:1:16',
        `Error: failure ${own}:1:16\n    at <anonymous>:1:16`,
    ])('own source also requires an own stack frame', (stack) => {
        expect(classify({ source: own, error: errorWithStack(stack) })).toBe('foreign');
    });

    test.each([
        ['gate header', `failed@${own}:1:16`, `Error: failed@${own}:1:16\n    at eval (chrome-extension://wallet/inject.js:3:8)`],
        ['multiline V8 message', `failure\n    at app (${own}:1:16)`, `Error: failure\n    at app (${own}:1:16)\n    at wallet (chrome-extension://wallet/inject.js:3:8)`],
        ['Firefox/Safari message prefix', `failure\napp@${own}:1:16`, `failure\napp@${own}:1:16\nwallet@safari-web-extension://wallet/inject.js:3:8`],
        ['Firefox/Safari without header', `failed@${own}:1:16`, 'wallet@safari-web-extension://wallet/inject.js:3:8'],
    ])('never counts message text as frames: %s', (_label, message, stack) => {
        const error = Object.assign(new Error(message), { stack });
        expect(classify({ error })).toBe('foreign');
    });

    test('a supplied CDN source vetoes an own stack frame', () => {
        // WO35 requires an own supplied source AND, when present, an own stack frame.
        expect(classify({ source: 'https://cdn.example/library.js',
            error: errorWithStack(`Error: failure\n    at app (${own}:3:4)`) })).toBe('foreign');
    });

    test.each([
        `Error: failure\n    at wallet (chrome-extension://wallet/inject.js:1:16)\n    at app (${own}:50:2)`,
        `wallet@moz-extension://wallet/inject.js:1:16\napp@${own}:50:2`,
        `module code@${own}:50:2`,
        `Error\n    at ${own}:50:2`,
        `Error: failure\n    at chrome-extension://wallet/inject.js:1:47\n    at async ${own}:1:41`,
        `Error: failure\n    at chrome-extension://wallet/inject.js:1:47\n    at async load (${own}:1:41)`,
        `wallet@moz-extension://wallet/inject.js:1:47\nasync*load@${own}:1:41`,
        `Error: failure\n    at Module.fail (${own}?cache=(1):1:31)`,
        `Error: failure\n    at ${own}?cache=(1):1:31`,
        `fail@${own}?cache=(1):1:31`,
    ])('one own frame qualifies, including stack-only rejections', (stack) => {
        const error = errorWithStack(stack);
        expect(classify({ source: own, error })).toBe('own');
        expect(classify({ error })).toBe('own');
        expect(classify({ source: page, error })).toBe('foreign');
    });
});
