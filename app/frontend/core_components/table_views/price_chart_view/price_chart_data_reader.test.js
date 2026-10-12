// price_chart_data_reader.test.js
// Verifies price chart column inference and row parsing.
// Bridges generic dataset rows and the DOM-independent chart data reader.
// Exists to keep the price chart view stable across imported price formats.

import { describe, expect, test } from "vitest";
import {
    extract_price_chart_points,
    infer_price_chart_columns,
    parse_price_chart_value,
    parse_price_chart_time,
    datasetSupportsChartView,
    resolveChartAxes,
    chartAxesToParams,
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

describe('general chart contract', () => {
    const columns = ['id', 'date', 'happened', 'price', 'count'];
    const types = { id: 'integer', date: 'text', happened: 'timestamptz', price: 'text', count: 'numeric(10, 2)' };

    test.each(['date', 'time', 'time without time zone', 'time with time zone', 'timetz',
        'timestamp', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz', 'timestamp(3) with time zone'])('fits typed %s even with only id as the number', type => {
        expect(datasetSupportsChartView(['id', 'clock'], { id: { data_type: 'integer' }, clock: { data_type: type } })).toBe(true);
    });

    test.each(['smallint', 'integer', 'bigint', 'int', 'int2', 'int4', 'int8', 'numeric', 'decimal(9,2)',
        'real', 'double precision', 'float4', 'float8', 'serial', 'bigserial'])('fits numeric %s', type => {
        expect(datasetSupportsChartView(['clock', 'n'], { clock: 'date', n: type })).toBe(true);
    });

    test.each(['text', 'varchar', 'interval', 'timestamp[]', 'daterange', 'update_status', 'jsonb', ''])('rejects an unusable time type %s despite the date alias', type => {
        expect(datasetSupportsChartView(['id', 'date'], { id: 'integer', date: type })).toBe(false);
    });

    test.each(['text', 'money', 'numeric[]', 'point', 'boolean', 'uuid', ''])('rejects nonnumeric %s', type => {
        expect(datasetSupportsChartView(['date', 'price'], { date: 'date', price: type })).toBe(false);
    });

    test('rejects absent and undelivered metadata without looking at rows', () => {
        expect(datasetSupportsChartView()).toBe(false);
        expect(datasetSupportsChartView(['id', 'date'])).toBe(false);
        expect(datasetSupportsChartView(['id', 'date'], { id: 'integer', date: { data_type: 'date', hide_everywhere: true } })).toBe(false);
        expect(datasetSupportsChartView(['id', 'date'], { id: { data_type: 'integer', client_delivery_mode: 'omit' }, date: 'date' })).toBe(false);
    });

    test('ignores text aliases, prefers another numeric column, then falls back to id', () => {
        expect(infer_price_chart_columns(columns, types)).toEqual({ timeColumn: 'happened', priceColumn: 'count' });
        expect(infer_price_chart_columns(['id', 'happened'], types)).toEqual({ timeColumn: 'happened', priceColumn: 'id' });
        expect(infer_price_chart_columns(columns, { ...types, price: 'numeric' }).priceColumn).toBe('price');
    });

    test('resolves address over saved defaults and validates axes separately', () => {
        expect(resolveChartAxes(columns, types, { chart_y: 'id' }, ['happened', 'count'])).toEqual({ timeColumn: 'happened', priceColumn: 'id' });
        expect(resolveChartAxes(columns, types, { chart_x: 'date', chart_y: 'price' }, ['happened', 'id'])).toEqual({ timeColumn: 'happened', priceColumn: 'id' });
        expect(resolveChartAxes(columns, types, { chart_x: 'count', chart_y: 'missing' }, ['gone', 'price'])).toEqual({ timeColumn: 'happened', priceColumn: 'count' });
    });

    test.each([
        ['saved time was filtered out', ['volume'], 'observed_at', 'volume'],
        ['saved number was filtered out', ['recorded_at'], 'recorded_at', 'close_price'],
        ['members arrive in reverse order', ['volume', 'recorded_at'], 'recorded_at', 'volume'],
        ['foreign and ineligible names are ignored', ['foreign_time', 'hidden_time', 'text_number', 'omitted_number', 'foreign_number'], 'observed_at', 'close_price'],
    ])('%s: preserves each eligible saved axis independently', (_name, saved, timeColumn, priceColumn) => {
        const delivered = ['observed_at', 'recorded_at', 'close_price', 'volume', 'hidden_time', 'text_number', 'omitted_number'];
        const metadata = { observed_at: 'date', recorded_at: 'timestamptz', close_price: 'numeric', volume: 'integer',
            hidden_time: { data_type: 'date', hide_everywhere: true }, text_number: 'text',
            omitted_number: { data_type: 'integer', client_delivery_mode: 'omit' },
            foreign_time: 'date', foreign_number: 'numeric' };
        expect(resolveChartAxes(delivered, metadata, {}, saved)).toEqual({ timeColumn, priceColumn });
        expect(resolveChartAxes(delivered, metadata, { chart_x: 'observed_at', chart_y: 'close_price' }, saved))
            .toEqual({ timeColumn: 'observed_at', priceColumn: 'close_price' });
    });

    test('round-trips axis parameters including punctuation without losing search or legacy view', () => {
        const axes = { timeColumn: 'when recorded', priceColumn: 'count+value' };
        const params = chartAxesToParams({ search: 'boat', sort_order: 'DESC' }, axes);
        const decoded = Object.fromEntries(new URLSearchParams(new URLSearchParams(params).toString()));
        expect(resolveChartAxes(['when recorded', 'count+value'], { 'when recorded': 'date', 'count+value': 'numeric' }, decoded)).toEqual(axes);
        expect(decoded).toMatchObject({ search: 'boat', view: 'price_chart', sort_order: 'DESC' });
    });

    test('parses PostgreSQL clocks using a fixed UTC day, including offsets', () => {
        expect(parse_price_chart_time('12:30:05')).toBe(Date.parse('1970-01-01T12:30:05Z'));
        expect(parse_price_chart_time('12:30:05+03')).toBe(Date.parse('1970-01-01T09:30:05Z'));
        expect(parse_price_chart_time('25:30:05')).toBeNull();
    });
});
