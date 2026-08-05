// permission_editor.test.js
// Verifies the manage_permissions integration now renders through reusable checkbox tables.
// Bridges permission data, tree selection events, and the shared table component in a jsdom runtime.
// Exists to protect the refactor from regressing scoped/tableless permission behavior.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

let permissionsData = [];

vi.mock("../../reusable_components/dom_container_builder.js", () => ({
    loadManagementView: vi.fn(async (_id, renderFn) => {
        const container = document.createElement("div");
        container.id = "permissions_container";
        document.body.appendChild(container);
        await renderFn(container);
        return container;
    }),
}));

vi.mock("./permission_checker.js", () => ({
    fetch_all_functions: vi.fn(async () => ([
        { id: 1, name: "globalLogin", url_route_endpoint: "/api/login", specific_table_related: false, ui_only: false },
        { id: 2, name: "updateRow", url_route_endpoint: "/api/update-row", specific_table_related: true, ui_only: false },
    ])),
    fetch_user_groups: vi.fn(async () => ([
        { id: 10, name: "Admins" },
        { id: 20, name: "Editors" },
    ])),
}));

vi.mock("./permission_granter.js", () => ({
    savePermissionRowsForMultipleTables: vi.fn(async () => ({ message: "saved scoped" })),
    savePermissionRowsTableless: vi.fn(async () => ({ message: "saved tableless" })),
}));

vi.mock("../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(async (name) => {
        if (name === "datasetPermissions") {
            return permissionsData;
        }
        return {};
    }),
}));

vi.mock("../function_access_checker.js", () => ({
    functionAccessMiddleware: vi.fn(async () => true),
}));

vi.mock("./permission_icons.js", () => ({
    table_icon_svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>',
    ui_icon_svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>',
    global_icon_svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8H0z"/></svg>',
    edit_icon_svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h6v6H0z"/></svg>',
    ensurePermissionIconsLoaded: vi.fn(async () => {}),
}));

vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showInfoToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock("../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: vi.fn(async () => true),
}));

vi.mock("../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn(() => ""),
}));

vi.mock("../vanilla_tree/van_tr_components/admin_tree_builder.js", () => ({
    renderTableSelectorTree: vi.fn(async () => {}),
}));

function addTreeNode(id, tableName, tableUid = "1") {
    const node = document.createElement("div");
    node.id = id;
    node.setAttribute("data-table-uid", tableUid);
    const span = document.createElement("span");
    span.setAttribute("data-lang-key", tableName);
    node.appendChild(span);
    document.body.appendChild(node);
}

describe("generate_permissions_form", () => {
    beforeEach(() => {
        permissionsData = [
            { target_dataset_name: "", function_id: 1, user_group_id: 10 },
            { target_dataset_name: "app_users", function_id: 2, user_group_id: 10 },
        ];
        localStorage.clear();
        document.body.innerHTML = "";
        delete window.check_manage_permissions_dirty;
    });

    test("renders tableless and scoped permission tables and disables scoped edit without selection", async () => {
        const { generate_permissions_form } = await import("./permission_editor.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        await generate_permissions_form(container);

        const sectionTitles = Array.from(container.querySelectorAll(".mp-table-section-title")).map((node) => node.textContent);
        expect(sectionTitles).toEqual([
            "Taulukohtaiset oikeudet",
            "Yleiset oikeudet",
        ]);

        const tables = container.querySelectorAll(".vct-root");
        expect(tables).toHaveLength(2);

        const scopedTable = tables[0];
        scopedTable.querySelector(".vct-btn-edit").click();
        const scopedCheckbox = scopedTable.querySelector(".vct-input-checkbox");
        expect(scopedCheckbox).not.toBeNull();
        expect(scopedCheckbox.disabled).toBe(true);
    });

    test("shows cell-level hover edit button inside readonly permission cells and clicking it opens edit mode", async () => {
        const { generate_permissions_form } = await import("./permission_editor.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        await generate_permissions_form(container);

        const tablelessTable = container.querySelectorAll(".vct-root")[1];
        const editButton = tablelessTable.querySelector(".vct-row .vct-cell-checkbox .vct-cell-edit-button");
        expect(editButton).not.toBeNull();
        expect(editButton.closest(".vct-cell")).not.toBeNull();
        expect(editButton.closest(".vct-toolbar")).toBeNull();
        expect(editButton.querySelector("svg")).not.toBeNull();

        editButton.click();

        expect(tablelessTable.querySelector(".vct-btn-save")).not.toBeNull();
        expect(tablelessTable.querySelector(".vct-input-checkbox")).not.toBeNull();
    });

    test("shows ambiguous scoped state across multiple selected tables", async () => {
        addTreeNode("tree-users", "app_users", "11");
        addTreeNode("tree-orders", "app_orders", "12");

        const { generate_permissions_form } = await import("./permission_editor.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        await generate_permissions_form(container);

        document.dispatchEvent(new CustomEvent("checkboxSelectionChanged", {
            detail: { selectedCategories: ["tree-users", "tree-orders"] },
        }));

        await Promise.resolve();
        await Promise.resolve();

        const scopedTable = container.querySelectorAll(".vct-root")[0];
        const ambiguousIndicator = scopedTable.querySelector(".vct-checkbox-indicator[data-state=\"ambiguous\"]");
        expect(ambiguousIndicator).not.toBeNull();
        expect(ambiguousIndicator.textContent).toBe("~");

        scopedTable.querySelector(".vct-btn-edit").click();
        const scopedCheckbox = scopedTable.querySelector(".vct-input-checkbox");
        expect(scopedCheckbox.indeterminate).toBe(true);
    });
});
