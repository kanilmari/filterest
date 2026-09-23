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

    test("links HTTP(S) addresses in semantic and ordinary text fields", () => {
        const kvContainer = document.createElement("div");
        document.body.appendChild(kvContainer);

        renderKeyValuePairs(
            kvContainer,
            [
                { key: "website", value: "https://example.test", isLink: true },
                { key: "unsafe", value: "javascript:alert(1)", isLink: true },
                { key: "plain", value: "https://plain-text.test" },
            ],
            { layoutMode: "stacked" }
        );

        const links = kvContainer.querySelectorAll("a");
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute("href")).toBe("https://example.test");
        expect(links[0].getAttribute("target")).toBe("_blank");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
        expect(links[1].getAttribute("href")).toBe("https://plain-text.test");
        expect(links[1].getAttribute("target")).toBe("_blank");
        expect(kvContainer.textContent).toContain("javascript:alert(1)");
        expect(kvContainer.textContent).toContain("https://plain-text.test");
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
    test.each(["conditional", "stacked", "inline"])(
        "honors per-column layouts inside legacy %s mode without changing values or visibility", (layoutMode) => {
            const kvContainer = document.createElement("div");
            document.body.append(kvContainer);
            const settings = [null, "auto", "inline", "stacked"];
            renderKeyValuePairs(kvContainer, settings.map((setting, index) => ({
                key: "website" + index, labelText: "Website " + index,
                value: "https://example.test/" + index, isLink: true,
                columnClass: "column_orders_website" + index,
                labelMeta: { label_value_layout: setting },
            })), { layoutMode });
            settings.forEach((setting, index) => {
                const pair = kvContainer.querySelector(".column_orders_website" + index);
                expect(pair).not.toBeNull();
                expect(pair.dataset.labelValueLayout).toBe(setting || undefined);
                expect(pair.querySelector("a")?.getAttribute("href")).toBe("https://example.test/" + index);
                expect(pair.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
                expect(pair.textContent).toContain("Website " + index);
                if (setting) expect(pair.querySelector(".kv-dropped")).toBeNull();
            });
        },
    );

    describe("a name placement stated by the caller's key hook", () => {
        const decorateWith = (labelPlacement) => () => ({ labelPlacement });

        test.each(["conditional", "stacked", "inline"])(
            "leaves a hidden name out of the pair in %s mode", (layoutMode) => {
                const kvContainer = document.createElement("div");
                document.body.append(kvContainer);

                renderKeyValuePairs(kvContainer, [{
                    key: "summary", labelText: "Summary",
                    value: "A paragraph that would otherwise be headed by its own name.",
                    columnClass: "column_orders_summary",
                }], { layoutMode, decorateKeyElement: decorateWith("hidden") });

                const pair = kvContainer.querySelector(".column_orders_summary");
                expect(pair?.dataset.cardLabelPlacement).toBe("hidden");
                expect(pair?.querySelector(".kv-key")).toBeNull();
                expect(pair?.textContent).toContain("A paragraph");
                expect(pair?.classList).toContain("label-value-layout--value-only");
            },
        );

        test.each(["conditional", "stacked", "inline"])(
            "keeps a short value's name on the value's line in %s mode", (layoutMode) => {
                const kvContainer = document.createElement("div");
                document.body.append(kvContainer);

                renderKeyValuePairs(kvContainer, [{
                    key: "price", labelText: "Price", value: "129 €",
                    columnClass: "column_orders_price",
                }], { layoutMode, decorateKeyElement: decorateWith("inline") });

                const pair = kvContainer.querySelector(".column_orders_price");
                expect(pair?.dataset.cardLabelPlacement).toBe("inline");
                expect(pair?.dataset.labelValueLayout).toBe("inline");
                // The colon belongs to style, never to the translated name element.
                expect(pair?.querySelector(".kv-key")?.textContent).toBe("Price");
                expect(pair?.querySelector(".kv-value")?.classList)
                    .toContain("label-value-layout__value");
            },
        );

        test("a stated placement overrules the column's own setting", () => {
            const kvContainer = document.createElement("div");
            document.body.append(kvContainer);

            renderKeyValuePairs(kvContainer, [{
                key: "summary", labelText: "Summary", value: "Long text",
                columnClass: "column_orders_summary",
                labelMeta: { label_value_layout: "auto" },
            }], { layoutMode: "conditional", decorateKeyElement: decorateWith("stacked") });

            const pair = kvContainer.querySelector(".column_orders_summary");
            expect(pair?.dataset.cardLabelPlacement).toBe("stacked");
            expect(pair?.dataset.labelValueLayout).toBe("stacked");
        });

        test("a stated placement is never re-decided by one row's measured text", () => {
            const kvContainer = document.createElement("div");
            document.body.append(kvContainer);

            renderKeyValuePairs(kvContainer, [{
                key: "price", labelText: "Price",
                value: "A value far too wide to fit beside its own name in this column.",
                columnClass: "column_orders_price",
            }], { layoutMode: "conditional", decorateKeyElement: decorateWith("inline") });

            expect(kvContainer.querySelector(".kv-dropped")).toBeNull();
            expect(kvContainer.querySelector(".kv-value")?.style.marginLeft).toBe("");
        });

        test("keeps link handling and its safety rules untouched by the placement", () => {
            const kvContainer = document.createElement("div");
            document.body.append(kvContainer);

            renderKeyValuePairs(kvContainer, [
                {
                    key: "homepage", labelText: "Homepage", value: "https://example.test",
                    isLink: true, columnClass: "column_orders_homepage",
                },
                {
                    key: "note", labelText: "Note", value: "javascript:alert(1)",
                    isLink: true, columnClass: "column_orders_note",
                },
            ], { layoutMode: "conditional", decorateKeyElement: decorateWith("hidden") });

            const link = kvContainer.querySelector(".column_orders_homepage a");
            expect(link?.getAttribute("href")).toBe("https://example.test");
            expect(link?.getAttribute("target")).toBe("_blank");
            expect(link?.getAttribute("rel")).toBe("noopener noreferrer");

            const unsafe = kvContainer.querySelector(".column_orders_note");
            expect(unsafe?.querySelector("a")).toBeNull();
            expect(unsafe?.textContent).toContain("javascript:alert(1)");
        });
    });
});
