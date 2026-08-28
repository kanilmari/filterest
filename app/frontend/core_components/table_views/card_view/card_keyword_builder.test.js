// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./card_field_formatter.js", () => ({
    createKeyValueElement: vi.fn((_label, value) => {
        const element = document.createElement("span");
        element.textContent = value;
        return element;
    }),
}));
vi.mock("./card_element_builder.js", () => ({
    createShowMoreLink: vi.fn(() => document.createElement("a")),
}));
vi.mock("../../dev_tools/function_counter.js", () => ({ count_this_function: vi.fn() }));
vi.mock("../../../ui_config.js", () => ({ show_more_button_on_cards: false }));

import { addKeywordsSection } from "./card_keyword_builder.js";

describe("card_keyword_builder", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("small cards render the active language instead of JSON fragments", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const rawValue = JSON.stringify({
            fi: "binance, binance.com, kryptovaluutat",
            en: "binance, binance.com, cryptocurrencies",
        });

        addKeywordsSection([
            {
                column: "keywords_static",
                rawValue,
                preferredLang: "fi",
                label: "",
                hasLangKey: false,
                columnClass: "service-keywords",
            },
        ], { id: 1 }, "app_service_catalog", container);

        const values = Array.from(container.querySelectorAll(".keyword_tag"))
            .map((element) => element.textContent);
        expect(values).toEqual(["binance", "binance.com", "kryptovaluutat"]);
        expect(container.textContent).not.toContain('{"fi"');
    });
});
