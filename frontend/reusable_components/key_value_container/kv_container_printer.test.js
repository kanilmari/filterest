// kv_container_printer.test.js
// Bridges the key-value card renderer and a jsdom card mount sequence.
// Verifies that initial KV rendering waits until the card is mounted to the live DOM.
// Exists to prevent regressions where off-DOM pre-rendering triggers extra relayout work.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderKeyValuePairs } from "./kv_container_printer.js";

describe("renderKeyValuePairs", () => {
    let originalResizeObserver;
    let observeCalls;

    beforeEach(() => {
        document.body.innerHTML = "";
        originalResizeObserver = globalThis.ResizeObserver;
        observeCalls = 0;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
            font: "",
            measureText: (text) => ({ width: text.length * 8 }),
        });
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 1;
        });
        globalThis.ResizeObserver = class {
            observe() {
                observeCalls += 1;
            }
            disconnect() {}
        };
    });

    afterEach(() => {
        document.body.innerHTML = "";
        if (originalResizeObserver === undefined) {
            delete globalThis.ResizeObserver;
        } else {
            globalThis.ResizeObserver = originalResizeObserver;
        }
        vi.restoreAllMocks();
    });

    test("pre-renders KV content but defers responsive observation until the entering card settles", () => {
        const card = document.createElement("article");
        card.className = "card card--entering";

        const kvContainer = document.createElement("div");
        card.appendChild(kvContainer);

        renderKeyValuePairs(
            kvContainer,
            [{ key: "task_name", value: "Continue SPA definition" }],
            { layoutMode: "conditional" }
        );

        expect(kvContainer.children.length).toBeGreaterThan(0);
        expect(observeCalls).toBe(0);

        document.body.appendChild(card);
        card.dispatchEvent(new CustomEvent("easelect:card-mounted"));

        expect(observeCalls).toBe(0);

        card.dispatchEvent(new Event("animationend"));
        expect(observeCalls).toBe(1);
    });

    test("renders internal relation links with an explicit new-tab action", () => {
        const kvContainer = document.createElement("div");
        document.body.appendChild(kvContainer);

        renderKeyValuePairs(
            kvContainer,
            [
                {
                    key: "parent_name",
                    labelText: "Parent name",
                    value: "Epic: Production Readiness 100%",
                    href: "/dev_agent_tasks/305-epic-production-readiness-100",
                    openInNewTabHref: "/dev_agent_tasks/305-epic-production-readiness-100",
                },
            ],
            { layoutMode: "stacked" }
        );

        const links = kvContainer.querySelectorAll("a");
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute("href")).toBe("/dev_agent_tasks/305-epic-production-readiness-100");
        expect(links[0].textContent).toBe("Epic: Production Readiness 100%");
        expect(links[1].getAttribute("target")).toBe("_blank");
        expect(links[1].textContent).toBe("");
        expect(links[1].getAttribute("title")).toBe("Avaa uudessa välilehdessä");
        expect(links[1].getAttribute("aria-label")).toBe("Avaa uudessa välilehdessä");
        expect(links[1].dataset.titleLangKey).toBe("open_in_new_tab");
        expect(links[1].dataset.ariaLabelLangKey).toBe("open_in_new_tab");
        expect(links[1].querySelector(".open-in-new-tab-icon")).not.toBeNull();
        expect(kvContainer.querySelector(".kv-key")?.textContent).toBe("Parent name");
    });

    test("uses titleValue as the hover text for rendered values", () => {
        const kvContainer = document.createElement("div");
        document.body.appendChild(kvContainer);

        renderKeyValuePairs(
            kvContainer,
            [{
                key: "created",
                labelText: "Created",
                value: "2026-06-15 21:36",
                titleValue: "2026-06-15 21:36:10",
            }],
            { layoutMode: "stacked" }
        );

        const value = kvContainer.querySelector(".kv-value");

        expect(value?.textContent).toBe("2026-06-15 21:36");
        expect(value?.title).toBe("2026-06-15 21:36:10");
    });

    test("applies the opt-in key decorator in every responsive layout mode", () => {
        const decorateKeyElement = vi.fn((keyElement) => {
            keyElement.classList.add("decorated-key");
        });

        ["inline", "stacked", "conditional"].forEach((layoutMode) => {
            const kvContainer = document.createElement("div");
            document.body.appendChild(kvContainer);
            renderKeyValuePairs(
                kvContainer,
                [{ key: "status", value: "Active" }],
                { layoutMode, decorateKeyElement }
            );

            expect(
                kvContainer.querySelector(".kv-key")?.classList.contains("decorated-key")
            ).toBe(true);
        });
        expect(decorateKeyElement).toHaveBeenCalledTimes(3);
    });

    test("preserves a field visibility class in every responsive layout mode", () => {
        ["inline", "stacked", "conditional"].forEach((layoutMode) => {
            const kvContainer = document.createElement("div");
            document.body.appendChild(kvContainer);
            renderKeyValuePairs(
                kvContainer,
                [{
                    key: "status",
                    value: "Active",
                    columnClass: "column_orders_status",
                }],
                { layoutMode }
            );

            expect(kvContainer.firstElementChild?.classList)
                .toContain("column_orders_status");
        });
    });
});
