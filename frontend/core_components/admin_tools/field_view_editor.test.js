// field_view_editor.test.js
// Verifies the Tools editor loads, reorders, protects, and saves global fields.
// Bridges the shared modal with the manifest-backed card-visibility endpoint.
// Exists so the compact editor cannot bypass technical-field visibility guards.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    save: vi.fn(),
    hideModal: vi.fn(),
    showModal: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    refresh: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
    getOpened: vi.fn(),
    saveOpened: vi.fn(),
    language: vi.fn(),
}));

vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    fetchCardVisibility: mocks.fetch,
    saveCardVisibility: mocks.save,
}));

vi.mock("../../reusable_components/modal/modal_builder.js", () => ({
    createModal: vi.fn(({ contentElements, footerElements }) => {
        const modal = document.createElement("div");
        modal.id = "test-field-view-modal";
        modal.append(...contentElements, ...footerElements);
        document.body.appendChild(modal);
        return modal;
    }),
    hideModal: mocks.hideModal,
    showModal: mocks.showModal,
}));

vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showSuccessToast: mocks.success,
    showWarningToast: mocks.warning,
}));

vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: mocks.refresh,
}));

vi.mock("../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: mocks.getState,
    setUnifiedTableState: mocks.setState,
}));

vi.mock("../filterbar/filterbar_engine/filterbar_state_saver.js", () => ({
    getOpenedFilters: mocks.getOpened,
    saveOpenedFilters: mocks.saveOpened,
}));

vi.mock("../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: mocks.language,
}));

function buildColumn(overrides = {}) {
    return {
        column_uid: 2,
        column_name: "title",
        co_number: 2,
        hide_everywhere: false,
        hide_everywhere_locked: false,
        hide_everywhere_lock_reason: "",
        card_element: "details",
        show_key_on_card: true,
        show_value_on_card: true,
        ...overrides,
    };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("field_view_editor", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.language.mockReturnValue("en");
        mocks.getState.mockReturnValue({
            sort: { column: "title", direction: "asc" },
            filters: { title: "draft", summary_from: "a" },
            offset: 20,
        });
        mocks.getOpened.mockReturnValue(["title", "summary"]);
        mocks.fetch.mockResolvedValue({
            columns: [
                buildColumn({
                    column_uid: 1,
                    column_name: "id",
                    co_number: 1,
                    hide_everywhere_locked: true,
                    hide_everywhere_lock_reason: "primary_key",
                }),
                buildColumn(),
                buildColumn({
                    column_uid: 3,
                    column_name: "summary",
                    co_number: 3,
                }),
            ],
        });
        mocks.save.mockResolvedValue({ message: "Saved" });
        mocks.refresh.mockResolvedValue(undefined);
    });

    test("renders locked technical visibility and saves accessible reordering", async () => {
        const { openFieldViewEditor } = await import("./field_view_editor.js");
        await openFieldViewEditor("orders");

        const rows = document.querySelectorAll(".field-view-editor__row");
        expect(rows).toHaveLength(3);
        const lockedCheckbox = rows[0].querySelector(
            '[data-testid="field-view-hide-everywhere"]'
        );
        expect(lockedCheckbox.disabled).toBe(true);
        expect(rows[0].textContent).toContain("Required for row links and actions");

        const firstMoveDown = rows[0].querySelectorAll(".field-view-editor__move")[1];
        firstMoveDown.click();
        const reorderedNames = Array.from(
            document.querySelectorAll(".field-view-editor__field-name")
        ).map((node) => node.textContent);
        expect(reorderedNames).toEqual(["title", "id", "summary"]);

        document.querySelector('[data-testid="field-view-save"]').click();
        await flushAsyncWork();

        expect(mocks.save).toHaveBeenCalledWith({
            table_name: "orders",
            columns: [
                expect.objectContaining({ column_uid: 2, co_number: 1 }),
                expect.objectContaining({ column_uid: 1, co_number: 2 }),
                expect.objectContaining({ column_uid: 3, co_number: 3 }),
            ],
        });
        expect(mocks.refresh).toHaveBeenCalledWith("orders", {
            skipUrlParams: true,
        });
        expect(mocks.success).toHaveBeenCalledWith("Saved");
    });

    test("removes newly hidden fields from active shared UI state", async () => {
        const { openFieldViewEditor } = await import("./field_view_editor.js");
        await openFieldViewEditor("orders");

        const titleRow = Array.from(
            document.querySelectorAll(".field-view-editor__row")
        ).find((row) => row.textContent.includes("title"));
        const checkbox = titleRow.querySelector(
            '[data-testid="field-view-hide-everywhere"]'
        );
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector('[data-testid="field-view-save"]').click();
        await flushAsyncWork();

        expect(mocks.setState).toHaveBeenCalledWith("orders", {
            sort: { column: null, direction: null },
            filters: { summary_from: "a" },
            offset: 0,
        });
        expect(mocks.saveOpened).toHaveBeenCalledWith("orders", ["summary"]);
    });

    test("creates a Tools button with the requested English label", async () => {
        const { createFieldViewEditorButton } = await import("./field_view_editor.js");
        const button = createFieldViewEditorButton("orders");

        expect(button.textContent).toBe("Edit fields view");
        expect(button.dataset.testid).toBe("btn-edit-fields-view");
        button.click();
        await flushAsyncWork();
        expect(mocks.fetch).toHaveBeenCalledWith("orders");
    });
});
