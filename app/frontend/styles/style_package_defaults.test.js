// style_package_defaults.test.js
// Resolves changed declaration defaults from source CSS without a browser.
// Connects a pre-change fixture to real imports, theme inheritance and token consumers.
// Guards identical defaults in both explicit themes over either OS preference.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../server_tools/lib/node_dependency_loader.mjs';
import baseline from '../../testing/shared_contracts/style_package_default_declarations.json' with { type: 'json' };
import contract from '../shared/style_package/definition.json' with { type: 'json' };

const postcss = requireNodeDependency('postcss');
const applicationRoot = process.cwd();
const parsed = new Map();
function stylesheet(file) {
    if (!parsed.has(file)) parsed.set(file, postcss.parse(fs.readFileSync(path.join(applicationRoot, file), 'utf8')));
    return parsed.get(file);
}

// Resolve only the var() and simple spacing arithmetic used by these declarations.
// Font-size clamp is checked numerically below. This is not a general CSS engine.
function resolveValue(value, variables, seen = []) {
    let result = value;
    while (result.includes('var(')) {
        const start = result.indexOf('var(');
        let depth = 1;
        let end = start + 4;
        let comma = -1;
        for (; end < result.length && depth > 0; end++) {
            if (result[end] === '(') depth++;
            else if (result[end] === ')') depth--;
            else if (result[end] === ',' && depth === 1 && comma === -1) comma = end;
        }
        if (depth !== 0) throw new Error('Unbalanced CSS variable');
        const name = result.slice(start + 4, comma === -1 ? end - 1 : comma).trim();
        if (seen.includes(name)) throw new Error(`Circular CSS variable ${name}`);
        const fallback = comma === -1 ? undefined : result.slice(comma + 1, end - 1).trim();
        const replacement = variables[name] ?? fallback;
        if (replacement === undefined) throw new Error(`Missing CSS variable ${name}`);
        result = result.slice(0, start) + resolveValue(replacement, variables, [...seen, name]) + result.slice(end);
    }
    return result.replace(/calc\(([\d.]+)px\s*([*/])\s*([\d.]+)\)/g,
        (_, left, operation, right) => `${operation === '*' ? Number(left) * Number(right) : Number(left) / Number(right)}px`);
}

function systemRuleApplies(rule, osTheme) {
    for (let parent = rule.parent; parent; parent = parent.parent)
        if (parent.type === 'atrule' && parent.name === 'media') {
            if (parent.params === '(prefers-color-scheme: dark)') return osTheme === 'dark';
            return false;
        }
    return true;
}

function themeVariables(theme, osTheme) {
    const foundation = ['frontend/styles/variables.css', 'frontend/styles/framework.css'];
    const root = {};
    for (const file of foundation) stylesheet(file).walkRules(rule => {
        if (rule.selector !== ':root' || !systemRuleApplies(rule, osTheme)) return;
        rule.walkDecls(declaration => { if (declaration.prop.startsWith('--')) root[declaration.prop] = declaration.value; });
    });
    // Inherited custom properties are already computed on their owning element.
    const inherited = Object.fromEntries(Object.entries(root).map(([key, value]) => [key, resolveValue(value, root)]));
    const body = { ...inherited };
    for (const file of foundation) stylesheet(file).walkRules(rule => {
        if (!rule.selector.split(',').map(value => value.trim()).includes(`body.${theme}-mode`)
            || !systemRuleApplies(rule, osTheme)) return;
        rule.walkDecls(declaration => { if (declaration.prop.startsWith('--')) body[declaration.prop] = declaration.value; });
    });
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, resolveValue(value, body)]));
}

function declarationFor(entry) {
    let value;
    stylesheet(entry.file).walkRules(rule => {
        if (rule.selector !== entry.selector) return;
        rule.walkDecls(entry.property, declaration => { value = declaration.value; });
    });
    if (value === undefined) throw new Error(`Missing declaration: ${entry.name}`);
    return value;
}

describe('unchanged style-package defaults (source CSS, no browser)', () => {
    for (const theme of ['light', 'dark']) for (const osTheme of ['light', 'dark']) {
        describe(`application ${theme}, OS ${osTheme}`, () => {
            const variables = themeVariables(theme, osTheme);
            test.each(baseline)('$name', entry => {
                const actual = declarationFor(entry);
                for (const key of entry.tokens ?? [entry.token]) expect(actual).toContain(`var(${contract.tokens[key].css},`);
                expect(resolveValue(actual, variables)).toBe(resolveValue(entry.before, variables));
            });
            test('named font, theme colour, spacing and radius checks', () => {
                const computed = (key, selector) => {
                    const entry = baseline.find(entry => entry.token === key && (!selector || entry.selector === selector));
                    return resolveValue(declarationFor(entry), variables);
                };
                expect(computed('font.body')).toBe('Arial, sans-serif');
                expect(computed('font.display')).toBe("'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif");
                expect(computed('body.letter-spacing')).toBe('0.5px');
                expect(computed('body.line-height')).toBe('1.5');
                expect(computed('home.slogan-size')).toBe('1.25rem');
                expect(computed('home.description-size')).toBe('1rem');
                expect(computed('home.block-radius')).toBe('4px');
                expect(computed('navigation.radius')).toBe('8px');
                expect(computed('card.radius', '.fw-card')).toBe('10px');
                expect(computed('card.radius', '.product-card-view-card')).toBe('8px');
                expect(computed('card.padding', '.fw-card')).toBe('16px');
                expect(computed('card.padding', '.product-card-view-body')).toBe('12px');
                expect(computed('navigation.background')).toBe(`hsl(207 ${theme === 'light' ? '8% 100%' : '20% 12%'})`);
                expect(computed('heading.color')).toBe(`hsl(207 ${theme === 'light' ? '30% 15%' : '10% 99%'})`);
            });
        });
    }
    test('the responsive title keeps its existing computed size at phone/tablet/desktop widths', () => {
        const entry = baseline.find(entry => entry.token === 'heading.size');
        const clamp = resolveValue(declarationFor(entry), {}).match(/^clamp\(([\d.]+)rem, ([\d.]+)vw, ([\d.]+)rem\)$/);
        expect(clamp).not.toBeNull();
        const pixels = width => Math.max(Number(clamp[1]) * 16, Math.min(Number(clamp[2]) * width / 100, Number(clamp[3]) * 16));
        expect(pixels(360)).toBe(24);
        expect(pixels(768)).toBe(24);
        expect(pixels(1024)).toBe(30.72);
        expect(pixels(1440)).toBe(35.2);
    });
    test('every consumed token has exactly one definition and approved source scope', () => {
        const css = Object.values(contract.tokens).map(rule => rule.css);
        expect(new Set(css).size).toBe(css.length);
        const consumerKeys = new Set(baseline.flatMap(entry => entry.tokens ?? [entry.token]));
        // Emphasis and reveal are contracts for the bounded Home additions in slice 6.
        expect(Object.keys(contract.tokens).filter(key => !consumerKeys.has(key))).toEqual(['font.emphasis', 'home.reveal']);
        for (const file of new Set(baseline.map(entry => entry.file))) {
            const imported = fs.readFileSync(path.join(applicationRoot, 'frontend/styles/imports.css'), 'utf8');
            expect(imported).toContain(path.basename(file));
        }
    });
});
