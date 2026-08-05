// nav_builder.test.js
// Verifies sidebar custom-view groups render through the shared disclosure section shell.
// Bridges custom view groups, nav disclosure DOM, and admin tree mounting in jsdom.
// Exists so the navbar lower tool area stays visually aligned with filterbar sections.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hasRoutePermission } from '../../route_permission_checker.js';
import { render_tree } from '../../../reusable_components/vanilla_tree/vanilla_tree_builder.js';

vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: vi.fn(() => true),
}));

vi.mock('../nav_engine/navigation_handler.js', () => ({
    handle_all_navigation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
    render_tree: vi.fn(async (_data, config) => {
        const container = document.getElementById(config.container_id);
        if (container) {
            container.dataset.rendered = 'true';
        }
    }),
}));

describe('create_navigation_buttons', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="navContainer"></div>';
        vi.mocked(hasRoutePermission).mockReturnValue(true);
        vi.mocked(render_tree).mockClear();
        localStorage.clear();
    });

    test('renders admin and user tool groups as navbar disclosure sections', async () => {
        const { create_navigation_buttons } = await import('./nav_builder.js');

        await create_navigation_buttons([
            { name: 'permissions', group: 'admin_tools' },
            { name: 'user', group: 'user_tools' },
        ]);

        const sections = document.querySelectorAll('#navContainer > .navbar-disclosure-section');
        const adminHeader = document.querySelector('[data-testid="nav-group-admin_tools"]');
        const userHeader = document.querySelector('[data-testid="nav-group-user_tools"]');

        expect(sections).toHaveLength(2);
        expect(adminHeader?.classList.contains('collapsible')).toBe(true);
        expect(userHeader?.classList.contains('collapsible')).toBe(true);
        expect(adminHeader?.querySelector('[data-lang-key="admin_tools"]')).not.toBeNull();
        expect(userHeader?.querySelector('[data-lang-key="user_tools"]')).not.toBeNull();
        expect(render_tree).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ container_id: 'admin_tools_tree' })
        );
        expect(document.querySelector('#admin_tools_tree')).not.toBeNull();
        expect(document.querySelector('.navigation_buttons[data-lang-key="user"]')).not.toBeNull();
        expect(document.querySelector('#navContainer > button.collapsible')).toBeNull();
    });

    test('toggles the section state through the shared animated disclosure button', async () => {
        const { create_navigation_buttons } = await import('./nav_builder.js');

        await create_navigation_buttons([
            { name: 'user', group: 'user_tools' },
        ]);

        const section = document.querySelector('.navbar-disclosure-section');
        const header = section?.querySelector('.navbar-section-heading');

        expect(section?.dataset.disclosureState).toBe('collapsed');
        header?.click();
        expect(section?.dataset.disclosureState).toBe('expanded');
    });
});
