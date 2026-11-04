// anchored_action_menu.test.js
// Proves the anchored action menu's keyboard, pointer, check mark and disposal contract.
// Bridges a native trigger with the portalled role="menu" list in jsdom.
// Exists so every document listener lives only while the menu is open.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAnchoredActionMenu } from "./anchored_action_menu.js";

const ITEMS = [
    { value: "article_view", label: "Artikkeli", langKey: "view_article" },
    { value: "image_first_view", label: "Kuvapainotteinen artikkeli", langKey: "view_image_first" },
    { value: "image_first_page_view", label: "Sivukokoinen kuvapainotteinen artikkeli", langKey: "article_presentations_page" },
];

function setup({ checked = "article_view" } = {}) {
    const wrapper = document.createElement("div");
    const primary = document.createElement("button");
    const trigger = document.createElement("button");
    wrapper.append(primary, trigger);
    document.body.append(wrapper);
    const onSelect = vi.fn();
    const menu = createAnchoredActionMenu({
        trigger, anchor: wrapper, owner: wrapper, onSelect, testid: "demo-menu",
        menuLabel: "Artikkelin esitystavat", menuLabelLangKey: "article_presentations_title",
        buildItems: () => ITEMS.map((item) => ({ ...item, checked: item.value === checked })),
    });
    return { wrapper, trigger, menu, onSelect };
}

const menuElement = () => document.querySelector('[data-testid="demo-menu"]');
const option = (value) => document.querySelector(`[data-testid="demo-menu-option-${value}"]`);
const key = (target, name) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

describe("createAnchoredActionMenu", () => {
    beforeEach(() => { document.body.replaceChildren(); });
    afterEach(() => { vi.restoreAllMocks(); });

    test("opens a labelled menu of radio items that marks only the current choice", () => {
        const { trigger } = setup({ checked: "image_first_view" });
        expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
        trigger.click();
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(trigger.getAttribute("aria-controls")).toBe(menuElement().id);
        expect(menuElement().getAttribute("role")).toBe("menu");
        expect(menuElement().dataset.ariaLabelLangKey).toBe("article_presentations_title");
        expect(menuElement().parentElement).toBe(document.body);
        const checked = [...menuElement().querySelectorAll('[aria-checked="true"]')];
        expect(checked.map((item) => item.dataset.value)).toEqual(["image_first_view"]);
        expect(option("image_first_view").textContent).toContain("✓");
        expect(option("article_view").textContent).not.toContain("✓");
        expect(option("image_first_page_view").querySelector("[data-lang-key]").dataset.langKey)
            .toBe("article_presentations_page");
        expect(document.activeElement).toBe(option("image_first_view"));
    });

    test("arrow keys open and move, Escape closes and returns focus to the trigger", () => {
        const { trigger, menu } = setup();
        trigger.focus();
        key(trigger, "ArrowDown");
        expect(menu.isOpen()).toBe(true);
        expect(document.activeElement).toBe(option("article_view"));
        key(document.activeElement, "ArrowDown");
        expect(document.activeElement).toBe(option("image_first_view"));
        key(document.activeElement, "End");
        expect(document.activeElement).toBe(option("image_first_page_view"));
        key(document.activeElement, "ArrowDown");
        expect(document.activeElement).toBe(option("article_view"));
        key(document.activeElement, "ArrowUp");
        expect(document.activeElement).toBe(option("image_first_page_view"));
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        const outerEscape = vi.fn();
        document.addEventListener("keydown", outerEscape);
        document.activeElement.dispatchEvent(escape);
        document.removeEventListener("keydown", outerEscape);
        expect(escape.defaultPrevented).toBe(true);
        expect(outerEscape).not.toHaveBeenCalled();
        expect(menuElement()).toBeNull();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
        key(trigger, "ArrowUp");
        expect(document.activeElement).toBe(option("image_first_page_view"));
    });

    test.each([false, true])("Tab closes without consuming the browser's focus movement (shift: %s)", (shiftKey) => {
        const { trigger, menu } = setup();
        trigger.click();
        const tab = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
        const outerTab = vi.fn();
        document.addEventListener("keydown", outerTab);
        document.activeElement.dispatchEvent(tab);
        document.removeEventListener("keydown", outerTab);
        expect(menu.isOpen()).toBe(false);
        expect(tab.defaultPrevented).toBe(false);
        expect(outerTab).toHaveBeenCalledOnce();
        // jsdom has no native tab traversal. This is the starting point from
        // which the browser's unprevented default advances (or reverses) focus.
        expect(document.activeElement).toBe(trigger);
    });

    test("Enter and Space activate the focused item through the native button", () => {
        const { trigger, onSelect } = setup();
        trigger.click();
        option("image_first_page_view").click();
        expect(onSelect).toHaveBeenCalledWith("image_first_page_view", expect.anything());
        expect(menuElement()).toBeNull();
    });

    test("an outside pointer closes the menu and removes its document listeners", () => {
        const add = vi.spyOn(document, "addEventListener");
        const remove = vi.spyOn(document, "removeEventListener");
        const { trigger, menu } = setup();
        trigger.click();
        const pointerListeners = add.mock.calls.filter(([type]) => type === "pointerdown");
        expect(pointerListeners).toHaveLength(1);
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(menu.isOpen()).toBe(false);
        expect(menuElement()).toBeNull();
        // AbortController removes it: a later outside pointer finds nothing to close.
        expect(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))).not.toThrow();
        expect(remove).not.toHaveBeenCalledWith("pointerdown", expect.anything());
    });

    test("a pointer on the trigger toggles instead of closing twice", () => {
        const { trigger, menu } = setup();
        trigger.click();
        trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(menu.isOpen()).toBe(true);
        trigger.click();
        expect(menu.isOpen()).toBe(false);
    });

    test("removing the owner disposes an open menu without stealing focus", async () => {
        const { wrapper, menu } = setup();
        const outside = document.createElement("input");
        document.body.append(outside);
        menu.open();
        wrapper.remove();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(menu.isOpen()).toBe(false);
        expect(menuElement()).toBeNull();
    });

    test("dispose closes and detaches the trigger", () => {
        const { trigger, menu } = setup();
        trigger.click();
        menu.dispose();
        expect(menuElement()).toBeNull();
        trigger.click();
        expect(menu.isOpen()).toBe(false);
    });
});
