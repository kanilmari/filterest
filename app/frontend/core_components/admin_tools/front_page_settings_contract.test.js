// front_page_settings_contract.test.js
// Checks the Home tool's real navigation registration, route contracts and phone styles.
// Connects existing menu/pipeline owners with the added administration surface.
// Complements DOM interaction tests; browser theme/layout proof remains a separate check.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { getAdminToolsStructure } from '../navigation/database_tree/nav_builder_helpers.js';
import { getEndpointUrl } from '../pipeline/api_pipeline.js';
import { DYNAMIC_ROUTE_NAMES } from '../endpoints/stable_api_inventory.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDirectory, 'front_page_settings.css'), 'utf8');
const registry = readFileSync(resolve(currentDirectory, '../navigation/admin_and_user_tools/custom_view_reader.js'), 'utf8');
const imports = readFileSync(resolve(currentDirectory, '../../styles/imports.css'), 'utf8');

describe('Home administration contracts', () => {
    test('uses the existing Site settings tree and permission-gated management-view loader', () => {
        const settings = getAdminToolsStructure().find(node => node.id === 'site_settings');
        expect(settings.children).toContainEqual({ id: 'front_page_settings', name: 'front_page_settings' });
        expect(registry).toMatch(/name: 'front_page_settings',[\s\S]*?loadManagementView\('front_page_settings_container', generate_front_page_settings_view\)[\s\S]*?group: 'admin_tools',[\s\S]*?requiredPermission: '\/api\/admin\/front-page'/);
    });

    test('derives both admin endpoints from the generated backend manifest and classifies them', () => {
        expect(getEndpointUrl('adminFrontPage')).toBe('/api/admin/front-page');
        expect(getEndpointUrl('adminFrontPageBackground')).toBe('/api/admin/front-page/background');
        expect(DYNAMIC_ROUTE_NAMES).toContain('adminFrontPage');
        expect(DYNAMIC_ROUTE_NAMES).toContain('adminFrontPageBackground');
    });

    test('phone classes collapse blocks, search, add and focal inputs into one column', () => {
        expect(imports).toContain('admin_tools/front_page_settings.css');
        const phone = css.slice(css.indexOf('@media (width <= 720px)'));
        ['block', 'user-search', 'add-row', 'focal-fields'].forEach(name => expect(phone).toContain(`.front-page-settings-${name}`));
        expect(phone).toContain('grid-template-columns: minmax(0, 1fr);');
        expect(css).toMatch(/:is\(input, select, button\)[^{]*\{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
        expect(css).toContain(':focus-visible');
    });

    test('explicit application theme tokens own surfaces; warning/preview hidden states stay hidden', () => {
        expect(css).toContain('background: var(--bg_color_extreme);');
        expect(css).toContain('background: var(--input_bg_color);');
        expect(css).toContain('color: var(--text_color);');
        expect(css).not.toContain('prefers-color-scheme');
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        expect(css).toMatch(/\[hidden\]\s*\{\s*display: none !important;/);
    });
});
