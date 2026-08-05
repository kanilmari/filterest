// row_geometry_helpers.test.js
// Unit tests for pure geometry suggestion helper functions.
// Between Vitest and row_geometry_helpers.js exports.
// Exists to lock extraction behavior without DOM or endpoint dependencies.

import { describe, expect, test } from "vitest";
import {
    GEOMETRY_FIELD_MAP,
    getSuggestionLabel,
    mapSuggestionToFields,
    toWKTPoint,
} from "./row_geometry_helpers.js";

describe("GEOMETRY_FIELD_MAP", () => {
    test("exports the expected suggestion fields for geometry backfill", () => {
        expect(GEOMETRY_FIELD_MAP).toEqual([
            "title",
            "label",
            "country_code",
            "country_name",
            "state",
            "county",
            "city",
            "district",
            "street",
            "house_number",
            "postal_code",
        ]);
    });
});

describe("mapSuggestionToFields", () => {
    test("returns only the fields present on the suggestion object", () => {
        const suggestion = {
            label: "Mikonkatu 8, Helsinki",
            city: "Helsinki",
            postal_code: "00100",
            ignored: "value",
        };

        expect(
            mapSuggestionToFields(suggestion, [
                "label",
                "city",
                "postal_code",
                "country_name",
            ])
        ).toEqual({
            label: "Mikonkatu 8, Helsinki",
            city: "Helsinki",
            postal_code: "00100",
        });
    });

    test("returns an empty object when the input is missing or field names are invalid", () => {
        expect(mapSuggestionToFields(null, GEOMETRY_FIELD_MAP)).toEqual({});
        expect(mapSuggestionToFields({ city: "Helsinki" }, null)).toEqual({});
    });

    test("preserves explicitly present null values", () => {
        expect(
            mapSuggestionToFields(
                { district: null, street: "Mikonkatu" },
                ["district", "street"]
            )
        ).toEqual({
            district: null,
            street: "Mikonkatu",
        });
    });
});

describe("toWKTPoint", () => {
    test("returns WKT for numeric coordinates", () => {
        expect(toWKTPoint({ lng: 24.9384, lat: 60.1699 })).toBe(
            "POINT(24.9384 60.1699)"
        );
    });

    test("accepts zero coordinates and numeric strings", () => {
        expect(toWKTPoint({ lng: 0, lat: 0 })).toBe("POINT(0 0)");
        expect(toWKTPoint({ lng: "24.1", lat: "60.2" })).toBe(
            "POINT(24.1 60.2)"
        );
    });

    test("returns null when coordinates are missing or invalid", () => {
        expect(toWKTPoint(null)).toBeNull();
        expect(toWKTPoint({ lng: 24.9 })).toBeNull();
        expect(toWKTPoint({ lng: "east", lat: 60.2 })).toBeNull();
    });
});

describe("getSuggestionLabel", () => {
    test("prefers label over title and falls back to title", () => {
        expect(
            getSuggestionLabel({ label: "Label wins", title: "Title loses" })
        ).toBe("Label wins");
        expect(getSuggestionLabel({ title: "Title only" })).toBe("Title only");
    });

    test("returns an empty string when no display label exists", () => {
        expect(getSuggestionLabel({})).toBe("");
        expect(getSuggestionLabel(null)).toBe("");
    });
});
