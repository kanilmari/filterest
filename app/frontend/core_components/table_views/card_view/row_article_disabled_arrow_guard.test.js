// row_article_disabled_arrow_guard.test.js
// Parses every frontend stylesheet to enforce the sole disabled image-arrow alpha.
// Resolves nested selector subjects and conditional declarations before checking alpha.
// Keeps unrelated components out of the shared gallery-arrow regression boundary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../../server_tools/lib/node_dependency_loader.mjs';

// Resolve the existing Stylelint/PostCSS dependencies through the installation loader.
const postcss = requireNodeDependency('postcss');
const selectorParser = requireNodeDependency('postcss-selector-parser');
const valueParser = requireNodeDependency('postcss-value-parser');
const ARROWS = new Set(['row_article_image_first_arrow', 'big_card_thumbnail_carousel_button']);
const ALPHA = '--row-article-image-arrow-visible-alpha';
const CANONICAL = ':is(.row_article_image_first_arrow, .big_card_thumbnail_carousel_button):disabled';

/** Alternatives of the selector's subject compound, including nested :is/:where.
 * Ancestor/sibling disabled states and :has/:not arguments are not the subject.
 */
function subjectStates(selector) {
    const lastCombinator = selector.nodes.findLastIndex(node => node.type === 'combinator');
    let states = [{ arrow: false, disabled: false }];
    for (const node of selector.nodes.slice(lastCombinator + 1)) {
        let alternatives = [{ arrow: node.type === 'class' && ARROWS.has(node.value),
            disabled: node.type === 'pseudo' && node.value === ':disabled'
                || node.type === 'attribute' && (node.attribute === 'disabled'
                    || node.attribute === 'aria-disabled' && node.value?.toLowerCase() === 'true') }];
        if (node.type === 'pseudo' && [':is', ':where'].includes(node.value)) {
            alternatives = node.nodes.flatMap(subjectStates);
        }
        states = states.flatMap(state => alternatives.map(other => ({
            arrow: state.arrow || other.arrow, disabled: state.disabled || other.disabled,
        })));
    }
    return states;
}

/** Conditional blocks inherit their nearest selector, at any nesting depth. */
function owningRule(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'rule') return parent;
    }
    return null;
}

/** CSS nesting binds & to the entire parent selector list, like :is().
 * Without &, a nested rule is an implicit descendant, not the parent's subject.
 */
function resolvedSelectors(rule, cache) {
    if (cache.has(rule)) return cache.get(rule);
    const selectors = selectorParser().astSync(rule.selector);
    const parent = owningRule(rule);
    if (parent) {
        const context = selectorParser().astSync(`:is(${resolvedSelectors(parent, cache)})`).first.first;
        selectors.each(selector => {
            let explicit = false;
            selector.walkNesting(node => { node.replaceWith(context.clone()); explicit = true; });
            if (!explicit) {
                selector.prepend(selectorParser.combinator({ value: ' ' }));
                selector.prepend(context.clone());
            }
        });
    }
    cache.set(rule, selectors);
    return selectors;
}

/** Explicit colour alpha also changes the normal arrow skin at the shared opacity. */
function hasAlphaColour(value) {
    let found = false;
    const colours = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);
    valueParser(value).walk(node => {
        if (node.type === 'word' && (/^#(?:[\da-f]{4}|[\da-f]{8})$/i.test(node.value)
            || node.value.toLowerCase() === 'transparent')) found = true;
        if (node.type !== 'function') return;
        const name = node.value.toLowerCase();
        if (name === 'url') return false;
        if (colours.has(name) && (node.nodes.some(child => child.type === 'div' && child.value === '/')
            || ['rgba', 'hsla'].includes(name)
                && node.nodes.filter(child => child.type === 'div' && child.value === ',').length === 3)) found = true;
    });
    return found;
}

function inspect(css, filename = 'fixture.css') {
    const violations = [], canonical = [], canonicalRules = [], contexts = new Map();
    const stylesheet = postcss.parse(css, { from: filename });
    const isCanonical = rule => filename.endsWith('/row_article_image_controls.css')
        && rule.parent.type === 'root' && rule.selector === CANONICAL;
    stylesheet.walkRules(rule => {
        if (isCanonical(rule)) canonicalRules.push(rule.source.start.line);
    });
    // Walk declarations rather than direct rule children: @media/@supports/etc.
    // inherit selectors, while nested rules establish their own resolved subject.
    stylesheet.walkDecls(declaration => {
        const rule = owningRule(declaration);
        if (!rule) return;
        const selectors = resolvedSelectors(rule, contexts);
        if (!selectors.nodes.some(selector => subjectStates(selector).some(state => state.arrow && state.disabled))) return;
        const property = declaration.prop.toLowerCase();
        if (property !== 'opacity' && property !== ALPHA
            && !(property === 'filter' && /opacity\s*\(/i.test(declaration.value))
            && !hasAlphaColour(declaration.value)) return;
        // Only a direct declaration in the global owning rule is canonical.
        const approved = isCanonical(rule) && declaration.parent === rule
            && property === ALPHA && declaration.value.trim() === '0.28' && !declaration.important;
        const location = `${filename}:${declaration.source.start.line}: ${selectors} { ${declaration} }`;
        if (approved) canonical.push(location);
        else violations.push(location);
    });
    return { violations, canonical, canonicalRules };
}

function stylesheets(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        .flatMap(entry => {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) return entry.name === 'dist' ? [] : stylesheets(filename);
            return entry.isFile() && entry.name.endsWith('.css') ? [filename] : [];
        });
}

test('every frontend stylesheet shares exactly one disabled-arrow alpha of 0.28', () => {
    const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const results = stylesheets(directory).map(filename => inspect(fs.readFileSync(filename, 'utf8'), filename));
    expect(results.flatMap(result => result.violations)).toEqual([]);
    expect(results.flatMap(result => result.canonical)).toHaveLength(1);
    expect(results.flatMap(result => result.canonicalRules)).toHaveLength(1);
});

for (const selector of [
    '.row_article_image_first_arrow:disabled', '.big_card_thumbnail_carousel_button[disabled]',
    '.row_article_image_first_arrow[aria-disabled="true"]',
    ':is(.fw-btn, .row_article_image_first_arrow):disabled',
    ':where(.big_card_thumbnail_carousel_button, input)[disabled]',
    '.row_article_image_first_arrow:is(:hover, :where([disabled], [aria-disabled="true"]))',
    ':is(.toolbar > .row_article_image_first_arrow, input):disabled',
]) {
    test.each(['opacity: 0.5', 'filter: grayscale(1) opacity(50%)', `${ALPHA}: 0.5`])(
        `rejects ${selector} { %s } inside media blocks`, declaration => {
            expect(inspect(`@media (width < 700px) { ${selector} { ${declaration} } }`).violations).toHaveLength(1);
        });
}

test.each(['.fw-btn:disabled', 'input[disabled]', '.navbar [aria-disabled="true"]',
    '.row_article_image_first_arrow .fw-btn:disabled', '.row_article_image_first_arrow:has(input:disabled)',
    '.row_article_image_first_arrow:not(:disabled)', ':is(.row_article_image_first_arrow, .fw-btn:disabled)',
    '.other:where(.row_article_image_first_arrow:disabled) > input'])('ignores unrelated styles: %s', selector => {
    expect(inspect(`${selector} { opacity: 0.5 }`).violations).toEqual([]);
});

test('rejects a canonical duplicate in a media block or another stylesheet', () => {
    const rule = `${CANONICAL} { ${ALPHA}: 0.28 }`;
    expect(inspect(rule, '/row_article_image_controls.css').canonical).toHaveLength(1);
    expect(inspect(`@media (hover: none) { ${rule} }`, '/row_article_image_controls.css').violations).toHaveLength(1);
    expect(inspect(rule).violations).toHaveLength(1);
});

test('counts a duplicate canonical selector even when it has no alpha declaration', () => {
    const duplicate = `${CANONICAL} { --row-article-image-arrow-visible-alpha: 0.28; } ${CANONICAL} { box-shadow: none; }`;
    expect(inspect(duplicate, '/row_article_image_controls.css').canonicalRules).toHaveLength(2);
});

test.each([
    ['gate nested media', '.row_article_image_first_arrow:disabled { @media (width >= 700px) { opacity: 0.5; } }'],
    ['nested &:disabled', '.row_article_image_first_arrow { &:disabled { opacity: 0.5; } }'],
    ['filter opacity', '.row_article_image_first_arrow:disabled { filter: opacity(0.5); }'],
    ['alpha colour', '.row_article_image_first_arrow:disabled { color: rgb(255 255 255 / 0.5); }'],
    ['supports/layer declaration', '.row_article_image_first_arrow:disabled { @supports (display: grid) { @layer overrides { opacity: 0.5; } } }'],
    ['deep conditional nesting', '@layer overrides { .toolbar { @supports (display: grid) { & > .big_card_thumbnail_carousel_button { @container (width > 1px) { &:disabled { @media (hover: none) { opacity: 0.5; } } } } } } }'],
    ['nested selector lists', '.fw-btn, .big_card_thumbnail_carousel_button { @media (hover: none) { &:where([disabled], :hover) { filter: opacity(0.5); } } }'],
    ['implicit descendant', '.toolbar { .row_article_image_first_arrow[disabled] { opacity: 0.5; } }'],
    ['nested alpha property', `${CANONICAL} { @media (hover: none) { ${ALPHA}: 0.28; } }`],
])('rejects %s while preserving the canonical rule', (_name, competing) => {
    const result = inspect(`${CANONICAL} { ${ALPHA}: 0.28; } ${competing}`, '/row_article_image_controls.css');
    expect(result.violations).toHaveLength(1);
    expect(result.canonical).toHaveLength(1);
    expect(result.canonicalRules).toHaveLength(competing.startsWith(CANONICAL) ? 2 : 1);
});

test.each(['rgba(0, 0, 0, 0.5)', 'hsla(0, 0%, 0%, 50%)', '#0008', '#00000080',
    'oklch(50% 0.2 30 / var(--alpha))', 'transparent'])('rejects disabled arrow colour alpha: %s', colour => {
    expect(inspect(`.row_article_image_first_arrow { &:disabled { background: ${colour}; } }`).violations).toHaveLength(1);
});

test('accepts one clean canonical rule and nested unrelated or opaque styles', () => {
    const css = `${CANONICAL} { ${ALPHA}: 0.28; }
        .row_article_image_first_arrow { &:disabled { @supports (display: grid) { @layer skin { color: rgb(255 255 255); } } }
            & .fw-btn:disabled { opacity: 0.5; } }
        .row_article_image_first_arrow:disabled { & > .icon { opacity: 0.5; } }
        .fw-btn:disabled { @media (width > 1px) { opacity: 0.5; } }
        .toolbar:disabled { .row_article_image_first_arrow { opacity: 0.5; } }`;
    const result = inspect(css, '/row_article_image_controls.css');
    expect(result.violations).toEqual([]);
    expect(result.canonical).toHaveLength(1);
    expect(result.canonicalRules).toHaveLength(1);
});
