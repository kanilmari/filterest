/* @vitest-environment jsdom */

// Verifies that the add-row modal responds immediately and keeps a responsive width.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    appendFormActions: vi.fn(),
    buildMainForm: vi.fn(),
    createModal: vi.fn(),
    fetchColumnsInfo: vi.fn(),
    fetchManyToManyInfos: vi.fn(),
    fetchOneToManyRelations: vi.fn(),
    getDatasetNameByUID: vi.fn(() => "services"),
    hideModal: vi.fn(),
    initializeFormSectionNavigator: vi.fn(),
    showModal: vi.fn(),
    showWarningToast: vi.fn(),
}));

vi.mock("../../../../reusable_components/modal/modal_builder.js", () => ({
    createModal: mocks.createModal,
    hideModal: mocks.hideModal,
    showModal: mocks.showModal,
}));

vi.mock("./row_api_fetcher.js", () => ({
    fetchColumnsInfo: mocks.fetchColumnsInfo,
    fetchManyToManyInfos: mocks.fetchManyToManyInfos,
    fetchOneToManyRelations: mocks.fetchOneToManyRelations,
    getDatasetNameByUID: mocks.getDatasetNameByUID,
}));

vi.mock("./row_form_builder.js", () => ({
    buildMainForm: mocks.buildMainForm,
}));

vi.mock("./row_submission_handler.js", () => ({
    appendFormActions: mocks.appendFormActions,
}));

vi.mock("../../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showWarningToast: mocks.showWarningToast,
}));

vi.mock("../../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => key),
}));

vi.mock("../../../../reusable_components/form_section_navigator/form_section_navigator.js", () => ({
    initializeFormSectionNavigator: mocks.initializeFormSectionNavigator,
}));

import { open_add_row_modal } from "./row_creation_handler.js";

function deferred() {
    let resolve;
    const promise = new Promise((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
});

describe("open_add_row_modal", () => {
    test("shows loading immediately, fetches relations in parallel, and replaces the modal", async () => {
        const columnsRequest = deferred();
        const oneToManyRequest = deferred();
        const manyToManyRequest = deferred();
        const form = document.createElement("form");
        mocks.fetchColumnsInfo.mockReturnValue(columnsRequest.promise);
        mocks.fetchOneToManyRelations.mockReturnValue(oneToManyRequest.promise);
        mocks.fetchManyToManyInfos.mockReturnValue(manyToManyRequest.promise);
        mocks.buildMainForm.mockResolvedValue(form);

        const opening = open_add_row_modal(10, "services");

        expect(mocks.createModal).toHaveBeenCalledTimes(1);
        expect(mocks.showModal).toHaveBeenCalledTimes(1);
        expect(mocks.createModal.mock.calls[0][0].width).toBe(
            "min(600px, calc(100vw - 32px))"
        );
        expect(mocks.createModal.mock.calls[0][0].contentElements[0].getAttribute("role"))
            .toBe("status");

        columnsRequest.resolve([{ column_name: "name", data_type: "text" }]);
        await Promise.resolve();
        expect(mocks.fetchOneToManyRelations).toHaveBeenCalledWith(10);
        expect(mocks.fetchManyToManyInfos).toHaveBeenCalledWith(10);
        expect(mocks.buildMainForm).not.toHaveBeenCalled();

        oneToManyRequest.resolve([{ source_table_uid: 20 }]);
        manyToManyRequest.resolve([{ third_table_uid: 30 }]);
        await opening;

        expect(mocks.buildMainForm).toHaveBeenCalledWith(
            "services",
            [{ column_name: "name", data_type: "text" }],
            [{ source_table_uid: 20 }],
            [{ third_table_uid: 30 }],
            expect.any(Object)
        );
        expect(mocks.createModal).toHaveBeenCalledTimes(2);
        expect(mocks.createModal.mock.calls[1][0].contentElements).toEqual([form]);
        expect(mocks.createModal.mock.calls[1][0].width).toBe(
            "min(600px, calc(100vw - 32px))"
        );
        expect(mocks.showModal).toHaveBeenCalledTimes(2);
    });
});
