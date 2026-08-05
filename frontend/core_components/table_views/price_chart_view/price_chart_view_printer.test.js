// price_chart_view_printer.test.js
// Verifies the price chart view DOM output and wheel zoom behavior.
// Bridges extracted price points and the standalone SVG renderer in jsdom.
// Exists to keep the new dataset view usable without browser-only dependencies.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { create_price_chart_view } from "./price_chart_view_printer.js";

describe("price_chart_view_printer", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("renders a line chart for price rows", () => {
        const view = create_price_chart_view(
            "app_price_chart_demo",
            ["observed_at", "close_price"],
            [
                { observed_at: "2026-01-01", close_price: 100 },
                { observed_at: "2026-01-02", close_price: 105 },
                { observed_at: "2026-01-03", close_price: 101 },
            ],
            { observed_at: "DATE", close_price: "NUMERIC" }
        );

        expect(view.dataset.testid).toBe("price-chart-view");
        expect(view.querySelector(".price-chart-view__line")).not.toBeNull();
        expect(view.querySelectorAll(".price-chart-view__point")).toHaveLength(3);
        expect(view.querySelector('[data-lang-key="price_chart_view_title"]')?.textContent).toBe("Price chart");
    });

    test("alt wheel zooms the visible range", () => {
        const view = create_price_chart_view(
            "app_price_chart_demo",
            ["observed_at", "close_price"],
            [
                { observed_at: "2026-01-01", close_price: 100 },
                { observed_at: "2026-01-02", close_price: 105 },
                { observed_at: "2026-01-03", close_price: 101 },
                { observed_at: "2026-01-04", close_price: 110 },
            ],
            { observed_at: "DATE", close_price: "NUMERIC" }
        );
        document.body.appendChild(view);
        const plot = view.querySelector('[data-testid="price-chart-plot"]');
        const initialStatus = view.querySelector(".price-chart-view__status")?.textContent;

        plot.dispatchEvent(new WheelEvent("wheel", {
            altKey: true,
            bubbles: true,
            cancelable: true,
            clientX: 200,
            deltaY: -100,
        }));

        const zoomedStatus = view.querySelector(".price-chart-view__status")?.textContent;
        expect(zoomedStatus).not.toBe(initialStatus);
    });

    test("shows an empty state when columns are not chartable", () => {
        const view = create_price_chart_view(
            "notes",
            ["id", "title"],
            [{ id: 1, title: "Only text" }],
            { id: "INTEGER", title: "TEXT" }
        );

        expect(view.querySelector(".price-chart-view__notice")?.textContent).toContain("No price chart columns found");
    });
});
