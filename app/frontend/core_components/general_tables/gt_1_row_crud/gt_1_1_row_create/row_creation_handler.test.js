// row_creation_handler.test.js
// Verifies add-row loading, cancellation, replacement and focus ownership.
// Connects deferred schema/form builds to the real shared modal lifecycle.
// Prevents closed or superseded builds from changing the dialog or reporting errors.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    clearRowCreationDraft: vi.fn(),
    createDraftBackedFormState: vi.fn(),
    showModal: vi.fn(),
    showWarningToast: vi.fn(),
}));

vi.mock("../../../../reusable_components/modal/modal_builder.js", async (importOriginal) => {
    const actual = await importOriginal();
    mocks.createModal.mockImplementation(actual.createModal);
    mocks.hideModal.mockImplementation(actual.hideModal);
    mocks.showModal.mockImplementation(actual.showModal);
    return {
        ...actual,
        createModal: mocks.createModal,
        hideModal: mocks.hideModal,
        showModal: mocks.showModal,
    };
});

vi.mock("../../../../icons/icon_loader.js", () => ({
    setElementSvgContent: vi.fn(),
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

vi.mock("./row_draft_saver.js", () => ({
    clearRowCreationDraft: mocks.clearRowCreationDraft,
    createDraftBackedFormState: mocks.createDraftBackedFormState,
}));

import { open_add_row_modal } from "./row_creation_handler.js";

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.useFakeTimers();
    mocks.hideModal({ immediate: true });
    vi.runAllTimers();
    document.body.replaceChildren();
    vi.clearAllMocks();
    mocks.fetchColumnsInfo.mockResolvedValue([{ column_name: "name", data_type: "text" }]);
    mocks.fetchOneToManyRelations.mockResolvedValue([]);
    mocks.fetchManyToManyInfos.mockResolvedValue([]);
    mocks.createDraftBackedFormState.mockImplementation((datasetName) => ({
        restoredFor: datasetName,
    }));
});

afterEach(() => {
    mocks.hideModal({ immediate: true });
    vi.runAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function formWithInput(name) {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.name = name;
    form.appendChild(input);
    return { form, input };
}

function closeLoadingModal(path) {
    if (path === "X") {
        document.querySelector('[data-testid="modal-close-button"]').click();
    } else if (path === "Escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else if (path === "backdrop") {
        document.getElementById("custom_modal_overlay").click();
    } else {
        mocks.hideModal();
    }
}

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
            "850px"
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
            expect.any(Object),
            expect.any(Map)
        );
        expect(mocks.createModal).toHaveBeenCalledTimes(2);
        expect(mocks.createModal.mock.calls[1][0].contentElements).toEqual([form]);
        expect(mocks.createModal.mock.calls[1][0].width).toBe(
            "850px"
        );
        expect(mocks.showModal).toHaveBeenCalledTimes(2);
    });

    test("restores the draft for the opened dataset and never shares another dataset's state", async () => {
        mocks.fetchColumnsInfo.mockResolvedValue([
            { column_name: "price", data_type: "numeric(18,2)" },
        ]);
        mocks.fetchOneToManyRelations.mockResolvedValue([]);
        mocks.fetchManyToManyInfos.mockResolvedValue([]);
        mocks.buildMainForm.mockResolvedValue(document.createElement("form"));

        await open_add_row_modal(10, "subscriptions");
        await open_add_row_modal(11, "projects");

        expect(mocks.createDraftBackedFormState).toHaveBeenNthCalledWith(
            1,
            "subscriptions",
            [{ column_name: "price", data_type: "numeric(18,2)" }]
        );
        expect(mocks.createDraftBackedFormState).toHaveBeenNthCalledWith(
            2,
            "projects",
            [{ column_name: "price", data_type: "numeric(18,2)" }]
        );
        expect(mocks.buildMainForm.mock.calls[0][4]).toEqual({ restoredFor: "subscriptions" });
        expect(mocks.buildMainForm.mock.calls[1][4]).toEqual({ restoredFor: "projects" });
    });

    test.each(["X", "Escape", "backdrop", "programmatic"])(
        "%s during a build prevents stale content, re-show and focus",
        async (path) => {
            const build = deferred();
            const { form, input } = formWithInput("closed-build");
            const inputFocus = vi.spyOn(input, "focus");
            mocks.buildMainForm.mockReturnValue(build.promise);
            const opening = open_add_row_modal(10, "services");
            await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledOnce());

            closeLoadingModal(path);
            vi.runAllTimers();
            const overlay = document.getElementById("custom_modal_overlay");
            const closedContent = overlay.innerHTML;
            const outside = document.createElement("button");
            document.body.appendChild(outside);
            outside.focus();

            build.resolve(form);
            await opening;
            vi.runAllTimers();

            expect(overlay.style.display).toBe("none");
            expect(overlay.getAttribute("aria-hidden")).toBe("true");
            expect(overlay.innerHTML).toBe(closedContent);
            expect(input.isConnected).toBe(false);
            expect(inputFocus).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(outside);
            expect(mocks.appendFormActions).not.toHaveBeenCalled();
            expect(mocks.initializeFormSectionNavigator).not.toHaveBeenCalled();
            expect(mocks.showWarningToast).not.toHaveBeenCalled();
        },
    );

    test.each(["first", "second"])("only the second open shows when %s finishes first", async (finishesFirst) => {
        const firstBuild = deferred();
        const secondBuild = deferred();
        const first = formWithInput("first-build");
        const second = formWithInput("second-build");
        const firstFocus = vi.spyOn(first.input, "focus");
        mocks.buildMainForm.mockReturnValueOnce(firstBuild.promise).mockReturnValueOnce(secondBuild.promise);
        const firstOpening = open_add_row_modal(10, "services");
        await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledTimes(1));
        mocks.hideModal();
        const secondOpening = open_add_row_modal(10, "services");
        await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledTimes(2));

        if (finishesFirst === "first") {
            firstBuild.resolve(first.form);
            await firstOpening;
            expect(document.querySelector('#custom_modal_body [role="status"]')).not.toBeNull();
        }
        secondBuild.resolve(second.form);
        await secondOpening;
        vi.runAllTimers();
        if (finishesFirst === "second") {
            firstBuild.resolve(first.form);
            await firstOpening;
            vi.runAllTimers();
        }

        expect(document.getElementById("custom_modal_overlay").style.display).toBe("flex");
        expect(document.getElementById("custom_modal_body").firstElementChild).toBe(second.form);
        expect(first.input.isConnected).toBe(false);
        expect(firstFocus).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(second.input);
        expect(mocks.appendFormActions).toHaveBeenCalledTimes(1);
        expect(mocks.createModal).toHaveBeenCalledTimes(3);
    });

    test("a failed build after close stays silent and hidden", async () => {
        const build = deferred();
        mocks.buildMainForm.mockReturnValue(build.promise);
        const opening = open_add_row_modal(10, "services");
        await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledOnce());
        mocks.hideModal();
        vi.runAllTimers();
        const previousFocus = document.activeElement;
        vi.spyOn(console, "warn").mockImplementation(() => {});

        build.reject(new Error("closed build failed"));
        await opening;
        vi.runAllTimers();

        expect(document.getElementById("custom_modal_overlay").style.display).toBe("none");
        expect(document.activeElement).toBe(previousFocus);
        expect(mocks.showModal).toHaveBeenCalledTimes(1);
        expect(mocks.showWarningToast).not.toHaveBeenCalled();
    });

    test.each(["empty", "rejected"])("ignores %s schema results after close", async (result) => {
        const columns = deferred();
        mocks.fetchColumnsInfo.mockReturnValue(columns.promise);
        const opening = open_add_row_modal(10, "services");
        mocks.hideModal();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        if (result === "empty") columns.resolve([]);
        else columns.reject(new Error("closed schema failed"));
        await opening;

        expect(mocks.createDraftBackedFormState).not.toHaveBeenCalled();
        expect(mocks.buildMainForm).not.toHaveBeenCalled();
        expect(mocks.showWarningToast).not.toHaveBeenCalled();
        expect(mocks.hideModal).toHaveBeenCalledTimes(1);
    });

    test("a failed old build does not hide a later open", async () => {
        const build = deferred();
        mocks.buildMainForm.mockReturnValueOnce(build.promise);
        const oldOpening = open_add_row_modal(10, "services");
        await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledOnce());
        mocks.hideModal();
        const next = formWithInput("new-session");
        mocks.buildMainForm.mockResolvedValueOnce(next.form);
        await open_add_row_modal(10, "services");
        vi.runAllTimers();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        build.reject(new Error("old build failed"));
        await oldOpening;
        vi.runAllTimers();

        expect(document.getElementById("custom_modal_overlay").style.display).toBe("flex");
        expect(document.activeElement).toBe(next.input);
        expect(mocks.showWarningToast).not.toHaveBeenCalled();
    });

    test("another feature replacing the modal cancels the pending add-row build", async () => {
        const build = deferred();
        mocks.buildMainForm.mockReturnValue(build.promise);
        const opening = open_add_row_modal(10, "services");
        await vi.waitFor(() => expect(mocks.buildMainForm).toHaveBeenCalledOnce());
        const replacement = formWithInput("other-feature");
        mocks.createModal({ contentElements: [replacement.form] });
        mocks.showModal();
        vi.runAllTimers();
        build.resolve(formWithInput("stale").form);
        await opening;
        vi.runAllTimers();

        expect(document.getElementById("custom_modal_body").firstElementChild).toBe(replacement.form);
        expect(document.activeElement).toBe(replacement.input);
    });

    test("closing before queued form focus runs cancels that focus", async () => {
        const { form, input } = formWithInput("completed-build");
        const inputFocus = vi.spyOn(input, "focus");
        mocks.buildMainForm.mockResolvedValue(form);
        await open_add_row_modal(10, "services");
        mocks.hideModal();
        vi.runAllTimers();

        expect(inputFocus).not.toHaveBeenCalled();
        expect(document.getElementById("custom_modal_overlay").style.display).toBe("none");
    });

    test("a current build failure still closes and reports its error", async () => {
        mocks.buildMainForm.mockRejectedValue(new Error("current build failed"));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await open_add_row_modal(10, "services");

        expect(document.getElementById("custom_modal_overlay").style.display).toBe("none");
        expect(mocks.showWarningToast).toHaveBeenCalledWith("failed_to_load");
    });
});
