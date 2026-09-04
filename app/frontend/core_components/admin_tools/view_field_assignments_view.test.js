// view_field_assignments_view.test.js
// Verifies the dedicated admin page's renderable views, group targets, field controls, and GET readback.
// Bridges mocked tree/multiselect interactions with the stable view-field-set endpoint wrappers.
// Exists so site/group assignments cannot widen, expose server-only fields, or report unverified saves.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
    reset: vi.fn(),
    renderTree: vi.fn(),
    confirm: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    extractDataset: vi.fn(),
    language: vi.fn(),
    pickerConfigs: [],
}));

vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    getViewFieldSets: mocks.get,
    saveSiteViewFieldSet: mocks.save,
    resetSharedViewFieldSet: mocks.reset,
}));
vi.mock("../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: mocks.language,
}));
vi.mock("../../reusable_components/vanilla_tree/vanilla_tree_builder.js", () => ({
    render_tree: mocks.renderTree,
}));
vi.mock("../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js", () => ({
    createMultiselectDropdown: vi.fn((config) => {
        mocks.pickerConfigs.push(config);
        const input = document.createElement("input");
        input.className = "msd-dropdown-input";
        input.placeholder = config.placeholder;
        config.containerElement.appendChild(input);
        return { destroy: vi.fn(), setDisabled: vi.fn() };
    }),
}));
vi.mock("../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: mocks.confirm,
}));
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showSuccessToast: mocks.success,
    showWarningToast: mocks.warning,
}));
vi.mock("./tree_selection_helpers.js", () => ({
    extractFirstSelectedTableName: mocks.extractDataset,
}));

const baseResponse = {
    dataset: "orders",
    view_key: "card",
    can_edit_site_default: true,
    site_default_field_set_id: 20,
    metadata_visible_columns: ["id", "title"],
    available_columns: ["id", "title"],
    available_column_details: [
        { column_uid: 1, column_name: "id" },
        { column_uid: 2, column_name: "title" },
        { column_uid: 3, column_name: "embedding", client_delivery_mode: "server_only" },
    ],
    field_sets: [
        { id: 20, name: "Site fields", scope: "shared", visible_columns: ["title"] },
        { id: 22, name: "Team fields", scope: "shared", visible_columns: ["id"] },
    ],
    group_assignments: [
        { group_id: 2, group_name: "Editors", field_set_id: 22, group_priority: 5 },
        { group_id: 4, group_name: "Guests", field_set_id: null, group_priority: 0 },
        { group_id: 9, group_name: "Reviewers", field_set_id: 22, group_priority: 5 },
    ],
};

async function createLoadedView(response = baseResponse) {
    mocks.get.mockResolvedValue(response);
    const { generate_view_field_assignments_view } = await import(
        "./view_field_assignments_view.js"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.setItem("full_tree_data", JSON.stringify({ nodes: [{ id: "orders-node" }] }));
    await generate_view_field_assignments_view(container);
    document.dispatchEvent(new CustomEvent("checkboxSelectionChanged", {
        detail: { selectedCategories: ["orders-node"] },
    }));
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith("orders", "card"));
    await vi.waitFor(() => expect(container.querySelectorAll(
        ".view-field-assignments__field-row"
    )).toHaveLength(2));
    return container;
}

describe("view_field_assignments_view", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        sessionStorage.clear();
        mocks.pickerConfigs.length = 0;
        [mocks.get, mocks.save, mocks.reset, mocks.renderTree, mocks.confirm,
            mocks.success, mocks.warning, mocks.extractDataset, mocks.language]
            .forEach((mock) => mock.mockReset());
        mocks.language.mockReturnValue("en");
        mocks.extractDataset.mockReturnValue("orders");
        mocks.confirm.mockResolvedValue(true);
        mocks.save.mockResolvedValue({ field_set_id: 30 });
        mocks.reset.mockResolvedValue({ status: "ok" });
    });

    test("renders only real views, selects every real group, and labels safe fields with UIDs", async () => {
        const container = await createLoadedView();

        expect(mocks.renderTree).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            render_mode: "checkbox",
            selection_mode: "single",
            checkbox_mode: "leaf",
            show_search: true,
        }));
        const viewValues = Array.from(container.querySelectorAll(
            '[data-testid="view-field-assignments-view"] option'
        )).map((option) => option.value);
        expect(viewValues).toContain("card");
        expect(viewValues).not.toContain("article");
        expect(mocks.pickerConfigs[0]).toMatchObject({
            allowExclude: false,
            initialState: { includeValues: ["2", "4", "9"] },
        });
        expect(container.textContent).toContain("UID 1");
        expect(container.textContent).toContain("UID 2");
        expect(container.textContent).not.toContain("embedding");
        const idRow = Array.from(container.querySelectorAll(".view-field-assignments__field-row"))
            .find((row) => row.dataset.fieldName === "id");
        expect(idRow.querySelector('input[type="checkbox"]').checked).toBe(false);
        expect(idRow.querySelector('input[type="checkbox"]').indeterminate).toBe(true);
        expect(idRow.querySelector('input[type="checkbox"]').disabled).toBe(false);
        expect(container.querySelector('[data-testid="view-field-assignments-mixed"]').hidden)
            .toBe(false);
        expect(localStorage.key(0)).toBe("full_tree_data");

        const priorityHelpButton = container.querySelector(
            '[data-testid="view-field-assignments-priority-help-button"]'
        );
        const priorityHelp = container.querySelector(
            '[data-testid="view-field-assignments-priority-help"]'
        );
        priorityHelpButton.click();
        expect(priorityHelp.hidden).toBe(false);
        expect(priorityHelp.textContent).toContain("larger number wins");
        expect(priorityHelpButton.getAttribute("aria-expanded")).toBe("true");
    });

    test("preserves an exact group selection when the administrator switches views", async () => {
        const container = await createLoadedView();
        mocks.pickerConfigs[0].onChange({ includeValues: ["2"] });
        mocks.get.mockResolvedValueOnce({ ...baseResponse, view_key: "table" });

        const viewSelect = container.querySelector(
            '[data-testid="view-field-assignments-view"]'
        );
        viewSelect.value = "table";
        viewSelect.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith("orders", "table"));
        await vi.waitFor(() => expect(mocks.pickerConfigs).toHaveLength(2));
        expect(mocks.pickerConfigs[1].initialState).toEqual({ includeValues: ["2"] });
        expect(JSON.parse(sessionStorage.getItem("view_field_assignments_admin_session_v1")))
            .toMatchObject({ viewKey: "table", selectedGroupIDs: ["2"] });
    });

    test("restores the exact group selection when the administrator returns to the tool", async () => {
        const firstContainer = await createLoadedView();
        mocks.pickerConfigs[0].onChange({ includeValues: ["9"] });
        firstContainer.__cleanupListeners();
        firstContainer.remove();

        await createLoadedView();

        expect(mocks.pickerConfigs.at(-1).initialState).toEqual({ includeValues: ["9"] });
    });

    test("cycles mixed fields through visible, hidden, and unchanged before exact variant readback", async () => {
        const readback = {
            ...baseResponse,
            site_default_field_set_id: 20,
            field_sets: [
                ...baseResponse.field_sets,
                { id: 30, name: "Editors variant", scope: "shared", visible_columns: ["id"] },
                { id: 31, name: "Guests variant", scope: "shared", visible_columns: ["id", "title"] },
            ],
            group_assignments: [
                { group_id: 2, group_name: "Editors", field_set_id: 30, group_priority: 7 },
                { group_id: 4, group_name: "Guests", field_set_id: 31, group_priority: 7 },
                { group_id: 9, group_name: "Reviewers", field_set_id: 22, group_priority: 5 },
            ],
        };
        mocks.get.mockResolvedValueOnce(baseResponse).mockResolvedValueOnce(readback);
        const container = await createLoadedView(baseResponse);
        mocks.pickerConfigs[0].onChange({ includeValues: ["2", "4"] });

        expect(container.querySelector('[data-testid="view-field-assignments-mixed"]').hidden)
            .toBe(false);
        const idRow = Array.from(container.querySelectorAll(".view-field-assignments__field-row"))
            .find((row) => row.dataset.fieldName === "id");
        const idCheckbox = idRow.querySelector('input[type="checkbox"]');
        expect(idCheckbox.indeterminate).toBe(true);
        expect(idCheckbox.getAttribute("aria-checked")).toBe("mixed");
        idCheckbox.click();
        expect(idCheckbox.checked).toBe(true);
        expect(idCheckbox.indeterminate).toBe(false);
        idCheckbox.click();
        expect(idCheckbox.checked).toBe(false);
        idCheckbox.click();
        expect(idCheckbox.indeterminate).toBe(true);
        idCheckbox.click();
        expect(idCheckbox.checked).toBe(true);
        container.querySelector('[data-testid="view-field-assignments-name"]').value = "Mixed replacement";
        container.querySelector('[data-testid="view-field-assignments-priority"]').value = "7";
        container.querySelector('[data-testid="view-field-assignments-save"]').click();

        await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
            messageLangKey: "view_field_assignments_mixed_confirm",
        }));
        expect(mocks.save).toHaveBeenCalledWith({
            dataset: "orders",
            view_key: "card",
            field_set_id: 0,
            name: "Mixed replacement",
            target_scope: "groups",
            target_group_ids: [2, 4],
            replace_targets: true,
            group_variants: [
                { group_id: 2, group_priority: 7, visible_columns: ["id"] },
                { group_id: 4, group_priority: 7, visible_columns: ["id", "title"] },
            ],
        });
        await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledWith(
            "Field assignment saved and verified"
        ));
    });

    test("uses a proper subset as exact groups, disables empty targets, and restores through GET", async () => {
        const readback = {
            ...baseResponse,
            group_assignments: [
                { group_id: 2, group_name: "Editors", field_set_id: null, group_priority: 0 },
                { group_id: 4, group_name: "Guests", field_set_id: null, group_priority: 0 },
                { group_id: 9, group_name: "Reviewers", field_set_id: 22, group_priority: 5 },
            ],
        };
        mocks.get.mockResolvedValueOnce(baseResponse).mockResolvedValueOnce(readback);
        const container = await createLoadedView(baseResponse);
        const picker = mocks.pickerConfigs[0];
        picker.onChange({ includeValues: [] });
        expect(container.querySelector('[data-testid="view-field-assignments-save"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="view-field-assignments-restore"]').disabled).toBe(true);

        picker.onChange({ includeValues: ["2"] });
        container.querySelector('[data-testid="view-field-assignments-restore"]').click();
        await vi.waitFor(() => expect(mocks.reset).toHaveBeenCalledWith({
            dataset: "orders",
            view_key: "card",
            target_scope: "groups",
            target_group_ids: [2],
        }));
        await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledWith(
            "Inheritance restored and verified"
        ));
    });

    test("keeps save closed when every presentation field is hidden", async () => {
        const container = await createLoadedView();
        mocks.pickerConfigs[0].onChange({ includeValues: ["2"] });
        for (const checkbox of container.querySelectorAll('[data-testid="view-field-assignment-visible"]')) {
            if (checkbox.checked) checkbox.click();
        }

        expect(container.querySelector('[data-testid="view-field-assignments-save"]').disabled)
            .toBe(true);
        expect(container.querySelector('[data-testid="view-field-assignments-field-warning"]').hidden)
            .toBe(false);
        expect(mocks.save).not.toHaveBeenCalled();
    });
});
