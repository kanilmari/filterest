// main_tab_printer_presentation.test.js
// Verifies tab shape across view choices, media, viewport widths, and rerenders.
// Between fetched tab metadata and the rendered tab shell in a jsdom runtime.
// Keeps independent module mocks and shared setup for each topical suite.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { resetMainTabPrinterTestState, setViewportWidth } from "./main_tab_printer_test_helpers.js";
import { clearMainTabActiveState } from "./main_tab_active_state.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";

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
    DATASET_PREFIX: "/",
    useStorageParams: vi.fn(),
    useUrlParams: vi.fn(),
}));

vi.mock("../../filterbar/filterbar_engine/filterbar_visibility_handler.js", () => ({
    resolveFilterBarElement: vi.fn(() => null),
}));

describe("initTabs", () => {
    beforeEach(resetMainTabPrinterTestState);

    // Owner 2026-11-22: Home's own picture does not count, and Home keeps the menu's one shape.
    test.each([1920, 1440, 390])("Home keeps the menu's shape with and without Home media at %ipx", async width => {
        setViewportWidth(width);
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        await initTabs();
        await openNavTab("app_service_catalog");
        const rounded = width >= 1850;
        const home = document.createElement("div");
        home.id = "front_page_container";
        home.innerHTML = '<div class="front-page-background"><video src="/probe.mp4"></video></div>';
        document.body.append(home);
        for (const media of [true, false]) {
            if (!media) home.replaceChildren();
            clearMainTabActiveState("front_page");
            expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("rounded");
            for (const tab of document.querySelectorAll(".navtablinks")) {
                expect(tab.dataset.tabPresentation).toBe(rounded ? "tab-inactive" : "button-inactive");
                for (const path of tab.querySelectorAll(".navtab-shape-path")) {
                    expect(path.getAttribute("d").match(rounded ? /A 7 7/g : /A 0 0/g)).toHaveLength(4);
                }
            }
        }
        home.remove();
    });

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
        expect(fillPath?.getAttribute("fill")).toBe("var(--bar-tab-fill-active, var(--bg_color_2))");
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

    test("one menu dataset whose picture shows makes every tab box-like before any dataset opens", async () => {
        setViewportWidth(1920);
        setChosenDatasetView("plain_dataset", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        // The cover shows only in the dark theme; the shape is the same in every theme.
        const strength = { overlay_opacity: 0, oval_enabled: false, center_opacity: 0.4, mid_opacity: 0.7, edge_opacity: 1 };
        const darkOnlyCover = { background: false, cover: true, cover_themes: {
            light: { ...strength, image_opacity: 0 }, dark: { ...strength, image_opacity: 0.3 } } };
        await initTabs({
            preloadedContentTablesResponse: {
                datasets: [
                    { dataset_name: "media_dataset", is_top_level_in_current_project: true, presentation_picture: darkOnlyCover },
                    { dataset_name: "plain_dataset", is_top_level_in_current_project: true,
                        presentation_picture: { background: false, cover: false } },
                ],
                tab_order: null,
            },
        });
        const tabs = Array.from(document.querySelectorAll(".navtablinks"));
        expect(tabs).toHaveLength(2);
        expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("box");
        expect(localStorage.getItem("side_menu_tab_shape")).toBe("box");
        // Without a stored selection the first tab opens; its view shows no picture of its own.
        expect(tabs.map(tab => tab.dataset.tabPresentation)).toEqual(["button-active", "button-inactive"]);
        // Opening the plain dataset does not change the shape.
        await openNavTab("plain_dataset");
        expect(tabs.map(tab => tab.dataset.tabPresentation)).toEqual(["button-inactive", "button-active"]);
        tabs.forEach((tab) => {
            expect(tab.querySelector(".navtab-stroke-path")?.getAttribute("d"))
                .toContain("A 0 0");
        });
        expect(document.querySelector(".navtabs")?.style.right).toBe("0px");
    });

    test("a failed catalogue keeps the menu's last decision", async () => {
        localStorage.setItem("side_menu_tab_shape", "box");
        const { resetSideMenuTabShapeForTests } = await import("./side_menu_tab_shape.js");
        resetSideMenuTabShapeForTests();
        setViewportWidth(1920);
        vi.mocked(endpoint_router).mockRejectedValueOnce(new Error("catalogue unavailable"));
        const { initTabs } = await import("./main_tab_printer.js");
        await initTabs();
        expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("box");
        expect(localStorage.getItem("side_menu_tab_shape")).toBe("box");
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

    test("tabs rebuilt around a preloaded admin view take the menu's shape and its overlap at once", async () => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
        setChosenDatasetView("app_service_catalog", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        await initTabs();
        await openNavTab("app_service_catalog");
        const container = document.querySelector(".navtabs");
        expect(container.style.right).toBe("-2px");

        vi.mocked(getSelectedDataset).mockReturnValue("view_field_settings");
        await initTabs({ dataAlreadyLoaded: true });

        // New buttons start rectangular; the rebuild gives them the rounded decision without a morph.
        expect(new Set(Array.from(container.querySelectorAll(".navtablinks"), (tab) => tab.dataset.tabPresentation)))
            .toEqual(new Set(["tab-inactive"]));
        expect(container.style.right).toBe("-2px");
        expect(document.querySelector(".navtablinks.active")).toBeNull();

        // Returning to an ordinary wide card dataset retains its intended overlap.
        await openNavTab("app_service_catalog");
        expect(container.style.right).toBe("-2px");
        expect(document.querySelector(".navtablinks.active").dataset.tabPresentation).toBe("tab-active");
    });
});
