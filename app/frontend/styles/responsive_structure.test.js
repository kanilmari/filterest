// @vitest-environment node
// responsive_structure.test.js
// Checks responsive source ownership and query structure without rendering CSS.
// Connects the linted stylesheet roots to ui_config.js and reviewed K461 debt.
// Keeps existing exceptions explicit while rejecting new or stale waivers.
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const configPath = 'app/frontend/ui_config.js';
const configSource = readFileSync(resolve(repositoryRoot, configPath), 'utf8');
const breakpointSource = configSource.match(/LAYOUT_BREAKPOINTS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1];
const bandNames = ['phone', 'tablet', 'navbarCollapsed', 'filterbarOverlay', 'cardStack', 'cardViewportStack'];
const bands = Object.fromEntries(bandNames.map(name =>
    [name, Number(breakpointSource?.match(new RegExp(`\\b${name}:\\s*(\\d+)\\b`))?.[1])]));
const allowedWidths = new Set(Object.values(bands));
const PHONE_QUERY = '(width <= 700px)';
const PHONE_BAND_MAX_PX = 768;
const NON_WIDTH_FEATURES = new Set(['hover', 'pointer', 'any-pointer', 'prefers-reduced-motion', 'prefers-color-scheme']);
const ownerMapPath = 'app/frontend/styles/responsive_owner_map.json';
const allowlistPath = 'app/frontend/styles/responsive_allowlist.json';

/** Decode name characters before PostCSS tokenizes escaped at-rule/feature names.
 * Keep strings, comments and structural escapes intact so CSS meaning is preserved.
 * Line numbers stay unchanged except for the single newline a hex escape consumes.
 */
export function decodeNameEscapes(cssText) {
    const parts = [];
    let quote = '';
    let inComment = false;
    for (let index = 0; index < cssText.length;) {
        const start = index;
        const character = cssText[index++];
        if (inComment) {
            if (character === '*' && cssText[index] === '/') {
                index++;
                inComment = false;
            }
        } else if (quote) {
            if (character === '\\' && index < cssText.length) index++;
            else if (character === quote) quote = '';
        } else if (character === '/' && cssText[index] === '*') {
            index++;
            inComment = true;
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '\\' && index < cssText.length && !/[\n\r\f]/.test(cssText[index])) {
            let codePoint = cssText.codePointAt(index);
            if (/[0-9a-f]/i.test(cssText[index])) {
                const digitsStart = index;
                while (index < cssText.length && index - digitsStart < 6 && /[0-9a-f]/i.test(cssText[index])) index++;
                codePoint = Number.parseInt(cssText.slice(digitsStart, index), 16);
                if (/[ \t\n\r\f]/.test(cssText[index] ?? '')) {
                    if (cssText[index] === '\r' && cssText[index + 1] === '\n') index++;
                    index++;
                }
            } else index += codePoint > 0xffff ? 2 : 1;
            // Null and invalid scalar values stay escaped, as does punctuation.
            if ((codePoint >= 0x80 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff))
                || (codePoint < 0x80 && /[a-z0-9_-]/i.test(String.fromCodePoint(codePoint)))) {
                parts.push(String.fromCodePoint(codePoint));
                continue;
            }
        }
        parts.push(cssText.slice(start, index));
    }
    return parts.join('');
}

// Keep nested functions intact so a numeric fragment cannot stand in for a width.
function widthConditions(params) {
    const clean = params.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const features = [];
    const stack = [];
    let bareWidth = false;
    for (const match of clean.matchAll(/\(|\)|(?<![\w-])(?:[a-z][\w-]*-)?(?:width|inline-size)(?![\w-])/gi)) {
        if (match[0] === '(') {
            const functionName = clean.slice(0, match.index).match(/[\w-]+$/)?.[0] || '';
            stack.push({ start: match.index - functionName.length, width: false });
        }
        else if (match[0] === ')') {
            const group = stack.pop();
            if (group?.width) features.push(clean.slice(group.start, match.index + 1));
        } else if (stack.length) {
            if (!stack.some(group => group.width)) stack.at(-1).width = true;
        }
        else bareWidth = true;
    }
    if (bareWidth || stack.some(group => group.width)) features.push(clean);
    return features.map(parseWidthCondition);
}

// Only complete, literal lengths are understood; em/rem use the initial 16px font.
function parseWidthCondition(text) {
    const length = String.raw`(\d*\.?\d+)(px|rem|em)`;
    const single = text.match(new RegExp(`^\\(\\s*(?:width|inline-size)\\s*(<=?|>=?)\\s*${length}\\s*\\)$`, 'i'));
    const colon = text.match(new RegExp(`^\\(\\s*(max|min)-(?:width|inline-size)\\s*:\\s*${length}\\s*\\)$`, 'i'));
    const range = text.match(new RegExp(`^\\(\\s*${length}\\s*(<=?)\\s*(?:width|inline-size)\\s*\\3\\s*${length}\\s*\\)$`, 'i'));
    const pixels = (amount, unit) => Number(amount) * (unit.toLowerCase() === 'px' ? 1 : 16);
    const values = range ? [pixels(range[1], range[2]), pixels(range[4], range[5])]
        : single ? [pixels(single[2], single[3])] : colon ? [pixels(colon[2], colon[3])] : [];
    const parsed = values.length > 0 && values.every(Number.isFinite);
    // Unknown expressions always enter the phone checks; there is no Infinity fallback.
    const bound = range ? values[1] : values[0];
    const phoneCandidate = !parsed || (single?.[1] === '>' ? bound < PHONE_BAND_MAX_PX : bound <= PHONE_BAND_MAX_PX);
    return { text, values, parsed, phoneCandidate };
}

function ancestors(node) {
    const result = [];
    for (let parent = node.parent; parent; parent = parent.parent) result.push(parent);
    return result;
}

function selectorClasses(selector) {
    // Ignore quoted attribute values so a filename is never treated as a class.
    const unquoted = selector.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    return [...new Set(unquoted.match(/[.#][\w-]+/g) || [])];
}

function deviationKey(item) {
    return JSON.stringify([item.file, item.rule, item.selector ?? item.query, item.detail]);
}

function formatDeviations(items) {
    return items.map(item => `${item.file}:${item.line} [${item.rule}] ${item.selector ?? item.query}: ${item.detail}`).join('\n');
}

/** One parse per stylesheet; inline self-tests use precisely the production checker. */
export function checkResponsiveStructure({ path, cssText, ownerMap = {}, allowlist = [] }) {
    const root = postcss.parse(decodeNameEscapes(cssText), { from: path });
    const deviations = [];
    const occurrences = new Map();
    const add = (rule, node, identity, detail) => {
        const key = JSON.stringify([rule, identity, detail]);
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        deviations.push({ file: path, rule, ...identity,
            detail: detail + (occurrence > 1 ? ` (occurrence ${occurrence})` : ''), line: node.source.start.line });
    };
    const phoneSections = [];
    root.walkAtRules(node => {
        const name = node.name.toLowerCase();
        if (!['media', 'container'].includes(name)) return;
        const conditions = widthConditions(node.params);
        const unparsed = conditions.filter(condition => !condition.parsed);
        for (const condition of unparsed) {
            add('h', node, { query: node.params }, `unparsed width expression: ${condition.text}`);
        }
        if (name === 'container') {
            if (conditions.some(condition => condition.parsed && condition.phoneCandidate)) {
                add('c', node, { query: node.params }, 'container band at or below 768px; intrinsic sizing only');
            }
            if (!unparsed.length) return;
        } else {
            if (conditions.some(condition => !condition.parsed
                || condition.values.some(value => !allowedWidths.has(value)))) {
                add('b', node, { query: node.params }, 'viewport width is outside the named layout bands');
            }
            if (!conditions.some(condition => condition.phoneCandidate)) return;
            if (node.params !== PHONE_QUERY) {
                add('a', node, { query: node.params }, `phone query must be exactly ${PHONE_QUERY}`);
            }
        }
        phoneSections.push(node);
    });
    const phoneSet = new Set(phoneSections);
    const inPhone = node => ancestors(node).some(parent => phoneSet.has(parent));
    const baseSelectors = new Set();
    const baseClasses = new Set();
    root.walkRules(node => {
        if (inPhone(node)) return;
        for (const selector of node.selectors) {
            baseSelectors.add(selector);
            selectorClasses(selector).forEach(name => baseClasses.add(name));
        }
    });

    phoneSections.forEach((section, index) => {
        if (index > 0) add('e', section, { query: section.params }, `additional phone section (${index + 1})`);
        if (section.parent !== root) add('e', section, { query: section.params }, 'phone section must be top-level');
        section.walkAtRules(node => {
            if (!['media', 'container', 'supports'].includes(node.name.toLowerCase())) return;
            const features = [...node.params.matchAll(/\(\s*([\w-]+)/g)].map(match => match[1]);
            if (node.name.toLowerCase() !== 'media' || widthConditions(node.params).length || !features.length
                || features.some(feature => !NON_WIDTH_FEATURES.has(feature))) {
                add('d', node, { query: node.params }, 'only non-width interaction, motion or color conditions may nest inside phone');
            }
        });
        // Only the nearest phone section owns each node, even in existing nested debt.
        section.walkRules(node => {
            if (ancestors(node).find(parent => phoneSet.has(parent)) !== section) return;
            for (const selector of node.selectors) {
                const classes = selectorClasses(selector);
                const foreign = classes.filter(name => ownerMap[name]
                    ? ownerMap[name] !== path : !baseClasses.has(name));
                if (ownerMap[selector] ? ownerMap[selector] !== path
                    : foreign.length || (!classes.length && !baseSelectors.has(selector))) {
                    add('f', node, { selector }, `no same-file base or ownership${foreign.length ? `: ${foreign.join(', ')}` : ''}`);
                }
            }
        });
        const importantOccurrences = new Map();
        section.walkDecls(node => {
            if (!node.important || ancestors(node).find(parent => phoneSet.has(parent)) !== section) return;
            const selector = ancestors(node).find(parent => parent.type === 'rule')?.selector || section.params;
            const identity = `${selector}|${node.prop}`;
            const occurrence = (importantOccurrences.get(identity) || 0) + 1;
            importantOccurrences.set(identity, occurrence);
            add('g', node, { selector }, `${node.prop}: ${node.value} !important (occurrence ${occurrence})`);
        });
    });
    if (phoneSections.length) {
        const first = ancestors(phoneSections[0]).find(node => node.parent === root) || phoneSections[0];
        for (const node of root.nodes.slice(root.nodes.indexOf(first) + 1)) {
            if (node.type === 'rule') add('e', node, { selector: node.selector }, 'top-level style rule follows the phone section');
        }
    }

    // Exact matches permit existing debt, not every future occurrence of a query.
    const remaining = [...deviations];
    for (const entry of allowlist.filter(item => item.file === path)) {
        const index = remaining.findIndex(item => deviationKey(item) === deviationKey(entry));
        if (index >= 0) remaining.splice(index, 1);
        else remaining.push({ ...entry, line: 1, detail: `stale allow-list entry: ${entry.detail}` });
    }
    return remaining;
}

// Mirror css_lint_scope.test.js: frontend plus optional components, excluding dist.
function maintainedStylesheets(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (['dist', 'node_modules'].includes(entry.name)
            || /secret|token|password|credential|\.key$|\.pem$|\.env$|^\.env|^keys$|^\.ssh$|^\.codex$/i.test(entry.name)) return [];
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? maintainedStylesheets(path) : entry.name.endsWith('.css') ? [path] : [];
    });
}

describe('responsive structure', () => {
    test('CSS phone literal and named bands agree with ui_config.js source', () => {
        expect(bands.phone).toBe(700);
        expect(bandNames.every(name => Number.isFinite(bands[name]))).toBe(true);
        expect(allowedWidths.size).toBe(bandNames.length);
    });

    test('maintained CSS has no new deviations or stale allow-list entries', () => {
        const ownerMap = JSON.parse(readFileSync(resolve(repositoryRoot, ownerMapPath), 'utf8'));
        const allowlist = JSON.parse(readFileSync(resolve(repositoryRoot, allowlistPath), 'utf8'));
        const files = ['app/frontend', 'app/components'].flatMap(directory => maintainedStylesheets(resolve(repositoryRoot, directory))).sort();
        const paths = new Set(files.map(path => relative(repositoryRoot, path)));
        expect(allowlist.filter(item => !paths.has(item.file)), 'waivers for removed stylesheets').toEqual([]);
        expect(new Set(allowlist.map(deviationKey)).size, 'duplicate waivers').toBe(allowlist.length);
        for (const item of allowlist) {
            expect(item.reason).toMatch(/^pre-existing on [0-9a-f]{40} \(K461\)$/);
            expect(item.selector ?? item.query).toBeTruthy();
            expect(item.detail).toBeTruthy();
        }
        for (const [selector, owner] of Object.entries(ownerMap)) {
            if (selector === '_instructions') continue;
            expect(paths.has(owner), `missing owner for ${selector}`).toBe(true);
        }
        const deviations = files.flatMap(path => checkResponsiveStructure({
            path: relative(repositoryRoot, path), cssText: readFileSync(path, 'utf8'), ownerMap, allowlist,
        }));
        expect(deviations, `Responsive structure deviations:\n${formatDeviations(deviations)}`).toEqual([]);
    });
});

describe('responsive structure guard rejects new deviations', () => {
    const path = 'app/frontend/styles/inline.css';
    const check = (cssText, options = {}) => checkResponsiveStructure({ path, cssText, ...options });
    test('decodes hexadecimal and simple name escapes with optional whitespace', () => {
        for (const [escaped, plain] of [
            [String.raw`.b\31 x`, '.b1x'], ['.b\\31\tx', '.b1x'], ['.b\\31\nx', '.b1x'],
            ['.b\\31\r\nx', '.b1x'], ['.b\\31\fx', '.b1x'], [String.raw`\-\_\g`, '-_g'],
            [String.raw`\e9 \1f98b \é\🦋`, 'é🦋é🦋'],
        ]) expect(decodeNameEscapes(escaped), escaped).toBe(plain);
    });
    test('preserves punctuation, null, invalid, newline and trailing escapes exactly', () => {
        for (const escaped of [
            String.raw`.md\:flex \. \3a  \2c  \0 \000000 \22 \27 \7b \7d \2f \28 \29 \a `,
            String.raw`\110000 \d800 \\69`, 'a\\\nb', 'a\\\r\nb', 'a\\\fb', 'trailing\\',
        ]) expect(decodeNameEscapes(escaped), escaped).toBe(escaped);
    });
    test('leaves quoted strings with their own escapes and comments untouched', () => {
        const untouched = String.raw`"\69 " '\69 ' /* \69 */ "escaped \" \69 " '\'\69 ' "\\\69 "`;
        expect(decodeNameEscapes(untouched)).toBe(untouched);
        expect(decodeNameEscapes(untouched + String.raw` .b\31 x`)).toBe(untouched + ' .b1x');
    });
    test('escaped gate calc input equals plain input with all six deviations', () => {
        const escaped = String.raw`.own {}
@media (w\69 dth <= calc(700px)) { .foreign { color: red !important; } }
.after {}`;
        const failures = check(escaped, { allowlist: [], ownerMap: {} });
        expect(failures).toEqual(check(escaped.replace(String.raw`w\69 dth`, 'width'), { allowlist: [], ownerMap: {} }));
        expect(failures.map(item => item.rule)).toEqual(['h', 'b', 'a', 'f', 'g', 'e']);
    });
    test('escaped media name equals plain media and reports foreign ownership', () => {
        const plain = check('@media (width <= 700px) { .foreign {} }');
        expect(check(String.raw`@m\65 dia (width <= 700px) { .foreign {} }`)).toEqual(plain);
        expect(plain.map(item => item.rule)).toEqual(['f']);
    });
    test.each([String.raw`wid\th`, String.raw`w\000069dth`])('escaped phone feature %s equals plain width', feature => {
        expect(check(`@media (${feature} <= 700px) { .foreign {} }`))
            .toEqual(check('@media (width <= 700px) { .foreign {} }'));
    });
    test.each([
        ['a', '.own {} @media (width <= 720px) { .own { color: red; } }'],
        ['b', '@media (width >= 1201px) { .own {} }'],
        ['c', '@container card (max-width: 600px) { .own {} }'],
        ['d', '.own {} @media (width <= 700px) { @media (width >= 1060px) { .own {} } }'],
        ['e', '.own {} @media (width <= 700px) { .own {} } .after {}'],
        ['f', '@media (width <= 700px) { .foreign { color: red; } }'],
        ['g', '.own {} @media (width <= 700px) { .own { color: red !important; } }'],
    ])('rejects rule %s with a source location', (rule, cssText) => {
        const failures = check(cssText);
        expect(failures).toContainEqual(expect.objectContaining({ file: path, rule, line: 1 }));
        expect(formatDeviations(failures)).toContain(`${path}:1 [${rule}]`);
    });

    test.each(['(max-width: 700px)', '(width < 700px)', '(700px >= width)', '(width <= 43.75rem)',
        '(width <= 700px), (any-pointer: coarse)'])('rejects alternate phone syntax: %s', query => {
        expect(check(`.own {} @media ${query} { .own {} }`).map(item => item.rule)).toContain('a');
    });
    test.each(['width', 'inline-size'])('completely parses supported %s forms and units', feature => {
        for (const [expression, values, phoneCandidate] of [
            [`(${feature} <= 700px)`, [700], true], [`(${feature} < 43.75em)`, [700], true],
            [`(${feature} >= 1060px)`, [1060], false], [`(${feature} > 66.25rem)`, [1060], false],
            [`(max-${feature}: 43.75rem)`, [700], true], [`(min-${feature}: 66.25em)`, [1060], false],
            [`(${feature} >= 700px)`, [700], true], [`(min-${feature}: 650px)`, [650], true],
            [`(${feature} > 768px)`, [768], false], [`(${feature} >= 768px)`, [768], true],
            [`(700px <= ${feature} <= 1100px)`, [700, 1100], false],
            [`(43.75em < ${feature} < 43.75rem)`, [700, 700], true],
        ]) {
            for (const prefix of ['', 'card ']) {
                expect(widthConditions(prefix + expression)).toEqual([
                    { text: expression, values, parsed: true, phoneCandidate },
                ]);
            }
        }
        expect(check(`.own {} @media (${feature} >= 1060px) { .own {} }
            @container card (min-${feature}: 66.25rem) { .own {} }`)).toEqual([]);
    });
    test.each([
        ['media', '(width <= calc(700px))'],
        ['media', '(width <= calc(100vw - 1rem))'],
        ['media', '(width <= var(--phone))'],
        ['container', '(width < calc(100vw - 1rem))'],
        ['media', '(max-width: 50%)'],
        ['media', '(width <= 700)'],
        ['media', '(width <= env(viewport-width))'],
        ['media', '(width <= clamp(600px, 50vw, 700px))'],
        ['media', '(width = 700px)'],
        ['media', '(700px >= width)'],
        ['media', '(width <= 700px + 1px)'],
        ['media', '(width <= 700 px)'],
        ['media', '(width <= 700pxfoo)'],
        ['media', '(max-device-width: 700px)'],
        ['media', 'unknown(width <= 700px)'],
        ['media', '(inline-size <= var(--phone))'],
        ['container', '(max-inline-size: 50%)'],
    ])('rejects unparsed width expression in @%s %s with rule h', (kind, query) => {
        const failures = check(`.own {}\n@${kind} ${query} { .foreign { color: red !important; } }\n.after {}`);
        expect(failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ file: path, rule: 'h', query, line: 2 }),
            expect.objectContaining({ rule: 'f', selector: '.foreign', line: 2 }),
            expect.objectContaining({ rule: 'g', selector: '.foreign', line: 2 }),
            expect.objectContaining({ rule: 'e', selector: '.after', line: 3 }),
        ]));
        expect(formatDeviations(failures)).toContain(`${path}:2 [h] ${query}: unparsed width expression:`);
    });
    test('gate calc input fails on h and f/g/e with empty allow-list and owner map', () => {
        const failures = check('.own {}\n@media (width <= calc(700px)) { .foreign { color: red !important; } }\n.after {}', {
            allowlist: [], ownerMap: {},
        });
        expect(failures.map(item => item.rule)).toEqual(expect.arrayContaining(['h', 'f', 'g', 'e']));
    });
    test('unparsed widths cannot hide beside parsed widths or inside nested phone conditions', () => {
        expect(check('.own {} @media (width >= 1060px), (inline-size <= calc(700px)) { .foreign {} }')
            .map(item => item.rule)).toEqual(expect.arrayContaining(['h', 'f']));
        expect(check('@media (width <= 700px) { @container card (inline-size < var(--phone)) { .foreign {} } }')
            .map(item => item.rule)).toEqual(expect.arrayContaining(['h', 'd', 'e', 'f']));
        expect(widthConditions('((width <= 700px) and (hover: hover))')).toEqual([
            { text: '(width <= 700px)', values: [700], parsed: true, phoneCandidate: true },
        ]);
    });
    test('accepts same-file rules, named bands, intrinsic containers and nested non-width conditions', () => {
        expect(check(`.own {} @media (width >= 1060px) { .own {} }
            @container (width > 768px) { .own {} }
            @media (width <= 700px) { @media (hover: hover) and (pointer: fine) and (any-pointer: fine)
                and (prefers-reduced-motion: reduce) and (prefers-color-scheme: dark) { .own { color: red; } } }`)).toEqual([]);
    });
    test('requires a single outer phone section', () => {
        expect(check('@media (hover: hover) { @media (width <= 700px) {} }').map(item => item.rule)).toContain('e');
        expect(check('@media (width <= 700px) {} @media (width <= 700px) {}').map(item => item.rule)).toEqual(['e']);
    });
    test('rejects nested container width gates and undocumented conditions', () => {
        expect(check('@media (width <= 700px) { @container (width > 1060px) {} }').map(item => item.rule)).toEqual(['d']);
        expect(check('@media (width <= 700px) { @media (orientation: portrait) {} }').map(item => item.rule)).toEqual(['d']);
    });
    test('respects explicit owners, including shared classes with local base rules', () => {
        expect(check('@media (width <= 700px) { .shared {} }', { ownerMap: { '.shared': path } })).toEqual([]);
        expect(check('.shared {} @media (width <= 700px) { .shared {} }', {
            ownerMap: { '.shared': 'app/frontend/styles/other.css' },
        }).map(item => item.rule)).toEqual(['f']);
    });
    test('waives only exact deviations, and rejects stale or repeated waivers', () => {
        const cssText = '@container (max-width: 600px) { .own {} }';
        const allowlist = check(cssText);
        expect(check(cssText, { allowlist })).toEqual([]);
        expect(check('', { allowlist })[0].detail).toContain('stale allow-list entry');
        expect(check(`${cssText} ${cssText}`, { allowlist })).toHaveLength(1);
        expect(check(cssText, { allowlist: [...allowlist, ...allowlist] })[0].detail).toContain('stale allow-list entry');
    });
});
