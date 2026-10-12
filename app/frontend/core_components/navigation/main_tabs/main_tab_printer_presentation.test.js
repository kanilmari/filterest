// main_tab_printer_presentation.test.js
// Verifies tab shape across view choices, media, viewport widths, and rerenders.
// Between fetched tab metadata and the rendered tab shell in a jsdom runtime.
// Keeps independent module mocks and shared setup for each topical suite.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { resetMainTabPrinterTestState, setViewportWidth } from "./main_tab_printer_test_helpers.js";

// The retitle boundary is verified in main_tab_printer_browser_tab_title.test.js.
vi.mock("../nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: vi.fn() }));

vi.mock("../nav_engine/navigation_handler.js", () => ({
    handle_all_navigation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: {},
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../../ui_config.js", () => ({
    NAVBAR_WIDTH_THRESHOLD: 1850,
    NAVTAB_BUTTON_BREAKPOINT_PX: 768,
}));

vi.mock("../../auth/login_shell_entry.js", () => ({
    handleLoginShellEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth/login_redirect_handler.js", () => ({
    requestLoginRedirect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth/logout_shell_reset.js", () => ({
    navigateToPostLogoutPath: vi.fn(() => false),
    performSpaLogoutReset: vi.fn().mockResolvedValue({ postLogoutPath: "/" }),
}));

vi.mock("../../admin_tools/auth_mode_handler.js", () => ({
    getButtonState: vi.fn(() => "logout"),
    setAuthModes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../route_permission_checker.js", () => ({
    applyPermission: vi.fn(),
    hasDatasetPermission: vi.fn().mockResolvedValue(true),
    primeMultipleDatasetPermissions: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../state_stores/dataset_selection_saver.js", () => ({
    getSelectedDataset: vi.fn(() => null),
    clearSelectedDataset: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(async (routeName) => {
        if (routeName === "fetchContentTables") {
            return {
                datasets: [
                    {
                        dataset_name: "app_service_catalog",
                        is_in_current_project: true,
                        is_top_level_in_current_project: true,
                        icon_key: "shopping_cart",
                    },
                    {
                        dataset_name: "app_service_catalog_helpers",
                        is_in_current_project: true,
                        is_top_level_in_current_project: false,
                        icon_key: "build",
                    },
                    {
                        dataset_name: "dev_agent_tasks",
                        is_in_current_project: false,
                        is_top_level_in_current_project: false,
                        icon_key: "shopping_cart",
                    },
                    {
                        dataset_name: "system_about",
                        is_in_current_project: false,
                        is_top_level_in_current_project: false,
                        is_about_table: true,
                        icon_key: "help",
                    },
                ],
                tab_order: null,
            };
        }

        if (routeName === "fetchUserProfile") {
            return { username: "alice" };
        }

        return {};
    }),
}));

vi.mock("../nav_engine/query_params.js", () => ({
    useStorageParams: vi.fn(),
    useUrlParams: vi.fn(),
}));

vi.mock("../../filterbar/filterbar_engine/filterbar_visibility_handler.js", () => ({
    resolveFilterBarElement: vi.fn(() => null),
}));

describe("initTabs", () => {
    beforeEach(resetMainTabPrinterTestState);

    test("uses button tabs on wide grid-like views even with physical navbar space", async () => {
        setViewportWidth(1920);
        setChosenDatasetView("app_service_catalog", "table");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");
        const fillPath = activeTab?.querySelector(".svg-container .navtab-fill-path");
        const glowPath = activeTab?.querySelector(".svg-container .navtab-active-glow-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(fillPath?.getAttribute("fill")).toBe("var(--bg_color_2)");
        expect(activeTab?.querySelector(".navtab-cover-layer")).toBeNull();
        expect(glowPath?.getAttribute("stroke")).toMatch(/^url\(#navtab-\d+-glow\)$/);
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
        expect(outlinePath?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
        expect(outlinePath?.closest("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
    });

    test("uses right-opening tabs for card view when the desktop navbar has physical space", async () => {
        setViewportWidth(1920);
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("-2px");
        expect(activeTab?.dataset.tabPresentation).toBe("tab-active");
        expect(outlinePath?.getAttribute("d")?.startsWith("M 300 1")).toBe(true);
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("uses rectangular tabs for every dataset when the active dataset has cover or background media", async () => {
        setViewportWidth(1920);
        setChosenDatasetView("media_dataset", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        await initTabs({
            preloadedContentTablesResponse: {
                datasets: [
                    {
                        dataset_name: "media_dataset",
                        is_top_level_in_current_project: true,
                        has_presentation_media: true,
                    },
                    {
                        dataset_name: "plain_dataset",
                        is_top_level_in_current_project: true,
                        has_presentation_media: false,
                    },
                ],
                tab_order: null,
            },
        });
        await openNavTab("media_dataset");

        const tabs = Array.from(document.querySelectorAll(".navtablinks"));
        expect(tabs).toHaveLength(2);
        expect(tabs[0].dataset.hasPresentationMedia).toBe("true");
        expect(tabs[0].dataset.tabPresentation).toBe("button-active");
        expect(tabs[1].dataset.tabPresentation).toBe("button-inactive");
        tabs.forEach((tab) => {
            expect(tab.querySelector(".navtab-stroke-path")?.getAttribute("d"))
                .toContain("A 0 0");
        });
        expect(document.querySelector(".navtabs")?.style.right).toBe("0px");
    });

    test("uses button tabs for card view when the navbar is in overlay layout", async () => {
        setViewportWidth(1024);
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("recalculates tab shape when a hidden desktop navbar becomes visible", async () => {
        setViewportWidth(1920);
        document.getElementById("tabs_container")?.classList.add("navbar_hidden");
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");

        vi.mocked(getSelectedDataset).mockReturnValue("app_service_catalog");
        document.getElementById("tabs_container")?.classList.remove("navbar_hidden");
        window.dispatchEvent(new Event("navbar-visibility-changed"));

        expect(activeTab?.dataset.tabPresentation).toBe("tab-active");
        expect(outlinePath?.getAttribute("d")?.startsWith("M 300 1")).toBe(true);
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("uses full-width button tabs on narrow screens", async () => {
        setViewportWidth(640);
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("resets a former rounded overlap when tabs rebuild around a preloaded admin view", async () => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        await initTabs();
        await openNavTab("app_service_catalog");
        const container = document.querySelector(".navtabs");
        expect(container.style.right).toBe("-2px");

        vi.mocked(getSelectedDataset).mockReturnValue("view_field_settings");
        await initTabs({ dataAlreadyLoaded: true });

        expect(Array.from(container.querySelectorAll(".navtablinks"), (tab) => tab.dataset.tabPresentation))
            .toEqual(expect.arrayContaining(["button-inactive"]));
        expect(container.style.right).toBe("0px");
        expect(document.querySelector(".navtablinks.active")).toBeNull();

        // Returning to an ordinary wide card dataset retains its intended overlap.
        await openNavTab("app_service_catalog");
        expect(container.style.right).toBe("-2px");
        expect(document.querySelector(".navtablinks.active").dataset.tabPresentation).toBe("tab-active");
    });
});
