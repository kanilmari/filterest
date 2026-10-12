// dataset_sort_default_controller.test.js
// Verifies authenticated-user visibility, scoped saves, and first-load default application.
// Covers the shared controller used by both hero and filterbar sorting controls.
// Exists to keep persistent sorting behavior centralized and URL overrides authoritative.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    fetchCurrentUserProfile: vi.fn(),
    getParams: vi.fn(),
    hasRoutePermission: vi.fn(),
    saveDatasetSortDefault: vi.fn(),
    savePersonalDatasetSortDefault: vi.fn(),
    showScopeModal: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.endpointRouter }));
vi.mock("../../endpoints/stable_endpoint_router.js", () => ({
    saveDatasetSortDefault: mocks.saveDatasetSortDefault,
    savePersonalDatasetSortDefault: mocks.savePersonalDatasetSortDefault,
}));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ getParams: mocks.getParams }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: mocks.hasRoutePermission }));
vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({
    fetchCurrentUserProfile: mocks.fetchCurrentUserProfile,
}));
vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: (_key, { fallback } = {}) => fallback || _key,
}));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showSuccessToast: mocks.showSuccessToast,
    showErrorToast: mocks.showErrorToast,
}));
vi.mock("./sort_default_scope_modal_builder.js", () => ({
    showSortDefaultScopeModal: mocks.showScopeModal,
}));

import {
    applyDatasetSortDefault,
    createDatasetSortDefaultAction,
} from "./dataset_sort_default_controller.js";
import { ensureHistoryEntryId, HISTORY_ENTRY_ID, writeHistoryEntry } from "../../navigation/nav_engine/history_entry_state.js";

describe("dataset_sort_default_controller", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        window.history.replaceState({}, "", "/");
        vi.clearAllMocks();
        mocks.endpointRouter.mockReset();
        mocks.getParams.mockReturnValue({});
        mocks.hasRoutePermission.mockReturnValue(true);
        mocks.fetchCurrentUserProfile.mockResolvedValue({ user_id: 42 });
        mocks.saveDatasetSortDefault.mockResolvedValue({ configured: true });
        mocks.savePersonalDatasetSortDefault.mockResolvedValue({ configured: true });
    });

    afterEach(() => vi.restoreAllMocks());

    test("does not expose Set default to an anonymous visitor", async () => {
        mocks.hasRoutePermission.mockReturnValue(false);
        mocks.fetchCurrentUserProfile.mockResolvedValue(null);
        const button = createDatasetSortDefaultAction(
            "travel_info",
            { value: "created:DESC" }
        );
        document.body.appendChild(button);

        await vi.waitFor(() => expect(document.body.contains(button)).toBe(false));
        expect(mocks.savePersonalDatasetSortDefault).not.toHaveBeenCalled();
    });

    test("ordinary user saves only a personal default without a scope modal", async () => {
        mocks.hasRoutePermission.mockReturnValue(false);
        mocks.savePersonalDatasetSortDefault.mockResolvedValue({
            configured: true,
            value: "__newest:DESC",
            scope: "user",
        });
        const selectOption = vi.fn();
        const closeDropdown = vi.fn();
        const button = createDatasetSortDefaultAction(
            "travel_info",
            { value: "__newest:DESC", label: "Newest", langKey: "sort_newest" },
            { selectOption, closeDropdown }
        );
        document.body.appendChild(button);
        await vi.waitFor(() => expect(button.hidden).toBe(false));

        button.click();

        await vi.waitFor(() => expect(mocks.savePersonalDatasetSortDefault).toHaveBeenCalledWith({
            dataset: "travel_info",
            value: "__newest:DESC",
        }));
        expect(mocks.showScopeModal).not.toHaveBeenCalled();
        expect(mocks.saveDatasetSortDefault).not.toHaveBeenCalled();
        expect(selectOption).toHaveBeenCalledWith("__newest:DESC");
        expect(closeDropdown).toHaveBeenCalledOnce();
        expect(mocks.showSuccessToast).toHaveBeenCalledWith(
            "Sorting was set as your default: Newest."
        );
    });

    test("reports and immediately applies a site-wide default", async () => {
        mocks.showScopeModal.mockResolvedValue("site");
        mocks.saveDatasetSortDefault.mockResolvedValue({
            configured: true,
            value: "updated:ASC",
            scope: "site",
        });
        const selectOption = vi.fn();
        const button = createDatasetSortDefaultAction(
            "travel_deals",
            { value: "updated:ASC", label: "Least recently updated", langKey: "sort_updated_oldest" },
            { selectOption }
        );

        button.click();

        await vi.waitFor(() => expect(selectOption).toHaveBeenCalledWith("updated:ASC"));
        expect(mocks.showScopeModal).toHaveBeenCalledOnce();
        expect(mocks.saveDatasetSortDefault).toHaveBeenCalledWith({
            dataset: "travel_deals",
            value: "updated:ASC",
            scope: "site",
        });
        expect(mocks.showSuccessToast).toHaveBeenCalledWith(
            "Sorting was set as the default for everyone: Least recently updated."
        );
    });

    test("applies a stored default only when the URL has no explicit sorting", async () => {
        mocks.endpointRouter.mockResolvedValue({ configured: true, value: "created:DESC", scope: "site" });
        const dropdown = { setValue: vi.fn() };

        await applyDatasetSortDefault(
            "travel_deals_default_test",
            dropdown,
            new Set(["", "__newest:DESC"])
        );

        expect(mocks.endpointRouter).toHaveBeenCalledWith(
            "getDatasetSortDefault",
            {
                url_params: "?dataset=travel_deals_default_test",
                suppressAuthRedirect: true,
            }
        );
        expect(dropdown.setValue).toHaveBeenCalledWith("__newest:DESC", true);
    });

    test("keeps an explicit URL sort authoritative", async () => {
        mocks.getParams.mockReturnValue({ sort_column: "title", sort_order: "ASC" });
        const dropdown = { setValue: vi.fn() };

        await applyDatasetSortDefault(
            "travel_info_url_override_test",
            dropdown,
            new Set(["", "created:DESC", "title:ASC"])
        );

        expect(mocks.endpointRouter).not.toHaveBeenCalled();
        expect(dropdown.setValue).not.toHaveBeenCalled();
    });
    test("late default loading preserves the user's intervening sort choice", async () => {
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const dropdown = { setValue: vi.fn() };
        const pending = applyDatasetSortDefault("late_default_fixture", dropdown, new Set(["__newest:DESC"]));
        mocks.getParams.mockReturnValue({ sort_column: "title", sort_order: "ASC" });
        release({ configured: true, value: "__newest:DESC" });
        await pending;
        expect(dropdown.setValue).not.toHaveBeenCalled();
    });

    test("late defaults cannot replace explicitly selected relevance either", async () => {
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const dropdown = { setValue: vi.fn() };
        const pending = applyDatasetSortDefault("late_relevance_fixture", dropdown, new Set(["__newest:DESC"]));
        const { setUnifiedTableState } = await import("../../state_stores/table_state_store.js");
        setUnifiedTableState("late_relevance_fixture", { sortSelectionExplicit: true, sort: { column: null, direction: null } });
        release({ configured: true, value: "__newest:DESC" });
        await pending;
        expect(dropdown.setValue).not.toHaveBeenCalled();
    });

    test.each(["new address", "same address", "restored entry"])(
        "late sorting defaults cannot change a different history entry (%s)",
        async (navigation) => {
            ensureHistoryEntryId();
            let release;
            mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            const dropdown = { setValue: vi.fn() };
            const pending = applyDatasetSortDefault(`departed_${navigation}`, dropdown, new Set(["__newest:DESC"]));
            if (navigation === "restored entry") {
                // This is the state/URL pair a Back traversal restores.
                history.replaceState({ [HISTORY_ENTRY_ID]: "previous-entry" }, "", "/frontend/previous");
                window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
            } else {
                history.pushState({}, "", navigation === "same address" ? "/" : "/frontend/next");
            }
            const destination = window.location.href;
            release({ configured: true, value: "__newest:DESC" });
            await pending;
            expect(dropdown.setValue).not.toHaveBeenCalled();
            expect(window.location.href).toBe(destination);
        },
    );

    test("startup URL replacement keeps the pending sort default on the same entry", async () => {
        const entryId = ensureHistoryEntryId();
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const dropdown = { setValue: vi.fn() };
        const pending = applyDatasetSortDefault("replacement_default", dropdown, new Set(["__newest:DESC"]));
        writeHistoryEntry("/catalog?view=card", {}, { replace: true });
        release({ configured: true, value: "__newest:DESC" });
        await pending;
        expect(history.state[HISTORY_ENTRY_ID]).toBe(entryId);
        expect(dropdown.setValue).toHaveBeenCalledWith("__newest:DESC", true);
    });

    test("an abandoned default remains available when the dataset is opened again", async () => {
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const oldDropdown = { setValue: vi.fn() };
        const pending = applyDatasetSortDefault("reopened_default", oldDropdown, new Set(["__newest:DESC"]));
        writeHistoryEntry("/other");
        release({ configured: true, value: "__newest:DESC" });
        await pending;
        expect(oldDropdown.setValue).not.toHaveBeenCalled();

        writeHistoryEntry("/reopened_default");
        const currentDropdown = { setValue: vi.fn() };
        await applyDatasetSortDefault("reopened_default", currentDropdown, new Set(["__newest:DESC"]));
        expect(currentDropdown.setValue).toHaveBeenCalledWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test.each([1, 2])(
        "saved default reaches only the current control after %i pending reopening(s)",
        async (reopenings) => {
            const tableName = `pending_reopen_${reopenings}`;
            let release;
            mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            const values = new Set(["__newest:DESC"]);
            const controls = [{ setValue: vi.fn() }];
            const pending = [applyDatasetSortDefault(tableName, controls[0], values)];
            for (let index = 0; index < reopenings; index++) {
                writeHistoryEntry("/other");
                writeHistoryEntry(`/${tableName}`);
                controls.push({ setValue: vi.fn() });
                pending.push(applyDatasetSortDefault(tableName, controls.at(-1), values));
            }
            expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
            release({ configured: true, value: "__newest:DESC" });
            await Promise.all(pending);

            for (const control of controls.slice(0, -1)) expect(control.setValue).not.toHaveBeenCalled();
            expect(controls.at(-1).setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
            // A stale callback cannot release the current entry's once-only claim.
            const sibling = { setValue: vi.fn() };
            await applyDatasetSortDefault(tableName, sibling, values);
            await applyDatasetSortDefault(tableName, controls.at(-1), values);
            expect(sibling.setValue).not.toHaveBeenCalled();
            expect(controls.at(-1).setValue).toHaveBeenCalledTimes(1);
            expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
        },
    );

    test("Back to the original entry while pending applies only to its rebuilt control", async () => {
        const tableName = "pending_back_default";
        writeHistoryEntry(`/${tableName}`);
        const originalState = { ...history.state };
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const values = new Set(["__newest:DESC"]);
        const oldControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}?view=card`);
        const intermediateControl = { setValue: vi.fn() };
        const second = applyDatasetSortDefault(tableName, intermediateControl, values);
        // Restore the exact state/URL pair supplied by a Back traversal.
        history.replaceState(originalState, "", `/${tableName}`);
        window.dispatchEvent(new PopStateEvent("popstate", { state: originalState }));
        const currentControl = { setValue: vi.fn() };
        const current = applyDatasetSortDefault(tableName, currentControl, values);
        release({ configured: true, value: "__newest:DESC" });
        await Promise.all([first, second, current]);

        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(intermediateControl.setValue).not.toHaveBeenCalled();
        expect(currentControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test("Back to a retained entry before resolution applies its original control exactly once", async () => {
        const tableName = "pending_retained_back_default";
        writeHistoryEntry(`/${tableName}`);
        const originalState = { ...history.state };
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const values = new Set(["__newest:DESC"]);
        const originalControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, originalControl, values);
        writeHistoryEntry(`/${tableName}?view=card`);
        const departedControl = { setValue: vi.fn() };
        const second = applyDatasetSortDefault(tableName, departedControl, values);
        // This return retains its mounted dropdown and does not rebuild it.
        history.replaceState(originalState, "", `/${tableName}`);
        window.dispatchEvent(new PopStateEvent("popstate", { state: originalState }));
        release({ configured: true, value: "__newest:DESC" });
        await Promise.all([first, second]);

        expect(originalControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(departedControl.setValue).not.toHaveBeenCalled();
        await applyDatasetSortDefault(tableName, originalControl, values);
        expect(originalControl.setValue).toHaveBeenCalledTimes(1);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test("returning to a rebuilt entry keeps its superseded pending control inactive", async () => {
        const tableName = "pending_rebuilt_retained_default";
        writeHistoryEntry(`/${tableName}`);
        const originalState = { ...history.state };
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const values = new Set(["__newest:DESC"]);
        const oldControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}?view=card`);
        const secondControl = { setValue: vi.fn() };
        const second = applyDatasetSortDefault(tableName, secondControl, values);
        history.replaceState(originalState, "", `/${tableName}`);
        const rebuiltControl = { setValue: vi.fn() };
        const rebuilt = applyDatasetSortDefault(tableName, rebuiltControl, values);
        writeHistoryEntry(`/${tableName}?view=table`);
        const thirdControl = { setValue: vi.fn() };
        const third = applyDatasetSortDefault(tableName, thirdControl, values);
        // Return again, this time retaining the rebuilt control.
        history.replaceState(originalState, "", `/${tableName}`);
        window.dispatchEvent(new PopStateEvent("popstate", { state: originalState }));
        release({ configured: true, value: "__newest:DESC" });
        await Promise.all([first, second, rebuilt, third]);

        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(secondControl.setValue).not.toHaveBeenCalled();
        expect(thirdControl.setValue).not.toHaveBeenCalled();
        expect(rebuiltControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test.each(["URL sort", "explicit relevance"])(
        "pending reopening preserves the current entry's intervening choice (%s)",
        async (choice) => {
            const tableName = `pending_choice_${choice}`;
            let release;
            mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            const values = new Set(["__newest:DESC"]);
            const oldControl = { setValue: vi.fn() };
            const first = applyDatasetSortDefault(tableName, oldControl, values);
            writeHistoryEntry("/reopened-choice");
            const currentControl = { setValue: vi.fn() };
            const current = applyDatasetSortDefault(tableName, currentControl, values);
            if (choice === "URL sort") {
                mocks.getParams.mockReturnValue({ sort_column: "title", sort_order: "ASC" });
            } else {
                const { setUnifiedTableState } = await import("../../state_stores/table_state_store.js");
                setUnifiedTableState(tableName, { sortSelectionExplicit: true, sort: { column: null, direction: null } });
            }
            release({ configured: true, value: "__newest:DESC" });
            await Promise.all([first, current]);

            expect(oldControl.setValue).not.toHaveBeenCalled();
            expect(currentControl.setValue).not.toHaveBeenCalled();
            expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
        },
    );

    test("reopening after an applied default uses the cached answer exactly once in the new entry", async () => {
        const tableName = "applied_then_reopened";
        const values = new Set(["__newest:DESC"]);
        mocks.endpointRouter.mockResolvedValueOnce({ configured: true, value: "__newest:DESC" });
        const firstControl = { setValue: vi.fn() };
        await applyDatasetSortDefault(tableName, firstControl, values);
        writeHistoryEntry("/other");
        writeHistoryEntry(`/${tableName}`);
        const currentControl = { setValue: vi.fn() };
        await applyDatasetSortDefault(tableName, currentControl, values);
        await applyDatasetSortDefault(tableName, currentControl, values);

        expect(firstControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(currentControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test("same-entry controls share one default application through URL normalization", async () => {
        const tableName = "same_entry_default_controls";
        let release;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const values = new Set(["__newest:DESC"]);
        const firstControl = { setValue: vi.fn() };
        const sibling = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, firstControl, values);
        writeHistoryEntry(`/${tableName}?view=card`, {}, { replace: true });
        const second = applyDatasetSortDefault(tableName, sibling, values);
        release({ configured: true, value: "created:DESC" });
        await Promise.all([first, second]);
        await applyDatasetSortDefault(tableName, sibling, values);

        expect(firstControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(sibling.setValue).not.toHaveBeenCalled();
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test("current reopened control retries once when the inherited pending request fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const tableName = "failed_pending_reopen";
        let reject;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        mocks.endpointRouter.mockResolvedValueOnce({ configured: true, value: "__newest:DESC" });
        const values = new Set(["__newest:DESC"]);
        const oldControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}`);
        const currentControl = { setValue: vi.fn() };
        const current = applyDatasetSortDefault(tableName, currentControl, values);
        reject(new Error("first request failed"));
        await Promise.all([first, current]);

        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(currentControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        await applyDatasetSortDefault(tableName, currentControl, values);
        expect(currentControl.setValue).toHaveBeenCalledTimes(1);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(2);
    });

    test("a second reopening during failure recovery consumes the retry exactly once", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const tableName = "reopen_during_default_retry";
        let reject;
        let releaseRetry;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { releaseRetry = resolve; }));
        const values = new Set(["__newest:DESC"]);
        const oldControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}`);
        const intermediateControl = { setValue: vi.fn() };
        const second = applyDatasetSortDefault(tableName, intermediateControl, values);
        reject(new Error("first request failed"));
        await vi.waitFor(() => expect(mocks.endpointRouter).toHaveBeenCalledTimes(2));
        writeHistoryEntry(`/${tableName}`);
        const currentControl = { setValue: vi.fn() };
        const current = applyDatasetSortDefault(tableName, currentControl, values);
        releaseRetry({ configured: true, value: "__newest:DESC" });
        await Promise.all([first, second, current]);

        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(intermediateControl.setValue).not.toHaveBeenCalled();
        expect(currentControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        await applyDatasetSortDefault(tableName, currentControl, values);
        expect(currentControl.setValue).toHaveBeenCalledTimes(1);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(2);
    });

    test("failed initial loading is retryable when the dataset is reopened later", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const tableName = "failed_then_reopened";
        const values = new Set(["__newest:DESC"]);
        mocks.endpointRouter.mockRejectedValueOnce(new Error("first request failed"));
        mocks.endpointRouter.mockResolvedValueOnce({ configured: true, value: "__newest:DESC" });
        const oldControl = { setValue: vi.fn() };
        await applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}`);
        const currentControl = { setValue: vi.fn() };
        await applyDatasetSortDefault(tableName, currentControl, values);

        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(currentControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(2);
    });

    test("failed inherited retry stops without looping and a later reopening can load the default", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const tableName = "failed_default_retry";
        let reject;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        mocks.endpointRouter.mockRejectedValueOnce(new Error("retry failed"));
        const values = new Set(["__newest:DESC"]);
        const oldControl = { setValue: vi.fn() };
        const first = applyDatasetSortDefault(tableName, oldControl, values);
        writeHistoryEntry(`/${tableName}`);
        const currentControl = { setValue: vi.fn() };
        const current = applyDatasetSortDefault(tableName, currentControl, values);
        reject(new Error("first request failed"));
        await Promise.all([first, current]);
        expect(oldControl.setValue).not.toHaveBeenCalled();
        expect(currentControl.setValue).not.toHaveBeenCalled();
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(2);

        mocks.endpointRouter.mockResolvedValueOnce({ configured: true, value: "__newest:DESC" });
        writeHistoryEntry(`/${tableName}`);
        const reopenedControl = { setValue: vi.fn() };
        await applyDatasetSortDefault(tableName, reopenedControl, values);
        expect(reopenedControl.setValue).toHaveBeenCalledExactlyOnceWith("__newest:DESC", true);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(3);
    });

});
