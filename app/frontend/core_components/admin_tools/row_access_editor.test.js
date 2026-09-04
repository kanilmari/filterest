// @vitest-environment jsdom
// row_access_editor.test.js
// Verifies stable selection, row-only actions, and exact mutation readback in the shared editor.
// Bridges selected rows, the administrator endpoint, and modal feedback without a concrete view.
// Exists so table, card, and article-card callers cannot widen or ambiguously save row permissions.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpoint: vi.fn(),
    selected: vi.fn(),
    hideModal: vi.fn(),
    showModal: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
}));

vi.mock("../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpoint,
}));

vi.mock("../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((_key, options = {}) => options.fallback || ""),
}));

vi.mock("../table_views/table_view/selected_items_reader.js", () => ({
    get_selected_items: mocks.selected,
}));

vi.mock("../../reusable_components/modal/modal_builder.js", () => ({
    createModal: vi.fn(({ contentElements }) => {
        const modal = document.createElement("div");
        modal.append(...contentElements);
        document.body.appendChild(modal);
        return { modal };
    }),
    hideModal: mocks.hideModal,
    showModal: mocks.showModal,
}));

vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: mocks.error,
    showSuccessToast: mocks.success,
    showWarningToast: mocks.warning,
}));

const ACTIONS = [
    { id: 1, key: "read", label_lang_key: "row_access_read", category_key: "content", sort_order: 20 },
    { id: 2, key: "update", label_lang_key: "row_access_update", category_key: "content", sort_order: 30 },
    { id: 3, key: "delete", label_lang_key: "row_access_delete", category_key: "content", sort_order: 40 },
];

function actionState(state, rowCount) {
    return {
        state,
        allow_count: state === "allow" ? rowCount : 0,
        deny_count: state === "deny" ? rowCount : 0,
        inherited_count: state === "inherited" ? rowCount : 0,
    };
}

function responseFor(rowIDs, state = "inherited", overrides = {}) {
    const selectedPrincipals = overrides.selected_principals || [];
    const stateTargetCount = rowIDs.length * Math.max(selectedPrincipals.length, 1);
    return {
        dataset: "orders",
        table_uid: 14,
        row_ids: rowIDs,
        actions: ACTIONS,
        principals: [
            { id: 2, type: "group", name: "editors" },
            { id: 7, type: "user", name: "ava", full_name: "Ava Example" },
        ],
        selected_principals: selectedPrincipals,
        state_target_count: stateTargetCount,
        states: Object.fromEntries(ACTIONS.map((action) => [
            action.key,
            actionState(state, stateTargetCount),
        ])),
        ...overrides,
    };
}

function principalRefsFromQuery(urlParams = "") {
    const raw = new URLSearchParams(String(urlParams).replace(/^\?/, ""))
        .get("principals");
    if (!raw) return [];
    return raw.split(",").map((value) => {
        const [type, id] = value.split(":", 2);
        return { type, id: Number(id) };
    });
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("row_access_editor", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.selected.mockReturnValue({ ids: [9, 2, 9], rows: [] });
        mocks.endpoint.mockImplementation((_endpoint, options = {}) => {
            if (options.method === "POST") {
                return Promise.resolve(responseFor([2, 9], "inherited", {
                    change_set_id: "12345678-1234-4123-8123-123456789abc",
                    selected_principals: options.body_data.principals,
                    state_target_count: 4,
                    states: {
                        read: actionState("inherited", 4),
                        update: actionState("allow", 4),
                        delete: actionState("inherited", 4),
                    },
                }));
            }
            return Promise.resolve(responseFor([2, 9], "inherited", {
                selected_principals: principalRefsFromQuery(options.url_params),
            }));
        });
    });

    test("warns without stable selected rows and does not open the endpoint", async () => {
        mocks.selected.mockReturnValue({ ids: [], rows: [] });
        const { openRowAccessEditor } = await import("./row_access_editor.js");

        expect(await openRowAccessEditor("orders")).toBeNull();
        expect(mocks.warning).toHaveBeenCalledWith("Select at least one row first.");
        expect(mocks.endpoint).not.toHaveBeenCalled();
    });

    test("shows only read, update, and delete controls for normalized selected rows", async () => {
        const { openRowAccessEditor } = await import("./row_access_editor.js");
        await openRowAccessEditor("orders");

        const picker = document.querySelector('[data-testid="row-access-principals"]');
        picker.__dropdown.setValue({
            includeValues: ["user:7", "group:2"],
        }, true);
        await flushAsyncWork();

        expect(document.querySelector('[data-testid="row-access-editor"]')?.textContent)
            .toContain("Selected rows: 2");
        expect(Array.from(document.querySelectorAll("[data-action]")).map((row) => row.dataset.action))
            .toEqual(["read", "update", "delete"]);
        expect(document.querySelector('[data-action="create"]')).toBeNull();
        expect(mocks.endpoint).toHaveBeenNthCalledWith(1, "adminRowAccessRules", {
            url_params: "?dataset=orders&row_ids=2%2C9",
            suppressAuthRedirect: true,
        });
        expect(mocks.endpoint).toHaveBeenNthCalledWith(2, "adminRowAccessRules", {
            url_params: "?dataset=orders&row_ids=2%2C9&principals=group%3A2%2Cuser%3A7",
            suppressAuthRedirect: true,
        });
    });

    test("combines users and groups in one searchable typed multiselect", async () => {
        const { openRowAccessEditor } = await import("./row_access_editor.js");
        await openRowAccessEditor("orders");

        const picker = document.querySelector('[data-testid="row-access-principals"]');
        picker.__dropdown.open();
        expect(Array.from(document.body.querySelectorAll('.msd-option-group-label'))
            .map((heading) => heading.textContent)).toEqual(["Groups", "Users"]);

        const search = document.body.querySelector('.msd-dropdown-search-input');
        search.value = "7";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        expect(document.body.querySelectorAll('.msd-option')).toHaveLength(1);
        expect(document.body.querySelector('.msd-option-label')?.textContent)
            .toContain("Ava Example (#7)");

        picker.__dropdown.setValue({
            includeValues: ["group:2", "user:7"],
        }, true);
        await flushAsyncWork();
        expect(picker.__dropdown.getValue()).toEqual(["group:2", "user:7"]);
    });

    test("saves one transaction and accepts success only after exact readback", async () => {
        const { openRowAccessEditor } = await import("./row_access_editor.js");
        await openRowAccessEditor("orders");

        const picker = document.querySelector('[data-testid="row-access-principals"]');
        picker.__dropdown.setValue({
            includeValues: ["group:2", "user:7"],
        }, true);
        await flushAsyncWork();

        const update = document.querySelector('[data-testid="row-access-update"]');
        update.value = "allow";
        update.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector('[data-testid="row-access-editor"]')
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(mocks.endpoint).toHaveBeenNthCalledWith(3, "adminRowAccessRules", {
            method: "POST",
            body_data: {
                        dataset: "orders",
                        row_ids: [2, 9],
                        principals: [
                            { type: "group", id: 2 },
                            { type: "user", id: 7 },
                        ],
                changes: {
                    read: "no_change",
                    update: "allow",
                    delete: "no_change",
                },
                reason: "",
            },
            suppressAuthRedirect: true,
        });
        expect(mocks.success).toHaveBeenCalledWith("Row permissions updated");
        expect(mocks.hideModal).toHaveBeenCalled();
        expect(mocks.error).not.toHaveBeenCalled();
    });

    test("fails closed when mutation readback targets different rows", async () => {
        mocks.endpoint.mockImplementation((_endpoint, options = {}) => {
            if (options.method === "POST") {
                return Promise.resolve(responseFor([2, 10], "allow", {
                    change_set_id: "12345678-1234-4123-8123-123456789abc",
                    selected_principals: options.body_data.principals,
                    state_target_count: 4,
                }));
            }
            return Promise.resolve(responseFor([2, 9], "inherited", {
                selected_principals: principalRefsFromQuery(options.url_params),
            }));
        });
        const { openRowAccessEditor } = await import("./row_access_editor.js");
        await openRowAccessEditor("orders");

        const picker = document.querySelector('[data-testid="row-access-principals"]');
        picker.__dropdown.setValue({
            includeValues: ["group:2", "user:7"],
        }, true);
        await flushAsyncWork();

        const read = document.querySelector('[data-testid="row-access-read"]');
        read.value = "allow";
        read.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector('[data-testid="row-access-editor"]')
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.hideModal).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalledWith(
            "The row access response was incomplete. Nothing was changed."
        );
    });

    test("fails closed when mutation readback omits one selected principal", async () => {
        mocks.endpoint.mockImplementation((_endpoint, options = {}) => {
            if (options.method === "POST") {
                return Promise.resolve(responseFor([2, 9], "allow", {
                    change_set_id: "12345678-1234-4123-8123-123456789abc",
                    selected_principals: [{ type: "group", id: 2 }],
                    state_target_count: 2,
                }));
            }
            return Promise.resolve(responseFor([2, 9], "inherited", {
                selected_principals: principalRefsFromQuery(options.url_params),
            }));
        });
        const { openRowAccessEditor } = await import("./row_access_editor.js");
        await openRowAccessEditor("orders");

        const picker = document.querySelector('[data-testid="row-access-principals"]');
        picker.__dropdown.setValue({
            includeValues: ["group:2", "user:7"],
        }, true);
        await flushAsyncWork();

        const read = document.querySelector('[data-testid="row-access-read"]');
        read.value = "allow";
        read.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector('[data-testid="row-access-editor"]')
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.hideModal).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalledWith(
            "The row access response was incomplete. Nothing was changed."
        );
    });
});
