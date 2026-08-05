// price_chart_data_reader.test.js
// Verifies price chart column inference and row parsing.
// Bridges generic dataset rows and the DOM-independent chart data reader.
// Exists to keep the price chart view stable across imported price formats.

import { describe, expect, test } from "vitest";
import {
    extract_price_chart_points,
    infer_price_chart_columns,
    parse_price_chart_value,
} from "./price_chart_data_reader.js";

describe("price_chart_data_reader", () => {
    test("prefers explicit time and close price columns", () => {
        const columns = infer_price_chart_columns(
            ["id", "observed_at", "close_price", "volume"],
            {
                observed_at: "TIMESTAMP",
                close_price: "NUMERIC",
                volume: "INTEGER",
            }
        );

        expect(columns).toEqual({
            timeColumn: "observed_at",
            priceColumn: "close_price",
        });
    });

    test("parses simple localized price strings", () => {
        expect(parse_price_chart_value("64 250,50 €")).toBe(64250.5);
        expect(parse_price_chart_value("$102.75")).toBe(102.75);
        expect(parse_price_chart_value("not a price")).toBeNull();
    });

    test("drops malformed rows and sorts points by time", () => {
        const result = extract_price_chart_points(
            ["recorded_at", "price"],
            [
                { recorded_at: "2026-01-03", price: "103.25" },
                { recorded_at: "bad", price: "101.10" },
                { recorded_at: "2026-01-01", price: "100.00" },
            ],
            { recorded_at: "DATE", price: "NUMERIC" }
        );

        expect(result.points).toHaveLength(2);
        expect(result.points.map((point) => point.price)).toEqual([100, 103.25]);
    });
});
