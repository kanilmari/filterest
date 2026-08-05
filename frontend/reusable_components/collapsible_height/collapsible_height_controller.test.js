// @vitest-environment jsdom
// collapsible_height_controller.test.js
// Verifies reusable height-collapse behavior for generic frontend containers.
// Bridges DOM measurement stubs and the collapsible height controller without relying on a real browser layout engine.
// Exists to keep expand/collapse state handling stable for trees, accordions, and future reusable widgets.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCollapsibleHeightController } from "./collapsible_height_controller.js";

function defineScrollHeight(element, initialHeight) {
    let currentHeight = initialHeight;
    Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        get: () => currentHeight,
    });
    return (nextHeight) => {
        currentHeight = nextHeight;
    };
}

describe("createCollapsibleHeightController", () => {
    let originalMatchMedia;
    let originalResizeObserver;
    let resizeObserverInstances;

    beforeEach(() => {
        document.body.innerHTML = "";
        resizeObserverInstances = [];
        originalMatchMedia = window.matchMedia;
        originalResizeObserver = globalThis.ResizeObserver;

        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        globalThis.ResizeObserver = class {
            constructor(callback) {
                this.callback = callback;
                resizeObserverInstances.push(this);
            }

            observe(target) {
                this.target = target;
            }

            disconnect() {}
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        window.matchMedia = originalMatchMedia;
        if (originalResizeObserver === undefined) {
            delete globalThis.ResizeObserver;
        } else {
            globalThis.ResizeObserver = originalResizeObserver;
        }
    });

    test("expands a collapsed element and restores auto height", async () => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        defineScrollHeight(element, 96);

        const controller = createCollapsibleHeightController(element, {
            startExpanded: false,
        });

        await controller.expand();

        expect(controller.isExpanded()).toBe(true);
        expect(element.hidden).toBe(false);
        expect(element.dataset.collapsibleState).toBe("expanded");
        expect(element.style.height).toBe("auto");
    });

    test("collapses an expanded element and hides it at zero height", async () => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        defineScrollHeight(element, 72);

        const controller = createCollapsibleHeightController(element, {
            startExpanded: true,
        });

        await controller.collapse();

        expect(controller.isExpanded()).toBe(false);
        expect(element.hidden).toBe(true);
        expect(element.dataset.collapsibleState).toBe("collapsed");
        expect(element.style.height).toBe("0px");
    });

    test("syncs open height when ResizeObserver reports nested growth", async () => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        const setScrollHeight = defineScrollHeight(element, 80);

        createCollapsibleHeightController(element, {
            startExpanded: true,
            observeResize: true,
        });

        setScrollHeight(140);
        resizeObserverInstances[0].callback([{ target: element }]);

        expect(element.hidden).toBe(false);
        expect(element.style.height).toBe("auto");
    });

    test("does not let an interrupted collapse hide the element after a reopen", async () => {
        vi.useFakeTimers();
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        const element = document.createElement("div");
        document.body.appendChild(element);
        defineScrollHeight(element, 72);

        const controller = createCollapsibleHeightController(element, {
            startExpanded: true,
        });

        const collapsePromise = controller.collapse();
        const expandPromise = controller.expand();

        await vi.advanceTimersByTimeAsync(400);
        await Promise.all([collapsePromise, expandPromise]);

        expect(controller.isExpanded()).toBe(true);
        expect(element.hidden).toBe(false);
        expect(element.style.height).toBe("auto");
        expect(element.dataset.collapsibleState).toBe("expanded");
    });
});
