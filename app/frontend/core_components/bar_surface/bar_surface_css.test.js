// Guards the bar-surface contract: consumers keep today's value as the fallback, the frosted file
// only sets variables that have consumers, and every one of them returns to solid on request.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');

const FRONTEND = 'frontend';
const FROSTED = 'frontend/core_components/bar_surface/bar_surface_frosted.css';
const frosted = postcss.parse(readFileSync(FROSTED, 'utf8'));

function sources(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === 'dist' || name === 'node_modules') continue;
        if (statSync(path).isDirectory()) sources(path, out);
        else if (/\.(css|js)$/.test(name) && !/\.test\.js$/.test(name) && path !== FROSTED) out.push(path);
    }
    return out;
}
const consumerText = sources(FRONTEND).map((path) => [path, readFileSync(path, 'utf8')]);

// Variables the frosted file sets on bar elements, outside the reset block.
const setVariables = new Set();
const resetVariables = new Set();
frosted.walkDecls(/^--bar-/, (decl) => {
    const media = decl.parent.parent?.type === 'atrule' ? decl.parent.parent.params : '';
    if (/prefers-reduced-transparency/.test(media)) resetVariables.add(decl.prop);
    else if (decl.parent.selector?.includes('#navbar') || /\.(filterbar|dataset-shared|front-page)/.test(decl.parent.selector)) {
        setVariables.add(decl.prop);
    }
});

describe('bar-surface variables', () => {
    test('the frosted file sets the expected panes and nothing outside the root attribute', () => {
        expect(setVariables.size).toBeGreaterThan(10);
        frosted.walkRules((rule) => {
            if (rule.parent.type === 'atrule' && /supports|width/.test(rule.parent.params)) return;
            if (rule.selector.startsWith('.bar-surface-switch-row')) return;
            expect(rule.selector.startsWith(':root[data-bar-surface="frosted"]'), rule.selector).toBe(true);
        });
    });

    test.each([...setVariables])('%s has a consumer whose fallback is today\'s value', (variable) => {
        const uses = consumerText.flatMap(([path, text]) => [...text.matchAll(new RegExp(`var\\(${variable}([,)])`, 'g'))]
            .map((match) => [path, match[1]]));
        expect(uses.length, `${variable} has no consumer`).toBeGreaterThan(0);
        for (const [path, next] of uses) expect(next, `${path} reads ${variable} without a fallback`).toBe(',');
    });

    test('less transparency, more contrast and forced colours reset every variable the frosted file sets', () => {
        expect([...resetVariables].sort()).toEqual([...setVariables].sort());
        let resetMedia = '';
        frosted.walkAtRules('media', (rule) => { if (/prefers-reduced-transparency/.test(rule.params)) resetMedia = rule.params; });
        expect(resetMedia).toBe('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
    });

    test('every pane rule shares one article/image-first gate (owner decision D4)', () => {
        const gate = ':root[data-bar-surface="frosted"]:not(:has(.image_first_view_overlay, '
            + '.content_div:not(.hidden) .dataset-shared-topbar[data-topbar-mode="article"]))';
        frosted.walkRules((rule) => {
            const setsPane = rule.nodes.some((node) => node.type === 'decl' && setVariables.has(node.prop));
            if (setsPane && !rule.parent.params) expect(rule.selector.startsWith(gate), rule.selector).toBe(true);
        });
    });

    test('the phone section is the file\'s last rule (K444)', () => {
        expect(frosted.last.type).toBe('atrule');
        expect(frosted.last.params).toBe('(width <= 700px)');
    });

    test('the filter panel keeps a backdrop filter in both states: it is the containing block of its fixed children', () => {
        const css = readFileSync('frontend/core_components/filterbar/filterbar_layout.css', 'utf8');
        expect(css).toContain('backdrop-filter: var(--bar-panel-backdrop, blur(20px));');
    });
});

test('the no-blur fallback outranks the dark-theme alpha, so dark panes do not stay 20% clear without blur', () => {
    let fallback = null;
    frosted.walkAtRules('supports', (rule) => { if (rule.params === 'not (backdrop-filter: blur(1px))') fallback = rule; });
    const selectors = [];
    fallback.walkRules((rule) => { if (rule.nodes.some((node) => node.prop === '--bar-alpha')) selectors.push(...rule.selectors); });
    expect(selectors).toContain(':root[data-bar-surface="frosted"] body.dark-mode');
});
