// view_field_assignments_state.test.js
// Verifies deterministic site/group targets, safe field shaping, and exact API readback.
// Bridges representative field-set responses and the dedicated admin page's pure state layer.
// Exists so mixed assignments and target widening cannot regress behind DOM behavior.

import { describe, expect, test } from "vitest";
import {
    buildEditorFieldRows,
    buildMixedGroupViewFieldSetSavePayload,
    buildOrderedFieldRows,
    buildViewFieldSetSavePayload,
    cycleFieldVisibility,
    everyGroupVariantHasVisibleColumns,
    groupVariantsFromRows,
    resetAssignmentMatches,
    resolveAssignmentTarget,
    resolveEditorAssignment,
    savedAssignmentMatches,
    savedGroupVariantsMatch,
} from "./view_field_assignments_state.js";

const groups = [
    { group_id: 9, group_name: "Reviewers", field_set_id: 22, group_priority: 5 },
    { group_id: 2, group_name: "Editors", field_set_id: 22, group_priority: 5 },
    { group_id: 4, group_name: "Guests", field_set_id: null, group_priority: 0 },
];

function response(overrides = {}) {
    return {
        site_default_field_set_id: 20,
        metadata_visible_columns: ["id", "title"],
        field_sets: [
            { id: 20, name: "Site", scope: "shared", visible_columns: ["title"] },
            { id: 22, name: "Teams", scope: "shared", visible_columns: ["summary", "id"] },
        ],
        group_assignments: groups,
        ...overrides,
    };
}

describe("view field assignment state", () => {
    test("maps all groups to site, a subset to exact numeric IDs, and none to a closed mutation", () => {
        expect(resolveAssignmentTarget(["9", "2", "4"], groups)).toEqual({
            mutationAllowed: true,
            targetScope: "site",
            targetGroupIDs: [],
            selectedGroupIDs: [2, 4, 9],
        });
        expect(resolveAssignmentTarget(["9", "2", "bogus", "2"], groups)).toEqual({
            mutationAllowed: true,
            targetScope: "groups",
            targetGroupIDs: [2, 9],
            selectedGroupIDs: [2, 9],
        });
        expect(resolveAssignmentTarget([], groups).mutationAllowed).toBe(false);
    });

    test("uses a uniform group assignment and marks differing or inherited assignments mixed", () => {
        expect(resolveEditorAssignment(response(), [2, 9])).toMatchObject({
            mixed: false,
            fieldSetID: 22,
            fieldSetName: "Teams",
            groupPriority: 5,
            visibleColumns: ["summary", "id"],
        });
        expect(resolveEditorAssignment(response(), [2, 4])).toMatchObject({
            mixed: true,
            fieldSetID: null,
            visibleColumns: ["summary", "id"],
            groupVariants: [
                { group_id: 2, visible_columns: ["summary", "id"] },
                { group_id: 4, visible_columns: ["title"] },
            ],
        });
        expect(resolveEditorAssignment(response(), [4])).toMatchObject({
            mixed: false,
            fieldSetID: null,
            visibleColumns: ["title"],
        });
    });

    test("compares effective field values instead of collection row identities", () => {
        expect(resolveEditorAssignment(response({
            field_sets: [
                ...response().field_sets,
                { id: 23, name: "Equivalent", scope: "shared", visible_columns: ["summary", "id"] },
            ],
            group_assignments: [
                { group_id: 2, group_name: "Editors", field_set_id: 22, group_priority: 5 },
                { group_id: 4, group_name: "Guests", field_set_id: 23, group_priority: 5 },
                groups[0],
            ],
        }), [2, 4])).toMatchObject({
            mixed: false,
            fieldVisibilityMixed: false,
            visibleColumns: ["summary", "id"],
        });
    });

    test("keeps real field conflicts mixed when every group maps the write to the site layer", () => {
        const assignment = resolveEditorAssignment(response(), [2, 4, 9]);
        expect(assignment).toMatchObject({
            targetScope: "site",
            selectedGroupIDs: [2, 4, 9],
            mixed: true,
            fieldVisibilityMixed: true,
        });
        expect(assignment.groupVariants).toHaveLength(3);

        const rows = buildEditorFieldRows([
            { column_uid: 1, column_name: "id" },
            { column_uid: 2, column_name: "title" },
            { column_uid: 3, column_name: "summary" },
        ], assignment);
        expect(rows.find((field) => field.name === "id")?.visibilityState).toBe("mixed");
        expect(rows.find((field) => field.name === "title")?.visibilityState).toBe("mixed");

        const payload = buildMixedGroupViewFieldSetSavePayload({
            dataset: "orders",
            viewKey: "card",
            name: "All current groups",
            target: resolveAssignmentTarget([2, 4, 9], groups),
            groupVariants: groupVariantsFromRows(rows, assignment),
        });
        expect(payload.target_scope).toBe("groups");
        expect(payload.target_group_ids).toEqual([2, 4, 9]);
        expect(payload.group_variants.map((variant) => variant.group_priority))
            .toEqual([5, 0, 5]);
    });

    test("models only differing fields as mixed and cycles them back to their original group values", () => {
        const assignment = resolveEditorAssignment(response(), [2, 4]);
        const rows = buildEditorFieldRows([
            { column_uid: 1, column_name: "id" },
            { column_uid: 2, column_name: "title" },
            { column_uid: 3, column_name: "summary" },
            { column_uid: 4, column_name: "common" },
        ], {
            ...assignment,
            groupVariants: assignment.groupVariants.map((variant) => ({
                ...variant,
                visible_columns: [...variant.visible_columns, "common"],
            })),
        });

        expect(rows.find((field) => field.name === "common")?.visibilityState).toBe("visible");
        const title = rows.find((field) => field.name === "title");
        expect(title).toMatchObject({
            visibilityState: "mixed",
            initiallyMixed: true,
            visibleByGroup: { "2": false, "4": true },
        });
        const visible = cycleFieldVisibility(title);
        const hidden = cycleFieldVisibility(visible);
        const restored = cycleFieldVisibility(hidden);
        expect([visible.visibilityState, hidden.visibilityState, restored.visibilityState])
            .toEqual(["visible", "hidden", "mixed"]);
        expect(restored.visibleByGroup).toEqual({ "2": false, "4": true });
    });

    test("builds and verifies exact per-group variants while intermediate fields retain original values", () => {
        const assignment = resolveEditorAssignment(response(), [2, 4]);
        let rows = buildEditorFieldRows([
            { column_uid: 1, column_name: "id" },
            { column_uid: 2, column_name: "title" },
            { column_uid: 3, column_name: "summary" },
        ], assignment);
        rows = rows.map((field) => field.name === "id"
            ? cycleFieldVisibility(field)
            : field);
        const variants = groupVariantsFromRows(rows, assignment, "7");
        expect(variants).toEqual([
            { group_id: 2, group_priority: 7, visible_columns: ["summary", "id"] },
            { group_id: 4, group_priority: 7, visible_columns: ["id", "title"] },
        ]);
        expect(everyGroupVariantHasVisibleColumns(variants)).toBe(true);

        const payload = buildMixedGroupViewFieldSetSavePayload({
            dataset: "orders",
            viewKey: "card",
            name: "Selected groups",
            target: resolveAssignmentTarget([2, 4], groups),
            groupVariants: variants,
        });
        expect(payload.group_variants).toEqual(variants);
        expect(savedGroupVariantsMatch({
            ...response(),
            field_sets: [
                ...response().field_sets,
                { id: 31, name: "A", scope: "shared", visible_columns: ["summary", "id"] },
                { id: 32, name: "B", scope: "shared", visible_columns: ["id", "title"] },
            ],
            group_assignments: [
                { group_id: 2, group_name: "Editors", field_set_id: 31, group_priority: 7 },
                { group_id: 4, group_name: "Guests", field_set_id: 32, group_priority: 7 },
                groups[2],
            ],
        }, payload)).toBe(true);
    });

    test("filters server-only details, preserves UID labels, and allows id to be unchecked", () => {
        expect(buildOrderedFieldRows([
            { column_uid: 1, column_name: "id" },
            { column_uid: 2, column_name: "title" },
            { column_uid: 3, column_name: "embedding", client_delivery_mode: "server_only" },
        ], ["title"])).toEqual([
            { name: "title", columnUID: 2, visible: true },
            { name: "id", columnUID: 1, visible: false },
        ]);
    });

    test("keeps a newly hidden field in its prior editor position after verified readback", () => {
        expect(buildOrderedFieldRows([
            { column_uid: 1, column_name: "id" },
            { column_uid: 2, column_name: "title" },
            { column_uid: 3, column_name: "summary" },
        ], ["title", "summary"], ["title", "id", "summary"])).toEqual([
            { name: "title", columnUID: 2, visible: true },
            { name: "id", columnUID: 1, visible: false },
            { name: "summary", columnUID: 3, visible: true },
        ]);
    });

    test("builds the complete replace payload and requires exact group readback", () => {
        const target = resolveAssignmentTarget([2, 9], groups);
        const payload = buildViewFieldSetSavePayload({
            dataset: "orders",
            viewKey: "card",
            name: "Teams",
            fieldSetID: 22,
            visibleColumns: ["summary", "id"],
            target,
            groupPriority: 5,
        });
        expect(payload).toEqual({
            dataset: "orders",
            view_key: "card",
            field_set_id: 22,
            name: "Teams",
            visible_columns: ["summary", "id"],
            target_scope: "groups",
            target_group_ids: [2, 9],
            group_priority: 5,
            replace_targets: true,
        });
        expect(savedAssignmentMatches(response(), payload, 22)).toBe(true);
        expect(savedAssignmentMatches(response({
            group_assignments: [...groups, {
                group_id: 7, group_name: "Extra", field_set_id: 22, group_priority: 5,
            }],
        }), payload, 22)).toBe(false);
    });

    test("verifies restore only when selected direct assignments are absent", () => {
        const groupTarget = resolveAssignmentTarget([2], groups);
        expect(resetAssignmentMatches(response({
            group_assignments: groups.map((group) => group.group_id === 2
                ? { ...group, field_set_id: null }
                : group),
        }), groupTarget)).toBe(true);
        expect(resetAssignmentMatches(response(), groupTarget)).toBe(false);
        expect(resetAssignmentMatches(response({ site_default_field_set_id: null }), {
            targetScope: "site", targetGroupIDs: [],
        })).toBe(true);
    });
});
