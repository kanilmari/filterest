// tab_reorder_handler.test.js
// Verifies tab drag-drop setup can be called repeatedly without duplicating listeners.
// Bridges the tab reorder initializer and navmenu DOM nodes in isolation.
// Exists to keep rerunnable SPA bootstrap from stacking duplicate drag-drop handlers.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const dataTransferStub = () => ({
    effectAllowed: "",
    dropEffect: "",
    setData: vi.fn(),
});

function dispatchDragEvent(element, type, options = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
        value: options.dataTransfer || dataTransferStub(),
    });
    Object.defineProperty(event, "clientX", { value: options.clientX || 0 });
    Object.defineProperty(event, "clientY", { value: options.clientY || 0 });
    element.dispatchEvent(event);
    return event;
}

function mockRect(element, rect) {
    element.getBoundingClientRect = vi.fn(() => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
    }));
}

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../endpoints/endpoint_router.js", () => ({
        endpoint_router: vi.fn(),
    }));
    return import("./tab_reorder_handler.js");
}

describe("enableTabDragAndDrop", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="navmenu">
                <button class="navtablinks" data-id="users"></button>
            </div>
        `;
    });

    test("binds container and button listeners only once per element", async () => {
        const mod = await loadModule();
        const container = document.getElementById("navmenu");
        const button = container.querySelector(".navtablinks");
        const containerListenerSpy = vi.spyOn(container, "addEventListener");
        const buttonListenerSpy = vi.spyOn(button, "addEventListener");

        mod.enableTabDragAndDrop();
        mod.enableTabDragAndDrop();

        expect(containerListenerSpy).toHaveBeenCalledTimes(4);
        expect(containerListenerSpy).toHaveBeenNthCalledWith(
            1,
            "dragstart",
            expect.any(Function)
        );
        expect(containerListenerSpy).toHaveBeenNthCalledWith(
            2,
            "dragover",
            expect.any(Function)
        );
        expect(containerListenerSpy).toHaveBeenNthCalledWith(
            3,
            "drop",
            expect.any(Function)
        );
        expect(containerListenerSpy).toHaveBeenNthCalledWith(
            4,
            "dragend",
            expect.any(Function)
        );
        expect(buttonListenerSpy).toHaveBeenCalledTimes(1);
        expect(button.draggable).toBe(true);
        expect(button.dataset.dragDropBound).toBe("true");
        expect(container.dataset.dragDropBound).toBe("true");
    });

    test("reorders vertical button tabs by moving the dragged tab directly", async () => {
        document.body.innerHTML = `
            <div id="navmenu">
                <button class="navtablinks" data-id="alpha" data-tab-presentation="button-inactive"></button>
                <button class="navtablinks" data-id="beta" data-tab-presentation="button-inactive"></button>
                <button class="navtablinks" data-id="gamma" data-tab-presentation="button-inactive"></button>
            </div>
        `;
        const mod = await loadModule();
        const { endpoint_router } = await import("../../endpoints/endpoint_router.js");
        const container = document.getElementById("navmenu");
        const [alpha, beta, gamma] = container.querySelectorAll(".navtablinks");
        mockRect(alpha, { left: 0, top: 0, width: 240, height: 56 });
        mockRect(beta, { left: 0, top: 56, width: 240, height: 56 });
        mockRect(gamma, { left: 0, top: 112, width: 240, height: 56 });

        mod.enableTabDragAndDrop();
        dispatchDragEvent(alpha, "dragstart", { clientY: 10 });
        dispatchDragEvent(container, "dragover", { clientY: 180 });
        dispatchDragEvent(container, "dragend");
        await Promise.resolve();

        expect(Array.from(container.children).map((child) => child.dataset.id)).toEqual([
            "beta",
            "gamma",
            "alpha",
        ]);
        expect(endpoint_router).toHaveBeenCalledWith("updateTabOrder", {
            method: "POST",
            body_data: {
                tab_order: [
                    { tab_id: "beta", sort_order: 1 },
                    { tab_id: "gamma", sort_order: 2 },
                    { tab_id: "alpha", sort_order: 3 },
                ],
            },
        });
    });

    test("keeps horizontal rtl tabs visually ordered with the same direct-drag model", async () => {
        document.body.innerHTML = `
            <div id="navmenu" style="direction: rtl;">
                <button class="navtablinks" data-id="right"></button>
                <button class="navtablinks" data-id="middle"></button>
                <button class="navtablinks" data-id="left"></button>
            </div>
        `;
        const mod = await loadModule();
        const { endpoint_router } = await import("../../endpoints/endpoint_router.js");
        const container = document.getElementById("navmenu");
        const [right, middle, left] = container.querySelectorAll(".navtablinks");
        mockRect(right, { left: 200, top: 0, width: 100, height: 56 });
        mockRect(middle, { left: 100, top: 0, width: 100, height: 56 });
        mockRect(left, { left: 0, top: 0, width: 100, height: 56 });

        mod.enableTabDragAndDrop();
        dispatchDragEvent(right, "dragstart", { clientX: 250 });
        dispatchDragEvent(container, "dragover", { clientX: 20 });
        dispatchDragEvent(container, "dragend");
        await Promise.resolve();

        expect(Array.from(container.children).map((child) => child.dataset.id)).toEqual([
            "middle",
            "left",
            "right",
        ]);
        expect(endpoint_router).toHaveBeenCalledTimes(1);
    });
});
