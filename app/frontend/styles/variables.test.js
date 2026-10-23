// @vitest-environment node
// variables.test.js
// Checks colour-only mixes against every frontend custom-property definition.
// Connects variables.css and theme overrides to all maintained CSS consumers.
// Prevents image-valued properties from making colour mixes transparent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');
const valueParser = requireNodeDependency('postcss-value-parser');
const { globSync } = requireNodeDependency('glob');
const frontendRoot = fileURLToPath(new URL('..', import.meta.url));

function variableReferences(parsed) {
    const names = new Set();
    parsed.walk(node => {
        if (node.type === 'function' && node.value.toLowerCase() === 'var') {
            const name = node.nodes.find(child => child.type === 'word')?.value;
            if (name?.startsWith('--')) names.add(name);
        }
    });
    return names;
}

function imageMixViolations(stylesheets) {
    const declarations = [];
    const imageProperties = new Set();
    for (const [file, source] of Object.entries(stylesheets)) {
        postcss.parse(source, { from: file }).walkDecls(declaration => {
            const parsed = valueParser(declaration.value);
            const references = variableReferences(parsed);
            declarations.push({ file, declaration, parsed, references });
            parsed.walk(node => {
                if (declaration.prop.startsWith('--') && node.type === 'function'
                    && /^(?:(?:repeating-)?(?:linear|radial|conic)-gradient|url)$/i.test(node.value)) {
                    imageProperties.add(declaration.prop);
                }
            });
        });
    }
    // Union all definitions, including media rules and separate theme files.
    // Propagate through aliases and fallbacks until cycles reach a fixed point.
    let changed;
    do {
        changed = false;
        for (const { declaration, references } of declarations) {
            if (declaration.prop.startsWith('--') && !imageProperties.has(declaration.prop)
                && [...references].some(name => imageProperties.has(name))) {
                imageProperties.add(declaration.prop);
                changed = true;
            }
        }
    } while (changed);

    const violations = [];
    for (const { file, declaration, parsed } of declarations) {
        parsed.walk(node => {
            if (node.type !== 'function' || node.value.toLowerCase() !== 'color-mix') return;
            const argumentsParsed = valueParser(valueParser.stringify(node.nodes));
            for (const name of variableReferences(argumentsParsed)) {
                if (imageProperties.has(name)) {
                    violations.push(`${file}:${declaration.source.start.line}: ${declaration.prop} mixes ${name}`);
                }
            }
        });
    }
    return violations;
}

describe('colour mix image guard', () => {
    test.each([
        'linear-gradient(red, blue)', 'radial-gradient(red, blue)',
        'repeating-conic-gradient(red 0deg, blue 20deg)', 'url("panel.png")',
    ])('rejects a theme-only image value: %s', image => {
        expect(imageMixViolations({
            'variables.css': ':root { --panel: white; }',
            'theme.css': `@media (prefers-color-scheme: dark) { body.dark-mode { --panel: ${image}; } }`,
            'consumer.css': '.bar { background: color-mix(in srgb, var(--panel) 94%, transparent); }',
        })).toEqual(['consumer.css:1: background mixes --panel']);
    });

    test('follows aliases, fallback references and nested mixes without looping on cycles', () => {
        expect(imageMixViolations({
            'theme.css': ':root { --image: url(panel.png); --alias: var(--image); --panel: var(--unknown, var(--alias)); --a: var(--b); --b: var(--a); }',
            'consumer.css': '.bar { background: linear-gradient(color-mix(in srgb, var(--panel), white), black); }',
        })).toEqual(['consumer.css:1: background mixes --panel']);
    });

    test('allows solid mixes beside direct image uses and ignores comments and strings', () => {
        expect(imageMixViolations({
            'variables.css': ':root { --panel: linear-gradient(red, blue); --solid: white; --label: "url(panel.png)"; }',
            'consumer.css': '.bar { /* color-mix(in srgb, var(--panel), white) */ background: var(--panel); color: color-mix(in srgb, var(--solid), transparent); content: "color-mix(in srgb, var(--panel), white)"; }',
        })).toEqual([]);
    });

    test('frontend color mixes never reference image-valued theme properties', () => {
        const files = globSync('**/*.css', {
            cwd: frontendRoot, dot: true, ignore: ['**/dist/**', '**/node_modules/**'],
        }).sort();
        expect(files).toContain('styles/variables.css');
        const stylesheets = Object.fromEntries(files.map(file => [file,
            readFileSync(join(frontendRoot, file), 'utf8')]));
        expect(imageMixViolations(stylesheets)).toEqual([]);
    });

    test('every filter-panel theme has the solid surface companion and preserves light colours', () => {
        const variables = postcss.parse(readFileSync(new URL('variables.css', import.meta.url), 'utf8'));
        let definitions = 0;
        variables.walkDecls('--filter_panel_bg', declaration => {
            definitions++;
            const companion = declaration.parent.nodes.find(node => node.prop === '--filter_panel_bg_color');
            expect(companion?.value, declaration.parent.selector).toBe('var(--bg-surface)');
            if (!declaration.parent.selector.includes('dark-mode')) expect(companion.value).toBe(declaration.value);
        });
        expect(definitions).toBeGreaterThan(0);
    });
});
