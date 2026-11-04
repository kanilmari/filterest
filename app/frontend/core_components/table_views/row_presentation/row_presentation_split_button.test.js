// row_presentation_split_button.test.js
// Proves the Article split button's permissions, caption, menu choice and classic Article path.
// Bridges the stored per-dataset choice with the primary button and the anchored menu.
// Exists so the caption, check mark and primary click always name the same presentation.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { grants, defaultView, translations } = vi.hoisted(() => ({
    grants: new Set(),
    defaultView: { value: "card" },
    translations: {},
}));

vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: vi.fn((route) => grants.has(route)),
    applyPermission: vi.fn(),
}));
vi.mock("../dataset_default_view.js", () => ({
    resolveDatasetDefaultView: vi.fn(() => defaultView.value),
}));
vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key, { fallback = "" } = {}) => translations[key] || fallback),
}));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: vi.fn(() => "fi"),
}));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showToast: vi.fn() }));

import { createRowPresentationSplitButton } from "./row_presentation_split_button.js";
import { wireOutsidePanelClose } from "../../filterbar/filterbar_outside_panel_close.js";
import { showToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import {
    getStoredRowPresentation,
    listPermittedRowPresentations,
    resolveRowPresentationChoice,
    setRowPresentationChoice,
} from "./row_presentation_choice.js";

const ARTICLE = "/ui/view/article_view";
const PAGE = "/ui/view/image_first_page_view";

function build(options = {}) {
    const selectArticle = vi.fn();
    const openPresentation = vi.fn(async () => ({ status: "opened" }));
    const wrapper = createRowPresentationSplitButton({ tableName: "demo", selectArticle, openPresentation, ...options });
    document.body.append(wrapper);
    return {
        wrapper, selectArticle, openPresentation,
        primary: wrapper.querySelector('[data-testid="view-btn-article_view"]'),
        toggle: wrapper.querySelector('[data-testid="row-presentation-toggle"]'),
    };
}
const option = (viewKey) => document.querySelector(`[data-testid="row-presentation-menu-option-${viewKey}"]`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear();
    grants.clear();
    defaultView.value = "card";
    Object.keys(translations).forEach((key) => delete translations[key]);
    showToast.mockReset();
});

describe("permissions", () => {
    test("Article readers get Article and IFAV through the Article gate; Page needs its own right", () => {
        grants.add(ARTICLE);
        expect(listPermittedRowPresentations("demo")).toEqual(["article_view", "image_first_view"]);
        grants.add(PAGE);
        expect(listPermittedRowPresentations("demo")).toEqual(["article_view", "image_first_view", "image_first_page_view"]);
    });

    test("a Page-only reader gets only Page: no classic gate, no menu and no grant expansion", () => {
        grants.add(PAGE);
        expect(listPermittedRowPresentations("demo")).toEqual(["image_first_page_view"]);
        const { primary, toggle } = build();
        expect(primary.dataset.presentation).toBe("image_first_page_view");
        expect(primary.textContent).toBe("Sivukokoinen kuvapainotteinen artikkeli");
        expect(toggle).toBeNull();
        expect(grants.has(ARTICLE)).toBe(false);
    });

    test("a Page-only reader of an Article-default dataset gets Page as the primary, never an unusable Article", async () => {
        // The classic row opener and the dataset renderer refuse Article without
        // its grant even when Article is the collection default.
        defaultView.value = "article_view";
        grants.add(PAGE);
        expect(listPermittedRowPresentations("demo")).toEqual(["image_first_page_view"]);
        const { primary, toggle, selectArticle, openPresentation } = build();
        expect(primary.dataset.presentation).toBe("image_first_page_view");
        expect(toggle).toBeNull();
        primary.click();
        await settle();
        expect(selectArticle).not.toHaveBeenCalled();
        expect(openPresentation).toHaveBeenCalledWith(expect.objectContaining({ viewKey: "image_first_page_view" }));
        expect(grants.has(ARTICLE)).toBe(false);
    });

    test("an Article default view alone offers no locked row action", () => {
        defaultView.value = "article_view";
        expect(listPermittedRowPresentations("demo")).toEqual([]);
        expect(build().wrapper.classList.contains("permission-hidden")).toBe(true);
    });

    test("no permitted presentation hides the control exactly like an ungranted view button", () => {
        const { wrapper } = build();
        expect(wrapper.style.display).toBe("none");
        expect(wrapper.classList.contains("permission-hidden")).toBe(true);
    });

    test("a stored choice the viewer may no longer open falls back to Article, then to the first permitted", () => {
        setRowPresentationChoice("demo", "image_first_page_view");
        grants.add(ARTICLE);
        expect(resolveRowPresentationChoice("demo")).toBe("article_view");
        grants.clear(); grants.add(PAGE);
        expect(resolveRowPresentationChoice("demo")).toBe("image_first_page_view");
    });
});

describe("caption and choice", () => {
    beforeEach(() => { grants.add(ARTICLE); grants.add(PAGE); });

    test("defaults to Article in the UI language with the menu's accessible name", () => {
        const { primary, toggle } = build({ isActive: true });
        expect(primary.textContent).toBe("Artikkeli");
        expect(primary.dataset.langKey).toBe("view_article");
        expect(primary.classList.contains("unified-view-button")).toBe(true);
        expect(primary.getAttribute("aria-pressed")).toBe("true");
        expect(toggle.getAttribute("aria-label")).toBe("Artikkelin esitystavat");
        expect(toggle.dataset.ariaLabelLangKey).toBe("article_presentations_title");
        expect(toggle.getAttribute("aria-haspopup")).toBe("menu");
    });

    test("reviewed runtime translations replace the built-in captions", () => {
        translations.view_image_first = "Image-first article";
        setRowPresentationChoice("demo", "image_first_view");
        expect(build().primary.textContent).toBe("Image-first article");
    });

    test("choosing a presentation updates caption, check mark and stored choice, then opens it", async () => {
        const { primary, toggle, openPresentation, selectArticle } = build();
        toggle.click();
        expect(option("article_view").getAttribute("aria-checked")).toBe("true");
        option("image_first_view").click();
        expect(primary.textContent).toBe("Kuvapainotteinen artikkeli");
        expect(primary.dataset.langKey).toBe("view_image_first");
        expect(getStoredRowPresentation("demo")).toBe("image_first_view");
        expect(document.activeElement).toBe(primary);
        await settle();
        expect(openPresentation).toHaveBeenCalledWith(expect.objectContaining({ tableName: "demo", viewKey: "image_first_view" }));
        expect(selectArticle).not.toHaveBeenCalled();
        toggle.click();
        expect(option("image_first_view").getAttribute("aria-checked")).toBe("true");
        expect(option("article_view").getAttribute("aria-checked")).toBe("false");
    });

    test("the primary click and repeated selections open the current choice each time", async () => {
        const { primary, toggle, openPresentation } = build();
        toggle.click(); option("image_first_page_view").click();
        await settle();
        primary.click(); await settle();
        toggle.click(); option("image_first_page_view").click(); await settle();
        expect(openPresentation.mock.calls.map(([call]) => call.viewKey))
            .toEqual(["image_first_page_view", "image_first_page_view", "image_first_page_view"]);
    });

    test("Article from the menu or the primary uses only the classic path", async () => {
        setRowPresentationChoice("demo", "image_first_view");
        const { primary, toggle, openPresentation, selectArticle } = build();
        toggle.click(); option("article_view").click();
        expect(primary.textContent).toBe("Artikkeli");
        primary.click();
        await settle();
        expect(selectArticle).toHaveBeenCalledTimes(2);
        expect(openPresentation).not.toHaveBeenCalled();
    });

    test("a toolbar rebuild keeps the dataset's choice; another dataset keeps its own", () => {
        const first = build();
        first.toggle.click(); option("image_first_page_view").click();
        first.wrapper.remove();
        expect(build().primary.dataset.presentation).toBe("image_first_page_view");
        const other = createRowPresentationSplitButton({ tableName: "other", selectArticle: vi.fn() });
        expect(other.querySelector(".row-presentation-split__primary").dataset.presentation).toBe("article_view");
    });

    test("every split button of the same dataset follows a choice", () => {
        const first = build();
        const second = build();
        first.toggle.click(); option("image_first_view").click();
        expect(second.primary.textContent).toBe("Kuvapainotteinen artikkeli");
    });

    test("busy state lasts until the opening settles", async () => {
        let finish;
        const { primary, wrapper } = build({ openPresentation: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
        setRowPresentationChoice("demo", "image_first_view");
        primary.dataset.presentation = "image_first_view";
        primary.click();
        await settle();
        expect(wrapper.getAttribute("aria-busy")).toBe("true");
        finish({ status: "opened" });
        await settle();
        expect(wrapper.hasAttribute("aria-busy")).toBe(false);
    });
});

describe("newest activation and failures", () => {
    beforeEach(() => { grants.add(ARTICLE); grants.add(PAGE); });

    test("each activation is recorded before any lazy import; Article cancels a pending IFAV", async () => {
        const guards = [];
        const openPresentation = vi.fn(({ isRequestCurrent }) => { guards.push(isRequestCurrent); return new Promise(() => {}); });
        const { toggle, selectArticle } = build({ openPresentation });
        toggle.click(); option("image_first_view").click();
        await settle();
        expect(guards[0]()).toBe(true);
        toggle.click(); option("article_view").click();
        expect(selectArticle).toHaveBeenCalledOnce();
        expect(guards[0]()).toBe(false);
    });

    test("a newer IFAV or Page choice, or a primary click, supersedes the earlier one", async () => {
        const guards = [];
        const openPresentation = vi.fn(({ isRequestCurrent }) => { guards.push(isRequestCurrent); return new Promise(() => {}); });
        const { primary, toggle, wrapper } = build({ openPresentation });
        toggle.click(); option("image_first_view").click();
        toggle.click(); option("image_first_page_view").click();
        await settle();
        expect(guards.map((guard) => guard())).toEqual([false, true]);
        primary.click(); await settle();
        expect(guards.map((guard) => guard())).toEqual([false, false, true]);
        expect(wrapper.getAttribute("aria-busy")).toBe("true");
    });

    test("a failed opener import gives the generic localized notice, unless superseded", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { primary } = build({ openPresentation: vi.fn(async () => { throw new Error("chunk"); }) });
        primary.dataset.presentation = "image_first_view";
        primary.click(); await settle();
        expect(showToast).toHaveBeenCalledOnce();
        const content = showToast.mock.calls[0][0].content;
        expect(content.dataset.langKey).toBe("load_failed");
        expect(content.textContent).toBe("Lataus epäonnistui.");
        expect(content.textContent).not.toMatch(/demo/);
        showToast.mockReset();
        let reject;
        const slow = build({ openPresentation: vi.fn(() => new Promise((_, no) => { reject = no; })) });
        slow.primary.dataset.presentation = "image_first_view";
        slow.primary.click(); await settle();
        slow.toggle.click(); option("article_view").click();
        reject(new Error("chunk")); await settle();
        expect(showToast).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("narrow filterbar panel", () => {
    beforeEach(() => { grants.add(ARTICLE); grants.add(PAGE); });

    function mountInPanel() {
        const panel = document.createElement("aside");
        const fixedToggleButton = document.createElement("button");
        const sharedTopBar = document.createElement("header");
        document.body.append(panel, fixedToggleButton, sharedTopBar);
        const parts = build();
        panel.append(parts.wrapper);
        const onClose = vi.fn();
        const controller = new AbortController();
        // The real listener: a bubbling document click, as in the filterbar runtime.
        wireOutsidePanelClose({
            tableName: "demo", panel, fixedToggleButton, sharedTopBar, onClose, signal: controller.signal,
            isNarrowScreen: () => true, isHidden: () => false,
        });
        return { ...parts, panel, onClose, controller };
    }

    test("closing a presentation keeps only its own mobile panel open", () => {
        const { onClose, controller } = mountInPanel();
        for (const owner of ["demo", "another"]) {
            const overlay = document.createElement("div");
            overlay.className = "image_first_view_overlay";
            const body = document.createElement("div");
            body.className = "modal_body";
            const dialog = document.createElement("div");
            dialog.className = "image_first_view";
            dialog.dataset.rowPresentationOwner = owner;
            body.append(dialog);
            overlay.append(body);
            const close = document.createElement("button");
            overlay.append(close);
            document.body.append(overlay);
            close.onclick = () => overlay.remove();
            close.click();
            expect(onClose).toHaveBeenCalledTimes(owner === "demo" ? 0 : 1);
        }
        controller.abort();
    });

    test("a choice in the body-mounted menu is not an outside click; focus stays on the rendered primary", async () => {
        const { toggle, primary, panel, onClose, controller, openPresentation } = mountInPanel();
        toggle.click();
        const item = option("image_first_view");
        expect(panel.contains(item)).toBe(false);
        expect(item.parentElement.parentElement).toBe(document.body);
        item.click();
        // The item is detached by its own handler before the click bubbles to document.
        expect(item.isConnected).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(primary);
        await settle();
        expect(openPresentation).toHaveBeenCalledOnce();
        document.body.click();
        expect(onClose).toHaveBeenCalledOnce();
        controller.abort();
    });
});
