// @vitest-environment jsdom
// admin_button_builder.test.js
// Verifies filterbar-only admin/chat helpers render with the pinned chat dock.
// Bridges admin button helpers with mocked permissions and chat UI dependencies.
// Exists to keep the filterbar chat section anchored above the filterbar clock.

import { beforeEach, describe, expect, test, vi } from "vitest";

const createChatUiMock = vi.hoisted(() => vi.fn((_tableName, parentElement) => {
    const marker = document.createElement("div");
    marker.classList.add("chat-ui-marker");
    parentElement.appendChild(marker);
}));
const getTranslationForKeyMock = vi.hoisted(() => vi.fn(() => ""));
const createGenericViewSelectorMock = vi.hoisted(() => vi.fn(() => document.createElement("div")));
const applyViewStylingMock = vi.hoisted(() => vi.fn());
const createVanillaDropdownMock = vi.hoisted(() => vi.fn(() => document.createElement("div")));
const hasDatasetPermissionMock = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));

vi.mock("../general_tables/gt_toolbar/toolbar_button_creator.js", () => ({
    createDeleteSelectedButton: vi.fn(() => document.createElement("button")),
    createColumnManagementButton: vi.fn(() => document.createElement("button")),
}));

vi.mock("../table_views/view_selector_printer.js", () => ({
    createGenericViewSelector: createGenericViewSelectorMock,
    applyViewStyling: applyViewStylingMock,
}));

vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: vi.fn(),
}));

vi.mock("../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js", () => ({
    createVanillaDropdown: createVanillaDropdownMock,
}));

vi.mock("../ai_features/table_chat/table_chat_printer.js", () => ({
    create_chat_ui: createChatUiMock,
}));

vi.mock("../ai_features/table_chat/table_chat_mode_resolver.js", () => ({
    resolveAvailableFilterbarAIChatMode: vi.fn(() => "api_tools"),
}));

vi.mock("../route_permission_checker.js", () => ({
    hasDatasetPermission: hasDatasetPermissionMock,
}));

vi.mock("../endpoints/endpoint_router.js", () => ({
    get_endpoint_url: vi.fn(() => "/api/mock"),
}));

vi.mock("../lang/translation_handler.js", () => ({
    getTranslationForKey: getTranslationForKeyMock,
}));

vi.mock("../table_views/experimental_free_layout_card/experimental_free_layout_card_store.js", () => ({
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT: "experimental_free_layout",
    STANDARD_CARD_STYLE_VARIANT: "standard",
    getCardStyleVariant: vi.fn(() => "standard"),
    isExperimentalFreeLayoutAvailable: vi.fn(() => false),
    setCardStyleVariant: vi.fn(),
}));

describe("appendChatUIIfAllowed", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        createChatUiMock.mockClear();
        createGenericViewSelectorMock.mockClear();
        applyViewStylingMock.mockClear();
        createVanillaDropdownMock.mockClear();
        hasDatasetPermissionMock.mockReset();
        hasDatasetPermissionMock.mockResolvedValue(false);
        getTranslationForKeyMock.mockReset();
        getTranslationForKeyMock.mockReturnValue("");
    });

    test("builds admin view controls from the dataset view registry", async () => {
        getTranslationForKeyMock.mockImplementation((_key, options = {}) => options.fallback || "");
        hasDatasetPermissionMock.mockImplementation((route) => (
            Promise.resolve(route === "/ui/table-view-style-buttons")
        ));
        const { appendAdminFeatures } = await import("./admin_button_builder.js");
        const managementContainer = document.createElement("div");
        const viewSelectorContainer = document.createElement("div");

        await appendAdminFeatures(
            "demo_table",
            managementContainer,
            viewSelectorContainer,
            "card"
        );

        expect(createGenericViewSelectorMock).toHaveBeenCalledWith(
            "demo_table",
            "card",
            [
                expect.objectContaining({ viewKey: "card", label: "Kortti", langKey: "view_card" }),
                expect.objectContaining({ viewKey: "article", label: "Artikkeli", langKey: "view_article" }),
                expect.objectContaining({ viewKey: "table", label: "Taulu", langKey: "view_table" }),
                expect.objectContaining({ viewKey: "normal", label: "Lista", langKey: "view_normal" }),
                expect.objectContaining({ viewKey: "transposed", label: "Vertailu", langKey: "view_transposed" }),
            ],
            [],
            { includeHeading: false }
        );
        expect(createVanillaDropdownMock).toHaveBeenCalledWith(expect.objectContaining({
            options: [
                { value: "tree", label: "Puunäkymä" },
                { value: "ticket", label: "Tiketti" },
                { value: "product_card", label: "Tuotekortti" },
                { value: "calendar", label: "Kalenteri" },
                { value: "map", label: "Kartta" },
                { value: "price_chart", label: "Hintagraafi" },
                { value: "settings", label: "Asetusnäkymä" },
                { value: "cloud_management", label: "Pilvihallinta" },
            ],
            placeholder: "Lisää näkymiä",
        }));
        expect(viewSelectorContainer.children).toHaveLength(1);
    });

    test("renders chat as a pinned filterbar dock with a clickable animated header", async () => {
        const { appendChatUIIfAllowed } = await import("./admin_button_builder.js");
        const filterBar = document.createElement("div");

        const section = appendChatUIIfAllowed("app_service_catalog", filterBar, {
            tableDisplayName: "Palvelukatalogi",
        });

        const heading = section?.querySelector(".filterbar-chat-dock__header");
        const toggle = section?.querySelector(".filterbar-chat-dock__toggle");
        const content = section?.querySelector(".filterbar-chat-content");

        expect(createChatUiMock).toHaveBeenCalledWith("app_service_catalog", expect.any(HTMLElement));
        expect(filterBar.firstElementChild).toBe(section);
        expect(section?.classList.contains("filterbar-chat-dock")).toBe(true);
        expect(section?.classList.contains("filterbar-chat-section")).toBe(true);
        expect(section?.dataset.chatMode).toBe("api_tools");
        expect(section?.dataset.chatState).toBe("collapsed");
        expect(heading?.classList.contains("filterbar-section-heading")).toBe(true);
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        expect(content?.getAttribute("aria-hidden")).toBe("true");
        const title = heading?.querySelector(".filterbar-chat-dock__title");
        expect(title?.dataset.langKey).toBe("chat_for_table");
        expect(title?.dataset.langVariable).toBe("Palvelukatalogi");
        expect(title?.dataset.langVariableKey).toBe("app_service_catalog");
        expect(heading?.querySelector(".filterbar-chat-dock__title")?.textContent)
            .toBe("Keskustelu - Palvelukatalogi");
        expect(heading?.querySelector(".filterbar-section-heading-icon--chat")).toBeTruthy();
        expect(content?.querySelector(".chat-ui-marker")).toBeTruthy();

        heading?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(section?.classList.contains("is-chat-maximized")).toBe(true);
        expect(section?.dataset.chatState).toBe("maximized");
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(toggle?.getAttribute("aria-label")).toBe("Pienennä chat");
        expect(content?.getAttribute("aria-hidden")).toBe("false");

        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(section?.classList.contains("is-chat-maximized")).toBe(false);
        expect(section?.dataset.chatState).toBe("collapsed");
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        expect(content?.getAttribute("aria-hidden")).toBe("true");
    });

    test("lets the filterbar measure the old dock state before delegated maximize applies", async () => {
        const { appendChatUIIfAllowed } = await import("./admin_button_builder.js");
        const filterBar = document.createElement("div");
        const section = appendChatUIIfAllowed("app_service_catalog", filterBar);
        const heading = section?.querySelector(".filterbar-chat-dock__header");

        let wasMaximizedWhenEventReachedFilterbar = null;
        section?.addEventListener("filterbar-chat-maximize-toggle", (event) => {
            wasMaximizedWhenEventReachedFilterbar = section.classList.contains("is-chat-maximized");
            event.preventDefault();
            section.__setMaximized?.(Boolean(event.detail?.maximized));
        });

        heading?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(wasMaximizedWhenEventReachedFilterbar).toBe(false);
        expect(section?.classList.contains("is-chat-maximized")).toBe(true);
    });

    test("renders the translated chat title template with the display name variable", async () => {
        getTranslationForKeyMock.mockReturnValue("Keskustelu – $table_name");
        const { appendChatUIIfAllowed } = await import("./admin_button_builder.js");

        const section = appendChatUIIfAllowed("system_users", null, {
            tableDisplayName: "Käyttäjät",
        });

        expect(section?.querySelector(".filterbar-chat-dock__title")?.textContent)
            .toBe("Keskustelu – Käyttäjät");
    });

    test("uses the dataset language key before formatting the raw dataset identifier", async () => {
        getTranslationForKeyMock.mockImplementation((key, options = {}) => {
            if (key === "chat_for_table") {
                return "Keskustelu – $table_name";
            }
            if (key === "system_lang_keys") {
                return "Kieliavaimet";
            }
            return options.fallback || "";
        });
        const { appendChatUIIfAllowed } = await import("./admin_button_builder.js");

        const section = appendChatUIIfAllowed("system_lang_keys");
        const title = section?.querySelector(".filterbar-chat-dock__title");

        expect(title?.dataset.langVariable).toBe("Kieliavaimet");
        expect(title?.textContent).toBe("Keskustelu – Kieliavaimet");
    });
});
