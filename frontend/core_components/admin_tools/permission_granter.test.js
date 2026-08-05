// permission_granter.test.js
// Verifies row-based permission save helpers used by the shared checkbox-table integration.
// Bridges changed-cell payloads and backend permission endpoint calls in a jsdom-friendly unit surface.
// Exists to keep manage_permissions save behavior stable after the DOM-grid migration.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../state_stores/table_specs_reader.js", () => ({
    getAllSpecs: vi.fn(() => ({
        app_users: { table_uid: "101" },
        app_orders: { table_uid: "202" },
    })),
}));

import {
    savePermissionRowsForMultipleTables,
    savePermissionRowsTableless,
} from "./permission_granter.js";

describe("savePermissionRowsForMultipleTables", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("expands changed cells across all selected tables and PATCHes add/remove", async () => {
        const endpointRouter = vi.fn().mockResolvedValue({ message: "ok" });
        const middleware = vi.fn().mockResolvedValue(true);

        await savePermissionRowsForMultipleTables({
            changedCells: [
                { rowId: "11", columnKey: "group_5", nextValue: true },
                { rowId: "12", columnKey: "group_6", nextValue: false },
            ],
            targetTableNames: ["app_users", "app_orders"],
            functionAccessMiddleware: middleware,
            endpoint_router: endpointRouter,
        });

        expect(middleware).toHaveBeenCalledWith("save_permissions");
        expect(endpointRouter).toHaveBeenCalledWith("datasetPermissions", {
            method: "PATCH",
            body_data: {
                add: [
                    { user_group_id: 5, function_id: 11, target_schema_name: "public", target_dataset_name: "app_users", target_table_uid: 101 },
                    { user_group_id: 5, function_id: 11, target_schema_name: "public", target_dataset_name: "app_orders", target_table_uid: 202 },
                ],
                remove: [
                    { user_group_id: 6, function_id: 12, target_schema_name: "public", target_dataset_name: "app_users", target_table_uid: 101 },
                    { user_group_id: 6, function_id: 12, target_schema_name: "public", target_dataset_name: "app_orders", target_table_uid: 202 },
                ],
            },
        });
    });

    test("returns null when there are no row-based changes", async () => {
        const endpointRouter = vi.fn();
        const middleware = vi.fn().mockResolvedValue(true);

        const result = await savePermissionRowsForMultipleTables({
            changedCells: [],
            targetTableNames: ["app_users"],
            functionAccessMiddleware: middleware,
            endpoint_router: endpointRouter,
        });

        expect(result).toBeNull();
        expect(endpointRouter).not.toHaveBeenCalled();
    });
});

describe("savePermissionRowsTableless", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("computes tableless diff from changed cells and POSTs normalized permissions", async () => {
        const endpointRouter = vi.fn().mockResolvedValue({ message: "ok" });
        const middleware = vi.fn().mockResolvedValue(true);

        await savePermissionRowsTableless({
            changedCells: [
                { rowId: "10", columnKey: "group_2", nextValue: false },
                { rowId: "12", columnKey: "group_3", nextValue: true },
            ],
            existingPermissions: [
                { user_group_id: 2, function_id: 10, target_dataset_name: "" },
                { user_group_id: 2, function_id: 11, target_dataset_name: "" },
            ],
            functionAccessMiddleware: middleware,
            endpoint_router: endpointRouter,
        });

        expect(middleware).toHaveBeenCalledWith("save_permissions");
        expect(endpointRouter).toHaveBeenCalledWith("datasetPermissions", {
            method: "POST",
            url_params: "",
            body_data: {
                permissions: [
                    { user_group_id: 2, function_id: 11, target_schema_name: "public", target_table_uid: null },
                    { user_group_id: 3, function_id: 12, target_schema_name: "public", target_table_uid: null },
                ],
            },
        });
    });
});
