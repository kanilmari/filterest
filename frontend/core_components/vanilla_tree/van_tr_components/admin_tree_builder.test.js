// @vitest-environment jsdom
// admin_tree_builder.test.js
// Verifies project-boundary and top-tab visibility calculations for admin tree moves.
// Bridges cached tree node metadata and move-confirmation UX without requiring drag-and-drop DOM events.
// Exists to keep high-risk admin tree move logic stable when project roots and helper subfolders change.

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
    render_tree: vi.fn(),
}));

vi.mock('../../navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: {},
}));

vi.mock('../../navigation/nav_engine/navigation_handler.js', () => ({
    handle_all_navigation: vi.fn(),
}));

vi.mock('../../navigation/main_tabs/main_tab_printer.js', () => ({
    initTabs: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: vi.fn(),
}));

vi.mock('../../route_permission_checker.js', () => ({
    hasDatasetPermission: vi.fn(),
    hasRoutePermission: vi.fn(),
}));

vi.mock('./tree_node_rename_editor.js', () => ({
    openRenameDialog: vi.fn(),
}));

vi.mock('../../database_view_fetcher.js', () => ({
    loadDatabaseView: vi.fn(),
}));

vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showConfirmModal: vi.fn(),
    showInputModal: vi.fn(),
}));

vi.mock('../../state_stores/table_specs_reader.js', () => ({
    setAllSpecs: vi.fn(),
}));

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showAccessDeniedToast: vi.fn(),
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

function buildNodesById(nodes) {
    return new Map(nodes.map((node) => [node.id, node]));
}

describe('admin_tree_builder move helpers', () => {
    test('stores dataset icon keys in table specs for downstream hero rendering', async () => {
        localStorage.clear();
        document.body.innerHTML = '<div id="nav_tree"></div>';

        const { endpoint_router } = await import('../../endpoints/endpoint_router.js');
        const { hasRoutePermission } = await import('../../route_permission_checker.js');
        const { setAllSpecs } = await import('../../state_stores/table_specs_reader.js');
        vi.mocked(hasRoutePermission).mockImplementation((route) => route === '/ui/nav_tree');
        vi.mocked(endpoint_router).mockResolvedValue({
            nodes: [
                { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
                {
                    id: 't_tiketit',
                    db_id: 3173,
                    name: 'tiketit',
                    parent_id: 'f_1',
                    table_uid: '3157',
                    icon_key: 'task',
                },
            ],
        });

        const { initializeTreeCallAdmin } = await import('./admin_tree_builder.js');
        await initializeTreeCallAdmin({ forceRefresh: true });

        expect(setAllSpecs).toHaveBeenCalledWith(expect.objectContaining({
            tiketit: expect.objectContaining({
                table_uid: '3157',
                icon_key: 'task',
            }),
        }));
    });

    test('normalizes a legacy root other_tables node under the canonical database folder', async () => {
        const { normalizeLegacyOtherTablesNodes } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_15', db_id: 15, name: 'database', parent_id: 'null' },
            { id: 'f_150', db_id: 150, name: 'other_tables', parent_id: 'f_15' },
            { id: 'f_151', db_id: 151, name: 'other_tables', parent_id: 'null' },
            { id: 't_system_comments', db_id: 604, name: 'system_comments', parent_id: 'f_151', table_uid: '604' },
        ];

        const normalized = normalizeLegacyOtherTablesNodes(nodes);

        expect(normalized.filter((node) => node.id === 'f_151')).toHaveLength(0);
        expect(normalized.filter((node) => node.name === 'other_tables')).toHaveLength(1);
        expect(normalized.find((node) => node.id === 't_system_comments')?.parent_id).toBe('f_150');
    });

    test('identifies only first-level folders under Apps as project roots', async () => {
        const { isProjectRootFolderNode } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
            { id: 'f_18', db_id: 18, name: 'serlog', parent_id: 'f_1' },
            { id: 'f_19', db_id: 19, name: 'helpers', parent_id: 'f_18' },
        ];
        const nodesById = buildNodesById(nodes);

        expect(isProjectRootFolderNode(nodes[1], nodesById)).toBe(true);
        expect(isProjectRootFolderNode(nodes[2], nodesById)).toBe(false);
        expect(isProjectRootFolderNode(nodes[0], nodesById)).toBe(false);
    });

    test('marks table moves from project root to helper subfolder as tab-visibility changes', async () => {
        const { describeTreeMoveImpact, buildMoveConfirmationModalOptions } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
            { id: 'f_18', db_id: 18, name: 'serlog', parent_id: 'f_1' },
            { id: 'f_19', db_id: 19, name: 'helpers', parent_id: 'f_18' },
            { id: 't_app_service_catalog', db_id: 101, name: 'app_service_catalog', parent_id: 'f_18', table_uid: '77' },
        ];

        const impact = describeTreeMoveImpact({
            draggedNode: nodes[3],
            targetFolderNode: nodes[2],
            nodesById: buildNodesById(nodes),
        });
        const modal = buildMoveConfirmationModalOptions(impact);

        expect(impact.crossProjectBoundary).toBe(false);
        expect(impact.changesTopTabVisibility).toBe(true);
        expect(impact.targetWillBeVisibleInTabs).toBe(false);
        expect(modal?.confirmFlags).toEqual({
            confirm_cross_project_move: false,
            confirm_tab_visibility_change: true,
        });
        expect(modal?.modalOptions.messagePlainText).toContain('disappear from the project\'s main SVG tabs');
    });

    test('marks table moves between project roots as cross-project moves', async () => {
        const { describeTreeMoveImpact, buildMoveConfirmationModalOptions } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
            { id: 'f_18', db_id: 18, name: 'serlog', parent_id: 'f_1' },
            { id: 'f_21', db_id: 21, name: 'tukisuu', parent_id: 'f_1' },
            { id: 't_app_service_catalog', db_id: 101, name: 'app_service_catalog', parent_id: 'f_18', table_uid: '77' },
        ];

        const impact = describeTreeMoveImpact({
            draggedNode: nodes[3],
            targetFolderNode: nodes[2],
            nodesById: buildNodesById(nodes),
        });
        const modal = buildMoveConfirmationModalOptions(impact);

        expect(impact.crossProjectBoundary).toBe(true);
        expect(impact.sourceProjectName).toBe('serlog');
        expect(impact.targetProjectName).toBe('tukisuu');
        expect(modal?.confirmFlags).toEqual({
            confirm_cross_project_move: true,
            confirm_tab_visibility_change: false,
        });
        expect(modal?.modalOptions.messagePlainText).toContain('from project "serlog" to project "tukisuu"');
    });

    test('marks folder moves between project trees as cross-project moves', async () => {
        const { describeTreeMoveImpact } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
            { id: 'f_18', db_id: 18, name: 'serlog', parent_id: 'f_1' },
            { id: 'f_19', db_id: 19, name: 'helpers', parent_id: 'f_18' },
            { id: 'f_21', db_id: 21, name: 'tukisuu', parent_id: 'f_1' },
        ];

        const impact = describeTreeMoveImpact({
            draggedNode: nodes[2],
            targetFolderNode: nodes[3],
            nodesById: buildNodesById(nodes),
        });

        expect(impact.itemType).toBe('folder');
        expect(impact.crossProjectBoundary).toBe(true);
        expect(impact.changesTopTabVisibility).toBe(false);
    });

    test('uses subfolder-specific translation keys for the create-subfolder modal', async () => {
        const { buildCreateSubfolderInputModalOptions } = await import('./admin_tree_builder.js');

        expect(buildCreateSubfolderInputModalOptions()).toMatchObject({
            titleLangKey: 'create_subfolder',
            confirmLangKey: 'create_subfolder',
            labelLangKey: 'folder_name',
        });
    });

    test('finds only the active project root node ids for badge decoration', async () => {
        const { getCurrentProjectRootFolderIds } = await import('./admin_tree_builder.js');
        const nodes = [
            { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
            { id: 'f_18', db_id: 18, name: 'serlog', parent_id: 'f_1', is_current_project: true },
            { id: 'f_19', db_id: 19, name: 'helpers', parent_id: 'f_18', is_current_project: true },
            { id: 'f_21', db_id: 21, name: 'tukisuu', parent_id: 'f_1' },
        ];

        expect(getCurrentProjectRootFolderIds(nodes)).toEqual(['f_18']);
    });

    test('decorates only the current project node with a visible badge', async () => {
        const { decorateCurrentProjectFolderBadges } = await import('./admin_tree_builder.js');
        document.body.innerHTML = `
            <div id="nav_tree">
                <div class="node" data-db-id="18" data-node-id="f_18">
                    <div class="node-row">
                        <div class="toggle"></div>
                        <span><span data-lang-key="serlog">serlog</span></span>
                    </div>
                </div>
                <div class="node" data-db-id="18" data-node-id="t_system_column_details">
                    <div class="node-row">
                        <div class="toggle"></div>
                        <span><span data-lang-key="system_column_details">system_column_details</span></span>
                    </div>
                </div>
                <div class="node" data-db-id="21" data-node-id="f_21">
                    <div class="node-row">
                        <div class="toggle"></div>
                        <span><span data-lang-key="tukisuu">tukisuu</span></span>
                    </div>
                </div>
            </div>
        `;

        const treeContainer = document.getElementById('nav_tree');
        decorateCurrentProjectFolderBadges(treeContainer, ['f_18']);

        expect(treeContainer.querySelector('[data-node-id="f_18"]')?.getAttribute('data-current-project')).toBe('true');
        expect(treeContainer.querySelector('[data-node-id="f_18"] .tree-current-project-badge')?.textContent).toBe('Current');
        expect(treeContainer.querySelector('[data-node-id="f_18"] .tree-current-project-badge')?.getAttribute('data-lang-key')).toBe('current');
        expect(treeContainer.querySelector('[data-node-id="t_system_column_details"] .tree-current-project-badge')).toBeNull();
        expect(treeContainer.querySelector('[data-node-id="f_21"] .tree-current-project-badge')).toBeNull();
    });
});
