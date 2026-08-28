// symbol_registry_view.test.js
// Verifies the admins-only symbol editor lists disk-backed keys and posts key assignments.
// Bridges the protected symbol endpoint and dataset/field metadata controls under jsdom.
// Exists so the editor never reintroduces a raw SVG or arbitrary path input.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const fetchAdminSymbolsMock = vi.fn();
const saveAdminSymbolAssignmentMock = vi.fn();
const showErrorToastMock = vi.fn();
const showSuccessToastMock = vi.fn();

vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    fetchAdminSymbols: fetchAdminSymbolsMock,
    saveAdminSymbolAssignment: saveAdminSymbolAssignmentMock,
}));

vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: showErrorToastMock,
    showSuccessToast: showSuccessToastMock,
}));

describe("symbol_registry_view", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        fetchAdminSymbolsMock.mockReset();
        saveAdminSymbolAssignmentMock.mockReset();
        showErrorToastMock.mockReset();
        showSuccessToastMock.mockReset();
        fetchAdminSymbolsMock.mockResolvedValue({
            symbols: [
                { key: "payments", url: "/symbol-assets/payments.svg" },
                { key: "table", url: "/symbol-assets/table.svg" },
            ],
            datasets: [{
                table_uid: 12,
                dataset_name: "app_travel_deals",
                display_name: "Travel deals",
                icon_key: "table",
            }],
            fields: [{
                column_uid: 44,
                table_uid: 12,
                dataset_name: "app_travel_deals",
                column_name: "price",
                icon_key: "",
            }],
        });
        saveAdminSymbolAssignmentMock.mockResolvedValue({ status: "ok" });
    });

    test("assigns a reviewed key to a dataset without exposing raw SVG input", async () => {
        const { generate_symbol_registry_view } = await import("./symbol_registry_view.js");
        const container = document.createElement("div");

        await generate_symbol_registry_view(container);

        expect(fetchAdminSymbolsMock).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll(".symbol-registry-option")).toHaveLength(2);
        expect(container.querySelector('textarea')).toBeNull();
        expect(container.querySelector('input[type="text"]')).toBeNull();
        expect(container.innerHTML).not.toContain("<svg");

        container.querySelector('[data-symbol-key="payments"]').click();
        const saveButton = container.querySelector('[data-lang-key="save_symbol_assignment"]');
        saveButton.click();

        await vi.waitFor(() => {
            expect(saveAdminSymbolAssignmentMock).toHaveBeenCalledWith({
                target_type: "dataset",
                target_uid: 12,
                icon_key: "payments",
            });
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith("Symbol assignment saved");
        expect(container.querySelector(".symbol-registry-current code")?.textContent)
            .toBe("payments");
    });

    test("filters fields by dataset and can clear a field assignment", async () => {
        const { generate_symbol_registry_view } = await import("./symbol_registry_view.js");
        const container = document.createElement("div");
        await generate_symbol_registry_view(container);

        const typeSelect = container.querySelector("#symbol_registry_target_type");
        typeSelect.value = "field";
        typeSelect.dispatchEvent(new Event("change"));
        const fieldSelect = container.querySelector("#symbol_registry_field");
        fieldSelect.value = "44";
        fieldSelect.dispatchEvent(new Event("change"));
        container.querySelector('[data-lang-key="clear_symbol_assignment"]').click();

        await vi.waitFor(() => {
            expect(saveAdminSymbolAssignmentMock).toHaveBeenCalledWith({
                target_type: "field",
                target_uid: 44,
                icon_key: "",
            });
        });
    });
});
