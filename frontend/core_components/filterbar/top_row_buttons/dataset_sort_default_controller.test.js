// dataset_sort_default_controller.test.js
// Verifies administrator visibility, scoped saves, and first-load default application.
// Covers the shared controller used by both hero and filterbar sorting controls.
// Exists to keep persistent sorting behavior centralized and URL overrides authoritative.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    getParams: vi.fn(),
    hasRoutePermission: vi.fn(),
    showScopeModal: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.endpointRouter }));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ getParams: mocks.getParams }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: mocks.hasRoutePermission }));
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
    });

    test("does not expose Set default without the admin route right", () => {
        mocks.hasRoutePermission.mockReturnValue(false);

        expect(createDatasetSortDefaultAction("travel_info", { value: "created:DESC" })).toBeNull();
    });

    test("saves the chosen option as a personal default", async () => {
        mocks.showScopeModal.mockResolvedValue("user");
        mocks.endpointRouter.mockResolvedValue({ configured: true, value: "created:DESC", scope: "user" });
        const selectOption = vi.fn();
        const closeDropdown = vi.fn();
        const button = createDatasetSortDefaultAction(
            "travel_info",
            { value: "created:DESC", label: "Newest", langKey: "sort_newest" },
            { selectOption, closeDropdown }
        );

        button.click();

        await vi.waitFor(() => expect(mocks.endpointRouter).toHaveBeenCalledWith(
            "saveDatasetSortDefault",
            {
                method: "POST",
                body_data: {
                    dataset: "travel_info",
                    value: "created:DESC",
                    scope: "user",
                },
            }
        ));
        expect(selectOption).toHaveBeenCalledWith("created:DESC");
        expect(closeDropdown).toHaveBeenCalledOnce();
        expect(mocks.showSuccessToast).toHaveBeenCalledWith(
            "Sorting was set as your default: Newest."
        );
    });

    test("reports and immediately applies a site-wide default", async () => {
        mocks.showScopeModal.mockResolvedValue("site");
        mocks.endpointRouter.mockResolvedValue({ configured: true, value: "updated:ASC", scope: "site" });
        const selectOption = vi.fn();
        const button = createDatasetSortDefaultAction(
            "travel_deals",
            { value: "updated:ASC", label: "Least recently updated", langKey: "sort_updated_oldest" },
            { selectOption }
        );

        button.click();

        await vi.waitFor(() => expect(selectOption).toHaveBeenCalledWith("updated:ASC"));
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
            new Set(["", "created:DESC"])
        );

        expect(mocks.endpointRouter).toHaveBeenCalledWith(
            "getDatasetSortDefault",
            {
                url_params: "?dataset=travel_deals_default_test",
                suppressAuthRedirect: true,
            }
        );
        expect(dropdown.setValue).toHaveBeenCalledWith("created:DESC", true);
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
});
