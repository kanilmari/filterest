// dataset_sort_default_controller.test.js
// Verifies authenticated-user visibility, scoped saves, and first-load default application.
// Covers the shared controller used by both hero and filterbar sorting controls.
// Exists to keep persistent sorting behavior centralized and URL overrides authoritative.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

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

describe("dataset_sort_default_controller", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        mocks.getParams.mockReturnValue({});
        mocks.hasRoutePermission.mockReturnValue(true);
        mocks.fetchCurrentUserProfile.mockResolvedValue({ user_id: 42 });
        mocks.saveDatasetSortDefault.mockResolvedValue({ configured: true });
        mocks.savePersonalDatasetSortDefault.mockResolvedValue({ configured: true });
    });

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

});
