// price_chart_view_printer.test.js
// Verifies the price chart view DOM output and wheel zoom behavior.
// Bridges extracted price points and the standalone SVG renderer in jsdom.
// Exists to keep the new dataset view usable without browser-only dependencies.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
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
        expect(view.querySelector('[data-lang-key="view_chart"]')?.textContent).toBe("Chart");
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

        expect(view.querySelector(".price-chart-view__notice")?.textContent).toContain("Chart is unavailable");
    });
});

test('axis pickers redraw and retain their choice through appended and empty rows', () => {
    const columns = ['clock', 'id', 'volume'];
    const types = { clock: 'date', id: 'integer', volume: 'numeric' };
    const rows = [
        { clock: '2026-01-01', id: 1, volume: 4 },
        { clock: '2026-01-02', id: 2, volume: 20 },
        { clock: '2026-01-03', id: 3, volume: 7 },
    ];
    const root = create_price_chart_view('series', columns, rows, types, { params: {} });
    const y = root.querySelector('[data-testid="chart-y-axis"]');
    expect(y.closest('label').textContent).toContain('Y-axis (numeric)');
    expect(y.value).toBe('volume');
    const initialPath = root.querySelector('path').getAttribute('d');
    y.value = 'id'; y.dispatchEvent(new Event('change'));
    expect(root.querySelector('path').getAttribute('d')).not.toBe(initialPath);
    expect(root.dataset.chartY).toBe('id');
    expect(new URLSearchParams(window.location.search).get('chart_y')).toBe('id');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('price_chart');
    root.commitDatasetRows([], { append: false, isCurrent: () => true });
    expect(root.querySelector('select')).not.toBeNull();
    expect(root.querySelectorAll('circle')).toHaveLength(0);
    root.commitDatasetRows(rows, { append: true, isCurrent: () => true });
    expect(y.value).toBe('id');
    expect(root.querySelectorAll('circle')).toHaveLength(3);
});

test('administrator save reports refusal and captures the chosen axes', async () => {
    const onSaveDefault = vi.fn().mockRejectedValue(new Error('denied'));
    const root = create_price_chart_view('series', ['clock', 'id'], [], { clock: 'date', id: 'integer' },
        { params: {}, canSaveDefault: true, onSaveDefault });
    const save = root.querySelector('[data-testid="chart-save-default"]');
    save.click();
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(onSaveDefault).toHaveBeenCalledWith({ timeColumn: 'clock', priceColumn: 'id' });
    expect(root.querySelector('[role="status"]').textContent).toBe('Could not save default axes');
    const guest = create_price_chart_view('series', ['clock', 'id'], [], { clock: 'date', id: 'integer' });
    expect(guest.querySelector('[data-testid="chart-save-default"]')).toBeNull();
});

test('Alt-wheel on an empty chart cannot poison the range of later rows', () => {
    const root = create_price_chart_view('empty_series', ['clock', 'id'], [], { clock: 'date', id: 'integer' });
    const plot = root.querySelector('[data-testid="price-chart-plot"]');
    plot.dispatchEvent(new WheelEvent('wheel', { altKey: true, deltaY: -100, cancelable: true }));
    root.commitDatasetRows([{ clock: '2026-01-01', id: 1 }], { append: true, isCurrent: () => true });
    expect(root.querySelectorAll('circle')).toHaveLength(1);
    root.querySelector('[data-lang-key="price_chart_zoom_in"]').click();
    root.commitDatasetRows([], { append: false, isCurrent: () => true });
    plot.dispatchEvent(new WheelEvent('wheel', { altKey: true, deltaY: -100, cancelable: true }));
    root.commitDatasetRows([{ clock: '2026-02-01', id: 2 }], { append: true, isCurrent: () => true });
    expect(root.querySelectorAll('circle')).toHaveLength(1);
});
