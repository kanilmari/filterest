import { describe, test, expect } from 'vitest';
import {
    groupViewsByGroup,
    collectNodeIds,
    appendMissingAdminViews,
    getAdminToolsStructure,
} from './nav_builder_helpers.js';

// ---------------------------------------------------------------------------
// groupViewsByGroup
// ---------------------------------------------------------------------------
describe('groupViewsByGroup', () => {
    test('groups views by their group property', () => {
        const views = [
            { name: 'users', group: 'tables' },
            { name: 'orders', group: 'tables' },
            { name: 'permissions', group: 'admin_tools' },
        ];
        const result = groupViewsByGroup(views);
        expect(Object.keys(result)).toEqual(['tables', 'admin_tools']);
        expect(result.tables).toHaveLength(2);
        expect(result.admin_tools).toHaveLength(1);
    });

    test('returns empty object for empty array', () => {
        expect(groupViewsByGroup([])).toEqual({});
    });

    test('handles single view', () => {
        const views = [{ name: 'x', group: 'g1' }];
        const result = groupViewsByGroup(views);
        expect(result.g1).toHaveLength(1);
        expect(result.g1[0].name).toBe('x');
    });

    test('preserves view objects in groups', () => {
        const view = { name: 'test', group: 'g', extra: 42 };
        const result = groupViewsByGroup([view]);
        expect(result.g[0]).toBe(view);
    });
});

// ---------------------------------------------------------------------------
// collectNodeIds
// ---------------------------------------------------------------------------
describe('collectNodeIds', () => {
    test('collects IDs from flat list', () => {
        const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const ids = collectNodeIds(nodes);
        expect(ids).toEqual(new Set(['a', 'b', 'c']));
    });

    test('collects IDs from nested tree', () => {
        const nodes = [
            { id: 'root', children: [
                { id: 'child1' },
                { id: 'child2', children: [{ id: 'grandchild' }] },
            ] },
        ];
        const ids = collectNodeIds(nodes);
        expect(ids).toEqual(new Set(['root', 'child1', 'child2', 'grandchild']));
    });

    test('returns empty set for empty array', () => {
        expect(collectNodeIds([])).toEqual(new Set());
    });
});

// ---------------------------------------------------------------------------
// appendMissingAdminViews
// ---------------------------------------------------------------------------
describe('appendMissingAdminViews', () => {
    function makeStructure() {
        return [
            { id: 'permissions', name: 'permissions' },
            {
                id: 'table_tools', name: 'table_tools', children: [
                    { id: 'create_table', name: 'create_table' },
                    {
                        id: 'maintenance', name: 'maintenance', children: [
                            { id: 'empty_rows', name: 'empty_rows' },
                        ]
                    }
                ]
            }
        ];
    }

    test('appends views not present in structure to maintenance', () => {
        const structure = makeStructure();
        const views = [
            { name: 'empty_rows' },      // already in structure
            { name: 'permissions' },      // already in structure
            { name: 'new_tool_b' },       // missing — should be added
            { name: 'new_tool_a' },       // missing — should be added
        ];
        appendMissingAdminViews(structure, views);
        const maintenanceChildren = structure[1].children[1].children;
        expect(maintenanceChildren).toHaveLength(3); // original 1 + 2 new
        expect(maintenanceChildren[1].id).toBe('new_tool_a'); // sorted alphabetically
        expect(maintenanceChildren[2].id).toBe('new_tool_b');
    });

    test('does nothing when all views are known', () => {
        const structure = makeStructure();
        const views = [{ name: 'empty_rows' }, { name: 'permissions' }];
        appendMissingAdminViews(structure, views);
        expect(structure[1].children[1].children).toHaveLength(1);
    });

    test('does nothing when no maintenance node exists', () => {
        const structure = [{ id: 'simple', name: 'simple' }];
        const views = [{ name: 'new_tool' }];
        appendMissingAdminViews(structure, views);
        // Should not throw; structure unchanged
        expect(structure).toHaveLength(1);
    });

    test('handles empty views array', () => {
        const structure = makeStructure();
        appendMissingAdminViews(structure, []);
        expect(structure[1].children[1].children).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// getAdminToolsStructure
// ---------------------------------------------------------------------------
describe('getAdminToolsStructure', () => {
    test('returns top-level admin roots for permissions, queen chat, table tools, and maintenance', () => {
        const structure = getAdminToolsStructure();
        expect(structure).toHaveLength(4);
        expect(structure[0].id).toBe('permissions');
        expect(structure[1].id).toBe('queen_chat');
        expect(structure[2].id).toBe('table_tools');
        expect(structure[3].id).toBe('maintenance');
    });

    test('table_tools contains table-oriented config views while maintenance holds general upkeep views', () => {
        const structure = getAdminToolsStructure();
        const tableTools = structure.find((node) => node.id === 'table_tools');
        const maintenance = structure.find((node) => node.id === 'maintenance');
        expect(tableTools.children.length).toBeGreaterThanOrEqual(3);
        expect(maintenance).toBeDefined();
        expect(maintenance.children.length).toBeGreaterThan(0);
        expect(tableTools.children.some(c => c.id === 'card_visibility')).toBe(true);
        expect(tableTools.children.some(c => c.id === 'service_catalog_moderation')).toBe(true);
        expect(tableTools.children.some(c => c.id === 'dataset_alias_management')).toBe(true);
        expect(maintenance.children.some(c => c.id === 'database_consistency')).toBe(true);
        expect(maintenance.children.some(c => c.id === 'queen_chat')).toBe(false);
    });

    test('returns fresh copy each call (not shared reference)', () => {
        const a = getAdminToolsStructure();
        const b = getAdminToolsStructure();
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });
});
