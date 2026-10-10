// card_visibility_phone_browser.test.js
// Checks real pointer access to the shared field editor at phone, tablet and desktop widths.
// Connects the real palette, ordinary management entry, modal, tree and checkbox table.
// Uses in-memory endpoint fixtures; no server, database or network is contacted.
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const { chromium } = requireNodeDependency('playwright');
const { build } = requireNodeDependency('esbuild');
const frontendRoot = fileURLToPath(new URL('../../', import.meta.url));
const styles = [
    'styles/variables.css', 'styles/framework.css', 'styles/base.css',
    'core_components/admin_tools/manage_permissions.css',
    'core_components/admin_tools/presentation_palette.css',
    'reusable_components/modal/modals.css',
    'reusable_components/vanilla_tree/vanilla_tree.css',
    'reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.css',
].map(path => readFileSync(frontendRoot + path, 'utf8')).join('\n');

const entry = `
import { mountDatasetCoverTestPalette } from './core_components/admin_tools/dataset_cover_test_palette.js';
import { generate_card_visibility_form } from './core_components/admin_tools/card_visibility_view.js';
import { loadManagementView } from './reusable_components/dom_container_builder.js';
import { datasetAppearanceDefaultsForPlace } from './shared/dataset_appearance/validator.js';
import { datasetAppearanceState } from './core_components/table_views/dataset_appearance_state.js';
import { setAllSpecs } from './core_components/state_stores/table_specs_reader.js';
window.savedFields = [];
const snapshot = { schema_version: 2, dataset_uid: 11, version: '1', shared_version: 'site-1',
    tab_values: datasetAppearanceDefaultsForPlace('tab_only'), overrides: {},
    site_values: datasetAppearanceDefaultsForPlace('site_only'), defaults: datasetAppearanceDefaultsForPlace('site_default') };
window.fixtureVisibility = { table_name: 'orders', dataset_appearance: snapshot,
    columns: [{ column_uid: 1, column_name: 'palette_field', show_value_on_card: true }] };
setAllSpecs({ orders: { table_uid: 11 } });
localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [
    { id: 'orders', name: 'orders', table_uid: 11, parent_id: null },
    ...Array.from({ length: 70 }, (_, index) => ({ id: 'other_' + index, name: 'other_' + index,
        table_uid: 100 + index, parent_id: null }))
] }));
window.openFixture = async entry => {
    if (entry === 'ordinary') {
        await loadManagementView('card_visibility_container', generate_card_visibility_form);
    } else {
        window.palette = await mountDatasetCoverTestPalette(document.querySelector('#hero'), 'orders', {
            permissionCheck: () => true,
            requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
            settingsRequestFn: async () => ({ version: 'site-1', site_values: snapshot.site_values, defaults: snapshot.defaults }),
            datasetSettingsRequestFn: async () => structuredClone(window.fixtureVisibility)
        });
    }
};
window.appearanceDraft = () => datasetAppearanceState.effective('orders').shared.hero_extra_height;
`;

function exportedFunctions(path, implementation) {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)]
        .map(([, name]) => `export function ${name}(...args) { ${implementation(name)} }`).join('\n');
}

async function buildFixtureBundle() {
    const result = await build({
        stdin: { contents: entry, resolveDir: frontendRoot }, bundle: true, write: false,
        format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'isolated-field-editor-fixtures', setup(builder) {
            builder.onResolve({ filter: /^\/frontend\// }, args => ({ path: frontendRoot + args.path.slice('/frontend/'.length) }));
            builder.onLoad({ filter: /stable_endpoint_router\.js$/ }, args => ({ contents: exportedFunctions(args.path, name => {
                if (name === 'fetchCardVisibility') return 'return Promise.resolve(structuredClone(window.fixtureVisibility));';
                if (name === 'saveCardVisibility') return `window.savedFields.push(args[0]);
                    window.fixtureVisibility.columns = args[0].columns;
                    window.fixtureVisibility.dataset_appearance.version = '2';
                    return Promise.resolve({ dataset_presentation: { dataset_appearance: structuredClone(window.fixtureVisibility.dataset_appearance) } });`;
                return `throw new Error('Unexpected endpoint: ${name}');`;
            }) }));
            builder.onLoad({ filter: /route_permission_checker\.js$/ }, args => ({
                contents: exportedFunctions(args.path, () => 'return true;'),
            }));
            builder.onLoad({ filter: /translation_handler\.js$/ }, () => ({ contents: `
                const fi = { edit: 'Muokkaa', save: 'Tallenna', cancel: 'Peruuta',
                    card_visibility: 'Korttien näkyvyysasetukset', card_details_layout: 'Kortin tietojen asettelu',
                    column_name: 'Sarakkeen nimi', show_value_on_card: 'Näytä arvo kortissa' };
                export function getTranslationForKey(key, options) {
                    return (document.documentElement.lang === 'fi' && fi[key]) || options?.fallback || key;
                }
                export async function translatePage() {}
                export function hasLoadedTranslations() { return true; }
                export function readTranslatedLabelOrEmpty() { return ''; }
                export function getTranslationsForKey() { return {}; }
            ` }));
            builder.onLoad({ filter: /icons\/icon_loader\.js$/ }, args => ({
                contents: exportedFunctions(args.path, () => "return Promise.resolve('');"),
            }));
            builder.onLoad({ filter: /toast_notification_printer\.js$/ }, args => ({
                contents: exportedFunctions(args.path, () => 'return undefined;'),
            }));
            builder.onLoad({ filter: /dataset_header_config_modal\.js$/ }, () => ({
                contents: 'export async function openDatasetHeaderConfigModal() {} export function createDatasetHeaderConfigHeroButton() { return null; }',
            }));
        } }],
    });
    return result.outputFiles[0].text;
}

describe.runIf(process.env.FILTEREST_TEST_ISOLATED_BROWSER === '1')('field editor pointer access', () => {
    let browser, bundle;
    beforeAll(async () => {
        bundle = await buildFixtureBundle();
        browser = await chromium.launch({
            executablePath: process.env.FILTEREST_TEST_CHROMIUM_EXECUTABLE || undefined,
            args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
        });
    });
    afterAll(async () => { await browser?.close(); });

    const cases = [375, 768, 1440].flatMap(width => ['palette', 'ordinary'].flatMap(entry => [
        { width, entry, language: 'en', theme: 'light', osTheme: 'dark' },
        { width, entry, language: 'fi', theme: 'dark', osTheme: 'light' },
    ]));
    test.each(cases)('$entry at $width px in $language/$theme over $osTheme OS theme', async fixture => {
        const context = await browser.newContext({ viewport: { width: fixture.width, height: 667 },
            locale: fixture.language, colorScheme: fixture.osTheme, serviceWorkers: 'block' });
        try {
            await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html>' }));
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('https://field-editor.invalid/');
            await page.setContent(`<!DOCTYPE html><html lang="${fixture.language}"><head><style>${styles}</style></head>
                <body class="${fixture.theme}-mode"><section id="hero"></section><main id="tabs_container"></main></body></html>`);
            await page.addScriptTag({ content: bundle });
            await page.evaluate(entry => window.openFixture(entry), fixture.entry);
            if (fixture.entry === 'palette') {
                await page.getByTestId('dataset-cover-test-palette-button').click();
                const slider = page.getByTestId('dataset-cover-test-palette-hero-height');
                await slider.evaluate(el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
                await page.getByTestId('dataset-cover-test-palette-fieldEditor').click();
                expect(await page.getByTestId('dataset-cover-test-palette').isVisible()).toBe(false);
            } else {
                await page.locator('#tree_node_orders_cv_tree input[type="radio"]').check();
            }
            const edit = page.getByTestId('card-visibility-edit-button');
            await edit.waitFor();
            // Measure before clicking: entering edit mode replaces the Edit button with Save and Cancel.
            const bounds = await edit.boundingBox();
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(fixture.width);
            await edit.click({ timeout: 1500 });
            const tree = await page.locator('.mp-left-container').boundingBox();
            const matrix = await page.locator('#cv_matrix_container').boundingBox();
            if (fixture.width === 375) expect(matrix.y).toBeGreaterThanOrEqual(tree.y + tree.height);
            else expect(matrix.x).toBeGreaterThan(tree.x + tree.width);
            const checkbox = page.locator('#cv_matrix_container .vct-input-checkbox:enabled').first();
            await checkbox.setChecked(!(await checkbox.isChecked()), { timeout: 1500 });
            await page.getByTestId('card-visibility-save-button').click({ timeout: 1500 });
            await page.waitForFunction(() => window.savedFields.length === 1);
            const [saved] = await page.evaluate(() => window.savedFields);
            expect(saved).toMatchObject({ table_name: 'orders', version: '1', shared_version: 'site-1' });
            expect(saved.columns[0].card_detail_capitalization).toBe(true);
            if (fixture.entry === 'palette') {
                const dimensions = await page.locator('#custom_modal_body').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
                expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
                await page.keyboard.press('Escape');
                expect(await page.locator('#custom_modal_overlay').isVisible()).toBe(false);
                await page.getByTestId('dataset-cover-test-palette-button').click();
                expect(await page.getByTestId('dataset-cover-test-palette-hero-height').inputValue()).toBe('100');
                expect(await page.evaluate(() => window.appearanceDraft())).toBe(100);
            }
            expect(errors).toEqual([]);
        } finally { await context.close(); }
    }, 15000);
});
