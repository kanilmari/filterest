import { describe, expect, test } from "vitest";
import {
    resolveKeywordRoleValue,
    splitKeywordRoleValue,
} from "./card_keyword_value_helpers.js";

describe("card keyword role values", () => {
    test("selects the active language from a genuine language-map JSON string", () => {
        const rawValue = JSON.stringify({
            fi: "binance, binance.com, kryptovaluutat",
            en: "binance, binance.com, cryptocurrencies",
        });

        expect(splitKeywordRoleValue(rawValue, "fi")).toEqual([
            "binance",
            "binance.com",
            "kryptovaluutat",
        ]);
    });

    test("uses English and then the first available language as fallbacks", () => {
        expect(resolveKeywordRoleValue(JSON.stringify({ en: "travel", fi: "matkat" }), "sv"))
            .toBe("travel");
        expect(resolveKeywordRoleValue(JSON.stringify({ de: "reisen" }), "sv"))
            .toBe("reisen");
    });

    test("preserves ordinary comma-separated keyword strings", () => {
        expect(splitKeywordRoleValue("binance, binance.com, kryptovaluutat", "fi"))
            .toEqual(["binance", "binance.com", "kryptovaluutat"]);
    });

    test("does not flatten an ordinary JSON object that is not a language map", () => {
        const rawValue = JSON.stringify({ category: "finance", rank: "one" });
        expect(resolveKeywordRoleValue(rawValue, "fi")).toBe(rawValue);
    });
});
